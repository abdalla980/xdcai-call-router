import { createServer } from "node:http";

const CATALOG_URL = process.env.CATALOG_URL || "https://xdcai.tech/api/catalog";
const PORT = Number(process.env.PORT || 8787);
const SELF_NAME = (process.env.SELF_NAME || "Call Router").toLowerCase();

const STOP = new Set(
  "a an the to for of and or my me i im on in with from this that what how is are was were be been being do does did get give find need needs needed want wants please show tell can could you your we our it its about into over under just any some who whom which when where why will would should make made using use used buy order get service services app whether checks".split(
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
  paid: ["payment", "payments"],
  payment: ["payments"],
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
      else if (tag === `${term}s` || term === `${tag}s`) best = Math.max(best, 4);
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

function docSiblings(services, service) {
  return services.filter((s) => {
    if (s.providerId !== service.providerId || priceOf(s) > 0) return false;
    const blob = `${s.url} ${s.capability}`.toLowerCase();
    return /schema|openapi|sample|how-to|instruction|requirements/.test(blob);
  });
}

const docsCache = new Map();

async function loadDocs(siblings) {
  const docs = [];
  await Promise.all(
    siblings.map(async (sibling) => {
      const hit = docsCache.get(sibling.url);
      if (hit && Date.now() - hit.at < 60_000) {
        if (hit.doc) docs.push({ url: sibling.url, doc: hit.doc });
        return;
      }
      try {
        const res = await fetch(sibling.url, {
          headers: { accept: "application/json", "user-agent": "xdcai-agent" },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) {
          docsCache.set(sibling.url, { at: Date.now(), doc: null });
          return;
        }
        const doc = await res.json();
        docsCache.set(sibling.url, { at: Date.now(), doc });
        docs.push({ url: sibling.url, doc });
      } catch {
        docsCache.set(sibling.url, { at: Date.now(), doc: null });
      }
    })
  );
  return docs;
}

function servicePath(service) {
  try {
    return new URL(service.url).pathname;
  } catch {
    return "";
  }
}

function pathScore(specPath, targetPath) {
  if (!specPath || !targetPath) return 0;
  const spec = specPath.startsWith("/") ? specPath : `/${specPath}`;
  if (targetPath === spec || targetPath.endsWith(spec)) return 3;
  const last = spec.split("/").filter(Boolean).pop();
  if (last && last.length >= 3 && targetPath.toLowerCase().includes(`/${last.toLowerCase()}`)) return 1;
  return 0;
}

function isSchemaField(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.type === "string" &&
      ("required" in value || "description" in value || "maxLength" in value || "format" in value || "properties" in value || "items" in value)
  );
}

function isFieldMap(value) {
  const entries = Object.entries(value || {});
  return entries.length > 0 && entries.every(([, field]) => isSchemaField(field));
}

function isJsonSchema(value) {
  return Boolean(value && typeof value === "object" && value.type === "object" && value.properties);
}

function isConcrete(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (isFieldMap(value) || isJsonSchema(value)) return false;
  return Object.values(value).some((item) => item == null || ["string", "number", "boolean"].includes(typeof item));
}

function resolveRef(doc, schema) {
  if (!schema || typeof schema.$ref !== "string") return schema;
  const name = schema.$ref.split("/").pop();
  return doc.components?.schemas?.[name] || schema;
}

function collect(doc, targetPath) {
  const concrete = [];
  const schemas = [];
  const add = (specPath, body) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) return;
    const score = pathScore(specPath, targetPath);
    if (!score) return;
    if (isConcrete(body)) concrete.push({ score, body });
    else if (isFieldMap(body) || isJsonSchema(body)) schemas.push({ score, body });
  };

  if (doc.body) add(doc.path || targetPath, doc.body);
  if (doc.inputSchema && typeof doc.inputSchema === "object") {
    for (const [key, spec] of Object.entries(doc.inputSchema)) add(key, spec?.body);
  }
  if (doc.operations && typeof doc.operations === "object") {
    for (const spec of Object.values(doc.operations)) add(spec?.path, spec?.body);
  }
  if (doc.fixed_examples && typeof doc.fixed_examples === "object") {
    for (const [key, body] of Object.entries(doc.fixed_examples)) add(`/${key}`, body);
  }
  if (doc.paths && typeof doc.paths === "object") {
    for (const [key, item] of Object.entries(doc.paths)) {
      const op = item?.post || item?.put;
      const media = op?.requestBody?.content?.["application/json"];
      if (!media) continue;
      if (isConcrete(media.example)) add(key, media.example);
      else add(key, resolveRef(doc, media.schema));
    }
  }
  concrete.sort((a, b) => b.score - a.score);
  schemas.sort((a, b) => b.score - a.score);
  return { concrete: concrete[0]?.body || null, schema: schemas[0]?.body || null };
}

