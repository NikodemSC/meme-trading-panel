/**
 * Small, dependency-free helpers for turning a Solana `getTransaction`
 * response with `jsonParsed` encoding into conservative market signals.
 *
 * This module is intentionally read-only: it never creates, signs, sends, or
 * simulates a transaction. It only interprets data that an RPC node returned.
 */

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkK45bBQtivW3g5D";

const QUOTE_ASSETS = new Map([
  [NATIVE_SOL_MINT, { asset: "SOL", decimals: 9 }],
  [USDC_MINT, { asset: "USDC", decimals: 6 }],
  [USDT_MINT, { asset: "USDT", decimals: 6 }],
]);

const WINDOW_DEFINITIONS = Object.freeze({
  "1m": 60_000,
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
});

/**
 * @typedef {Object} MarketSignal
 * @property {"BUY"|"SELL"} side A likely trade direction for the signer.
 * @property {string} mint The non-SOL/non-stable SPL token mint.
 * @property {string} tokenAmountRaw Absolute token amount in raw units.
 * @property {string} tokenDeltaRaw Signed token-balance change in raw units.
 * @property {number} tokenDecimals Token decimals reported by the RPC node.
 * @property {string} tokenAmountUi Exact decimal string, never a JS float.
 * @property {"SOL"|"USDC"|"USDT"} quoteAsset Asset used on the other side.
 * @property {string} quoteMint Mint of the quoted asset; SOL uses wrapped SOL mint.
 * @property {string} quoteAmountRaw Absolute quote balance change in raw units.
 * @property {string} quoteDeltaRaw Signed quote-balance change in raw units.
 * @property {number} quoteDecimals Quote asset decimals.
 * @property {string} quoteAmountUi Exact decimal string, never a JS float.
 * @property {boolean} quoteAmountIncludesTransactionFee True when inferred from the native SOL balance.
 * @property {string} signer Primary transaction signer.
 * @property {string|null} signature Transaction signature if available.
 * @property {number|null} slot Solana slot if available.
 * @property {number|null} blockTime Unix timestamp in seconds if available.
 * @property {number|null} timestampMs Unix timestamp in milliseconds if available.
 * @property {string|null} source Source label passed by the caller.
 * @property {string|null} programId Program id passed by the caller, if any.
 * @property {string|null} poolAddress Pool address passed by the caller, if any.
 * @property {string|null} transactionFeeLamportsRaw Network fee reported by the RPC node.
 * @property {string|null} nativeSolDeltaRaw Signed native SOL wallet-balance change, if available.
 */

/**
 * Extract a single likely SPL-token buy or sell from a parsed Solana
 * transaction. The function deliberately returns an empty array when it
 * cannot identify exactly one non-quote token and one opposite quote leg.
 *
 * A native-SOL quote is accepted only if the transaction contains swap-like
 * evidence (parsed swap/buy/sell instruction, matching program logs, or a
 * caller-supplied verified source). This avoids treating ordinary token
 * transfers as trades.
 *
 * @param {object} transaction A result from `getTransaction` using `jsonParsed` encoding.
 * @param {object} [metadata]
 * @param {string|object} [metadata.source] Optional source annotation, e.g. `{ name: "Raydium", verifiedTrade: true }`.
 * @param {string} [metadata.signature] Signature fallback when it is absent from the transaction.
 * @param {number} [metadata.slot] Slot fallback when it is absent from the transaction.
 * @param {number} [metadata.timestampMs] Optional received-at time in milliseconds.
 * @returns {MarketSignal[]} A one-item array for a conservative likely trade, otherwise `[]`.
 */
