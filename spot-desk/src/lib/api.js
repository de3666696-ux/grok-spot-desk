/**
 * Fundamental + market scan + news
 * Primary: CoinPaprika | News: RSS via rss2json
 */
const PAPRIKA = "https://api.coinpaprika.com/v1";
const RSS2JSON = "https://api.rss2json.com/v1/api.json";
const NEWS_FEEDS = [
  "https://cointelegraph.com/rss",
  "https://bitcoinmagazine.com/.rss/full/",
];

const mem = new Map();
const inflight = new Map();
const TTL = { global: 90000, tickers: 60000, coin: 180000, news: 240000, search: 400000 };

function cacheGet(key) {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { mem.delete(key); return null; }
  return hit.data;
}
function cacheSet(key, data, ttl) {
  mem.set(key, { data, exp: Date.now() + ttl });
  if (mem.size > 200) mem.delete(mem.keys().next().value);
}

export async function getJson(url, { retries = 3, timeoutMs = 14000 } = {}) {
  if (inflight.has(url)) return inflight.get(url);
  const job = (async () => {
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
        if (res.status === 429 || res.status === 503) {
          lastErr = new Error("RATE_LIMIT");
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        if (!res.ok) {
          lastErr = new Error("HTTP_" + res.status);
          if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        return await res.json();
      } catch (e) {
        lastErr = e?.name === "AbortError" ? new Error("TIMEOUT") : e instanceof Error ? e : new Error(String(e));
        if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error("FETCH_FAILED");
  })();
  inflight.set(url, job);
  try { return await job; } finally { inflight.delete(url); }
}

export function humanError(err) {
  const m = err?.message || String(err);
  if (m === "RATE_LIMIT" || /429/.test(m)) return "API limitada. Espera 20–40 s e inténtalo de nuevo.";
  if (m === "TIMEOUT") return "Tiempo de espera agotado. Revisa tu conexión.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin red o bloqueo. Reintenta.";
  return m.length < 120 ? m : "No se pudieron obtener datos.";
}

export async function fetchGlobal() {
  const key = "global";
  const c = cacheGet(key);
  if (c) return c;
  const j = await getJson(PAPRIKA + "/global");
  const out = {
    marketCap: j.market_cap_usd,
    volume24h: j.volume_24h_usd,
    btcDominance: j.bitcoin_dominance_percentage,
    ethDominance: j.ethereum_dominance_percentage,
    coins: j.cryptocurrencies_number,
    marketCapAth: j.market_cap_ath_value,
    marketCapAthDate: j.market_cap_ath_date,
    fetchedAt: Date.now(),
  };
  cacheSet(key, out, TTL.global);
  return out;
}

export async function fetchMarketScan({ limit = 100 } = {}) {
  const key = "tickers:" + limit;
  const c = cacheGet(key);
  if (c) return c;
  const raw = await getJson(PAPRIKA + "/tickers?quotes=USD");
  const list = (Array.isArray(raw) ? raw : [])
    .filter((t) => t.quotes?.USD && t.rank)
    .slice(0, Math.min(limit, 300))
    .map((t) => {
      const q = t.quotes.USD;
      return {
        id: t.id,
        name: t.name,
        symbol: (t.symbol || "").toUpperCase(),
        rank: t.rank,
        price: q.price,
        volume24h: q.volume_24h,
        marketCap: q.market_cap,
        change1h: q.percent_change_1h,
        change24h: q.percent_change_24h,
        change7d: q.percent_change_7d,
        change30d: q.percent_change_30d,
        ath: q.ath_price,
        athDate: q.ath_date,
        percentFromAth: q.percent_from_price_ath,
        beta: t.beta_value,
      };
    });
  cacheSet(key, list, TTL.tickers);
  return list;
}

export async function searchCoins(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const key = "search:" + q;
  const c = cacheGet(key);
  if (c) return c;
  try {
    const scan = await fetchMarketScan({ limit: 400 });
    const hits = scan.filter(
      (t) => t.symbol.toLowerCase() === q || t.name.toLowerCase().includes(q) || t.id.includes(q)
    );
    if (hits.length) {
      cacheSet(key, hits.slice(0, 15), TTL.search);
      return hits.slice(0, 15);
    }
  } catch {}
  const all = await getJson(PAPRIKA + "/coins");
  const hits = (Array.isArray(all) ? all : [])
    .filter((c) => !c.is_new && (c.symbol?.toLowerCase() === q || c.name?.toLowerCase().includes(q) || c.id?.includes(q)))
    .slice(0, 15)
    .map((c) => ({ id: c.id, name: c.name, symbol: (c.symbol || "").toUpperCase(), rank: c.rank }));
  cacheSet(key, hits, TTL.search);
  return hits;
}

export async function fetchCoinFundamental(coinIdOrSymbol) {
  let id = coinIdOrSymbol;
  if (!String(id).includes("-")) {
    const hits = await searchCoins(coinIdOrSymbol);
    id = hits[0]?.id;
    if (!id) throw new Error("No se encontró: " + coinIdOrSymbol);
  }
  const key = "coin:" + id;
  const c = cacheGet(key);
  if (c) return c;

  const [meta, ticker] = await Promise.all([
    getJson(PAPRIKA + "/coins/" + id),
    getJson(PAPRIKA + "/tickers/" + id + "?quotes=USD").catch(() => null),
  ]);
  const q = ticker?.quotes?.USD || {};
  const out = {
    id: meta.id,
    name: meta.name,
    symbol: (meta.symbol || "").toUpperCase(),
    rank: meta.rank ?? ticker?.rank,
    type: meta.type,
    isActive: meta.is_active,
    description: meta.description || "",
    message: meta.message || "",
    startedAt: meta.started_at,
    developmentStatus: meta.development_status,
    hardwareWallet: meta.hardware_wallet,
    proofType: meta.proof_type,
    orgStructure: meta.org_structure,
    hashAlgorithm: meta.hash_algorithm,
    openSource: meta.open_source,
    tags: (meta.tags || []).map((t) => t.name || t.id).filter(Boolean),
    team: (meta.team || []).slice(0, 8).map((m) => ({ name: m.name, position: m.position })),
    links: {
      website: meta.links?.website?.[0],
      twitter: meta.links?.twitter?.[0],
      sourceCode: meta.links?.source_code?.[0],
      reddit: meta.links?.reddit?.[0],
      whitepaper: meta.whitepaper?.link,
    },
    logo: meta.logo,
    price: q.price ?? null,
    volume24h: q.volume_24h ?? null,
    marketCap: q.market_cap ?? null,
    change1h: q.percent_change_1h ?? null,
    change24h: q.percent_change_24h ?? null,
    change7d: q.percent_change_7d ?? null,
    change30d: q.percent_change_30d ?? null,
    ath: q.ath_price ?? null,
    athDate: q.ath_date ?? null,
    percentFromAth: q.percent_from_price_ath ?? null,
    totalSupply: ticker?.total_supply ?? meta.total_supply,
    maxSupply: ticker?.max_supply ?? meta.max_supply,
    circulating: ticker?.circulating_supply,
    beta: ticker?.beta_value,
    fetchedAt: Date.now(),
    source: "coinpaprika",
  };
  cacheSet(key, out, TTL.coin);
  return out;
}

export async function fetchNews({ limit = 24 } = {}) {
  const key = "news:" + limit;
  const c = cacheGet(key);
  if (c) return c;
  const items = [];
  for (const feed of NEWS_FEEDS) {
    try {
      const url = RSS2JSON + "?rss_url=" + encodeURIComponent(feed);
      const j = await getJson(url, { retries: 2 });
      if (j.status !== "ok" || !Array.isArray(j.items)) continue;
      for (const it of j.items) {
        items.push({
          title: it.title,
          link: it.link,
          pubDate: it.pubDate,
          source: j.feed?.title || feed,
          description: (it.description || "").replace(/<[^>]+>/g, "").slice(0, 220),
        });
      }
    } catch {}
  }
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  const out = items.slice(0, limit);
  cacheSet(key, out, TTL.news);
  return out;
}


/** Prioriza noticias que mencionan nombre o símbolo del activo */
export function filterNewsForCoin(items, coin) {
  if (!items?.length) return [];
  if (!coin) return items;
  const keys = [
    (coin.symbol || "").toLowerCase(),
    (coin.name || "").toLowerCase(),
    (coin.id || "").split("-").pop(),
  ].filter((k) => k && k.length > 1);

  const scored = items.map((n) => {
    const hay = `${n.title || ""} ${n.description || ""}`.toLowerCase();
    let s = 0;
    for (const k of keys) {
      if (hay.includes(k)) s += 2;
    }
    // símbolos cortos (btc) pueden dar falsos positivos: bonus menor si solo 3 letras
    return { n, s };
  });
  scored.sort((a, b) => b.s - a.s || new Date(b.n.pubDate) - new Date(a.n.pubDate));
  const related = scored.filter((x) => x.s > 0).map((x) => ({ ...x.n, related: true }));
  const rest = scored.filter((x) => x.s === 0).map((x) => ({ ...x.n, related: false }));
  return [...related, ...rest];
}
