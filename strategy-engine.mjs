function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export const strategyFieldCatalog = Object.freeze({
  entry: [
    { key: "minMarketCapUsd", label: "Min. market cap", unit: "USD", metric: "marketCapUsd", operator: "gte" },
    { key: "maxMarketCapUsd", label: "Maks. market cap", unit: "USD", metric: "marketCapUsd", operator: "lte" },
    { key: "minPriceUsd", label: "Min. cena tokena", unit: "USD", metric: "priceUsd", operator: "gte" },
    { key: "maxPriceUsd", label: "Maks. cena tokena", unit: "USD", metric: "priceUsd", operator: "lte" },
    { key: "minFdvUsd", label: "Min. FDV", unit: "USD", metric: "fdvUsd", operator: "gte" },
    { key: "maxFdvUsd", label: "Maks. FDV", unit: "USD", metric: "fdvUsd", operator: "lte" },
    { key: "minLaunchMarketCapUsd", label: "Min. market cap startowy", unit: "USD", metric: "launchMarketCapUsd", operator: "gte" },
    { key: "maxLaunchMarketCapUsd", label: "Maks. market cap startowy", unit: "USD", metric: "launchMarketCapUsd", operator: "lte" },
    { key: "maxLaunchGrowthPercent", label: "Maks. wzrost od startu", unit: "%", metric: "priceChangeFromLaunchPercent", operator: "lte" },
    { key: "minBondingProgressPercent", label: "Min. postęp bonding curve", unit: "%", metric: "bondingCurveProgressPercent", operator: "gte" },
    { key: "maxBondingProgressPercent", label: "Maks. postęp bonding curve", unit: "%", metric: "bondingCurveProgressPercent", operator: "lte" },
    { key: "migrationState", label: "Etap tokena", unit: "", metric: "migratedFlag", operator: "eq" },
    { key: "minLiquidityUsd", label: "Min. płynność", unit: "USD", metric: "liquidityUsd", operator: "gte" },
    { key: "maxLiquidityUsd", label: "Maks. płynność", unit: "USD", metric: "liquidityUsd", operator: "lte" },
    { key: "minVolume5mUsd", label: "Min. wolumen 5 min", unit: "USD", metric: "volume5mUsd", operator: "gte" },
    { key: "maxVolume5mUsd", label: "Maks. wolumen 5 min", unit: "USD", metric: "volume5mUsd", operator: "lte" },
    { key: "minTransactions5m", label: "Min. transakcje 5 min", unit: "", metric: "transactions5m", operator: "gte" },
    { key: "maxTransactions5m", label: "Maks. transakcje 5 min", unit: "", metric: "transactions5m", operator: "lte" },
    { key: "minBuys5m", label: "Min. kupna 5 min", unit: "", metric: "buys5m", operator: "gte" },
    { key: "maxBuys5m", label: "Maks. kupna 5 min", unit: "", metric: "buys5m", operator: "lte" },
    { key: "minSells5m", label: "Min. sprzedaże 5 min", unit: "", metric: "sells5m", operator: "gte" },
    { key: "maxSells5m", label: "Maks. sprzedaże 5 min", unit: "", metric: "sells5m", operator: "lte" },
    { key: "minBuyRatio5mPercent", label: "Min. udział kupna", unit: "%", metric: "buyRatio5mPercent", operator: "gte" },
    { key: "maxBuyRatio5mPercent", label: "Maks. udział kupna", unit: "%", metric: "buyRatio5mPercent", operator: "lte" },
    { key: "minPriceChange5m", label: "Min. zmiana 5 min", unit: "%", metric: "priceChange5m", operator: "gte" },
    { key: "maxPriceChange5m", label: "Maks. zmiana 5 min", unit: "%", metric: "priceChange5m", operator: "lte" },
    { key: "minMomentum", label: "Min. momentum", unit: "%", metric: "momentum", operator: "gte" },
    { key: "maxMomentum", label: "Maks. momentum", unit: "%", metric: "momentum", operator: "lte" },
    { key: "minVolume1hUsd", label: "Min. wolumen 1 h", unit: "USD", metric: "volume1hUsd", operator: "gte" },
    { key: "maxVolume1hUsd", label: "Maks. wolumen 1 h", unit: "USD", metric: "volume1hUsd", operator: "lte" },
    { key: "minTransactions1h", label: "Min. transakcje 1 h", unit: "", metric: "transactions1h", operator: "gte" },
    { key: "maxTransactions1h", label: "Maks. transakcje 1 h", unit: "", metric: "transactions1h", operator: "lte" },
    { key: "minBuys1h", label: "Min. kupna 1 h", unit: "", metric: "buys1h", operator: "gte" },
    { key: "maxBuys1h", label: "Maks. kupna 1 h", unit: "", metric: "buys1h", operator: "lte" },
    { key: "minSells1h", label: "Min. sprzedaże 1 h", unit: "", metric: "sells1h", operator: "gte" },
    { key: "maxSells1h", label: "Maks. sprzedaże 1 h", unit: "", metric: "sells1h", operator: "lte" },
    { key: "minPriceChange1h", label: "Min. zmiana 1 h", unit: "%", metric: "priceChange1h", operator: "gte" },
    { key: "maxPriceChange1h", label: "Maks. zmiana 1 h", unit: "%", metric: "priceChange1h", operator: "lte" },
    { key: "minVolume6hUsd", label: "Min. wolumen 6 h", unit: "USD", metric: "volume6hUsd", operator: "gte" },
    { key: "maxVolume6hUsd", label: "Maks. wolumen 6 h", unit: "USD", metric: "volume6hUsd", operator: "lte" },
    { key: "minTransactions6h", label: "Min. transakcje 6 h", unit: "", metric: "transactions6h", operator: "gte" },
    { key: "maxTransactions6h", label: "Maks. transakcje 6 h", unit: "", metric: "transactions6h", operator: "lte" },
    { key: "minBuys6h", label: "Min. kupna 6 h", unit: "", metric: "buys6h", operator: "gte" },
    { key: "maxBuys6h", label: "Maks. kupna 6 h", unit: "", metric: "buys6h", operator: "lte" },
    { key: "minSells6h", label: "Min. sprzedaże 6 h", unit: "", metric: "sells6h", operator: "gte" },
    { key: "maxSells6h", label: "Maks. sprzedaże 6 h", unit: "", metric: "sells6h", operator: "lte" },
    { key: "minPriceChange6h", label: "Min. zmiana 6 h", unit: "%", metric: "priceChange6h", operator: "gte" },
    { key: "maxPriceChange6h", label: "Maks. zmiana 6 h", unit: "%", metric: "priceChange6h", operator: "lte" },
    { key: "minVolume24hUsd", label: "Min. wolumen 24 h", unit: "USD", metric: "volume24hUsd", operator: "gte" },
    { key: "maxVolume24hUsd", label: "Maks. wolumen 24 h", unit: "USD", metric: "volume24hUsd", operator: "lte" },
    { key: "minTransactions24h", label: "Min. transakcje 24 h", unit: "", metric: "transactions24h", operator: "gte" },
    { key: "maxTransactions24h", label: "Maks. transakcje 24 h", unit: "", metric: "transactions24h", operator: "lte" },
    { key: "minBuys24h", label: "Min. kupna 24 h", unit: "", metric: "buys24h", operator: "gte" },
    { key: "maxBuys24h", label: "Maks. kupna 24 h", unit: "", metric: "buys24h", operator: "lte" },
    { key: "minSells24h", label: "Min. sprzedaże 24 h", unit: "", metric: "sells24h", operator: "gte" },
    { key: "maxSells24h", label: "Maks. sprzedaże 24 h", unit: "", metric: "sells24h", operator: "lte" },
    { key: "minPriceChange24h", label: "Min. zmiana 24 h", unit: "%", metric: "priceChange24h", operator: "gte" },
    { key: "maxPriceChange24h", label: "Maks. zmiana 24 h", unit: "%", metric: "priceChange24h", operator: "lte" },
    { key: "requireWebsite", label: "Wymagana strona", unit: "", metric: "hasWebsite", operator: "eq" },
    { key: "requireTwitter", label: "Wymagany X / Twitter", unit: "", metric: "hasTwitter", operator: "eq" },
    { key: "requireTelegram", label: "Wymagany Telegram", unit: "", metric: "hasTelegram", operator: "eq" },
    { key: "requireProfile", label: "Wymagany profil", unit: "", metric: "hasProfile", operator: "eq" },
    { key: "minActiveBoosts", label: "Min. aktywne boosty", unit: "", metric: "activeBoosts", operator: "gte" },
    { key: "maxActiveBoosts", label: "Maks. aktywne boosty", unit: "", metric: "activeBoosts", operator: "lte" },
    { key: "minHolders", label: "Min. liczba holderów", unit: "", metric: "holderCount", operator: "gte" },
    { key: "maxHolders", label: "Maks. liczba holderów", unit: "", metric: "holderCount", operator: "lte" },
    { key: "minTopHolderPercent", label: "Min. udział największego holdera", unit: "%", metric: "topHolderPercent", operator: "gte" },
    { key: "maxTopHolderPercent", label: "Maks. udział największego holdera", unit: "%", metric: "topHolderPercent", operator: "lte" },
    { key: "minTop10HoldersPercent", label: "Min. udział Top 10", unit: "%", metric: "top10HoldersPercent", operator: "gte" },
    { key: "maxTop10HoldersPercent", label: "Maks. udział Top 10", unit: "%", metric: "top10HoldersPercent", operator: "lte" },
    { key: "minAgeSeconds", label: "Min. wiek", unit: "s", metric: "ageSeconds", operator: "gte" },
    { key: "maxAgeSeconds", label: "Maks. wiek", unit: "s", metric: "ageSeconds", operator: "lte" },
    { key: "minDexPairAgeMinutes", label: "Min. wiek pary DEX", unit: "min", metric: "dexPairAgeMinutes", operator: "gte" },
    { key: "maxDexPairAgeMinutes", label: "Maks. wiek pary DEX", unit: "min", metric: "dexPairAgeMinutes", operator: "lte" },
  ],
  exit: [
    { key: "partialTakeProfitPercent", label: "Częściowy take profit od zysku", unit: "%" },
    { key: "partialSellPercent", label: "Sprzedaj część pozycji", unit: "%" },
    { key: "takeProfitPercent", label: "Take profit", unit: "%" },
    { key: "stopLossPercent", label: "Stop loss", unit: "%" },
    { key: "trailingStopPercent", label: "Trailing stop", unit: "%" },
    { key: "stagnationExitSeconds", label: "Maks. czas bez ruchu", unit: "s" },
    { key: "stagnationMovementPercent", label: "Ruch resetujący licznik", unit: "%" },
    { key: "maxHoldSeconds", label: "Maks. czas pozycji", unit: "s" },
  ],
});