export function extractMarketSignalsFromTransaction(transaction, metadata = {}) {
  const tx = unwrapTransaction(transaction);
  if (!tx || tx?.meta?.err || !tx?.transaction?.message) return [];

  const accountKeys = Array.isArray(tx.transaction.message.accountKeys)
    ? tx.transaction.message.accountKeys
    : [];
  const signerIndex = accountKeys.findIndex((entry) => getAccountSigner(entry));
  if (signerIndex < 0) return [];

  const signer = getAccountPublicKey(accountKeys[signerIndex]);
  if (!signer) return [];

  const deltas = collectSignerTokenDeltas(tx.meta, signer);
  if (!deltas.length) return [];

  const targetDeltas = deltas.filter((delta) => !QUOTE_ASSETS.has(delta.mint) && delta.delta !== 0n);
  // A single generic transaction may mint, burn, add liquidity, or touch more
  // than one token. Do not guess which token was traded in those cases.
  if (targetDeltas.length !== 1) return [];

  const target = targetDeltas[0];
  const tokenQuoteDeltas = deltas.filter((delta) => QUOTE_ASSETS.has(delta.mint) && delta.delta !== 0n);
  if (tokenQuoteDeltas.length > 1) return [];

  const nativeSolDelta = getNativeSolDelta(tx.meta, signerIndex);
  const quote = chooseQuote({
    tokenQuoteDelta: tokenQuoteDeltas[0] || null,
    nativeSolDelta,
    tokenSide: target.delta > 0n ? "BUY" : "SELL",
    hasSwapEvidence: hasSwapEvidence(tx, metadata.source),
  });
  if (!quote) return [];

  const source = normalizeSource(metadata.source);
  const signature = stringOrNull(metadata.signature)
    || firstSignature(tx.transaction.signatures)
    || stringOrNull(tx.signature);
  const slot = finiteNumberOrNull(metadata.slot) ?? finiteNumberOrNull(tx.slot);
  const blockTime = finiteNumberOrNull(tx.blockTime);
  const timestampMs = finiteNumberOrNull(metadata.timestampMs)
    ?? (blockTime === null ? null : blockTime * 1_000);

  return [{
    side: target.delta > 0n ? "BUY" : "SELL",
    mint: target.mint,
    tokenAmountRaw: absolute(target.delta).toString(),
    tokenDeltaRaw: target.delta.toString(),
    tokenDecimals: target.decimals,
    tokenAmountUi: rawToUi(absolute(target.delta), target.decimals),
    quoteAsset: quote.asset,
    quoteMint: quote.mint,
    quoteAmountRaw: absolute(quote.delta).toString(),
    quoteDeltaRaw: quote.delta.toString(),
    quoteDecimals: quote.decimals,
    quoteAmountUi: rawToUi(absolute(quote.delta), quote.decimals),
    quoteAmountIncludesTransactionFee: quote.includesTransactionFee,
    signer,
    signature,
    slot,
    blockTime,
    timestampMs,
    source: source.name,
    programId: source.programId,
    poolAddress: source.poolAddress,
    transactionFeeLamportsRaw: rawMetaNumber(tx.meta?.fee),
    nativeSolDeltaRaw: nativeSolDelta === null ? null : nativeSolDelta.toString(),
  }];
}

/**
 * Build rolling buy/sell metrics from signals returned by
 * `extractMarketSignalsFromTransaction`.
 *
 * Amounts remain raw integer strings. They must not be added across different
 * mints or quote assets, so the result groups them by mint and quote asset.
 * Events without a timestamp are ignored: guessing their age would make
 * volume windows unreliable.
 *
 * @param {Array<Partial<MarketSignal>>} events Market signals in any order.
 * @param {number|Date} [now=Date.now()] End of the rolling windows.
 * @returns {{ generatedAt: number, windows: Record<string, { since: number, byMint: Record<string, object> }> }}
 */
