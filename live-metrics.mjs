const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;

function percent(from, to) {
  return from > 0 && to > 0 ? (to / from - 1) * 100 : 0;
}

export class RollingMarketMetrics {
  constructor({ windowMs = FIVE_MINUTES, momentumMs = ONE_MINUTE, maxEventsPerToken = 2000 } = {}) {
    this.windowMs = windowMs;
    this.momentumMs = momentumMs;
    this.maxEventsPerToken = maxEventsPerToken;
    this.byMint = new Map();
  }
  drop(mint) { this.byMint.delete(mint); }
  update(token, event, quote = {}) {
    if (!token?.mint) return token;
    const now = Number(event?.timestamp) > 0 ? Number(event.timestamp) * 1000 : Date.now();
    let events = this.byMint.get(token.mint) || [];
    if (event?.type === "trade") {
      const decimals = Number(quote.decimals);
      const price = Number(quote.price);
      const rawQuote = Number(event.quoteAmount ?? event.solAmount);
      const volumeUsd = Number.isFinite(rawQuote) && Number.isInteger(decimals) && price > 0 ? rawQuote / 10 ** decimals * price : 0;
      events.push({ at: now, volumeUsd, marketCapUsd: Number(token.marketCapUsd) || 0, isBuy: Boolean(event.isBuy) });
    }
    const cutoff = now - this.windowMs;
    events = events.filter(item => item.at >= cutoff).slice(-this.maxEventsPerToken);
    this.byMint.set(token.mint, events);
    const currentMc = Number(token.marketCapUsd) || 0;
    const first = events[0];
    const momentumFirst = events.find(item => item.at >= now - this.momentumMs) || first;
    token.transactions5m = events.length;
    token.volume5mUsd = events.reduce((sum, item) => sum + item.volumeUsd, 0);
    token.buys5m = events.reduce((sum, item) => sum + (item.isBuy ? 1 : 0), 0);
    token.sells5m = events.length - token.buys5m;
    token.buyRatio5mPercent = events.length ? token.buys5m / events.length * 100 : 0;
    token.priceChange5m = first ? percent(first.marketCapUsd, currentMc) : 0;
    token.momentum = momentumFirst ? percent(momentumFirst.marketCapUsd, currentMc) : 0;
    const reserve = Number(event?.realQuote ?? event?.realSol);
    const decimals = Number(quote.decimals), price = Number(quote.price);
    if (Number.isFinite(reserve) && Number.isInteger(decimals) && price > 0) token.liquidityUsd = Math.max(0, reserve / 10 ** decimals * price * 2);
    else if (!Number.isFinite(Number(token.liquidityUsd))) token.liquidityUsd = 0;
    token.metricsUpdatedAt = new Date(now).toISOString();
    return token;
  }
}