function metricValue(token, metric, now) {
  if (metric === "ageSeconds") {
    const created = Date.parse(token.createdAt || token.detectedAt || "");
    return Number.isFinite(created) ? Math.max(0, (now - created) / 1000) : null;
  }
  return finite(token[metric]);
}

export function evaluateEntry(token, config, context = {}) {
  const reasons = [];
  if (!token || token.source !== "Pump.fun") reasons.push("Źródło nie jest Pump.fun");
  if (!(finite(token?.marketCapUsd) > 0)) reasons.push("Brak aktualnego market capu");
  if (context.openPositions >= config.maxOpenPositions) reasons.push("Limit otwartych pozycji");
  if (context.hasPosition) reasons.push("Pozycja jest już otwarta");
  if (context.pending) reasons.push("Transakcja już oczekuje");
  if (context.tradedBefore && config.onePositionPerToken) reasons.push("Token był już kupiony w tej sesji");
  const now = context.now || Date.now();
  for (const rule of strategyFieldCatalog.entry) {
    const expected = finite(config[rule.key]);
    if (expected === null) continue;
    const actual = metricValue(token, rule.metric, now);
    // Włączona reguła bez danych nie może przepuścić tokena przypadkiem.
    if (actual === null) { reasons.push(`Brak danych: ${rule.label}`); continue; }
    if (rule.operator === "gte" && actual < expected) reasons.push(`${rule.label} poniżej minimum`);
    if (rule.operator === "lte" && actual > expected) reasons.push(`${rule.label} powyżej maksimum`);
    if (rule.operator === "eq" && actual !== expected) reasons.push(`${rule.label} nie pasuje`);
  }
  return { pass: reasons.length === 0, reasons };
}