function clip(value, maxLength) {
  const text = String(value);
  return Number.isFinite(maxLength) && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function stringFromTask(name, task, field) {
  const address = task.match(/0x[a-fA-F0-9]{40}/)?.[0];
  const xdcName = task.match(/\b[a-z0-9-]+\.xdc\b/i)?.[0];
  if (address && /address|wallet|owner|account/i.test(name)) return address;
  if (xdcName && /name|domain/i.test(name)) return xdcName;
  if (/draft|description|text|query|prompt|task|message|input|content/i.test(name)) return clip(task, field?.maxLength);
  return null;
}

function materialize(schema, task) {
  const missing = [];
  const body = {};
  const fields = isJsonSchema(schema)
    ? Object.entries(schema.properties).filter(([name]) => (schema.required || []).includes(name))
    : Object.entries(schema).filter(([, field]) => field?.required === true);

  for (const [name, field] of fields) {
    if (field?.default !== undefined && !/draft|description|text|query|prompt|task|message|input|content/i.test(name)) {
      body[name] = field.default;
      continue;
    }
    const type = field?.type;
    if (type === "string" || type === undefined) {
      const value = stringFromTask(name, task, field);
      if (value == null) missing.push(name);
      else body[name] = value;
      continue;
    }
    if (type === "boolean" && typeof field.default === "boolean") {
      body[name] = field.default;
      continue;
    }
    missing.push(name);
  }
  return missing.length ? { body: null, missing } : { body, missing };
}

function applyTaskFacts(example, task) {
  const copy = structuredClone(example);
  const address = task.match(/0x[a-fA-F0-9]{40}/)?.[0];
  const xdcName = task.match(/\b[a-z0-9-]+\.xdc\b/i)?.[0];
  const walk = (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") {
        walk(value);
        continue;
      }
      if (typeof value !== "string") continue;
      if (address && (/^0x[a-fA-F0-9]{40}$/.test(value) || /address|wallet|owner|account/i.test(key))) node[key] = address;
      if (xdcName && /name|domain/i.test(key) && /\.xdc$/i.test(value)) node[key] = xdcName;
    }
  };
  walk(copy);
  return copy;
}

function bodyFor(docs, service, task) {
  const target = servicePath(service);
  let concrete = null;
  let schema = null;
  let source = null;
  for (const { url, doc } of docs) {
    const found = collect(doc, target);
    if (!concrete && found.concrete) {
      concrete = found.concrete;
      source = url;
    }
    if (!schema && found.schema) {
      schema = found.schema;
      if (!source) source = url;
    }
  }
  if (concrete) return { body: applyTaskFacts(concrete, task), missing: [], source, kind: "example" };
  if (schema) return { ...materialize(schema, task), source, kind: "schema" };
  return { body: null, missing: ["body"], source: null, kind: null };
}

function shellCommand(method, url, body) {
  let command = `npx xdcai call ${JSON.stringify(url)} --method ${method}`;
  if (body != null) command += ` --data ${JSON.stringify(JSON.stringify(body))}`;
  return command;
}

function specificity(service, terms) {
  const blob = `${service.url} ${service.capability}`.toLowerCase();
  const own = new Set(tokens(blob));
  let n = 0;
  for (const term of terms) if (own.has(term)) n += 1;
  return n;
}

