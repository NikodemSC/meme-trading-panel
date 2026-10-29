import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const ORIGIN = "https://nikodemsc.github.io";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER = "https://api.jup.ag/swap/v2";
const PRICE_API = "https://api.jup.ag/price/v3";
const RPC = Deno.env.get("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};

type Settings = {
  id: number;
  trading_enabled: boolean;
  auto_enabled: boolean;
  max_per_trade_sol: number;
  daily_buy_limit_sol: number;
  max_slippage_bps: number;
};

type Position = {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  token_amount_raw: string;
  token_decimals: number;
  total_cost_sol: number;
  entry_price_usd: number | null;
  current_price_usd: number | null;
  ath_price_usd: number | null;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  trailing_drawdown_pct: number | null;
  status: "open" | "closing" | "closed";
};

type TradeRequest = {
  action?: string;
  side?: "buy" | "sell";
  mint?: string;
  name?: string;
  symbol?: string;
  amount_sol?: number;
  client_request_id?: string;
  confirm?: boolean;
  settings?: Partial<Settings>;
};

const projectUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const jupiterKey = Deno.env.get("JUPITER_API_KEY") || "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function safeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function headers(extra: Record<string, string> = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function db<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${projectUrl}/rest/v1/${path}`, {
    ...init,
    headers: headers({ ...(init.headers as Record<string, string> || {}) }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Database request failed (${response.status}): ${body.slice(0, 300)}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function getSettings(): Promise<Settings> {
  const rows = await db<Settings[]>("solana_bot_settings?id=eq.1&select=*");
  if (!rows?.length) throw new Error("Bot settings are not initialized.");
  return rows[0];
}

function readKeypair(): Keypair | null {
  const value = Deno.env.get("SOLANA_BOT_KEYPAIR");
  if (!value) return null;
  try {
    let bytes: Uint8Array;
    if (value.trim().startsWith("[")) {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.length !== 64) throw new Error("Expected 64-byte JSON array");
      bytes = Uint8Array.from(parsed);
    } else {
      bytes = bs58.decode(value.trim());
    }
    if (bytes.length !== 64) throw new Error("Keypair must contain 64 bytes");
    return Keypair.fromSecretKey(bytes);
  } catch {
    throw new Error("SOLANA_BOT_KEYPAIR is not a valid 64-byte Solana keypair.");
  }
}

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Solana RPC error (${response.status})`);
  return payload.result as T;
}

async function prices(mints: string[]) {
  const unique = [...new Set(mints)];
  if (!unique.length) return {};
  const response = await fetch(`${PRICE_API}?ids=${encodeURIComponent(unique.join(","))}`, {
    headers: jupiterKey ? { "x-api-key": jupiterKey } : {},
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Price service error (${response.status})`);
  return body as Record<string, { usdPrice?: number; decimals?: number; blockId?: number; priceChange24h?: number }>;
}

function jupiterHeaders() {
  return { "Content-Type": "application/json", ...(jupiterKey ? { "x-api-key": jupiterKey } : {}) };
}

async function balance(pubkey: string) {
  const result = await rpc<{ value: number }>("getBalance", [pubkey, { commitment: "confirmed" }]);
  return result.value / 1_000_000_000;
}

async function status() {
  const keypair = readKeypair();
  const settings = await getSettings();
  let solBalance: number | null = null;
  if (keypair) {
    try { solBalance = await balance(keypair.publicKey.toBase58()); } catch { solBalance = null; }
  }
  return {
    ok: true,
    network: "Solana Mainnet Beta",
    wallet_configured: Boolean(keypair),
    wallet_address: keypair?.publicKey.toBase58() || null,
    sol_balance: solBalance,
    jupiter_api_key_configured: Boolean(jupiterKey),
    trading_enabled: settings.trading_enabled,
    auto_enabled: settings.auto_enabled,
    settings,
  };
}

