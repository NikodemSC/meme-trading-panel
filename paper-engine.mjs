import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { evaluateEntry, evaluateExit, strategyFieldCatalog } from "./strategy-engine.mjs";
import { addTradeToDailyResults } from "./paper-stats.mjs";

const defaultConfig = Object.freeze({
  entryAmountUsd: 25,
  maxOpenPositions: 5,
  onePositionPerToken: true,
  minMarketCapUsd: 5000,
  maxMarketCapUsd: null,
  minPriceUsd: null,
  maxPriceUsd: null,
  minFdvUsd: null,
  maxFdvUsd: null,
  minLaunchMarketCapUsd: null,
  maxLaunchMarketCapUsd: null,
  maxLaunchGrowthPercent: 500,
  minBondingProgressPercent: null,
  maxBondingProgressPercent: null,
  migrationState: null,
  minLiquidityUsd: null,
  maxLiquidityUsd: null,
  minVolume5mUsd: null,
  maxVolume5mUsd: null,
  minTransactions5m: null,
  maxTransactions5m: null,
  minBuys5m: null,
  maxBuys5m: null,
  minSells5m: null,
  maxSells5m: null,
  minBuyRatio5mPercent: null,
  maxBuyRatio5mPercent: null,
  minPriceChange5m: null,
  maxPriceChange5m: null,
  minMomentum: null,
  maxMomentum: null,
  minVolume1hUsd: null,
  maxVolume1hUsd: null,
  minTransactions1h: null,
  maxTransactions1h: null,
  minBuys1h: null,
  maxBuys1h: null,
  minSells1h: null,
  maxSells1h: null,
  minPriceChange1h: null,
  maxPriceChange1h: null,
  minVolume6hUsd: null,
  maxVolume6hUsd: null,
  minTransactions6h: null,
  maxTransactions6h: null,
  minBuys6h: null,
  maxBuys6h: null,
  minSells6h: null,
  maxSells6h: null,
  minPriceChange6h: null,
  maxPriceChange6h: null,
  minVolume24hUsd: null,
  maxVolume24hUsd: null,
  minTransactions24h: null,
  maxTransactions24h: null,
  minBuys24h: null,
  maxBuys24h: null,
  minSells24h: null,
  maxSells24h: null,
  minPriceChange24h: null,
  maxPriceChange24h: null,
  requireWebsite: null,
  requireTwitter: null,
  requireTelegram: null,
  requireProfile: null,
  minActiveBoosts: null,
  maxActiveBoosts: null,
  minHolders: null,
  maxHolders: null,
  minTopHolderPercent: null,
  maxTopHolderPercent: null,
  minTop10HoldersPercent: null,
  maxTop10HoldersPercent: null,
  minAgeSeconds: null,
  maxAgeSeconds: 120,
  minDexPairAgeMinutes: null,
  maxDexPairAgeMinutes: null,
  takeProfitPercent: 50,
  partialTakeProfitPercent: null,
  partialSellPercent: null,
  stopLossPercent: 20,
  trailingStopPercent: null,
  stagnationExitSeconds: null,
  stagnationMovementPercent: 1,
  maxHoldSeconds: 300,
  networkFeeUsd: 0.001,
  platformFeePercent: 1,
  slippagePercent: 1,
  priceImpactPercent: 0.5,
  executionDelayMs: 750,
});

