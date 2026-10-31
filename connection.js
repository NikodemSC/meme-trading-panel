(() => {
  const configured = String(window.MEME_PILOT_CONFIG?.apiBase || "").replace(/\/$/, "");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  // GitHub Pages can briefly serve an older cached config file. Keep a safe
  // public fallback so the static panel still reaches the hosted backend.
  const githubPages = location.hostname.endsWith(".github.io");
  const hostedFallback = githubPages ? "https://meme-pilot-backend.onrender.com" : "";
  // A full app deployment serves the panel and API from the same origin.
  // A GitHub Pages build sets staticPanel=true and must use the configured API URL.
  const base = configured || hostedFallback || (!window.MEME_PILOT_CONFIG?.staticPanel ? location.origin : "");
  const remote = Boolean(base && new URL(base).origin !== location.origin);
  const key = `meme-pilot:session:${base}`;
  let token = "";
  try { token = sessionStorage.getItem(key) || ""; } catch {}
  let online = false;
  const banner = document.createElement("div");
  banner.className = "engine-status";
  banner.setAttribute("role", "status");
  document.body.prepend(banner);
  function state(value) {
    online = value;
    banner.hidden = value;
    banner.textContent = base
      ? "Silnik offline lub brak połączenia. Włącz komputer i sprawdź internet. Sterowanie wróci automatycznie; widoczne dane mogą być nieaktualne."
      : "Panel jest gotowy. Połączenie z komputerem nie zostało jeszcze skonfigurowane.";
    document.body.classList.toggle("engine-offline", !value);
  }
  function saveToken(value) {
    token = value || "";
    try { token ? sessionStorage.setItem(key, token) : sessionStorage.removeItem(key); } catch {}
  }
  async function request(path, options = {}) {
    if (!base) { state(false); throw Error("Połączenie z komputerem nie zostało jeszcze skonfigurowane."); }
    const headers = new Headers(options.headers);
    if (remote && token) headers.set("Authorization", `Bearer ${token}`);
    let response;
    try {
      response = await fetch(base + path, {
        ...options, headers, credentials: remote ? "omit" : "same-origin",
        signal: options.signal || AbortSignal.timeout(10000),
      });
    } catch {
      state(false);
      throw Error("Brak połączenia z silnikiem. Sprawdź, czy komputer jest włączony.");
    }
    if (response.status >= 500 || !response.headers.get("content-type")?.includes("application/json")) {
      state(false);
      throw Error("Silnik jest chwilowo niedostępny. Połączenie zostanie ponowione.");
    }
    state(true);
    return response;
  }
  window.MemeConnection = {
    fetch: request, saveToken, remote, get online() { return online; },
    login() { location.replace(new URL("index.html", location.href)); },
    home() { location.replace(new URL("index.html", location.href)); },
  };
  state(false);
  // Browsing the panel remains possible offline. Never queue control commands.
  document.addEventListener("submit", event => {
    if (!online) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener("click", event => {
    if (!online && event.target.closest("[data-bot-status], #clearSession, #newPaperWallet, #authSubmit")) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
})();

