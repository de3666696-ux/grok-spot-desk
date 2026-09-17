/**
 * Data layer — reliability first:
 * - Prefer data-api.binance.vision (api.binance.com often 451)
 * - Memory cache + in-flight dedupe
 * - Binance-only mode when CoinGecko returns 429
 * - Candle OHLC validation
 */

const CG = "https://api.coingecko.com/api/v3";
const BN_HOSTS = [
  "https://data-api.binance.vision/api/v3",
  "https://api.binance.us/api/v3",
  "https://api.binance.com/api/v3",
];

const mem = new Map();
const inflight = new Map();

const CACHE_TTL = {
  search: 8 * 60_000,
  detail: 4 * 60_000,
  klines: 45_000,
  price: 10_000,
  ticker24: 30_000,
};

export const KNOWN = {
  BTC: { id: "bitcoin", name: "Bitcoin" },
  ETH: { id: "ethereum", name: "Ethereum" },
  SOL: { id: "solana", name: "Solana" },
  BNB: { id: "binancecoin", name: "BNB" },
  XRP: { id: "ripple", name: "XRP" },
  ADA: { id: "cardano", name: "Cardano" },
  DOGE: { id: "dogecoin", name: "Dogecoin" },
  AVAX: { id: "avalanche-2", name: "Avalanche" },
  DOT: { id: "polkadot", name: "Polkadot" },
  LINK: { id: "chainlink", name: "Chainlink" },
  MATIC: { id: "matic-network", name: "Polygon" },
  LTC: { id: "litecoin", name: "Litecoin" },
  ATOM: { id: "cosmos", name: "Cosmos" },
  UNI: { id: "uniswap", name: "Uniswap" },
  NEAR: { id: "near", name: "NEAR" },
  APT: { id: "aptos", name: "Aptos" },
  ARB: { id: "arbitrum", name: "Arbitrum" },
  OP: { id: "optimism", name: "Optimism" },
  SUI: { id: "sui", name: "Sui" },
  INJ: { id: "injective-protocol", name: "Injective" },
  FET: { id: "fetch-ai", name: "Fetch.ai" },
  RENDER: { id: "render-token", name: "Render" },
  PEPE: { id: "pepe", name: "Pepe" },
  WIF: { id: "dogwifcoin", name: "dogwifhat" },
  TON: { id: "the-open-network", name: "Toncoin" },
  TRX: { id: "tron", name: "TRON" },
  HBAR: { id: "hedera-hashgraph", name: "Hedera" },
  FIL: { id: "filecoin", name: "Filecoin" },
  AAVE: { id: "aave", name: "Aave" },
  MKR: { id: "maker", name: "Maker" },
};

function cacheGet(key) {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    mem.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data, ttl) {
  mem.set(key, { data, exp: Date.now() + ttl, at: Date.now() });
  if (mem.size > 250) mem.delete(mem.keys().next().value);
}

export async function getJson(url, { retries = 3, timeoutMs = 12000 } = {}) {
  if (inflight.has(url)) return inflight.get(url);

  const job = (async () => {
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: ctrl.signal,
        });
        if (res.status === 429 || res.status === 503) {
          lastErr = new Error("RATE_LIMIT");
          await new Promise((r) => setTimeout(r, 1100 * (attempt + 1)));
          continue;
        }
        if (res.status === 451) {
          lastErr = new Error("GEO_BLOCK");
          break;
        }
        if (!res.ok) {
          lastErr = new Error(`HTTP_${res.status}`);
          if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return await res.json();
      } catch (e) {
        lastErr =
          e?.name === "AbortError"
            ? new Error("TIMEOUT")
            : e instanceof Error
              ? e
              : new Error(String(e));
        if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error("FETCH_FAILED");
  })();

  inflight.set(url, job);
  try {
    return await job;
  } finally {
    inflight.delete(url);
  }
}

function validateCandles(raw) {
  if (!Array.isArray(raw) || raw.length < 30) return null;
  const out = [];
  for (const k of raw) {
    if (!Array.isArray(k) || k.length < 6) continue;
    const time = Number(k[0]);
    const open = +k[1];
    const high = +k[2];
    const low = +k[3];
    const close = +k[4];
    const volume = +k[5];
    if (![time, open, high, low, close, volume].every(Number.isFinite)) continue;
    if (high < low || close <= 0 || open <= 0) continue;
    if (Number(k[6]) > Date.now() + 60_000) continue;
    out.push({ time, open, high, low, close, volume });
  }
  return out.length >= 30 ? out : null;
}

