const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
});

export function warsawDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return [parts.year, parts.month, parts.day].join("-");
}

export function addTradeToDailyResults(results, trade) {
  const day = warsawDay(trade.at);
  if (!day) return;
  const entry = results[day] ||= { realizedPnlUsd: 0, buyCount: 0, sellCount: 0, winCount: 0, lossCount: 0 };
  if (trade.side === "BUY") entry.buyCount++;
  if (trade.side === "SELL") {
    entry.sellCount++;
    const pnl = Number(trade.realizedPnlUsd || 0);
    entry.realizedPnlUsd = Number((entry.realizedPnlUsd + pnl).toFixed(8));
    if (pnl > 0) entry.winCount++;
    if (pnl < 0) entry.lossCount++;
  }
}

const ranges = [
  { id: "under4k", label: "Poniżej $4k", min: 0, max: 4000 },
  { id: "4to10k", label: "$4k – $10k", min: 4000, max: 10000 },
  { id: "10to30k", label: "$10k – $30k", min: 10000, max: 30000 },
  { id: "above30k", label: "$30k i więcej", min: 30000, max: Infinity },
];

export function buildPaperStats(engine) {
  const snapshot = engine.publicState();
  const positions = engine.state.positions;
  const openById = new Map(snapshot.positions.map(position => [position.id, position]));
  const buckets = ranges.map(range => ({ ...range, count: 0, profitable: 0, losing: 0, flat: 0, open: 0, closed: 0, sharePercent: 0 }));
  let closedWins = 0, closedLosses = 0, closedFlat = 0;
  for (const position of positions) {
    const marketCap = Number(position.entryMarketCapUsd);
    const bucket = buckets.find(item => marketCap >= item.min && marketCap < item.max);
    if (!bucket) continue;
    const open = position.status === "OPEN",live = openById.get(position.id);
    const pnl = Number(position.realizedPnlUsd || 0) + (open ? Number(live?.unrealizedPnlUsd || 0) : 0);
    bucket.count++;
    bucket[open ? "open" : "closed"]++;
    bucket[pnl > 0 ? "profitable" : pnl < 0 ? "losing" : "flat"]++;
    if (!open) {
      if (pnl > 0) closedWins++;
      else if (pnl < 0) closedLosses++;
      else closedFlat++;
    }
  }
  for (const bucket of buckets) bucket.sharePercent = positions.length ? Number((bucket.count / positions.length * 100).toFixed(1)) : 0;
  return {
    wallet: { equityUsd: snapshot.wallet.equityUsd, realizedPnlUsd: snapshot.wallet.realizedPnlUsd, unrealizedPnlUsd: snapshot.wallet.unrealizedPnlUsd, totalPnlUsd: snapshot.wallet.totalPnlUsd },
    totals: {
      entries: positions.length, open: snapshot.positions.length, closed: positions.length - snapshot.positions.length,
      closedWins, closedLosses, closedFlat,
      winRatePercent: closedWins + closedLosses ? Number((closedWins / (closedWins + closedLosses) * 100).toFixed(1)) : null,
    },
    buckets,
    days: structuredClone(engine.state.dailyResults || {}),
    timezone: "Europe/Warsaw",
  };
}