export function evaluateExit(position, token, config, now = Date.now()) {
  const currentMc = finite(token?.marketCapUsd);
  if (!(currentMc > 0) || !(position.entryMarketCapUsd > 0)) return { pass: false, reason: null, pnlPercent: null };
  const pnlPercent = (currentMc / position.entryMarketCapUsd - 1) * 100;
  if (finite(config.takeProfitPercent) !== null && pnlPercent >= config.takeProfitPercent) return { pass: true, reason: "TAKE_PROFIT", pnlPercent };
  if (!position.partialTakeProfitDone && finite(config.partialTakeProfitPercent) !== null && finite(config.partialSellPercent) > 0 && pnlPercent >= config.partialTakeProfitPercent) return { pass: true, reason: "PARTIAL_TAKE_PROFIT", pnlPercent };
  if (finite(config.stopLossPercent) !== null && pnlPercent <= -config.stopLossPercent) return { pass: true, reason: "STOP_LOSS", pnlPercent };
  if (finite(config.trailingStopPercent) !== null && position.highWaterMarketCapUsd > 0) {
    const drawdown = (currentMc / position.highWaterMarketCapUsd - 1) * 100;
    if (drawdown <= -config.trailingStopPercent) return { pass: true, reason: "TRAILING_STOP", pnlPercent };
  }
  if (finite(config.stagnationExitSeconds) !== null) {
    const lastMove = Date.parse(position.lastMeaningfulMoveAt || position.openedAt);
    if (Number.isFinite(lastMove) && now - lastMove >= config.stagnationExitSeconds * 1000) return { pass: true, reason: "NO_MOVEMENT", pnlPercent };
  }
  if (finite(config.maxHoldSeconds) !== null && now - Date.parse(position.openedAt) >= config.maxHoldSeconds * 1000) return { pass: true, reason: "MAX_HOLD", pnlPercent };
  return { pass: false, reason: null, pnlPercent };
}

