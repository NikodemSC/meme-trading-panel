const corsHeaders = {
  "Access-Control-Allow-Origin": "https://nikodemsc.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const addresses = Array.isArray(body?.addresses) ? [...new Set(body.addresses)] : [];
    const validAddress = (value: unknown) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
    if (addresses.length < 1 || addresses.length > 30 || !addresses.every(validAddress)) {
      return json({ error: "Pass 1 to 30 valid Solana token addresses." }, 400);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let upstream: Response;
    try {
      upstream = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + addresses.join(","), {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (upstream.status === 429) return json({ error: "Market data rate limit reached." }, 429);
    if (!upstream.ok) return json({ error: "Market data provider returned an error." }, 502);
    const pairs = await upstream.json();
    return json(Array.isArray(pairs) ? pairs : []);
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "Market data provider timed out."
      : "Could not read market data.";
    return json({ error: message }, 502);
  }
});

