import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PaperEngine } from "./paper-engine.mjs";

export class PaperPortfolio {
  constructor({ dataDir, getToken, publish }) {
    this.dataDir = dataDir;
    this.registryPath = join(dataDir, "paper-wallets.json");
    this.getToken = getToken;
    this.publish = publish || (() => {});
    this.wallets = this.loadRegistry();
    this.engines = new Map();
    for (const wallet of this.wallets) this.open(wallet);
  }
  loadRegistry() {
    try {
      if (existsSync(this.registryPath)) {
        const parsed = JSON.parse(readFileSync(this.registryPath, "utf8"));
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch { /* Existing paper data remains available through the first wallet. */ }
    return [{ id: "main", name: "Paper 1", file: "paper-trading.json" }];
  }
  saveRegistry() {
    const temp = `${this.registryPath}.tmp`;
    writeFileSync(temp, JSON.stringify(this.wallets, null, 2));
    renameSync(temp, this.registryPath);
  }
  open(wallet) {
    const engine = new PaperEngine({
      dataPath: join(this.dataDir, wallet.file),
      getToken: this.getToken,
      publish: (type, state) => this.publish(type, { walletId: wallet.id, status: state.status }),
    });
    this.engines.set(wallet.id, engine);
    return engine;
  }
  get(id = "main") {
    const engine = this.engines.get(id);
    if (!engine) throw Error("Nie znaleziono portfela paper.");
    return engine;
  }
  list() {
    return this.wallets.map(wallet => {
      const engine = this.get(wallet.id),state = engine.state;
      const openValueUsd = state.positions.filter(item => item.status === "OPEN").reduce((sum, item) => {
        const currentMc = Number(engine.getToken(item.mint)?.marketCapUsd || item.lastMarketCapUsd || item.entryMarketCapUsd);
        return sum + Number(item.supplyFraction || 0) * currentMc;
      }, 0);
      const equityUsd = state.wallet.cashUsd + openValueUsd;
      return { id: wallet.id, name: wallet.name, status: state.status, equityUsd, totalPnlUsd: equityUsd - state.wallet.initialBalanceUsd };
    });
  }
  publicState(id = "main") {
    const wallet = this.wallets.find(item => item.id === id);
    if (!wallet) throw Error("Nie znaleziono portfela paper.");
    return { ...this.get(id).publicState(), walletId: id, walletName: wallet.name, wallets: this.list() };
  }
  create({ name, balanceUsd, cloneConfigFrom } = {}) {
    const cleanName = String(name || "").trim();
    const balance = Number(balanceUsd);
    if (!cleanName || cleanName.length > 50) throw Error("Podaj nazwę portfela (maks. 50 znaków).");
    if (!Number.isFinite(balance) || balance <= 0) throw Error("Saldo musi być większe od zera.");
    if (this.wallets.length >= 20) throw Error("Limit 20 portfeli paper.");
    const copiedConfig = cloneConfigFrom ? structuredClone(this.get(cloneConfigFrom).state.config) : null;
    const id = randomUUID();
    const wallet = { id, name: cleanName, file: `paper-wallet-${id}.json` };
    const engine = this.open(wallet);
    if (copiedConfig) engine.updateConfig(copiedConfig);
    engine.resetWallet(balance);
    this.wallets.push(wallet);
    this.saveRegistry();
    writeFileSync(join(this.dataDir, wallet.file), JSON.stringify(engine.state, null, 2));
    return this.publicState(id);
  }
  remove(id) {
    const index = this.wallets.findIndex(wallet => wallet.id === id);
    if (index < 0) throw Error("Nie znaleziono portfela paper.");
    if (this.wallets.length <= 1) throw Error("Musi pozostać co najmniej jeden portfel paper.");
    const [wallet] = this.wallets.splice(index, 1);
    this.engines.get(wallet.id)?.close();
    this.engines.delete(wallet.id);
    this.saveRegistry();
    try { unlinkSync(join(this.dataDir, wallet.file)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    return { ...this.publicState(this.wallets[0].id), removedWalletId: wallet.id };
  }
  onMarketUpdate(token) {
    for (const engine of this.engines.values()) engine.onMarketUpdate(token);
  }
  close() {
    for (const engine of this.engines.values()) engine.close();
  }
}

