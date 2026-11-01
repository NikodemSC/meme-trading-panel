import { PaperEngine } from "./paper-engine.mjs";
import { evaluateExit } from "./strategy-engine.mjs";

// Menadżer korzysta z tej samej bezpiecznej symulacji transakcji co Paper Trading,
// ale nigdy sam nie wyszukuje nowych tokenów. Obserwuje wyłącznie adresy dodane przez użytkownika.
export class ManagerEngine extends PaperEngine {
  constructor(options) {
    super(options);
    const active = new Set(this.state.positions.filter(item => item.status === "OPEN").map(item => item.mint));
    const cleaned = (this.state.trackedMints || []).filter(mint => active.has(mint));
    if (cleaned.length !== (this.state.trackedMints || []).length) { this.state.trackedMints = cleaned; this.persist(); }
  }

  fresh(balanceUsd = 1000) {
    return { ...super.fresh(balanceUsd), trackedMints: [] };
  }

  addToken(mint) {
    const clean = String(mint || "").trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean)) throw Error("Wklej poprawny adres tokena Solana.");
    if (!this.state.trackedMints.includes(clean)) this.state.trackedMints.push(clean);
    // Kliknięcie „Kup token” uruchamia Menadżera automatycznie.
    if (this.state.status !== "running") this.state.status = "running";
    const token = this.getToken(clean);
    const alreadyOpen = this.state.positions.some(item => item.mint === clean && item.status === "OPEN");
    if (this.state.status === "running" && token && !alreadyOpen && !this.hasTraded(clean) && this.state.positions.filter(item => item.status === "OPEN").length < this.state.config.maxOpenPositions) this.schedule("BUY", clean, "MANAGER_ADD");
    this.log(`${token?.symbol || clean}: dodano do obserwowanych tokenów.`, "MANAGER");
    this.emit("manager-token");
    return this.publicState();
  }

  removeToken(mint) {
    const clean = String(mint || "").trim();
    this.state.trackedMints = this.state.trackedMints.filter(item => item !== clean);
    this.log(`${clean}: usunięto z obserwowanych tokenów.`, "MANAGER");
    this.emit("manager-token");
    return this.publicState();
  }

  sellToken(mint) {
    const clean = String(mint || "").trim();
    const position = this.state.positions.find(item => item.mint === clean && item.status === "OPEN");
    if (!position) throw Error("Nie znaleziono otwartej pozycji dla tego tokena.");
    // Ręczna sprzedaż działa niezależnie od tego, czy automat był zatrzymany.
    this.state.status = "running";
    this.schedule("SELL", clean, "MANUAL_SELL");
    this.log(`${position.symbol || clean}: zlecono ręczny SELL.`, "SELL");
    this.emit("manager-sell-pending");
    return this.publicState();
  }

  onMarketUpdate(token) {
    if (!token?.mint || !this.state.trackedMints.includes(token.mint) || !(Number(token.marketCapUsd) > 0)) return;
    let changed = false;
    for (const position of this.state.positions.filter(item => item.mint === token.mint && item.status === "OPEN")) {
      const mc = Number(token.marketCapUsd);
      if (mc > (position.highWaterMarketCapUsd || position.entryMarketCapUsd)) { position.highWaterMarketCapUsd = mc; changed = true; }
      if (this.state.config.stagnationExitSeconds !== null) {
        const reference = Number(position.stagnationReferenceMarketCapUsd || position.entryMarketCapUsd);
        const movement = reference > 0 ? Math.abs(mc / reference - 1) * 100 : 0;
        if (movement >= Number(this.state.config.stagnationMovementPercent ?? 1)) {
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
    if (this.state.status === "running" && this.state.positions.filter(item => item.status === "OPEN").length < this.state.config.maxOpenPositions && !this.state.positions.some(item => item.mint === token.mint && item.status === "OPEN") && !this.hasTraded(token.mint)) this.schedule("BUY", token.mint, "MANAGER_ADD");
    if (changed) this.emit("manager-mark");
  }

  publicState() {
    return super.publicState();
  }
}