function shortlist(services, task) {
  const terms = termsFromTask(task);
  if (!terms.length) return { terms, ranked: [] };
  const ranked = services
    .filter((s) => !isSelf(s))
    .map((s) => ({ s, score: scoreService(s, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const spec = specificity(b.s, terms) - specificity(a.s, terms);
      if (spec) return spec;
      const vol = (b.s.volumeUSDC || 0) - (a.s.volumeUSDC || 0);
      if (vol) return vol;
      const calls = (b.s.calls || 0) - (a.s.calls || 0);
      if (calls) return calls;
      return priceOf(a.s) - priceOf(b.s);
    });
  return { terms, ranked };
}

function rank(services, task) {
  const { terms, ranked } = shortlist(services, task);
  if (!terms.length) {
    return {
      task,
      worthPaying: false,
      reason: "The task has no searchable words.",
      call: null,
    };
  }

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
  const price = priceOf(winner);
  const lookalike = ranked.slice(1, 6).sort((a, b) => priceOf(a.s) - priceOf(b.s))[0];

  const why = [
    `Best match for ${terms.join(", ")} (score ${ranked[0].score}).`,
    `${winner.providerName}: ${winner.capability}.`,
    `${winner.calls || 0} calls, ${winner.volumeUSDC || 0} USDC already settled, price ${winner.priceUSDC} USDC.`,
    lookalike
      ? `Next option is ${lookalike.s.providerName} at ${lookalike.s.priceUSDC} USDC (score ${lookalike.score}).`
      : "No second match.",
    filled.missing.length ? `Replace ${filled.missing.join(", ")} in the URL before calling.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    task,
    worthPaying: false,
    terms,
    reason: price === 0 ? "The best match is free. Pay nothing." : why,
    call: {
      method: winner.method,
      url: filled.url,
      priceUSDC: winner.priceUSDC,
      capability: winner.capability,
      provider: winner.providerName,
      body: null,
      command: null,
      ready: false,
      readFirst: null,
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

async function finishMatch(services, task, entry, runnerUp, skipped) {
  const service = entry.s;
  const filled = fillUrl(service.url, task);
  let body = null;
  let source = null;
  let bodyKind = null;
  const missing = [...filled.missing];

  if (service.method !== "GET") {
    const docs = await loadDocs(docSiblings(services, service));
    const built = bodyFor(docs, service, task);
    body = built.body;
    source = built.source;
    bodyKind = built.kind;
    for (const item of built.missing) if (!missing.includes(item)) missing.push(item);
  }

  const ready = missing.length === 0 && (service.method === "GET" || body != null);
  const price = priceOf(service);
  const why = [
    skipped ? "Skipped a higher match that was not ready to call." : "",
    `Best ready match for ${termsFromTask(task).join(", ")} (score ${entry.score}).`,
    `${service.providerName}: ${service.capability}.`,
    `${service.calls || 0} calls, ${service.volumeUSDC || 0} USDC already settled, price ${service.priceUSDC} USDC.`,
    runnerUp ? `Next option is ${runnerUp.s.providerName} at ${runnerUp.s.priceUSDC} USDC (score ${runnerUp.score}).` : "No second match.",
    missing.length ? `Replace ${missing.join(", ")} in the URL before calling.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const note = !ready && service.method !== "GET"
    ? "No published example covers the required body. Do not pay this endpoint yet."
    : ready && bodyKind === "example"
      ? "Request body is the provider's published example. Run call.command."
      : ready && body
        ? "Request body is filled from the provider's published schema. Run call.command."
        : ready
          ? "Run call.command."
          : "";
  const reason = price === 0 && ready
    ? "The best match is free. Pay nothing. Run call.command."
    : [why, note].filter(Boolean).join(" ");
  return {
    task,
    worthPaying: price > 0 && ready,
    terms: termsFromTask(task),
    reason,
    call: {
      method: service.method,
      url: filled.url,
      priceUSDC: service.priceUSDC,
      capability: service.capability,
      provider: service.providerName,
      body,
      command: shellCommand(service.method, filled.url, body),
      ready,
      readFirst: source,
      missing,
      why: reason,
    },
    runnerUp: runnerUp
      ? {
          method: runnerUp.s.method,
          url: runnerUp.s.url,
          priceUSDC: runnerUp.s.priceUSDC,
          capability: runnerUp.s.capability,
          provider: runnerUp.s.providerName,
          score: runnerUp.score,
        }
      : null,
  };
}

async function routeTask(services, task) {
  const { terms, ranked } = shortlist(services, task);
  if (!terms.length) {
    return { task, worthPaying: false, reason: "The task has no searchable words.", call: null };
  }
  if (!ranked.length) {
    return {
      task,
      worthPaying: false,
      reason: "Nothing in the live catalog matches this task. Do not pay anyone for it.",
      terms,
      call: null,
    };
  }

  const pool = ranked.slice(0, 8);
  let fallback = null;
  for (let i = 0; i < pool.length; i++) {
    const result = await finishMatch(services, task, pool[i], pool[i + 1] || null, i > 0);
    if (!fallback) fallback = result;
    if (result.call.ready) return result;
  }
  return fallback;
}

function schema() {
  return {
    capability: "xdc.agent.route",
    description:
      "Send one task sentence. Get back one ready marketplace call: method, URL, request body, and the command to run.",
    priceUSDC: "0.05",
    method: "POST",
    path: "/route",
    body: { task: { type: "string", required: true, maxLength: 500 } },
    example: { task: "deploy an erc20 token" },
    response:
      "worthPaying, call.ready, call.method, call.url, call.body, call.command, call.why, runnerUp. worthPaying is false when the URL or body is not ready.",
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
      return send(res, 200, await routeTask(services, task));
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

export { rank, routeTask, termsFromTask, scoreService };
