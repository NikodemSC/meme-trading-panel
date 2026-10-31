import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export class NamedEnginePortfolio {
  constructor({ dataDir, registryFile, filePrefix, defaultFile, defaultName, EngineClass, getToken, publish, maxWallets = 20 }) {
    this.dataDir = dataDir;
    this.registryPath = join(dataDir, registryFile);
    this.filePrefix = filePrefix;
    this.defaultFile = defaultFile;
    this.defaultName = defaultName;
    this.EngineClass = EngineClass;
    this.getToken = getToken;
    this.publish = publish || (() => {});
    this.maxWallets = maxWallets;
    this.wallets = this.loadRegistry();
    this.engines = new Map();
    for (const wallet of this.wallets) this.open(wallet);
  }
  loadRegistry() {
    try { const parsed = JSON.parse(readFileSync(this.registryPath, "utf8")); if (Array.isArray(parsed) && parsed.length) return parsed; } catch {}
    return [{ id: "main", name: this.defaultName, file: this.defaultFile }];
  }
  saveRegistry() { const temp = `${this.registryPath}.tmp`; writeFileSync(temp, JSON.stringify(this.wallets, null, 2)); renameSync(temp, this.registryPath); }
  open(wallet) {
    const engine = new this.EngineClass({ dataPath: join(this.dataDir, wallet.file), getToken: this.getToken, publish: (type, state) => this.publish(type, { walletId: wallet.id, status: state.status }) });
    this.engines.set(wallet.id, engine); return engine;
  }
  get(id = "main") { const engine = this.engines.get(id); if (!engine) throw Error("Nie znaleziono portfela."); return engine; }
  list() {
    return this.wallets.map(wallet => { const engine = this.get(wallet.id), state = engine.publicState(); return { id: wallet.id, name: wallet.name, status: state.status, sourceWallet: state.sourceWallet || null, equityUsd: state.wallet.equityUsd, totalPnlUsd: state.wallet.totalPnlUsd }; });
  }
  publicState(id = "main") { const wallet = this.wallets.find(item => item.id === id); if (!wallet) throw Error("Nie znaleziono portfela."); return { ...this.get(id).publicState(), walletId: id, walletName: wallet.name, wallets: this.list() }; }
  create({ name, balanceUsd = 1000, cloneConfigFrom } = {}) {
    const cleanName = String(name || "").trim(), balance = Number(balanceUsd);
    if (!cleanName || cleanName.length > 50) throw Error("Podaj nazwę portfela (maks. 50 znaków).");
    if (!Number.isFinite(balance) || balance <= 0) throw Error("Saldo musi być większe od zera.");
    if (this.wallets.length >= this.maxWallets) throw Error(`Limit ${this.maxWallets} portfeli.`);
    const id = randomUUID(), wallet = { id, name: cleanName, file: `${this.filePrefix}-${id}.json` }, engine = this.open(wallet);
    if (cloneConfigFrom) engine.updateConfig(structuredClone(this.get(cloneConfigFrom).state.config));
    engine.resetWallet(balance); this.wallets.push(wallet); this.saveRegistry(); writeFileSync(join(this.dataDir, wallet.file), JSON.stringify(engine.state, null, 2));
    return this.publicState(id);
  }
  rename(id, name) {
    const wallet = this.wallets.find(item => item.id === id), cleanName = String(name || "").trim();
    if (!wallet) throw Error("Nie znaleziono portfela.");
    if (!cleanName || cleanName.length > 50) throw Error("Podaj nazwę portfela (maks. 50 znaków).");
    wallet.name = cleanName; this.saveRegistry();
    return this.publicState(id);
  }
  remove(id) {
    const index = this.wallets.findIndex(wallet => wallet.id === id); if (index < 0) throw Error("Nie znaleziono portfela.");
    if (this.wallets.length <= 1) throw Error("Musi pozostać co najmniej jeden portfel.");
    const [wallet] = this.wallets.splice(index, 1); this.engines.get(wallet.id)?.close(); this.engines.delete(wallet.id); this.saveRegistry();
    try { unlinkSync(join(this.dataDir, wallet.file)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    return { ...this.publicState(this.wallets[0].id), removedWalletId: wallet.id };
  }
  onMarketUpdate(token) { for (const engine of this.engines.values()) engine.onMarketUpdate(token); }
  close() { for (const engine of this.engines.values()) engine.close(); }
}