export function rollingMetrics(events, now = Date.now()) {
  const nowMs = toEpochMs(now) ?? Date.now();
  const normalizedEvents = Array.isArray(events) ? events : [];
  const windows = {};

  for (const [label, lengthMs] of Object.entries(WINDOW_DEFINITIONS)) {
    const since = nowMs - lengthMs;
    /** @type {Record<string, object>} */
    const byMint = {};

    for (const event of normalizedEvents) {
      const timestampMs = eventTimestampMs(event);
      if (timestampMs === null || timestampMs < since || timestampMs > nowMs) continue;
      if (event?.side !== "BUY" && event?.side !== "SELL") continue;
      if (!isNonEmptyString(event?.mint)) continue;

      const tokenAmount = parseRaw(event.tokenAmountRaw);
      const quoteAmount = parseRaw(event.quoteAmountRaw);
      if (tokenAmount === null || quoteAmount === null) continue;

      const mint = event.mint;
      const quoteAsset = isNonEmptyString(event.quoteAsset) ? event.quoteAsset : "UNKNOWN";
      const summary = byMint[mint] ||= createMetricSummary(mint, finiteNumberOrNull(event.tokenDecimals));

      if (event.side === "BUY") {
        summary.buyCount += 1;
        summary.buyTokenAmountRaw = (BigInt(summary.buyTokenAmountRaw) + tokenAmount).toString();
        const quote = summary.quoteAssets[quoteAsset] ||= createQuoteMetric(finiteNumberOrNull(event.quoteDecimals));
        quote.buyAmountRaw = (BigInt(quote.buyAmountRaw) + quoteAmount).toString();
      } else {
        summary.sellCount += 1;
        summary.sellTokenAmountRaw = (BigInt(summary.sellTokenAmountRaw) + tokenAmount).toString();
        const quote = summary.quoteAssets[quoteAsset] ||= createQuoteMetric(finiteNumberOrNull(event.quoteDecimals));
        quote.sellAmountRaw = (BigInt(quote.sellAmountRaw) + quoteAmount).toString();
      }
    }

    windows[label] = { since, byMint };
  }

  return { generatedAt: nowMs, windows };
}

/**
 * @param {unknown} transaction
 * @returns {object|null}
 */
function unwrapTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") return null;
  if (transaction.result && typeof transaction.result === "object") return transaction.result;
  if (transaction.value && typeof transaction.value === "object" && transaction.value.transaction) return transaction.value;
  return transaction;
}

/**
 * @param {object} meta
 * @param {string} signer
 * @returns {Array<{ mint: string, decimals: number, delta: bigint }>}
 */
function collectSignerTokenDeltas(meta, signer) {
  const grouped = new Map();
  const addBalance = (balance, phase) => {
    if (!balance || typeof balance !== "object") return;
    const owner = stringOrNull(balance.owner);
    const mint = stringOrNull(balance.mint);
    const accountIndex = finiteNumberOrNull(balance.accountIndex);
    const amount = parseRaw(balance.uiTokenAmount?.amount ?? balance.amount);
    const decimals = finiteNumberOrNull(balance.uiTokenAmount?.decimals ?? balance.decimals);
    if (!mint || accountIndex === null || amount === null || decimals === null || decimals < 0) return;

    const key = `${accountIndex}:${mint}`;
    const entry = grouped.get(key) || { mint, decimals, pre: null, post: null, preOwner: null, postOwner: null };
    // Decimals cannot differ for the same token account. Treat malformed RPC
    // data as ambiguous rather than mixing two units.
    if (entry.decimals !== decimals) {
      entry.invalid = true;
    } else if (phase === "pre") {
      entry.pre = amount;
      entry.preOwner = owner;
    } else {
      entry.post = amount;
      entry.postOwner = owner;
    }
    grouped.set(key, entry);
  };

  for (const balance of Array.isArray(meta?.preTokenBalances) ? meta.preTokenBalances : []) addBalance(balance, "pre");
  for (const balance of Array.isArray(meta?.postTokenBalances) ? meta.postTokenBalances : []) addBalance(balance, "post");

  const byMint = new Map();
  for (const entry of grouped.values()) {
    if (entry.invalid) continue;
    // If both sides exist, both must confirm that the token account belongs to
    // the signer. For a newly created/closed token account only one side is
    // present, and that one still has to name the signer explicitly.
    const hasPre = entry.pre !== null;
    const hasPost = entry.post !== null;
    if (hasPre && hasPost && (entry.preOwner !== signer || entry.postOwner !== signer)) continue;
    if (hasPre && !hasPost && entry.preOwner !== signer) continue;
    if (!hasPre && hasPost && entry.postOwner !== signer) continue;
    const amount = (entry.post ?? 0n) - (entry.pre ?? 0n);
    const existing = byMint.get(entry.mint) || { mint: entry.mint, decimals: entry.decimals, delta: 0n, invalid: false };
    if (existing.decimals !== entry.decimals) {
      existing.invalid = true;
    } else {
      existing.delta += amount;
    }
    byMint.set(entry.mint, existing);
  }

  return [...byMint.values()].filter((entry) => !entry.invalid);
}