async function authorizeCron(token: string) {
  if (!token) return false;
  const response = await fetch(`${projectUrl}/rest/v1/rpc/validate_solana_bot_cron_token`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ p_token: token }),
  });
  if (!response.ok) return false;
  return await response.json() === true;
}

async function addTrade(data: Record<string, unknown>) {
  const rows = await db<Array<{ id: string }>>("solana_bot_trades", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(data),
  });
  return rows[0];
}

async function setTrade(id: string, data: Record<string, unknown>) {
  await db(`solana_bot_trades?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(data),
  });
}

async function findPosition(mint: string): Promise<Position | null> {
  const rows = await db<Position[]>(`solana_bot_positions?mint=eq.${encodeURIComponent(mint)}&status=eq.open&select=*`);
  return rows[0] || null;
}

// Deserialize a base64 transaction using browser-independent byte primitives.
function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64(value: Uint8Array) {
  let binary = "";
  for (let i = 0; i < value.length; i += 0x8000) binary += String.fromCharCode(...value.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function performSwap(side: "buy" | "sell", mint: string, amount: string, slippageBps: number, keypair: Keypair) {
  const inputMint = side === "buy" ? SOL_MINT : mint;
  const outputMint = side === "buy" ? mint : SOL_MINT;
  const query = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    taker: keypair.publicKey.toBase58(),
    slippageBps: String(slippageBps),
  });
  const quoteResponse = await fetch(`${JUPITER}/order?${query}`, { headers: jupiterHeaders() });
  const order = await quoteResponse.json();
  if (!quoteResponse.ok || order.error || !order.transaction || !order.requestId) {
    throw new Error(order.error || order.message || `Jupiter quote failed (${quoteResponse.status})`);
  }
  const transaction = VersionedTransaction.deserialize(decodeBase64(order.transaction));
  transaction.sign([keypair]);
  const signedTransaction = encodeBase64(transaction.serialize());
  const executeResponse = await fetch(`${JUPITER}/execute`, {
    method: "POST",
    headers: jupiterHeaders(),
    body: JSON.stringify({ requestId: order.requestId, signedTransaction }),
  });
  const result = await executeResponse.json();
  if (!executeResponse.ok || result.status !== "Success" || !result.signature) {
    throw new Error(result.error || result.message || `Swap execution failed (${executeResponse.status})`);
  }
  return { order, result };
}

async function preview(side: "buy" | "sell", mint: string, amountSol: number) {
  const settings = await getSettings();
  if (!settings.trading_enabled) throw new Error("Trading is disabled. Turn it on in Bot settings before requesting a trade.");
  const keypair = readKeypair();
  if (!keypair) throw new Error("SOLANA_BOT_KEYPAIR is missing from Supabase Edge Function secrets.");
  const tokenMint = new PublicKey(mint).toBase58();
  let amount = "";
  if (side === "buy") {
    if (!Number.isFinite(amountSol) || amountSol <= 0 || amountSol > Number(settings.max_per_trade_sol)) {
      throw new Error(`Buy amount must be between 0 and ${settings.max_per_trade_sol} SOL.`);
    }
    amount = String(Math.floor(amountSol * 1_000_000_000));
  } else {
    const position = await findPosition(tokenMint);
    if (!position) throw new Error("No open panel position exists for this token.");
    amount = String(position.token_amount_raw);
  }
  const inputMint = side === "buy" ? SOL_MINT : tokenMint;
  const outputMint = side === "buy" ? tokenMint : SOL_MINT;
  const params = new URLSearchParams({
    inputMint, outputMint, amount, taker: keypair.publicKey.toBase58(),
    slippageBps: String(settings.max_slippage_bps),
  });
  const response = await fetch(`${JUPITER}/order?${params}`, { headers: jupiterHeaders() });
  const order = await response.json();
  if (!response.ok || order.error || !order.outAmount) throw new Error(order.error || order.message || `Jupiter quote failed (${response.status})`);
  const priceData = await prices([inputMint, outputMint]).catch(() => ({}));
  const outputDecimals = Number(priceData[outputMint]?.decimals ?? 0);
  return {
    side, mint: tokenMint, amount_sol: side === "buy" ? amountSol : null,
    input_amount_raw: amount, expected_output_raw: String(order.outAmount),
    expected_output: outputDecimals ? Number(order.outAmount) / 10 ** outputDecimals : null,
    output_decimals: outputDecimals,
    minimum_output_raw: String(order.otherAmountThreshold || ""),
    price_impact_pct: Number(order.priceImpactPct || 0) * 100,
    slippage_bps: settings.max_slippage_bps,
    fee_bps: order.feeBps ?? null,
    route_count: Array.isArray(order.routePlan) ? order.routePlan.length : null,
  };
}

async function recordTrade(side: "buy" | "sell", mint: string, name: string, symbol: string, amountSol: number, requestId: string, auto = false) {
  const settings = await getSettings();
  if (!settings.trading_enabled) throw new Error("Trading is disabled. Turn it on in Bot settings before trading.");
  const keypair = readKeypair();
  if (!keypair) throw new Error("SOLANA_BOT_KEYPAIR is missing from Supabase Edge Function secrets.");
  const tokenMint = new PublicKey(mint).toBase58();
  const existing = await db<Array<Record<string, unknown>>>(`solana_bot_trades?client_request_id=eq.${encodeURIComponent(requestId)}&select=*`);
  if (existing.length) return existing[0];
  let position = side === "sell" ? await findPosition(tokenMint) : null;
  if (side === "sell" && !position) throw new Error("No open panel position exists for this token.");
  if (side === "buy") {
    if (!Number.isFinite(amountSol) || amountSol <= 0 || amountSol > Number(settings.max_per_trade_sol)) {
      throw new Error(`Buy amount must be between 0 and ${settings.max_per_trade_sol} SOL.`);
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daily = await db<Array<{ amount_sol: number }>>(`solana_bot_trades?side=eq.buy&status=eq.success&created_at=gte.${today.toISOString()}&select=amount_sol`);
    const totalToday = daily.reduce((sum, trade) => sum + Number(trade.amount_sol), 0);
    if (totalToday + amountSol > Number(settings.daily_buy_limit_sol)) {
      throw new Error(`Daily buy limit of ${settings.daily_buy_limit_sol} SOL would be exceeded.`);
    }
    const solBalance = await balance(keypair.publicKey.toBase58());
    if (solBalance < amountSol + 0.01) throw new Error("Wallet balance is too low for this buy and network fees.");
  }
  const amountRaw = side === "buy" ? String(Math.floor(amountSol * 1_000_000_000)) : String(position!.token_amount_raw);
  let trade: { id: string };
  try {
    trade = await addTrade({
      client_request_id: requestId,
      side,
      mint: tokenMint,
      name: name.slice(0, 80),
      symbol: symbol.slice(0, 24).toUpperCase(),
      amount_sol: side === "buy" ? amountSol : Number(position!.total_cost_sol),
      amount_token_raw: side === "sell" ? amountRaw : null,
      status: "pending",
      automated: auto,
    });
  } catch (error) {
    const duplicate = await db<Array<Record<string, unknown>>>(`solana_bot_trades?client_request_id=eq.${encodeURIComponent(requestId)}&select=*`);
    if (duplicate.length) return duplicate[0];
    throw error;
  }
  if (side === "sell") {
    const lockRows = await db<Position[]>(`solana_bot_positions?id=eq.${encodeURIComponent(position!.id)}&status=eq.open`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "closing" }),
    });
    if (!lockRows.length) {
      await setTrade(trade.id, { status: "failed", error_message: "Position is already closing." });
      throw new Error("This position is already closing.");
    }
  }
  let chainSignature: string | null = null;
  try {
    const { order, result } = await performSwap(side, tokenMint, amountRaw, settings.max_slippage_bps, keypair);
    chainSignature = result.signature;
    let priceData: Record<string, { usdPrice?: number; decimals?: number }> = {};
    try { priceData = await prices([SOL_MINT, tokenMint]); } catch { /* Price display must not invalidate a confirmed swap. */ }
    const solUsd = Number(priceData[SOL_MINT]?.usdPrice || 0);
    const tokenPriceUsd = Number(priceData[tokenMint]?.usdPrice || 0);
    const tokenDecimals = Number(priceData[tokenMint]?.decimals ?? 0);
    const outRaw = BigInt(order.outAmount || "0");
    const actualSolAmount = side === "buy" ? amountSol : Number(order.outAmount || 0) / 1_000_000_000;
    await setTrade(trade.id, {
      status: "success",
      signature: result.signature,
      jupiter_request_id: order.requestId,
      amount_token_raw: side === "buy" ? String(outRaw) : amountRaw,
      amount_sol: actualSolAmount,
      price_impact_pct: Number(order.priceImpactPct || 0) * 100,
      completed_at: new Date().toISOString(),
    });
    if (side === "buy") {
      const tokensReceived = Number(outRaw) / 10 ** tokenDecimals;
      const entryPrice = tokensReceived > 0 && solUsd > 0 ? amountSol * solUsd / tokensReceived : null;
      const existingPosition = await findPosition(tokenMint);
      if (existingPosition) {
        const totalRaw = BigInt(existingPosition.token_amount_raw) + outRaw;
        const oldTokens = Number(BigInt(existingPosition.token_amount_raw)) / 10 ** existingPosition.token_decimals;
        const avgPrice = oldTokens + tokensReceived > 0 && entryPrice !== null
          ? ((oldTokens * Number(existingPosition.entry_price_usd || 0)) + (tokensReceived * entryPrice)) / (oldTokens + tokensReceived)
          : existingPosition.entry_price_usd;
        await db(`solana_bot_positions?id=eq.${encodeURIComponent(existingPosition.id)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            token_amount_raw: String(totalRaw),
            token_decimals: tokenDecimals,
            total_cost_sol: Number(existingPosition.total_cost_sol) + amountSol,
            entry_price_usd: avgPrice,
            current_price_usd: tokenPriceUsd || existingPosition.current_price_usd,
            ath_price_usd: Math.max(Number(existingPosition.ath_price_usd || 0), tokenPriceUsd),
            updated_at: new Date().toISOString(),
          }),
        });
      } else {
        await db("solana_bot_positions", {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            mint: tokenMint, name, symbol: symbol.toUpperCase(), token_amount_raw: String(outRaw), token_decimals: tokenDecimals,
            total_cost_sol: amountSol, entry_price_usd: entryPrice, current_price_usd: tokenPriceUsd || null,
            ath_price_usd: tokenPriceUsd || null, status: "open",
          }),
        });
      }
    } else {
      await db(`solana_bot_positions?id=eq.${encodeURIComponent(position!.id)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "closed", token_amount_raw: "0", closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
    }
    return { status: "success", side, mint: tokenMint, signature: result.signature, explorer_url: `https://solscan.io/tx/${result.signature}`, amount_sol: actualSolAmount, output_amount_raw: String(outRaw), price_impact_pct: Number(order.priceImpactPct || 0) * 100, automated: auto };
  } catch (error) {
    if (chainSignature) {
      const warning = `Swap confirmed on Solana (${chainSignature}), but panel synchronization failed: ${String(error).slice(0, 350)}`;
      try {
        await setTrade(trade.id, {
          status: "success",
          signature: chainSignature,
          error_message: warning,
          completed_at: new Date().toISOString(),
        });
      } catch (syncError) {
        console.error("Confirmed swap history sync failed", chainSignature, String(syncError).slice(0, 300));
      }
      console.error(warning);
      return {
        status: "success",
        side,
        mint: tokenMint,
        signature: chainSignature,
        explorer_url: `https://solscan.io/tx/${chainSignature}`,
        amount_sol: side === "buy" ? amountSol : Number(position?.total_cost_sol || 0),
        automated: auto,
        warning: "Transakcja jest potwierdzona. Odśwież panel, aby zsynchronizować pozycję.",
      };
    }
    await setTrade(trade.id, { status: "failed", error_message: String(error).slice(0, 500), completed_at: new Date().toISOString() });
    if (side === "sell" && position) {
      await db(`solana_bot_positions?id=eq.${encodeURIComponent(position.id)}&status=eq.closing`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "open" }),
      });
    }
    throw error;
  }
}

