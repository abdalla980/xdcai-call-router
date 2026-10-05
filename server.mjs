import { createServer } from "node:http";

const CATALOG_URL = process.env.CATALOG_URL || "https://xdcai.tech/api/catalog";
const PORT = Number(process.env.PORT || 8787);
const SELF_NAME = (process.env.SELF_NAME || "Call Router").toLowerCase();

const STOP = new Set(
  "a an the to for of and or my me i im on in with from this that what how is are was were be been being do does did get give find need needs needed want wants please show tell can could you your we our it its about into over under just any some who whom which when where why will would should make made using use used buy order get".split(
    " "
  )
);

const ALIASES = {
  latte: ["coffee"],
  espresso: ["coffee"],
  cappuccino: ["coffee"],
  americano: ["coffee"],
  mocha: ["coffee"],
  macchiato: ["coffee"],
  cappucino: ["coffee"],
  hoodie: ["merch"],
  shirt: ["merch"],
  erc20: ["token"],
  aml: ["sanctions", "screening"],
  kyc: ["sanctions", "screening"],
  screen: ["screening", "sanctions"],
  screening: ["sanctions"],
  domain: ["xns", "names"],
  name: ["xns", "names"],
  resolve: ["xns"],
};

let cache = { at: 0, services: [] };

function tokens(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function termsFromTask(task) {
  const seen = new Set();
  for (const t of tokens(task)) {
    if (t.length < 3 || STOP.has(t)) continue;
    seen.add(t);
    for (const extra of ALIASES[t] || []) seen.add(extra);
  }
  return [...seen];
}

function scoreService(service, terms) {
  const tagList = (service.tags || []).map((t) => t.toLowerCase());
  const cap = String(service.capability || "").toLowerCase();
  const capTokens = tokens(cap);
  const name = String(service.providerName || "").toLowerCase();
  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const tag of tagList) {
      if (tag === term) best = Math.max(best, 5);
      else if (tag.includes(term) || term.includes(tag)) best = Math.max(best, 3);
    }
    if (cap === term) best = Math.max(best, 5);
    else if (capTokens.includes(term)) best = Math.max(best, 4);
    if (name === term) best = Math.max(best, 3);
    else if (name.includes(term)) best = Math.max(best, 2);
    total += best;
  }
  return total;
}

async function loadCatalog() {
  if (Date.now() - cache.at < 60_000 && cache.services.length) return cache.services;
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const body = await res.json();
  cache = { at: Date.now(), services: body.services || [] };
  return cache.services;
}

function priceOf(service) {
  const n = Number(service.priceUSDC);
  return Number.isFinite(n) ? n : 0;
}

function isSelf(service) {
  return String(service.providerName || "").toLowerCase() === SELF_NAME;
}

function fillUrl(url, task) {
  const missing = [];
  let out = url;
  const addr = task.match(/0x[a-fA-F0-9]{40}/);
  const name = task.match(/\b[a-z0-9-]+\.xdc\b/i);

  const replace = (pattern, value) => {
    if (!pattern.test(out)) return;
    if (!value) {
      const token = out.match(pattern)?.[0];
      if (token) missing.push(token);
      return;
    }
    out = out.replace(pattern, value);
  };

  replace(/:address\b|\{address\}/gi, addr ? addr[0] : null);
  replace(/:name\b|\{name\}/gi, name ? name[0] : null);

  const still = out.match(/:[a-z_]+|\{[a-z_]+\}/gi);
  if (still) missing.push(...still);
  return { url: out, missing: [...new Set(missing)] };
}

function freeSibling(services, service) {
  return services.find((s) => {
    if (s.providerId !== service.providerId || priceOf(s) > 0) return false;
    const blob = `${s.url} ${s.capability}`.toLowerCase();
    return /schema|openapi|sample|how-to|instruction|menu|requirements/.test(blob);
  });
}

