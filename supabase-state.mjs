import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const projectUrl = process.env.SUPABASE_URL || "https://odqgoejynyfqksazibwk.supabase.co";
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const tableUrl = `${projectUrl.replace(/\/$/, "")}/rest/v1/meme_pilot_state`;
let warned = false;

function enabled() {
  if (secretKey) return true;
  if (!warned) { warned = true; console.warn("Supabase persistence is disabled: set SUPABASE_SECRET_KEY on the backend."); }
  return false;
}

function headers(extra = {}) {
  return { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json", ...extra };
}

export async function restorePublicSnapshot(dataDir) {
  if (!enabled()) return false;
  try {
    const response = await fetch(`${tableUrl}?state_key=eq.public&select=payload`, { headers: headers(), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error(`Supabase restore ${response.status}`);
    const rows = await response.json();
    const files = rows?.[0]?.payload?.files;
    if (!files || typeof files !== "object" || !Object.keys(files).length) return false;
    const userDir = join(dataDir, "users", "public");
    mkdirSync(userDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      if (!/^[a-zA-Z0-9._-]+\.json$/.test(name) || typeof content !== "string") continue;
      writeFileSync(join(userDir, name), content, "utf8");
    }
    console.log(`Supabase: przywrócono dane panelu (${Object.keys(files).length} plików).`);
    return true;
  } catch (error) {
    console.warn(`Supabase restore skipped: ${error?.message || error}`);
    return false;
  }
}

export async function savePublicSnapshot(dataDir) {
  if (!enabled()) return false;
  try {
    const userDir = join(dataDir, "users", "public");
    if (!existsSync(userDir)) return false;
    const files = Object.fromEntries(readdirSync(userDir).filter(name => /^[a-zA-Z0-9._-]+\.json$/.test(name)).map(name => [name, readFileSync(join(userDir, name), "utf8")]));
    if (!Object.keys(files).length) return false;
    const response = await fetch(tableUrl, { method: "POST", headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify({ state_key: "public", payload: { files }, updated_at: new Date().toISOString() }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error(`Supabase save ${response.status}`);
    return true;
  } catch (error) {
    console.warn(`Supabase save skipped: ${error?.message || error}`);
    return false;
  }
}