async function tick() {
  const settings = await getSettings();
  if (!settings.trading_enabled || !settings.auto_enabled) return { ok: true, skipped: "automatic exits are disabled" };
  const keypair = readKeypair();
  if (!keypair) return { ok: false, skipped: "bot wallet secret is not configured" };
  const positions = await db<Position[]>("solana_bot_positions?status=eq.open&select=*");
  if (!positions.length) return { ok: true, checked: 0, exits: 0 };
  const priceData = await prices([SOL_MINT, ...positions.map((p) => p.mint)]);
  const slot = await rpc<number>("getSlot", [{ commitment: "confirmed" }]);
  let exits = 0;
  for (const position of positions) {
    const quote = priceData[position.mint];
    const current = Number(quote?.usdPrice || 0);
    const block = Number(quote?.blockId || 0);
    if (!current || !block || slot - block > 600) continue;
    const ath = Math.max(Number(position.ath_price_usd || 0), current);
    await db(`solana_bot_positions?id=eq.${encodeURIComponent(position.id)}&status=eq.open`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ current_price_usd: current, ath_price_usd: ath, updated_at: new Date().toISOString() }),
    });
    const entry = Number(position.entry_price_usd || 0);
    if (!entry) continue;
    const hitStop = Number(position.stop_loss_pct || 0) > 0 && current <= entry * (1 - Number(position.stop_loss_pct) / 100);
    const hitTarget = Number(position.take_profit_pct || 0) > 0 && current >= entry * (1 + Number(position.take_profit_pct) / 100);
    const hitTrail = Number(position.trailing_drawdown_pct || 0) > 0 && ath > entry && current <= ath * (1 - Number(position.trailing_drawdown_pct) / 100);
    if (!hitStop && !hitTarget && !hitTrail) continue;
    const reason = hitStop ? "stop_loss" : hitTarget ? "take_profit" : "trailing_exit";
    const requestId = `auto-${position.id}-${reason}-${Math.floor(Date.now() / 60000)}`;
    try {
      await recordTrade("sell", position.mint, position.name, position.symbol, 0, requestId, true);
      exits++;
    } catch (error) {
      console.error("Automatic exit failed", position.mint, String(error).slice(0, 300));
    }
  }
  return { ok: true, checked: positions.length, exits };
}