/**
 * @param {object} meta
 * @param {number} signerIndex
 * @returns {bigint|null}
 */
function getNativeSolDelta(meta, signerIndex) {
  const pre = parseRaw(Array.isArray(meta?.preBalances) ? meta.preBalances[signerIndex] : null);
  const post = parseRaw(Array.isArray(meta?.postBalances) ? meta.postBalances[signerIndex] : null);
  return pre === null || post === null ? null : post - pre;
}

/**
 * @param {{ tokenQuoteDelta: { mint: string, decimals: number, delta: bigint }|null, nativeSolDelta: bigint|null, tokenSide: "BUY"|"SELL", hasSwapEvidence: boolean }} input
 * @returns {{ asset: "SOL"|"USDC"|"USDT", mint: string, decimals: number, delta: bigint, includesTransactionFee: boolean }|null}
 */
function chooseQuote(input) {
  const expectedQuoteDirection = input.tokenSide === "BUY" ? -1 : 1;
  if (input.tokenQuoteDelta) {
    const quote = QUOTE_ASSETS.get(input.tokenQuoteDelta.mint);
    if (!quote || signOf(input.tokenQuoteDelta.delta) !== expectedQuoteDirection) return null;
    return {
      asset: quote.asset,
      mint: input.tokenQuoteDelta.mint,
      decimals: input.tokenQuoteDelta.decimals,
      delta: input.tokenQuoteDelta.delta,
      includesTransactionFee: false,
    };
  }

  // Native balance changes can include the network fee and rent. We only use
  // them when a DEX/swap signal was independently observed.
  if (!input.hasSwapEvidence || input.nativeSolDelta === null || signOf(input.nativeSolDelta) !== expectedQuoteDirection) return null;
  return {
    asset: "SOL",
    mint: NATIVE_SOL_MINT,
    decimals: 9,
    delta: input.nativeSolDelta,
    includesTransactionFee: true,
  };
}

/**
 * @param {object} tx
 * @param {unknown} source
 * @returns {boolean}
 */
function hasSwapEvidence(tx, source) {
  if (source && typeof source === "object") {
    if (source.verifiedTrade === true || source.isTrade === true || source.kind === "swap" || source.type === "swap") return true;
  }

  const sourceText = typeof source === "string"
    ? source
    : `${source?.name || ""} ${source?.label || ""} ${source?.protocol || ""}`;
  if (/pump(?:\.fun)?|raydium|meteora|jupiter|orca|phoenix|lifinity|swap/i.test(sourceText)) return true;

  const logs = Array.isArray(tx?.meta?.logMessages) ? tx.meta.logMessages.join(" ") : "";
  if (/instruction:\s*(swap|buy|sell)|\b(swapbasein|swapbaseout|swapv2)\b/i.test(logs)) return true;

  return instructionContainsSwap(tx?.transaction?.message?.instructions)
    || instructionContainsSwap(tx?.meta?.innerInstructions?.flatMap((entry) => entry.instructions || []));
}

