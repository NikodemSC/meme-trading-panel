import { PaperEngine, normalizePaperConfig } from "./paper-engine.mjs";
import { evaluateExit } from "./strategy-engine.mjs";

const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class CopyEngine extends PaperEngine {
  fresh(balanceUsd = 1000) {
    const state = super.fresh(balanceUsd);
    state.config = { ...state.config, sourceWallet: "", scalePercent: 100, autoSell: false };
    state.sourceWallet = "";
    state.seenSignatures = [];
    state.pendingSourceTrades = [];
    return state;
  }

  load() {
    const state = super.load();
    state.config = { ...state.config, sourceWallet: String(state.config.sourceWallet || state.sourceWallet || ""), scalePercent: Number(state.config.scalePercent) > 0 ? Number(state.config.scalePercent) : 100, autoSell: state.config.autoSell === true };
    state.sourceWallet = state.config.sourceWallet;
    state.seenSignatures = Array.isArray(state.seenSignatures) ? state.seenSignatures.slice(0, 500) : [];
    state.pendingSourceTrades = Array.isArray(state.pendingSourceTrades) ? state.pendingSourceTrades : [];
    return state;
  }

  updateConfig(input = {}) {
    const base = normalizePaperConfig(input);
    const sourceWallet = String(input.sourceWallet ?? this.state.config.sourceWallet ?? "").trim();
    if (sourceWallet && !addressPattern.test(sourceWallet)) throw Error("Wpisz poprawny adres portfela Solana.");
    const scalePercent = Number(input.scalePercent ?? this.state.config.scalePercent ?? 100);
    if (!Number.isFinite(scalePercent) || scalePercent <= 0 || scalePercent > 1000) throw Error("Skala kopiowania musi być od 0,01% do 1000%.");
    this.state.config = { ...base, sourceWallet, scalePercent, autoSell: input.autoSell === true };
    this.state.sourceWallet = sourceWallet;
    this.log("Zapisano ustawienia Copy.", "SETTINGS");
    this.emit("copy-config");
    return this.publicState();
  }

  clearConfig() {
    const sourceWallet = this.state.config.sourceWallet || "";
    const scalePercent = this.state.config.scalePercent || 100;
    const autoSell = this.state.config.autoSell === true;
    this.state.config = { ...normalizePaperConfig({}), sourceWallet, scalePercent, autoSell };
    this.log("Przywrócono domyślne ustawienia Copy.", "SETTINGS");
    this.emit("copy-config");
    return this.publicState();
  }

  setSourceWallet(address) {
    const sourceWallet = String(address || "").trim();
    if (!addressPattern.test(sourceWallet)) throw Error("Wpisz poprawny adres portfela Solana.");
    this.state.config.sourceWallet = sourceWallet;
    this.state.sourceWallet = sourceWallet;
    this.state.status = "running";
    this.state.seenSignatures = [];
    this.log(`Ustawiono kopiowany portfel ${sourceWallet.slice(0, 6)}…${sourceWallet.slice(-5)}.`, "COPY");
    this.emit("copy-source");
    return this.publicState();
  }

  markSignatures(signatures) {
    this.state.seenSignatures = [...new Set([...signatures, ...this.state.seenSignatures])].slice(0, 500);
    this.persist();
  }

  hasSeenSignature(signature) { return this.state.seenSignatures.includes(signature); }

  onSourceTrade(event) {
    if (!event?.mint || !this.state.config.sourceWallet) return;
    if (!(Number(this.getToken(event.mint)?.marketCapUsd) > 0)) { this.state.pendingSourceTrades.push(event); this.state.pendingSourceTrades = this.state.pendingSourceTrades.slice(-100); this.persist(); return; }
    const sourceAmount = Number(event.amountUsd);
    const amountUsd = Number.isFinite(sourceAmount) && sourceAmount > 0 ? sourceAmount * Number(this.state.config.scalePercent || 100) / 100 : this.state.config.entryAmountUsd;
    if (event.side === "BUY") this.schedule("BUY", event.mint, "COPY_BUY", { entryAmountUsd: amountUsd, sourceMarketCapUsd: event.marketCapUsd });
    if (event.side === "SELL" && !this.state.config.autoSell) this.schedule("SELL", event.mint, "COPY_SELL", { sourceMarketCapUsd: event.marketCapUsd });
  }

  onMarketUpdate(token) {
    if (!token?.mint || !(Number(token.marketCapUsd) > 0)) return;
    const waiting = this.state.pendingSourceTrades.filter(item => item.mint === token.mint);
    if (waiting.length) { this.state.pendingSourceTrades = this.state.pendingSourceTrades.filter(item => item.mint !== token.mint); for (const event of waiting) this.onSourceTrade(event); }
    let changed = false;
    for (const position of this.state.positions.filter(item => item.mint === token.mint && item.status === "OPEN")) {
      const mc = Number(token.marketCapUsd);
      if (mc > (position.highWaterMarketCapUsd || position.entryMarketCapUsd)) { position.highWaterMarketCapUsd = mc; changed = true; }
      position.lastMarketCapUsd = mc; position.lastPriceAt = token.mcUpdatedAt || new Date().toISOString();
      if (this.state.config.autoSell && this.state.status === "running") { const exit = evaluateExit(position, token, this.state.config); if (exit.pass) this.schedule("SELL", token.mint, exit.reason); }
    }
    if (changed) this.emit("copy-mark");
  }

  publicState() {
    return { ...super.publicState(), sourceWallet: this.state.config.sourceWallet || "", scalePercent: this.state.config.scalePercent, autoSell: this.state.config.autoSell === true };
  }

  copyStats() {
    const buys = this.state.history.filter(item => item.side === "BUY" && Number(item.sourceMarketCapUsd) > 0 && Number(item.marketCapUsd) > 0);
    const differences = buys.map(item => Number(item.marketCapUsd) / Number(item.sourceMarketCapUsd) - 1);
    const average = differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length * 100 : null;
    return { averageMarketCapDifferencePercent: average === null ? null : Number(average.toFixed(2)), samples: differences.length };
  }
}