async function handle(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";
  if (request.method === "GET" && action === "health") {
    return json({ ok: true, service: "solana-bot-engine", network: "mainnet-beta" });
  }
  let body: TradeRequest = {};
  if (request.method !== "GET") {
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON request." }, 400); }
  }
  const isTick = body.action === "tick";
  if (isTick) {
    if (!await authorizeCron(request.headers.get("x-cron-token") || "")) return json({ error: "Unauthorized cron request." }, 401);
    return json(await tick());
  }
  const expectedToken = Deno.env.get("BOT_CONTROL_TOKEN") || "";
  const givenToken = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expectedToken) return json({ error: "Set BOT_CONTROL_TOKEN in Supabase Edge Function secrets first." }, 503);
  if (!safeEqual(givenToken, expectedToken)) return json({ error: "Invalid control token." }, 401);

  try {
    const requestedAction = body.action || action;
    if (requestedAction === "status") return json(await status());
    if (requestedAction === "positions") return json(await db("solana_bot_positions?select=*&order=opened_at.desc"));
    if (requestedAction === "trades") return json(await db("solana_bot_trades?select=*&order=created_at.desc&limit=100"));
    if (requestedAction === "settings" && request.method === "GET") return json(await getSettings());
    if (requestedAction === "settings" && request.method === "POST") {
      const patch: Record<string, unknown> = {};
      const values = body.settings || {};
      if (typeof values.trading_enabled === "boolean") patch.trading_enabled = values.trading_enabled;
      if (typeof values.auto_enabled === "boolean") patch.auto_enabled = values.auto_enabled;
      if (values.max_per_trade_sol !== undefined) {
        const n = Number(values.max_per_trade_sol);
        if (!Number.isFinite(n) || n <= 0 || n > 100) return json({ error: "Per-trade limit must be between 0 and 100 SOL." }, 400);
        patch.max_per_trade_sol = n;
      }
      if (values.daily_buy_limit_sol !== undefined) {
        const n = Number(values.daily_buy_limit_sol);
        if (!Number.isFinite(n) || n <= 0 || n > 1000) return json({ error: "Daily limit must be between 0 and 1000 SOL." }, 400);
        patch.daily_buy_limit_sol = n;
      }
      if (values.max_slippage_bps !== undefined) {
        const n = Math.round(Number(values.max_slippage_bps));
        if (!Number.isFinite(n) || n < 1 || n > 5000) return json({ error: "Slippage must be 1–5000 bps." }, 400);
        patch.max_slippage_bps = n;
      }
      if (patch.trading_enabled === true && !readKeypair()) {
        return json({ error: "Add SOLANA_BOT_KEYPAIR to Supabase Edge Function secrets before enabling trading." }, 400);
      }
      if (patch.auto_enabled === true && patch.trading_enabled !== true) {
        const current = await getSettings();
        if (!(patch.trading_enabled === true || current.trading_enabled)) return json({ error: "Enable trading before enabling automatic exits." }, 400);
      }
      if (!Object.keys(patch).length) return json(await getSettings());
      patch.updated_at = new Date().toISOString();
      const rows = await db<Settings[]>("solana_bot_settings?id=eq.1", {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch),
      });
      return json(rows[0] || await getSettings());
    }
    if (requestedAction === "quote" && request.method === "POST") {
      if (body.side !== "buy" && body.side !== "sell") return json({ error: "side must be buy or sell." }, 400);
      const mint = new PublicKey(String(body.mint || "")).toBase58();
      return json(await preview(body.side, mint, Number(body.amount_sol || 0)));
    }
    if (requestedAction === "strategy" && request.method === "POST") {
      const mint = new PublicKey(String(body.mint || "")).toBase58();
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const allowed = ["stop_loss_pct", "take_profit_pct", "trailing_drawdown_pct"] as const;
      for (const key of allowed) {
        const value = (body as Record<string, unknown>)[key];
        if (value === null || value === "") patch[key] = null;
        else if (value !== undefined) {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0 || n > 99) return json({ error: `${key} must be 0–99 percent.` }, 400);
          patch[key] = n;
        }
      }
      const rows = await db<Position[]>(`solana_bot_positions?mint=eq.${encodeURIComponent(mint)}&status=eq.open`, {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch),
      });
      if (!rows.length) return json({ error: "Open position not found." }, 404);
      return json(rows[0]);
    }
    if (requestedAction === "buy" || requestedAction === "sell") {
      if (body.confirm !== true) return json({ error: "Explicit trade confirmation is required." }, 400);
      if (!body.client_request_id || !/^[0-9a-f-]{36}$/i.test(body.client_request_id)) return json({ error: "A UUID client_request_id is required." }, 400);
      const mint = new PublicKey(String(body.mint || "")).toBase58();
      const amountSol = Number(body.amount_sol || 0);
      const out = await recordTrade(requestedAction, mint, String(body.name || "Token"), String(body.symbol || mint.slice(0, 6)), amountSol, body.client_request_id);
      return json(out);
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    console.error("solana-bot-engine error", message);
    return json({ error: message }, 400);
  }
}

Deno.serve(handle);

