import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const HASH_OPTIONS = { N: 2 ** 14, r: 8, p: 5, maxmem: 64 * 1024 * 1024 };
const COOKIE_NAME = "mp_session";

function tokenHash(value) { return createHash("sha256").update(value).digest("hex"); }
function publicUser(user) { return { id: user.id, name: user.name, role: user.role, slot: user.slot }; }
function cleanSlot(value) {
  const slot = Number(value);
  if (![1, 2].includes(slot)) throw Error("Wybierz Konto 1 albo Konto 2.");
  return slot;
}
function checkPassword(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) throw Error("Hasło musi mieć co najmniej 12 znaków.");
  return value;
}
async function passwordHash(password, salt) {
  const digest = await scrypt(password, salt, 64, HASH_OPTIONS);
  return digest.toString("hex");
}

export class AccountStore {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "accounts.json");
    this.state = { version: 1, users: [], sessions: [] };
    if (existsSync(this.file)) {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      if (!Array.isArray(parsed.users) || !Array.isArray(parsed.sessions)) throw Error("Nie można odczytać kont użytkowników.");
      this.state = parsed;
    }
    let migrated = false;
    this.state.users.slice(0, 2).forEach((user, index) => {
      const slot = index + 1;
      if (user.slot !== slot || user.name !== `Konto ${slot}` || user.role !== (slot === 1 ? "owner" : "user")) migrated = true;
      user.slot = slot; user.name = `Konto ${slot}`; user.role = slot === 1 ? "owner" : "user";
    });
    if (migrated) this.save();
    this.failures = new Map();
  }
  save() {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }
  hasUsers() { return this.state.users.length > 0; }
  userIds() { return this.state.users.map(user => user.id); }
  getUser(id) { const user = this.state.users.find(item => item.id === id); return user ? publicUser(user) : null; }
  slots() {
    return [1, 2].map(slot => ({ slot, name: `Konto ${slot}`, configured: this.state.users.some(user => user.slot === slot) }));
  }
  slotConfigured(slotInput) {
    const slot = cleanSlot(slotInput);
    return this.state.users.some(user => user.slot === slot);
  }
  async createSlot(slotInput, passwordInput) {
    const slot = cleanSlot(slotInput), password = checkPassword(passwordInput);
    if (this.state.users.some(user => user.slot === slot)) throw Error(`Konto ${slot} ma już ustawione hasło.`);
    const salt = randomBytes(24).toString("hex"), hash = await passwordHash(password, salt);
    if (this.state.users.some(user => user.slot === slot)) throw Error(`Konto ${slot} ma już ustawione hasło.`);
    const user = { id: randomUUID(), slot, name: `Konto ${slot}`, role: slot === 1 ? "owner" : "user", salt, hash, createdAt: new Date().toISOString() };
    this.state.users.push(user);
    this.save();
    return publicUser(user);
  }
  async login(slotInput, passwordInput, remoteAddress = "") {
    const slot = cleanSlot(slotInput);
    const key = `${remoteAddress}:slot-${slot}`;
    const attempt = this.failures.get(key);
    if (attempt?.until > Date.now()) throw Error("Za dużo prób. Spróbuj ponownie za 15 minut.");
    const user = this.state.users.find(item => item.slot === slot);
    const salt = user?.salt || "00000000000000000000000000000000";
    const actual = await passwordHash(String(passwordInput ?? ""), salt);
    const expected = user?.hash || "0".repeat(128);
    if (!user || !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))) {
      const count = (attempt?.count || 0) + 1;
      this.failures.set(key, { count, until: count >= 5 ? Date.now() + 15 * 60 * 1000 : 0 });
      throw Error("Nieprawidłowa nazwa lub hasło.");
    }
    this.failures.delete(key);
    const token = randomBytes(32).toString("base64url");
    this.state.sessions = this.state.sessions.filter(session => session.expiresAt > Date.now());
    const previous = this.state.sessions.filter(session => session.userId === user.id).slice(-9);
    this.state.sessions = this.state.sessions.filter(session => session.userId !== user.id || previous.includes(session));
    this.state.sessions.push({ hash: tokenHash(token), userId: user.id, expiresAt: Date.now() + SESSION_LIFETIME_MS });
    this.save();
    return { user: publicUser(user), token };
  }
  resolve(token) {
    if (!token || typeof token !== "string" || token.length > 100) return null;
    const session = this.state.sessions.find(item => item.hash === tokenHash(token) && item.expiresAt > Date.now());
    return session ? this.getUser(session.userId) : null;
  }
  logout(token) {
    if (!token) return;
    const hash = tokenHash(token);
    this.state.sessions = this.state.sessions.filter(item => item.hash !== hash);
    this.save();
  }
}

export function sessionToken(req) {
  if (req.headers.authorization) return /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization)?.[1] || null;
  const cookies = String(req.headers.cookie || "").split(";");
  const pair = cookies.find(item => item.trim().startsWith(`${COOKIE_NAME}=`));
  return pair ? pair.trim().slice(COOKIE_NAME.length + 1) : null;
}
export function sessionCookie(token, secure) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_MS / 1000}${secure ? "; Secure" : ""}`;
}
export function clearSessionCookie(secure) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