export async function fetchCandles(symbol, interval = "1d") {
  const base = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const key = `kl:${base}:${interval}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, fromCache: true };

  const pairs = [`${base}USDT`, `${base}USDC`, `${base}USD`, `${base}BUSD`];
  for (const host of BN_HOSTS) {
    for (const pair of pairs) {
      try {
        const raw = await getJson(
          `${host}/klines?symbol=${pair}&interval=${interval}&limit=250`,
          { retries: 2 },
        );
        const candles = validateCandles(raw);
        if (!candles) continue;
        const result = { pair, host, candles, fetchedAt: Date.now(), fromCache: false };
        cacheSet(key, result, CACHE_TTL.klines);
        return result;
      } catch {
        /* next host/pair */
      }
    }
  }
  return null;
}

export async function fetchLivePrice(symbol) {
  const base = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const key = `px:${base}`;
  const cached = cacheGet(key);
  if (cached != null) return { price: cached, fromCache: true, at: Date.now() };

  for (const host of BN_HOSTS) {
    for (const pair of [`${base}USDT`, `${base}USDC`, `${base}USD`]) {
      try {
        const j = await getJson(`${host}/ticker/price?symbol=${pair}`, { retries: 2 });
        const px = Number(j.price);
        if (Number.isFinite(px) && px > 0) {
          cacheSet(key, px, CACHE_TTL.price);
          return { price: px, fromCache: false, at: Date.now(), pair, host };
        }
      } catch {
        /* next */
      }
    }
  }
  return null;
}

export async function fetchTicker24h(symbol) {
  const base = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const key = `t24:${base}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  for (const host of BN_HOSTS) {
    for (const pair of [`${base}USDT`, `${base}USDC`]) {
      try {
        const j = await getJson(`${host}/ticker/24hr?symbol=${pair}`, { retries: 2 });
        const out = {
          lastPrice: Number(j.lastPrice),
          priceChangePercent: Number(j.priceChangePercent),
          highPrice: Number(j.highPrice),
          lowPrice: Number(j.lowPrice),
          volume: Number(j.volume),
          quoteVolume: Number(j.quoteVolume),
          pair,
          fetchedAt: Date.now(),
        };
        if (Number.isFinite(out.lastPrice)) {
          cacheSet(key, out, CACHE_TTL.ticker24);
          return out;
        }
      } catch {
        /* next */
      }
    }
  }
  return null;
}

function stubDetail(symbol, extra = {}) {
  const up = symbol.toUpperCase();
  const known = KNOWN[up];
  return {
    id: known?.id || up.toLowerCase(),
    symbol: up,
    name: known?.name || up,
    market_cap_rank: null,
    market_data: {
      current_price: { usd: extra.price ?? null },
      price_change_percentage_24h: extra.change24 ?? null,
      price_change_percentage_7d: null,
      market_cap: { usd: null },
      total_volume: { usd: extra.quoteVolume ?? null },
      ath_change_percentage: { usd: null },
    },
    image: {},
    categories: [],
    description: { en: "" },
    developer_data: {},
    _source: "binance-only",
  };
}

export async function resolveAndDetail(query) {
  const q = query.trim();
  const up = q.toUpperCase().replace(/[^A-Z0-9]/g, "") || q.toUpperCase();
  const known = KNOWN[up];
  let id = known?.id || q.toLowerCase();

  if (!known) {
    const searchKey = `search:${q.toLowerCase()}`;
    try {
      let search = cacheGet(searchKey);
      if (!search) {
        search = await getJson(`${CG}/search?query=${encodeURIComponent(q)}`);
        cacheSet(searchKey, search, CACHE_TTL.search);
      }
      const coins = search.coins || [];
      const exact =
        coins.find((c) => c.symbol?.toLowerCase() === q.toLowerCase()) ||
        coins.find((c) => c.id === q.toLowerCase()) ||
        coins[0];
      if (exact) id = exact.id;
    } catch {
      /* keep id */
    }
  }

  const detailKey = `detail:${id}`;
  const cachedDetail = cacheGet(detailKey);
  if (cachedDetail) return { ...cachedDetail, _fromCache: true };

  try {
    const d = await getJson(
      `${CG}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=true&sparkline=false`,
    );
    d._source = "coingecko";
    d._fetchedAt = Date.now();
    cacheSet(detailKey, d, CACHE_TTL.detail);
    return d;
  } catch {
    const t24 = await fetchTicker24h(up);
    const stub = stubDetail(up, {
      price: t24?.lastPrice,
      change24: t24?.priceChangePercent,
      quoteVolume: t24?.quoteVolume,
    });
    stub._fetchedAt = Date.now();
    cacheSet(detailKey, stub, 60_000);
    return stub;
  }
}

export function humanError(err) {
  const m = err?.message || String(err);
  if (m === "RATE_LIMIT" || /429/.test(m)) {
    return "API temporalmente limitada. Espera 20–40 s o usa chips (BTC/ETH); hay cache.";
  }
  if (m === "GEO_BLOCK" || /451/.test(m)) {
    return "Host Binance bloqueado en esta red. Se usan mirrors automáticamente.";
  }
  if (m === "TIMEOUT") return "Tiempo de espera agotado. Revisa la conexión.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin red o bloqueo de red. Reintenta.";
  return m.length < 120 ? m : "No se pudieron obtener datos. Reintenta.";
}