function rank(services, task) {
  const terms = termsFromTask(task);
  if (!terms.length) {
    return {
      task,
      worthPaying: false,
      reason: "The task has no searchable words.",
      call: null,
    };
  }

  const ranked = services
    .filter((s) => !isSelf(s))
    .map((s) => ({ s, score: scoreService(s, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const vol = (b.s.volumeUSDC || 0) - (a.s.volumeUSDC || 0);
      if (vol) return vol;
      const calls = (b.s.calls || 0) - (a.s.calls || 0);
      if (calls) return calls;
      return priceOf(a.s) - priceOf(b.s);
    });

  if (!ranked.length) {
    return {
      task,
      worthPaying: false,
      reason: "Nothing in the live catalog matches this task. Do not pay anyone for it.",
      terms,
      call: null,
    };
  }

  const winner = ranked[0].s;
  const filled = fillUrl(winner.url, task);
  const sibling = freeSibling(services, winner);
  const price = priceOf(winner);
  const lookalike = ranked.slice(1, 6).sort((a, b) => priceOf(a.s) - priceOf(b.s))[0];

  const why = [
    `Best match for ${terms.join(", ")} (score ${ranked[0].score}).`,
    `${winner.providerName}: ${winner.capability}.`,
    `${winner.calls || 0} calls, ${winner.volumeUSDC || 0} USDC already settled, price ${winner.priceUSDC} USDC.`,
    lookalike
      ? `Next option is ${lookalike.s.providerName} at ${lookalike.s.priceUSDC} USDC (score ${lookalike.score}).`
      : "No second match.",
    filled.missing.length
      ? `Replace ${filled.missing.join(", ")} in the URL before calling.`
      : "",
    sibling ? `Read ${sibling.url} before paying if you need the request body.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    task,
    worthPaying: price > 0 && filled.missing.length === 0,
    terms,
    reason: price === 0 ? "The best match is free. Pay nothing." : why,
    call: {
      method: winner.method,
      url: filled.url,
      priceUSDC: winner.priceUSDC,
      capability: winner.capability,
      provider: winner.providerName,
      body: winner.method === "GET" ? null : null,
      readFirst: sibling ? sibling.url : null,
      missing: filled.missing,
      why,
    },
    runnerUp: lookalike
      ? {
          method: lookalike.s.method,
          url: lookalike.s.url,
          priceUSDC: lookalike.s.priceUSDC,
          capability: lookalike.s.capability,
          provider: lookalike.s.providerName,
          score: lookalike.score,
        }
      : null,
  };
}

function schema() {
  return {
    capability: "xdc.agent.route",
    description:
      "Send one task sentence. Get back the single live marketplace call worth paying: method, URL, price, and why it beat the next option.",
    priceUSDC: "0.05",
    method: "POST",
    path: "/route",
    body: { task: { type: "string", required: true, maxLength: 500 } },
    example: { task: "resolve the owner of alice.xdc" },
    response:
      "worthPaying, call.method, call.url, call.priceUSDC, call.body, call.why, runnerUp. A free match returns worthPaying false.",
  };
}

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/schema")) {
    return send(res, 200, schema());
  }
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/route") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let payload = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      return send(res, 400, { error: "Body must be JSON: { \"task\": \"...\" }" });
    }
    const task = typeof payload.task === "string" ? payload.task.trim() : "";
    if (!task || task.length > 500) {
      return send(res, 400, { error: "task must be a string of 1 to 500 characters." });
    }
    try {
      const services = await loadCatalog();
      return send(res, 200, rank(services, task));
    } catch (err) {
      return send(res, 502, { error: err instanceof Error ? err.message : "catalog unavailable" });
    }
  }
  return send(res, 404, { error: "Use GET /schema or POST /route" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    send(res, 500, { error: err instanceof Error ? err.message : "error" });
  });
});

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`call router listening on ${HOST}:${PORT}`);
});

export { rank, termsFromTask, scoreService };