function numberOrNull(value, { min = -Infinity, max = Infinity } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
function round(value, digits = 8) { return Number(Number(value || 0).toFixed(digits)); }
function clone(value) { return structuredClone(value); }

export function normalizePaperConfig(input = {}) {
  const result = { ...defaultConfig };
  for (const rule of strategyFieldCatalog.entry) {
    if (Object.prototype.hasOwnProperty.call(input, rule.key)) result[rule.key] = numberOrNull(input[rule.key], { min: /PriceChange|Momentum/.test(rule.key) ? -100000 : 0, max: /BuyRatio|TopHolder|Top10Holders/.test(rule.key) ? 100 : Infinity });
  }
  for (const rule of strategyFieldCatalog.exit) {
    if (Object.prototype.hasOwnProperty.call(input, rule.key)) result[rule.key] = numberOrNull(input[rule.key], { min: 0 });
  }
  result.partialSellPercent = numberOrNull(input.partialSellPercent, { min: 0.01, max: 100 });
  if (result.partialTakeProfitPercent === null || result.partialSellPercent === null) {
    result.partialTakeProfitPercent = null;
    result.partialSellPercent = null;
  }
  result.entryAmountUsd = numberOrNull(input.entryAmountUsd, { min: 0.01 }) ?? defaultConfig.entryAmountUsd;
  result.maxOpenPositions = Math.floor(numberOrNull(input.maxOpenPositions, { min: 1, max: 100 }) ?? defaultConfig.maxOpenPositions);
  result.onePositionPerToken = input.onePositionPerToken !== false;
  result.networkFeeUsd = numberOrNull(input.networkFeeUsd, { min: 0 }) ?? 0;
  result.platformFeePercent = numberOrNull(input.platformFeePercent, { min: 0, max: 100 }) ?? 0;
  result.slippagePercent = numberOrNull(input.slippagePercent, { min: 0, max: 100 }) ?? 0;
  result.priceImpactPercent = numberOrNull(input.priceImpactPercent, { min: 0, max: 100 }) ?? 0;
  result.executionDelayMs = Math.round(numberOrNull(input.executionDelayMs, { min: 0, max: 60000 }) ?? 0);
  if (Object.prototype.hasOwnProperty.call(input, "sourceWallet")) result.sourceWallet = String(input.sourceWallet || "").trim();
  if (Object.prototype.hasOwnProperty.call(input, "scalePercent")) result.scalePercent = numberOrNull(input.scalePercent, { min: 0.01, max: 1000 }) ?? 100;
  if (Object.prototype.hasOwnProperty.call(input, "autoSell")) result.autoSell = input.autoSell === true;
  return result;
}

export class PaperEngine {
  constructor({ dataPath, getToken, publish }) {
    this.dataPath = dataPath;
    this.getToken = getToken;
    this.publish = publish || (() => {});
    this.pending = new Map();
    this.saveTimer = null;
    this.holdTimer = null;
    this.state = this.load();
    this.startHoldMonitor();
  }
  fresh(balanceUsd = 1000) {
    const now = new Date().toISOString();
    return { version: 1, status: "stopped", config: { ...defaultConfig }, wallet: { initialBalanceUsd: balanceUsd, cashUsd: balanceUsd, createdAt: now }, positions: [], history: [], dailyResults: {}, logs: [], sequence: 0, updatedAt: now };
  }
  load() {
    try {
      if (!existsSync(this.dataPath)) return this.fresh();
      const parsed = JSON.parse(readFileSync(this.dataPath, "utf8"));
      const history = Array.isArray(parsed.history) ? parsed.history : [];
      const dailyResults = parsed.dailyResults && typeof parsed.dailyResults === "object" ? parsed.dailyResults : {};
      if (!parsed.dailyResults) for (const trade of [...history].reverse()) addTradeToDailyResults(dailyResults, trade);
      return { ...this.fresh(), ...parsed, status: parsed.status, config: normalizePaperConfig(parsed.config), wallet: { ...this.fresh().wallet, ...parsed.wallet }, positions: Array.isArray(parsed.positions) ? parsed.positions : [], history, dailyResults, logs: Array.isArray(parsed.logs) ? parsed.logs : [] };
    } catch { return this.fresh(); }
  }
  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const temp = `${this.dataPath}.tmp`;
      writeFileSync(temp, JSON.stringify(this.state, null, 2));
      renameSync(temp, this.dataPath);
    }, 80);
  }
  log(message, type = "INFO") {
    this.state.logs.unshift({ id: randomUUID(), at: new Date().toISOString(), type, message });
    this.state.logs = this.state.logs.slice(0, 100);
  }
  emit(kind = "paper") {
    this.state.updatedAt = new Date().toISOString();
    this.persist();
    this.publish(kind, this.publicState());
  }
  setStatus(status) {
    if (!["running", "paused", "stopped"].includes(status)) throw Error("Nieprawidłowy status bota.");
    this.state.status = status;
    this.log(status === "running" ? "Bot uruchomiony." : status === "paused" ? "Bot wstrzymany." : "Bot zatrzymany.", "STATUS");
    this.emit("paper-status");
    return this.publicState();
  }
  updateConfig(input) {
    this.state.config = normalizePaperConfig(input);
    this.log("Zapisano ustawienia strategii i symulacji.", "SETTINGS");
    this.emit("paper-config");
    return this.publicState();
  }
  clearConfig() {
    this.state.config = { ...defaultConfig };
    this.log("Przywrócono domyślne ustawienia strategii i symulacji.", "SETTINGS");
    this.emit("paper-config");
    return this.publicState();
  }
  resetWallet(balanceUsd) {
    const balance = numberOrNull(balanceUsd, { min: 0.01 });
    if (balance === null) throw Error("Saldo musi być większe od zera.");
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    const config = this.state.config;
    this.state = this.fresh(balance);
    this.state.config = config;
    this.log(`Utworzono nowy portfel Paper z saldem $${balance.toFixed(2)}.`, "WALLET");
    this.emit("paper-reset");
    return this.publicState();
  }
  clearSession() { return this.resetWallet(this.state.wallet.initialBalanceUsd); }
  hasTraded(mint) { return this.state.history.some(trade => trade.mint === mint && trade.side === "BUY"); }
  onMarketUpdate(token) {
    if (!token?.mint || !(Number(token.marketCapUsd) > 0)) return;
    let changed = false;
    for (const position of this.state.positions.filter(item => item.mint === token.mint && item.status === "OPEN")) {
      const mc = Number(token.marketCapUsd);
      if (mc > (position.highWaterMarketCapUsd || position.entryMarketCapUsd)) { position.highWaterMarketCapUsd = mc; changed = true; }
      if (this.state.config.stagnationExitSeconds !== null) {
        const reference = Number(position.stagnationReferenceMarketCapUsd || position.entryMarketCapUsd);
        const threshold = Number(this.state.config.stagnationMovementPercent ?? 1);
        const movement = reference > 0 ? Math.abs(mc / reference - 1) * 100 : 0;
        if (movement >= threshold) {
          position.stagnationReferenceMarketCapUsd = mc;
          position.lastMeaningfulMoveAt = token.mcUpdatedAt || new Date().toISOString();
          changed = true;
        }
      }
      position.lastMarketCapUsd = mc;
      position.lastPriceAt = token.mcUpdatedAt || new Date().toISOString();
      if (this.state.status === "running") {
        const exit = evaluateExit(position, token, this.state.config);
        if (exit.pass) this.schedule("SELL", token.mint, exit.reason);
      }
    }
    if (this.state.status === "running") {
      const evaluation = evaluateEntry(token, this.state.config, {
        openPositions: this.state.positions.filter(item => item.status === "OPEN").length + [...this.pending.values()].filter(item => item.side === "BUY").length,
        hasPosition: this.state.positions.some(item => item.mint === token.mint && item.status === "OPEN"),
        pending: this.pending.has(`BUY:${token.mint}`),
        tradedBefore: this.hasTraded(token.mint),
      });
      if (evaluation.pass) this.schedule("BUY", token.mint, "ENTRY_RULES");
    }
    if (changed) this.emit("paper-mark");
  }
  schedule(side, mint, reason, options = {}) {
    const key = `${side}:${mint}`;
    if (this.pending.has(key)) return;
    const delay = this.state.config.executionDelayMs;
    const token = this.getToken(mint);
    const scheduledAt = new Date().toISOString();
    const pending = { side, mint, reason, entryAmountUsd: numberOrNull(options.entryAmountUsd, { min: 0.01 }) ?? null, sourceMarketCapUsd: numberOrNull(options.sourceMarketCapUsd, { min: 0.00000001 }) ?? null, signalMarketCapUsd: Number(token?.marketCapUsd) || null, scheduledAt, executeAt: new Date(Date.now() + delay).toISOString() };
    if (side === "BUY") {
      const entryAmountUsd = pending.entryAmountUsd ?? this.state.config.entryAmountUsd;
      const estimatedFees = this.costs(entryAmountUsd);
      pending.reservedUsd = entryAmountUsd + estimatedFees.networkFeeUsd + estimatedFees.platformFeeUsd;
      const alreadyReserved = [...this.pending.values()].filter(item => item.side === "BUY").reduce((sum, item) => sum + Number(item.reservedUsd || 0), 0);
      if (this.state.wallet.cashUsd - alreadyReserved < pending.reservedUsd) { this.log(`${token?.symbol || mint}: brak wolnych środków na zablokowanie BUY.`, "SKIP"); return this.emit("paper-skip"); }
    }
    pending.timer = setTimeout(() => { this.pending.delete(key); side === "BUY" ? this.executeBuy(mint, reason, pending) : this.executeSell(mint, reason, pending); }, delay);
    this.pending.set(key, pending);
    this.emit("paper-pending");
  }
  costs(grossUsd) {
    const platformFeeUsd = grossUsd * this.state.config.platformFeePercent / 100;
    const priceImpactUsd = grossUsd * this.state.config.priceImpactPercent / 100;
    return { networkFeeUsd: this.state.config.networkFeeUsd, platformFeeUsd, slippageUsd: 0, priceImpactUsd };
  }
  executeBuy(mint, reason, pending = {}) {
    if (this.state.status !== "running") return this.emit("paper-skip");
    const token = this.getToken(mint);
    if (!token || !(Number(token.marketCapUsd) > 0)) { this.log(`${token?.symbol || mint}: brak ceny wykonania BUY.`, "SKIP"); return this.emit("paper-skip"); }
    let executionMovePercent = 0;
    if (pending.signalMarketCapUsd > 0) {
      const entryMovePercent = (token.marketCapUsd / pending.signalMarketCapUsd - 1) * 100;
      executionMovePercent = entryMovePercent;
      if (entryMovePercent > this.state.config.slippagePercent) {
        this.log(`${token?.symbol || mint}: BUY odrzucony — ruch ${entryMovePercent.toFixed(1)}% przekroczył slippage ${this.state.config.slippagePercent.toFixed(1)}%.`, "SKIP");
        return this.emit("paper-skip");
      }
    }
    const grossUsd = Math.min(pending.entryAmountUsd ?? this.state.config.entryAmountUsd, this.state.wallet.cashUsd);
    const fees = this.costs(grossUsd);
    const debitedUsd = grossUsd + fees.networkFeeUsd + fees.platformFeeUsd;
    if (grossUsd <= 0 || debitedUsd > this.state.wallet.cashUsd) { this.log(`${token.symbol || mint}: za mało środków na BUY.`, "SKIP"); return this.emit("paper-skip"); }
    const netAssetUsd = Math.max(0, grossUsd - fees.priceImpactUsd);
    if (netAssetUsd <= 0) return;
    const fraction = netAssetUsd / token.marketCapUsd;
    const tokenSupplyUi = Number(token.supply) / 10 ** Number(token.decimals ?? 6);
    const openedAt = new Date().toISOString();
    const actualDelayMs = Math.max(0, Date.now() - Date.parse(pending.scheduledAt || openedAt));
    const position = { id: randomUUID(), mint, name: token.name, symbol: token.symbol, image: token.image, status: "OPEN", openedAt, entryReason: reason, sourceMarketCapUsd: pending.sourceMarketCapUsd, signalMarketCapUsd: pending.signalMarketCapUsd, executionMovePercent, executionDelayMs: actualDelayMs, entryMarketCapUsd: token.marketCapUsd, lastMarketCapUsd: token.marketCapUsd, highWaterMarketCapUsd: token.marketCapUsd, stagnationReferenceMarketCapUsd: token.marketCapUsd, lastMeaningfulMoveAt: openedAt, supplyFraction: fraction, tokenAmount: Number.isFinite(tokenSupplyUi) ? fraction * tokenSupplyUi : null, grossEntryUsd: grossUsd, entryAssetValueUsd: netAssetUsd, entryDebitedUsd: debitedUsd, entryFees: fees, sourceSignature: token.signature };
    this.state.wallet.cashUsd = round(this.state.wallet.cashUsd - debitedUsd);
    this.state.positions.push(position);
    this.state.history.unshift({ id: randomUUID(), positionId: position.id, side: "BUY", status: "FILLED", mint, name: token.name, symbol: token.symbol, image: token.image, at: position.openedAt, reason, sourceMarketCapUsd: pending.sourceMarketCapUsd, signalMarketCapUsd: pending.signalMarketCapUsd, marketCapUsd: token.marketCapUsd, executionMovePercent, executionDelayMs: actualDelayMs, slippageTolerancePercent: this.state.config.slippagePercent, grossUsd, netAssetUsd, totalWalletChangeUsd: -debitedUsd, ...fees });
    addTradeToDailyResults(this.state.dailyResults, this.state.history[0]);
    this.state.history = this.state.history.slice(0, 1000);
    this.log(`${token.symbol || mint}: wirtualny BUY za $${grossUsd.toFixed(2)}.`, "BUY");
    this.emit("paper-trade");
  }
  executeSell(mint, reason, pending = {}) {
    if (this.state.status !== "running") return this.emit("paper-skip");
    const token = this.getToken(mint);
    const positions = this.state.positions.filter(item => item.mint === mint && item.status === "OPEN");
    if (!token || !(token.marketCapUsd > 0) || !positions.length) return;
    if (pending.signalMarketCapUsd > 0) {
      const adverseMovePercent = (1 - token.marketCapUsd / pending.signalMarketCapUsd) * 100;
      if (adverseMovePercent > this.state.config.slippagePercent) { this.log(`${token.symbol || mint}: SELL odrzucony — ruch ${adverseMovePercent.toFixed(1)}% przekroczył slippage ${this.state.config.slippagePercent.toFixed(1)}%.`, "SKIP"); return this.emit("paper-skip"); }
    }
    for (const position of positions) {
      if (reason === "PARTIAL_TAKE_PROFIT" && position.partialTakeProfitDone) continue;
      const isPartial = reason === "PARTIAL_TAKE_PROFIT" && this.state.config.partialSellPercent < 100;
      const soldPercent = isPartial ? this.state.config.partialSellPercent : 100;
      const soldFraction = position.supplyFraction * soldPercent / 100;
      const grossUsd = soldFraction * token.marketCapUsd;
      const fees = this.costs(grossUsd);
      const creditedUsd = Math.max(0, grossUsd - fees.networkFeeUsd - fees.platformFeeUsd - fees.priceImpactUsd);
      const basisBefore = Number(position.remainingCostBasisUsd ?? position.entryDebitedUsd);
      const soldBasisUsd = basisBefore * soldPercent / 100;
      const realizedPnlUsd = creditedUsd - soldBasisUsd;
      const at = new Date().toISOString();
      position.realizedPnlUsd = round(Number(position.realizedPnlUsd || 0) + realizedPnlUsd);
      position.remainingCostBasisUsd = round(Math.max(0, basisBefore - soldBasisUsd));
      if (isPartial) {
        position.supplyFraction = round(position.supplyFraction - soldFraction, 16);
        if (position.tokenAmount !== null) position.tokenAmount = round(position.tokenAmount * (1 - soldPercent / 100), 12);
        position.partialTakeProfitDone = true;
      } else {
        position.status = "CLOSED"; position.closedAt = at; position.exitReason = reason; position.exitMarketCapUsd = token.marketCapUsd; position.exitGrossUsd = grossUsd; position.exitCreditedUsd = creditedUsd;
      }
      this.state.wallet.cashUsd = round(this.state.wallet.cashUsd + creditedUsd);
      this.state.history.unshift({ id: randomUUID(), positionId: position.id, side: "SELL", status: "FILLED", mint, name: token.name, symbol: token.symbol, image: token.image, at, reason, soldPercent, partial: isPartial, sourceMarketCapUsd: pending.sourceMarketCapUsd, signalMarketCapUsd: pending.signalMarketCapUsd, marketCapUsd: token.marketCapUsd, executionDelayMs: Math.max(0, Date.now()-Date.parse(pending.scheduledAt||at)), slippageTolerancePercent: this.state.config.slippagePercent, grossUsd, netAssetUsd: creditedUsd, totalWalletChangeUsd: creditedUsd, realizedPnlUsd, ...fees });
      addTradeToDailyResults(this.state.dailyResults, this.state.history[0]);
      this.log(`${token.symbol || mint}: wirtualny SELL ${soldPercent}% · ${reason} · PnL ${realizedPnlUsd >= 0 ? "+" : ""}$${realizedPnlUsd.toFixed(2)}.`, "SELL");
    }
    this.state.history = this.state.history.slice(0, 1000);
    this.emit("paper-trade");
  }
  startHoldMonitor() {
    this.holdTimer = setInterval(() => {
      if (this.state.status !== "running" || (this.state.config.maxHoldSeconds === null && this.state.config.stagnationExitSeconds === null)) return;
      for (const position of this.state.positions.filter(item => item.status === "OPEN")) {
        const token = this.getToken(position.mint); if (!token) continue;
        const exit = evaluateExit(position, token, this.state.config);
        if (exit.pass) this.schedule("SELL", position.mint, exit.reason);
      }
    }, 250);
    this.holdTimer.unref?.();
  }
  close() {
    clearInterval(this.holdTimer);
    clearTimeout(this.saveTimer);
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2));
  }
  publicState() {
    const open = this.state.positions.filter(item => item.status === "OPEN").map(position => {
      const token = this.getToken(position.mint);
      const currentMc = Number(token?.marketCapUsd || position.lastMarketCapUsd || position.entryMarketCapUsd);
      const currentValueUsd = position.supplyFraction * currentMc;
      const basis = Number(position.remainingCostBasisUsd ?? position.entryDebitedUsd);
      return { ...position, currentMarketCapUsd: currentMc, currentValueUsd, unrealizedPnlUsd: currentValueUsd - basis, pnlPercent: basis > 0 ? (currentValueUsd / basis - 1) * 100 : 0, image: token?.image || position.image, name: token?.name || position.name, symbol: token?.symbol || position.symbol };
    });
    const realizedPnlUsd = this.state.positions.reduce((sum, item) => sum + Number(item.realizedPnlUsd || 0), 0);
    const openValueUsd = open.reduce((sum, item) => sum + item.currentValueUsd, 0);
    const unrealizedPnlUsd = open.reduce((sum, item) => sum + item.unrealizedPnlUsd, 0);
    const equityUsd = this.state.wallet.cashUsd + openValueUsd;
    const history = this.state.history.map(trade => { const token = this.getToken(trade.mint); return { ...trade, name: token?.name || trade.name, symbol: token?.symbol || trade.symbol, image: token?.image || trade.image }; });
    return { mode: "paper-only", realTrading: false, status: this.state.status, config: clone(this.state.config), wallet: { ...this.state.wallet, equityUsd, openValueUsd, realizedPnlUsd, unrealizedPnlUsd, totalPnlUsd: equityUsd - this.state.wallet.initialBalanceUsd }, positions: open, history: clone(history), logs: clone(this.state.logs.slice(0, 30)), pending: [...this.pending.values()].map(({ timer, ...item }) => item), updatedAt: this.state.updatedAt };
  }
}

