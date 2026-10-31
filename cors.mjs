export function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  const host = String(req.headers.host || "");
  const ownOrigins = [`http://${host}`, `https://${host}`];
  if (origin && !ownOrigins.includes(origin) && !allowedOrigins.includes(origin)) {
    res.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "Ten adres panelu nie jest dozwolony." }));
    return false;
  }
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Meme-Pilot-Request, Authorization");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return false; }
  return true;
}