/**
 * @param {unknown} instructions
 * @returns {boolean}
 */
function instructionContainsSwap(instructions) {
  if (!Array.isArray(instructions)) return false;
  return instructions.some((instruction) => {
    const type = String(instruction?.parsed?.type || instruction?.type || "");
    return /swap|buy|sell/i.test(type);
  });
}

/**
 * @param {unknown} source
 * @returns {{ name: string|null, programId: string|null, poolAddress: string|null }}
 */
function normalizeSource(source) {
  if (typeof source === "string") return { name: source.trim() || null, programId: null, poolAddress: null };
  if (!source || typeof source !== "object") return { name: null, programId: null, poolAddress: null };
  return {
    name: stringOrNull(source.name) || stringOrNull(source.label) || stringOrNull(source.protocol),
    programId: stringOrNull(source.programId),
    poolAddress: stringOrNull(source.poolAddress) || stringOrNull(source.pool),
  };
}

/** @param {unknown} entry @returns {boolean} */
function getAccountSigner(entry) {
  return entry?.signer === true;
}

/** @param {unknown} entry @returns {string|null} */
function getAccountPublicKey(entry) {
  if (typeof entry === "string") return entry;
  const value = entry?.pubkey ?? entry?.publicKey;
  if (typeof value === "string") return stringOrNull(value);
  // web3.js returns PublicKey objects here, while raw JSON-RPC returns
  // strings.  Supporting both keeps the decoder independent of transport.
  try {
    const text = typeof value?.toBase58 === "function" ? value.toBase58() : typeof value?.toString === "function" ? value.toString() : null;
    return stringOrNull(text);
  } catch { return null; }
}

/** @param {unknown} signatures @returns {string|null} */
function firstSignature(signatures) {
  if (!Array.isArray(signatures) || !signatures.length) return null;
  const first = signatures[0];
  return typeof first === "string" ? first : stringOrNull(first?.signature);
}

/** @param {unknown} value @returns {bigint|null} */
function parseRaw(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/** @param {bigint} value @returns {bigint} */
function absolute(value) {
  return value < 0n ? -value : value;
}

/** @param {bigint} value @returns {-1|0|1} */
function signOf(value) {
  return value > 0n ? 1 : value < 0n ? -1 : 0;
}

/** @param {bigint} value @param {number} decimals @returns {string} */
function rawToUi(value, decimals) {
  const safeDecimals = Math.max(0, Math.floor(decimals));
  if (safeDecimals === 0) return value.toString();
  const padded = value.toString().padStart(safeDecimals + 1, "0");
  const whole = padded.slice(0, -safeDecimals);
  const fraction = padded.slice(-safeDecimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** @param {unknown} value @returns {string|null} */
function rawMetaNumber(value) {
  const raw = parseRaw(value);
  return raw === null ? null : raw.toString();
}

/** @param {unknown} value @returns {string|null} */
function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** @param {unknown} value @returns {boolean} */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** @param {unknown} value @returns {number|null} */
function finiteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value @returns {number|null} */
function toEpochMs(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  return finiteNumberOrNull(value);
}

/** @param {Partial<MarketSignal>} event @returns {number|null} */
function eventTimestampMs(event) {
  const direct = finiteNumberOrNull(event?.timestampMs);
  if (direct !== null) return direct;
  const blockTime = finiteNumberOrNull(event?.blockTime);
  return blockTime === null ? null : blockTime * 1_000;
}

/** @param {string} mint @param {number|null} decimals */
function createMetricSummary(mint, decimals) {
  return {
    mint,
    tokenDecimals: decimals,
    buyCount: 0,
    sellCount: 0,
    buyTokenAmountRaw: "0",
    sellTokenAmountRaw: "0",
    quoteAssets: {},
  };
}

/** @param {number|null} decimals */
function createQuoteMetric(decimals) {
  return {
    decimals,
    buyAmountRaw: "0",
    sellAmountRaw: "0",
  };
}

