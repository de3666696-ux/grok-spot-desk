import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import {
  Search, RefreshCw, TrendingUp, TrendingDown, AlertTriangle,
  Send, Bot, Zap, Target, Wallet, Shield, Activity, Trash2, History, Briefcase,
} from "lucide-react";

const CG = "https://api.coingecko.com/api/v3";
const BN = "https://api.binance.com/api/v3";
const LS_KEY = "gsd:v2";
const QUICK = [
  "BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","DOT","LINK",
  "MATIC","LTC","ATOM","UNI","NEAR","APT","ARB","OP","SUI","INJ",
  "FET","RENDER","PEPE","WIF","TON","TRX","HBAR","FIL","AAVE","MKR",
];

const RISK_LEVELS = {
  conservador: { label: "Conservador", pct: 0.5, buy: 82, scale: 72 },
  moderado: { label: "Moderado", pct: 1.0, buy: 76, scale: 68 },
  agresivo: { label: "Agresivo", pct: 2.0, buy: 70, scale: 62 },
  muy_agresivo: { label: "Muy agresivo", pct: 3.0, buy: 66, scale: 58 },
};

const fmt = {
  price(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const d = Math.min(8, Math.max(2, Math.ceil(-Math.log10(a)) + 2));
    return "$" + n.toFixed(d);
  },
  pct(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
  },
  usd(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  },
  compact(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  },
  date(ts) {
    try { return new Date(ts).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return "—"; }
  },
};

function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { history: [], positions: [], capital: 25, riskLevel: "moderado" };
    return { history: [], positions: [], capital: 25, riskLevel: "moderado", ...JSON.parse(raw) };
  } catch {
    return { history: [], positions: [], capital: 25, riskLevel: "moderado" };
  }
}
function saveStore(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

async function getJson(url, { retries = 3, timeoutMs = 14000 } = {}) {
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
        lastErr = new Error("El proveedor de datos está saturado. Espera unos segundos y reintenta.");
        await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`No se pudo cargar datos (código ${res.status}).`);
      return await res.json();
    } catch (e) {
      lastErr = e.name === "AbortError"
        ? new Error("Tiempo de espera agotado. Revisa tu internet e inténtalo de nuevo.")
        : e;
      if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("No se pudieron obtener datos.");
}

function sma(arr, p) {
  return arr.map((_, i) => {
    if (i < p - 1) return null;
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += arr[j];
    return s / p;
  });
}
function ema(arr, p) {
  const out = Array(arr.length).fill(null);
  if (arr.length < p) return out;
  const k = 2 / (p + 1);
  let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = e;
  for (let i = p; i < arr.length; i++) {
    e = arr[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}
function rsi(closes, p = 14) {
  const out = Array(closes.length).fill(null);
  if (closes.length < p + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  let ag = g / p, al = l / p;
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function atr(candles, p = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  return sma(tr, p);
}
function pivots(candles, w = 3) {
  const highs = [], lows = [];
  for (let i = w; i < candles.length - w; i++) {
    let hi = true, lo = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) hi = false;
      if (candles[j].low <= candles[i].low) lo = false;
    }
    if (hi) highs.push(candles[i].high);
    if (lo) lows.push(candles[i].low);
  }
  return { highs, lows };
}

function analyzeCandles(candles) {
  if (!candles || candles.length < 40) return null;
  const closes = candles.map((c) => c.close);
  const s20 = sma(closes, 20);
  const s50 = closes.length >= 50 ? sma(closes, 50) : null;
  const s200 = closes.length >= 200 ? sma(closes, 200) : null;
  const e20 = ema(closes, 20);
  const rs = rsi(closes, 14);
  const at = atr(candles, 14);
  const price = closes.at(-1);
  const lastRsi = rs.at(-1);
  const lastAtr = at.at(-1);
  const lastS20 = s20.at(-1);
  const lastS50 = s50?.at(-1);
  const lastS200 = s200?.at(-1);
  const lastE20 = e20.at(-1);

  let trend = "lateral";
  if (lastS200 && price > lastS20 && lastS20 > lastS50 && lastS50 > lastS200) trend = "alcista";
  else if (lastS200 && price < lastS20 && lastS20 < lastS50 && lastS50 < lastS200) trend = "bajista";
  else if (lastE20 && lastS50) {
    if (price > lastE20 && lastE20 > lastS50) trend = "alcista";
    else if (price < lastE20 && lastE20 < lastS50) trend = "bajista";
  }

  const { highs, lows } = pivots(candles.slice(-120));
  const supports = lows.filter((x) => x < price).sort((a, b) => b - a);
  const resists = highs.filter((x) => x > price).sort((a, b) => a - b);
  const support = supports[0] ?? price - (lastAtr || price * 0.04) * 2;
  const res1 = resists[0] ?? price + (lastAtr || price * 0.04) * 1.8;
  const res2 = resists[1] ?? price + (lastAtr || price * 0.04) * 3.2;
  const res3 = resists[2] ?? price + (lastAtr || price * 0.04) * 5;
  const distSup = ((price - support) / price) * 100;

  let quality = 50;
  if (trend === "alcista") quality += 18;
  if (trend === "bajista") quality -= 18;
  if (lastS200 && price > lastS200) quality += 8;
  if (lastS200 && price < lastS200) quality -= 8;
  if (lastRsi >= 40 && lastRsi <= 62) quality += 10;
  if (lastRsi > 75) quality -= 14;
  if (distSup <= 8) quality += 8;
  if (distSup > 20) quality -= 6;
  quality = Math.max(0, Math.min(100, Math.round(quality)));

  const chart = candles.slice(-120).map((c, i) => {
    const idx = candles.length - 120 + i;
    return {
      t: new Date(c.time).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
      time: c.time,
      close: c.close,
      s20: s20[idx],
      s50: s50?.[idx] ?? null,
      s200: s200?.[idx] ?? null,
      rsi: rs[idx],
    };
  });

  return {
    price, trend, lastRsi, lastAtr, lastS20, lastS50, lastS200, lastE20,
    support, res1, res2, res3, distSup, quality, chart, candles,
  };
}

function scoreCoin(detail, tech) {
  const md = detail.market_data || {};
  const mcap = md.market_cap?.usd || 0;
  const vol = md.total_volume?.usd || 0;
  const circ = md.circulating_supply;
  const max = md.max_supply;
  const fdv = md.fully_diluted_valuation?.usd;
  const commits = detail.developer_data?.commit_count_4_weeks;
  const rank = detail.market_cap_rank || 9999;

  let fund = 8;
  if (commits != null) fund += commits > 40 ? 8 : commits > 10 ? 5 : commits > 0 ? 2 : 0;
  if ((detail.categories || []).some((c) => c && !/meme/i.test(c))) fund += 4;
  if (detail.description?.en?.length > 200) fund += 2;
  fund = Math.min(24, fund);

  let tok = 6;
  if (circ && max) {
    const r = circ / max;
    tok += r > 0.85 ? 6 : r > 0.5 ? 4 : r > 0.3 ? 2 : 0;
  }
  if (mcap && fdv) {
    const r = fdv / mcap;
    tok += r < 1.2 ? 4 : r < 2 ? 2 : r > 4 ? -3 : 0;
  }
  tok = Math.max(0, Math.min(16, tok));

  let val = 5;
  const ath = Math.abs(md.ath_change_percentage?.usd || 0);
  if (ath >= 25 && ath <= 70) val += 5;
  else if (ath > 70 && ath <= 90) val += 3;
  if (rank <= 20) val += 4;
  else if (rank <= 50) val += 2;
  val = Math.min(14, val);

  let liq = mcap && vol ? (vol / mcap > 0.05 ? 8 : vol / mcap > 0.02 ? 5 : vol / mcap > 0.008 ? 3 : 1) : 1;
  let tec = tech ? Math.round(tech.quality * 0.18) : 4;
  let risk = 12;
  if (fdv && mcap && fdv / mcap > 3) risk -= 4;
  if (tech?.trend === "bajista") risk -= 3;
  if (tech?.lastRsi > 75) risk -= 3;
  risk = Math.max(0, risk);

  const total = Math.min(100, Math.round(fund + tok + val + liq + tec + risk));
  return { total, parts: { fund, tok, val, liq, tec, risk } };
}

function verdictFrom(score, tech, riskLevel) {
  const cfg = RISK_LEVELS[riskLevel] || RISK_LEVELS.moderado;
  if (!tech) return { tag: "OBSERVAR", cls: "v-wait", why: "Faltan datos técnicos de Binance para esta moneda." };
  if (tech.trend === "bajista" && score < cfg.buy) return { tag: "ESPERAR", cls: "v-wait", why: "Tendencia diaria bajista: mejor esperar soporte o giro." };
  if (tech.lastRsi > 78) return { tag: "ESPERAR", cls: "v-wait", why: "RSI muy alto: mala relación riesgo/beneficio ahora." };
  if (tech.distSup > 22) return { tag: "ESPERAR", cls: "v-wait", why: `Precio lejos del soporte (${tech.distSup.toFixed(0)}%). No perseguir.` };
  if (score >= cfg.buy) return { tag: "COMPRAR", cls: "v-buy", why: "Confluencia de score, liquidez y estructura técnica para tu perfil." };
  if (score >= cfg.scale) return { tag: "COMPRAR EN TRAMOS", cls: "v-scale", why: "Ventaja parcial: entrar por partes según el plan." };
  if (score >= 55) return { tag: "OBSERVAR", cls: "v-wait", why: "Interesante para seguir, sin entrada clara hoy." };
  return { tag: "NO COMPRAR", cls: "v-no", why: "Calidad/riesgo no justifican entrada Spot ahora." };
}

function buildPlan(capital, riskPct, entry, stop) {
  capital = Number(capital) || 0;
  if (capital < 5) {
    return { tooSmall: true, msg: `Con $${capital.toFixed(2)} es justo. Recomiendo al menos $5–$15 en Binance Spot.` };
  }
  if (!entry || !stop || stop >= entry) return null;
  const maxRisk = capital * (riskPct / 100);
  const stopPct = (entry - stop) / entry;
  let size = Math.min(capital, maxRisk / Math.max(stopPct, 0.005));
  if (size < 5 && capital >= 5) size = 5;
  const units = size / entry;
  const tramos =
    size >= 15
      ? [
          { label: "Tramo 1 · zona actual", usd: size * 0.4 },
          { label: "Tramo 2 · si baja a soporte", usd: size * 0.35 },
          { label: "Tramo 3 · solo si se confirma", usd: size * 0.25 },
        ]
      : size >= 10
        ? [
            { label: "Tramo 1", usd: size * 0.6 },
            { label: "Tramo 2 en soporte", usd: size * 0.4 },
          ]
        : [{ label: "Entrada única (capital pequeño)", usd: size }];
  return { tooSmall: false, size, units, maxRisk, stopPct: stopPct * 100, tramos };
}

async function fetchCandles(symbol) {
  const base = symbol.toUpperCase();
  for (const pair of [`${base}USDT`, `${base}USDC`, `${base}FDUSD`]) {
    try {
      const raw = await getJson(`${BN}/klines?symbol=${pair}&interval=1d&limit=250`);
      if (!Array.isArray(raw) || raw.length < 40) continue;
      return raw
        .filter((k) => k[6] <= Date.now())
        .map((k) => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
    } catch { /* next */ }
  }
  return null;
}

async function resolveAndDetail(query) {
  const q = query.trim();
  let id = q.toLowerCase();
  try {
    const search = await getJson(`${CG}/search?query=${encodeURIComponent(q)}`);
    const coins = search.coins || [];
    const exact =
      coins.find((c) => c.symbol?.toLowerCase() === q.toLowerCase()) ||
      coins.find((c) => c.id === q.toLowerCase()) ||
      coins[0];
    if (exact) id = exact.id;
  } catch { /* use raw */ }
  return getJson(
    `${CG}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true&sparkline=false`
  );
}

function ChartBlock({ tech, stop, targets, entryMarks }) {
  if (!tech?.chart?.length) return null;
  return (
    <>
      <div className="chart-box">
        <ResponsiveContainer>
          <ComposedChart data={tech.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#1e2a3a" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "#7d8fa3", fontSize: 10 }} minTickGap={32} axisLine={false} tickLine={false} />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "#7d8fa3", fontSize: 10 }} width={64} axisLine={false} tickLine={false} tickFormatter={(v) => fmt.price(v)} />
            <Tooltip
              contentStyle={{ background: "#0f141c", border: "1px solid #1e2a3a", borderRadius: 10, fontSize: 12 }}
              formatter={(v, n) => [fmt.price(v), n]}
            />
            {stop && <ReferenceLine y={stop} stroke="#ef4444" strokeDasharray="4 3" />}
            {targets?.map((t, i) => t && <ReferenceLine key={i} y={t} stroke="#22c55e" strokeDasharray="4 3" />)}
            <ReferenceLine y={tech.support} stroke="#3d8bfd" strokeDasharray="2 2" />
            {entryMarks?.map((m, i) => (
              <ReferenceLine key={"e" + i} y={m.price} stroke="#f0b429" strokeDasharray="6 3" />
            ))}
            <Line type="monotone" dataKey="close" stroke="#eef2f7" strokeWidth={2} dot={false} name="Precio" />
            <Line type="monotone" dataKey="s20" stroke="#00d4aa" strokeWidth={1.2} dot={false} name="SMA20" />
            <Line type="monotone" dataKey="s50" stroke="#3d8bfd" strokeWidth={1.1} dot={false} name="SMA50" />
            <Line type="monotone" dataKey="s200" stroke="#a78bfa" strokeWidth={1} dot={false} strokeDasharray="5 3" name="SMA200" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-sub">
        <ResponsiveContainer>
          <ComposedChart data={tech.chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <YAxis domain={[0, 100]} tick={{ fill: "#7d8fa3", fontSize: 9 }} width={64} axisLine={false} tickLine={false} />
            <XAxis dataKey="t" hide />
            <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
            <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.5} />
            <ReferenceArea y1={40} y2={60} fill="#00d4aa" fillOpacity={0.05} />
            <Line type="monotone" dataKey="rsi" stroke="#f0b429" strokeWidth={1.4} dot={false} name="RSI" />
            <Tooltip contentStyle={{ background: "#0f141c", border: "1px solid #1e2a3a", borderRadius: 8, fontSize: 11 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}


function signalConfidence(tech, score, riskLevel) {
  if (!tech || !score) return { label: "Sin datos", pct: 0, note: "Analiza una moneda primero." };
  let pct = 40;
  pct += Math.min(25, Math.round(score.total * 0.25));
  pct += Math.min(15, Math.round((tech.quality || 0) * 0.15));
  if (tech.trend === "alcista") pct += 8;
  if (tech.trend === "bajista") pct -= 10;
  if (tech.lastRsi >= 40 && tech.lastRsi <= 65) pct += 6;
  if (tech.lastRsi > 75) pct -= 12;
  if (tech.distSup != null && tech.distSup <= 10) pct += 6;
  if (tech.distSup != null && tech.distSup > 20) pct -= 8;
  if (riskLevel === "conservador") pct -= 3;
  if (riskLevel === "muy_agresivo") pct += 2;
  pct = Math.max(5, Math.min(92, Math.round(pct)));
  let label = "Baja";
  if (pct >= 70) label = "Alta";
  else if (pct >= 55) label = "Media-alta";
  else if (pct >= 40) label = "Media";
  return {
    label,
    pct,
    note: pct >= 70
      ? "Confluencia razonable: aún así usa stop y tramos."
      : pct >= 50
        ? "Señal usable con cautela: no all-in."
        : "Poca confluencia: mejor esperar o tamaño mínimo.",
  };
}

function buildBuyTiming(tech, verdict, stop, livePrice) {
  if (!tech) return null;
  const price = livePrice || tech.price;
  const atr = tech.lastAtr || price * 0.03;
  const support = tech.support;
  // Zonas de precio
  const zonaIdealMin = support * 0.99;
  const zonaIdealMax = Math.min(support * 1.025, price * 0.998);
  const zonaOkMin = support * 1.01;
  const zonaOkMax = Math.min(support * 1.05, price * 1.002);
  const zonaAgresivaMax = Math.min(price * 1.005, support * 1.08);

  let momento = "ESPERAR";
  let detalle = "";
  let color = "wait";

  const nearSupport = tech.distSup != null && tech.distSup <= 8;
  const midSupport = tech.distSup != null && tech.distSup <= 14;
  const overbought = tech.lastRsi != null && tech.lastRsi > 72;
  const tag = verdict?.tag || "";

  if (tag === "NO COMPRAR" || tag === "OBSERVAR" && tech.trend === "bajista") {
    momento = "NO ENTRAR AHORA";
    detalle = "La calidad o la tendencia no justifican comprar en este momento. Espera mejor estructura.";
    color = "no";
  } else if (overbought || tech.distSup > 20) {
    momento = "ESPERAR RETROCESO";
    detalle = `Precio actual ${fmt.price(price)} está extendido o caliente. Mejor comprar más cerca del soporte ~${fmt.price(support)}.`;
    color = "wait";
  } else if (tag.includes("COMPRAR") && nearSupport && !overbought) {
    momento = "VENTANA DE COMPRA AHORA";
    detalle = `Estás cerca del soporte y el veredicto es favorable. Prioriza la zona ${fmt.price(zonaIdealMin)} – ${fmt.price(zonaIdealMax)}.`;
    color = "now";
  } else if (tag.includes("COMPRAR") && midSupport) {
    momento = "COMPRAR EN TRAMOS";
    detalle = `Puedes empezar un tramo pequeño cerca de ${fmt.price(price)} y guardar el resto para ${fmt.price(support)}–${fmt.price(zonaOkMax)}.`;
    color = "scale";
  } else if (tag.includes("COMPRAR")) {
    momento = "COMPRAR CON CUIDADO / TRAMOS";
    detalle = `Hay señal, pero no es el soporte perfecto. No metas todo el capital de golpe a ${fmt.price(price)}.`;
    color = "scale";
  } else {
    momento = "ESPERAR MEJOR PRECIO";
    detalle = `Observa. Interés de compra más sano entre ${fmt.price(zonaIdealMin)} y ${fmt.price(zonaIdealMax)}.`;
    color = "wait";
  }

  return {
    momento, detalle, color,
    precioActual: price,
    zonaIdeal: { min: zonaIdealMin, max: Math.max(zonaIdealMin, zonaIdealMax) },
    zonaAceptable: { min: zonaOkMin, max: Math.max(zonaOkMin, zonaOkMax) },
    zonaAgresiva: { min: price * 0.995, max: zonaAgresivaMax },
    soporte: support,
    stop,
    tp1: tech.res1,
    tp2: tech.res2,
    tp3: tech.res3,
    condicion: "Si el precio pierde el stop con fuerza, la idea de compra queda invalidada. No promediar a la baja sin plan.",
  };
}

/** Asistente local amplio (sin Gemini): guía + datos del análisis + conocimiento Spot estructurado */
function assistantReply(q, ctx) {
  const query = (q || "").toLowerCase().trim();
  const { detail, tech, score, verdict, plan, capital, riskLevel, positions, history } = ctx;
  const name = detail?.name || null;
  const price = tech?.price;
  const risk = RISK_LEVELS[riskLevel] || RISK_LEVELS.moderado;
  const stop = tech ? Math.min(tech.support * 0.96, tech.price - (tech.lastAtr || tech.price * 0.03) * 1.4) : null;

  // Guía por pasos
  if (/c[oó]mo empiezo|gu[ií]a|paso a paso|qu[eé] hago|tutorial|ayúdame a/.test(query)) {
    return [
      "Guía Spot paso a paso (como un coach):",
      "1) Elige perfil de riesgo arriba (Conservador → Muy agresivo).",
      "2) Pon el capital que sí puedes arriesgar (ej. $15–$50).",
      "3) Analiza BTC o ETH si empiezas (más líquidos, comisiones más bajas).",
      "4) Lee: veredicto · escenarios · cuánto comprar en tramos.",
      "5) Si decides entrar: pulsa «Registré compra», anota precio y $.",
      "6) Compra MANUAL en Binance Spot (la app no ejecuta órdenes).",
      "7) Revisa «Mis posiciones» para ver si hay rendimiento.",
      "",
      "Regla de oro: el stop existe para limitar daño, no para «tener razón».",
    ].join("\n");
  }

  if (/nueva cripto|listada|sale una|token nuevo|aparecer[aá] aqu[ií]/.test(query)) {
    return [
      "Sí: si una cripto nueva está en CoinGecko y tiene par en Binance (USDT/USDC), puedes buscarla por nombre o símbolo.",
      "No aparece sola en los chips rápidos hasta que la busques.",
      "Ojo: tokens nuevos suelen ser más peligrosos (poca liquidez, manipulación, unlocks). Con capital pequeño prioriza BTC/ETH/SOL.",
    ].join("\n");
  }

  if (/riesgo|perfil|conservador|agresivo|porcent/.test(query) && !/stop|invalid/.test(query)) {
    return [
      `Tu perfil actual: **${risk.label}** → riesgo ~${risk.pct}% del capital por operación.`,
      "Conservador (0.5%): prioriza no perder; umbral de compra más alto.",
      "Moderado (1%): equilibrio típico para Spot.",
      "Agresivo (2%) / Muy agresivo (3%): más tamaño, más daño si falla el stop.",
      "El porcentaje no es «cuánto vas a ganar»: es el techo de pérdida planificada si salta el stop.",
    ].join("\n");
  }

  if (/comisi[oó]n|fee|binance|spot vs future|apalanc/.test(query)) {
    return [
      "Spot Binance: compras el activo real (sin apalancamiento). Pierdes como máximo lo invertido (más comisiones).",
      "Futures/apalancamiento: puedes perder más rápido; esta app está pensada para Spot.",
      "Comisiones: dependen de tu nivel VIP y si usas BNB. Con $5–$20 elige monedas líquidas (BTC/ETH) para que el fee no se coma el trade.",
      "Tip: evita overtrading. Con capital pequeño, 1–2 ideas claras > 10 entradas.",
    ].join("\n");
  }

  if (/dca|promedio|escalon|tramo/.test(query)) {
    return [
      "Comprar en tramos (DCA táctico) reduce el error de timing.",
      "Ejemplo: 40% ahora, 35% si baja a soporte, 25% solo si confirma (rompe resistencia con volumen).",
      "No promedio una tesis rota: si pierde el stop, no «añadas para recuperar».",
      plan && !plan.tooSmall
        ? `Con tu capital, el plan actual sugiere ~${fmt.usd(plan.size)} repartidos en ${plan.tramos.length} tramo(s).`
        : "Analiza una moneda para ver tramos numéricos.",
    ].join("\n");
  }

  if (/cu[aá]nto|comprar|posici[oó]n|tama[nñ]o|d[oó]lar|\$|invertir/.test(query)) {
    if (!plan) return "Analiza una moneda y configura capital. Luego te digo el tamaño exacto.";
    if (plan.tooSmall) return plan.msg;
    return [
      `Capital ~$${Number(capital).toFixed(2)} · perfil ${risk.label} (${risk.pct}%):`,
      `• Tamaño sugerido: **${fmt.usd(plan.size)}**`,
      `• Unidades ~**${plan.units.toFixed(6)}** @ ${fmt.price(price)}`,
      `• Riesgo máx. si salta stop: **${fmt.usd(plan.maxRisk)}** (~${plan.stopPct.toFixed(1)}%)`,
      "",
      ...plan.tramos.map((t) => `– ${t.label}: **${fmt.usd(t.usd)}**`),
      "",
      "Ejecuta en Binance Spot a mano. Aquí solo planificas.",
    ].join("\n");
  }

  if (/subir|bajar|predic|objetivo|tp|escenario|a cu[aá]nto|hacia|futuro/.test(query)) {
    if (!tech) return "Primero analiza una moneda para escenarios técnicos.";
    const p = tech.price;
    const pct = (x) => fmt.pct((x / p - 1) * 100);
    return [
      "No es profecía. Son niveles técnicos (ATR + pivots de velas diarias Binance).",
      `Ref. **${fmt.price(p)}** · ATR ~${fmt.price(tech.lastAtr)}`,
      "",
      "Alcista:",
      `• TP1 ${fmt.price(tech.res1)} (${pct(tech.res1)})`,
      `• TP2 ${fmt.price(tech.res2)} (${pct(tech.res2)})`,
      `• TP3 ${fmt.price(tech.res3)} (${pct(tech.res3)})`,
      "",
      "Bajista:",
      `• Soporte ${fmt.price(tech.support)} (${pct(tech.support)})`,
      `• Stop ${fmt.price(stop)} (${pct(stop)})`,
      "",
      verdict ? `Veredicto: **${verdict.tag}** — ${verdict.why}` : "",
    ].filter(Boolean).join("\n");
  }

  if (/stop|invalid|d[oó]nde salgo|cortar p[eé]rdida/.test(query)) {
    if (!tech) return "Analiza una moneda para calcular el stop.";
    return [
      `Stop sugerido${name ? " en " + name : ""}: **${fmt.price(stop)}** (${fmt.pct((stop / tech.price - 1) * 100)}).`,
      "Lógica: debajo del soporte relevante y con margen de ATR para no salir por ruido.",
      "Si el precio cierra con fuerza bajo ese nivel, la entrada queda invalidada.",
    ].join("\n");
  }

  if (/veredicto|debo|momento|se[nñ]al|entrar|compro o no|cu[aá]ndo comprar|a qu[eé] precio|precio de entrada|zona de compra/.test(query)) {
    if (!verdict || !tech) return "Analiza BTC, ETH o la moneda que te interese para ver cuándo y a qué precio comprar.";
    const timing = buildBuyTiming(tech, verdict, stop, price);
    if (!timing) return `**${verdict.tag}**\n${verdict.why}`;
    return [
      `**${timing.momento}**`,
      timing.detalle,
      "",
      `Precio actual: **${fmt.price(timing.precioActual)}**`,
      `Zona ideal de compra: **${fmt.price(timing.zonaIdeal.min)} – ${fmt.price(timing.zonaIdeal.max)}**`,
      `Zona aceptable: **${fmt.price(timing.zonaAceptable.min)} – ${fmt.price(timing.zonaAceptable.max)}**`,
      `Stop: **${fmt.price(timing.stop)}**`,
      `Objetivos: TP1 ${fmt.price(timing.tp1)} · TP2 ${fmt.price(timing.tp2)} · TP3 ${fmt.price(timing.tp3)}`,
      "",
      `Veredicto: **${verdict.tag}** — ${verdict.why}`,
      `Score ${score?.total ?? "—"}/100 · RSI ${tech.lastRsi?.toFixed?.(1) ?? "—"} · Perfil ${risk.label}`,
    ].join("\n");
  }

  if (/posici[oó]n|rendimiento|ganancia|p[eé]rdida|pnl|mis compras/.test(query)) {
    if (!positions?.length) return "Aún no has registrado compras. Analiza una moneda y usa «Registré compra».";
    const lines = positions.slice(0, 8).map((p) => {
      const pnl = p.lastPrice != null ? ((p.lastPrice / p.entryPrice - 1) * 100) : null;
      return `• ${p.symbol}: entrada ${fmt.price(p.entryPrice)} · ${fmt.usd(p.usd)} · ${pnl == null ? "P&L n/d" : fmt.pct(pnl)}`;
    });
    return ["Tus posiciones guardadas (local):", ...lines].join("\n");
  }

  if (/historial|b[uú]squeda|qu[eé] busqu[eé]/.test(query)) {
    if (!history?.length) return "Todavía no hay búsquedas guardadas.";
    return ["Últimas búsquedas:", ...history.slice(0, 10).map((h) => `• ${h.symbol} · ${fmt.date(h.at)}`)].join("\n");
  }

  if (/rsi|sma|soporte|resistencia|tendencia|indicador/.test(query)) {
    if (!tech) return "Analiza una moneda para hablar de sus indicadores concretos.";
    return [
      `Tendencia 1D: **${tech.trend}**`,
      `RSI(14): **${tech.lastRsi?.toFixed?.(1)}** (zona media 40–60 suele ser más sana para entrar que >75)`,
      `SMA20 ${fmt.price(tech.lastS20)} · SMA50 ${fmt.price(tech.lastS50)} · SMA200 ${fmt.price(tech.lastS200)}`,
      `Soporte ~${fmt.price(tech.support)} · Resistencias ${fmt.price(tech.res1)} / ${fmt.price(tech.res2)}`,
      "Precio sobre SMA200 con SMAs alineadas al alza = estructura más sana. Lo contrario invita a esperar.",
    ].join("\n");
  }

  if (/meme|pepe|shitcoin|100x/.test(query)) {
    return "Los memes pueden subir fuerte y caer más fuerte. Con capital pequeño, trata cualquier meme como especulación alta: tamaño mínimo, stop claro, cero promedios si se rompe. Esta app prioriza disciplina Spot, no lotería.";
  }

  // Fallback + más ayuda
  if (/confianza|segura|fiable|qu[eé] tan buena|calidad de se[nñ]al/.test(query)) {
    const conf = signalConfidence(tech, score, riskLevel);
    return [
      `Confianza de la señal actual: **${conf.label} (${conf.pct}/100)**`,
      conf.note,
      "No es probabilidad de ganar: es confluencia de score + técnico + contexto.",
    ].join("\n");
  }

  if (/error|no carga|falla|api|datos/.test(query)) {
    return "Si falla el análisis: 1) espera 20–30 s (límite de APIs), 2) prueba BTC/ETH, 3) recarga la página, 4) revisa internet. La app reintenta sola varias veces.";
  }

  if (/regla|disciplina|checklist|antes de comprar/.test(query)) {
    return [
      "Checklist antes de comprar:",
      "1) ¿El momento NO dice «NO ENTRAR» ni «ESPERAR RETROCESO» extremo?",
      "2) ¿Tienes zona ideal y stop escritos?",
      "3) ¿El tamaño es ≤ lo que el plan sugiere?",
      "4) ¿Si pierde el stop, te duele poco?",
      "5) ¿Vas a registrar la compra en la app?",
      "Si falla un punto, no entres o reduce a un tramo mínimo.",
    ].join("\n");
  }

  const conf = signalConfidence(tech, score, riskLevel);
  const bits = [
    "Puedo ayudarte con: cuándo/a qué precio comprar, tramos, stops, RSI/SMA, riesgo, comisiones Spot, checklist, tus posiciones y el activo cargado.",
    name
      ? `Contexto actual: **${name}** · veredicto ${verdict?.tag || "—"} · confianza señal ${conf.label} (${conf.pct}/100).`
      : "Carga una moneda (Analizar) para números reales de entrada/stop/TP.",
    "Ejemplos: «¿cuándo comprar?», «checklist», «¿qué tan fiable es la señal?», «¿cuánto compro con $20?»",
  ];
  return bits.join("\n\n");
}

export default function App() {
  const initial = loadStore();
  const [capital, setCapital] = useState(initial.capital);
  const [riskLevel, setRiskLevel] = useState(initial.riskLevel);
  const [query, setQuery] = useState("BTC");
  const [tab, setTab] = useState("analizar");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tech, setTech] = useState(null);
  const [live, setLive] = useState(null);
  const [dir, setDir] = useState(0);
  const [history, setHistory] = useState(initial.history || []);
  const [positions, setPositions] = useState(initial.positions || []);
  const [buyUsd, setBuyUsd] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [msgs, setMsgs] = useState([
    {
      role: "bot",
      text: "Soy tu guía Spot (sin IA externa).\nPregunta lo que necesites sobre riesgo, tamaño, stops, escenarios o tus posiciones.\nTodo se guarda en este navegador: búsquedas y compras no se borran al cerrar.",
    },
  ]);
  const [chatIn, setChatIn] = useState("");
  const endRef = useRef(null);

  const riskPct = (RISK_LEVELS[riskLevel] || RISK_LEVELS.moderado).pct;
  const score = useMemo(() => (detail && tech ? scoreCoin(detail, tech) : null), [detail, tech]);
  const stop = useMemo(() => {
    if (!tech) return null;
    return Math.min(tech.support * 0.96, tech.price - (tech.lastAtr || tech.price * 0.03) * 1.4);
  }, [tech]);
  const verdict = useMemo(
    () => (score && tech ? verdictFrom(score.total, tech, riskLevel) : null),
    [score, tech, riskLevel]
  );
  const plan = useMemo(
    () => buildPlan(capital, riskPct, live || tech?.price, stop),
    [capital, riskPct, live, tech, stop]
  );

  // persist settings + lists
  useEffect(() => {
    saveStore({ capital, riskLevel, history, positions });
  }, [capital, riskLevel, history, positions]);

  const run = useCallback(async (q) => {
    const term = (q || query).trim();
    if (!term) return;
    setLoading(true);
    setError(null);
    setTab("analizar");
    try {
      const d = await resolveAndDetail(term);
      const symbol = d.symbol?.toUpperCase();
      const candles = await fetchCandles(symbol);
      const t = analyzeCandles(candles);
      if (!t) {
        setDetail(d);
        setTech(null);
        setLive(d.market_data?.current_price?.usd ?? null);
        setError("Hay datos de mercado, pero no velas suficientes en Binance para esta moneda. Prueba un par USDT más líquido (BTC, ETH, SOL…).");
        setQuery(symbol || term);
        setHistory((h) => {
          const entry = { id: d.id, symbol, name: d.name, image: d.image?.thumb || d.image?.small, at: Date.now() };
          return [entry, ...h.filter((x) => x.id !== d.id)].slice(0, 40);
        });
        return;
      }
      setDetail(d);
      setTech(t);
      const px = t?.price ?? d.market_data?.current_price?.usd ?? null;
      setLive(px);
      setQuery(symbol || term);
      setBuyPrice(px != null ? String(px) : "");
      setBuyUsd((prev) => prev || String(Math.min(Number(capital) || 10, 15)));
      setHistory((h) => {
        const entry = {
          id: d.id,
          symbol,
          name: d.name,
          image: d.image?.thumb || d.image?.small,
          at: Date.now(),
        };
        const rest = h.filter((x) => x.id !== d.id);
        return [entry, ...rest].slice(0, 40);
      });
    } catch (e) {
      setError(e.message || "No se pudo analizar. Prueba BTC o ETH, o espera 20 s si la API está limitada.");
      setDetail(null);
      setTech(null);
    } finally {
      setLoading(false);
    }
  }, [query, capital]);

  // live price + refresh position marks
  useEffect(() => {
    if (!detail?.symbol) return;
    let stopPoll = false;
    const tick = async () => {
      const sym = detail.symbol.toUpperCase();
      try {
        for (const p of [`${sym}USDT`, `${sym}USDC`]) {
          const res = await fetch(`${BN}/ticker/price?symbol=${p}`);
          if (!res.ok) continue;
          const j = await res.json();
          if (j.price && !j.code) {
            const px = +j.price;
            if (!stopPoll && Number.isFinite(px)) {
              setLive((prev) => {
                if (prev != null) setDir(px > prev ? 1 : px < prev ? -1 : 0);
                return px;
              });
              setPositions((ps) =>
                ps.map((pos) =>
                  pos.symbol === sym ? { ...pos, lastPrice: px, lastAt: Date.now() } : pos
                )
              );
            }
            return;
          }
        }
        const j = await getJson(`${CG}/simple/price?ids=${detail.id}&vs_currencies=usd`);
        const px = j?.[detail.id]?.usd;
        if (Number.isFinite(px) && !stopPoll) {
          setLive(px);
          setPositions((ps) =>
            ps.map((pos) =>
              pos.id === detail.id ? { ...pos, lastPrice: px, lastAt: Date.now() } : pos
            )
          );
        }
      } catch { /* ignore */ }
    };
    tick();
    const iv = setInterval(tick, 12000);
    return () => { stopPoll = true; clearInterval(iv); };
  }, [detail?.id, detail?.symbol]);

  // refresh last prices for open positions periodically
  useEffect(() => {
    if (!positions.length) return;
    let dead = false;
    async function refresh() {
      for (const p of positions) {
        try {
          const j = await getJson(`${CG}/simple/price?ids=${p.id}&vs_currencies=usd`);
          const px = j?.[p.id]?.usd;
          if (Number.isFinite(px) && !dead) {
            setPositions((ps) =>
              ps.map((x) => (x.id === p.id ? { ...x, lastPrice: px, lastAt: Date.now() } : x))
            );
          }
        } catch { /* skip */ }
      }
    }
    refresh();
    const iv = setInterval(refresh, 60000);
    return () => { dead = true; clearInterval(iv); };
  }, [positions.length]); // eslint-disable-line

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  function sendChat() {
    const q = chatIn.trim();
    if (!q) return;
    setChatIn("");
    setMsgs((m) => [...m, { role: "me", text: q }]);
    const reply = assistantReply(q, {
      detail, tech, score, verdict, plan, capital, riskLevel, positions, history,
    });
    setTimeout(() => setMsgs((m) => [...m, { role: "bot", text: reply }]), 180);
  }

  function registerBuy() {
    if (!detail || !tech) return;
    const entryPrice = Number(buyPrice) || live || tech.price;
    const usd = Number(buyUsd) || 0;
    if (!entryPrice || usd < 1) {
      setError("Indica precio de entrada y dólares comprados (mín. ~$1).");
      return;
    }
    const pos = {
      id: detail.id,
      symbol: detail.symbol.toUpperCase(),
      name: detail.name,
      image: detail.image?.thumb || detail.image?.small,
      entryPrice,
      usd,
      units: usd / entryPrice,
      at: Date.now(),
      lastPrice: live || entryPrice,
      lastAt: Date.now(),
      stopAtRegister: stop,
    };
    setPositions((ps) => [pos, ...ps].slice(0, 50));
    setError(null);
    setMsgs((m) => [
      ...m,
      {
        role: "bot",
        text: `Compra registrada: **${pos.symbol}** · ${fmt.usd(usd)} @ ${fmt.price(entryPrice)}.\nQueda guardada aunque cierres la página. Mírala en la pestaña «Posiciones» y en el gráfico (línea dorada = tu entrada).`,
      },
    ]);
    setTab("posiciones");
  }

  function removePosition(at) {
    setPositions((ps) => ps.filter((p) => p.at !== at));
  }
  function clearHistory() {
    setHistory([]);
  }

  const md = detail?.market_data;
  const displayPrice = live ?? tech?.price ?? md?.current_price?.usd;
  const entryMarks = positions
    .filter((p) => detail && p.id === detail.id)
    .map((p) => ({ price: p.entryPrice }));

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Grok Spot Desk</h1>
          <p>Spot Binance · guía local · datos reales · guardado en tu navegador</p>
        </div>
        <div className="badge-live"><span className="dot" /> en vivo</div>
      </header>

      <div className="profile-bar">
        <div className="field">
          <label>Capital operación ($)</label>
          <input type="number" min={5} step={1} value={capital} onChange={(e) => setCapital(+e.target.value || 0)} />
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>Riesgo por niveles</label>
          <div className="risk-pills">
            {Object.entries(RISK_LEVELS).map(([key, v]) => (
              <button
                key={key}
                type="button"
                className={`risk-pill ${riskLevel === key ? "active" : ""}`}
                onClick={() => setRiskLevel(key)}
              >
                {v.label}
                <small>{v.pct}% / trade</small>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Exchange</label>
          <input value="Binance Spot" readOnly />
        </div>
      </div>

      <div className="search-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Busca cualquier cripto: BTC, SOL, un token nuevo…"
        />
        <button className="btn btn-primary" onClick={() => run()} disabled={loading}>
          {loading ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
          Analizar
        </button>
      </div>
      <div className="quick">
        {QUICK.map((s) => (
          <button key={s} className="chip" onClick={() => { setQuery(s); run(s); }}>{s}</button>
        ))}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "analizar" ? "active" : ""}`} onClick={() => setTab("analizar")}>Analizar</button>
        <button className={`tab ${tab === "historial" ? "active" : ""}`} onClick={() => setTab("historial")}>
          <History size={13} style={{ verticalAlign: "middle" }} /> Historial ({history.length})
        </button>
        <button className={`tab ${tab === "posiciones" ? "active" : ""}`} onClick={() => setTab("posiciones")}>
          <Briefcase size={13} style={{ verticalAlign: "middle" }} /> Posiciones ({positions.length})
        </button>
      </div>

      {error && <div className="error"><AlertTriangle size={14} /> {error}</div>}

      {tab === "historial" && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3><History size={14} /> Búsquedas guardadas</h3>
          {!history.length && <div className="empty">Aún no hay búsquedas. Analiza una moneda.</div>}
          {history.map((h) => (
            <div className="list-row" key={h.id + h.at} onClick={() => run(h.symbol)}>
              {h.image && <img src={h.image} alt="" />}
              <div>
                <div className="name">{h.symbol} · {h.name}</div>
                <div className="sub">{fmt.date(h.at)}</div>
              </div>
            </div>
          ))}
          {!!history.length && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={clearHistory}>Vaciar historial</button>
          )}
        </div>
      )}

      {tab === "posiciones" && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3><Briefcase size={14} /> Mis compras (rendimiento)</h3>
          {!positions.length && <div className="empty">Registra una compra desde el análisis para ver el P&amp;L aquí.</div>}
          {positions.map((p) => {
            const pnlPct = p.lastPrice != null ? (p.lastPrice / p.entryPrice - 1) * 100 : null;
            const pnlUsd = pnlPct != null ? p.usd * (pnlPct / 100) : null;
            return (
              <div className="list-row" key={p.at} onClick={() => run(p.symbol)}>
                {p.image && <img src={p.image} alt="" />}
                <div>
                  <div className="name">{p.symbol} · {fmt.usd(p.usd)}</div>
                  <div className="sub">Entrada {fmt.price(p.entryPrice)} · {fmt.date(p.at)}</div>
                </div>
                <div className="right">
                  <div className={pnlPct != null && pnlPct >= 0 ? "pnl-up" : "pnl-down"}>
                    {pnlPct == null ? "—" : fmt.pct(pnlPct)}
                  </div>
                  <div className="sub">{pnlUsd == null ? "" : fmt.usd(pnlUsd)}</div>
                </div>
                <button className="icon-btn" type="button" onClick={(e) => { e.stopPropagation(); removePosition(p.at); }}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid">
        <div>
          {loading && <div className="card loading"><RefreshCw className="spin" size={20} /> Analizando…</div>}
          {!loading && !detail && tab === "analizar" && (
            <div className="card empty">Busca una cripto o pulsa un chip. Las nuevas también: escribe el nombre si está en CoinGecko/Binance.</div>
          )}
          {!loading && detail && tab === "analizar" && (
            <div className="card">
              <div className="coin-head">
                <div className="coin-id">
                  <img src={detail.image?.small} alt="" />
                  <div>
                    <h2>{detail.name} <span>{detail.symbol?.toUpperCase()}</span></h2>
                    <div className="meta">Rank #{detail.market_cap_rank ?? "—"}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className={`price-big ${dir > 0 ? "up" : dir < 0 ? "down" : ""}`}>{fmt.price(displayPrice)}</div>
                  <div className="meta"><Zap size={11} style={{ verticalAlign: "middle" }} /> en vivo</div>
                </div>
              </div>

              {verdict && (
                <div className="verdict">
                  <span className={`verdict-tag ${verdict.cls}`}>{verdict.tag}</span>
                  <div className="scores">
                    <div><strong>{score?.total}</strong><span>score</span></div>
                    <div><strong>{tech?.quality ?? "—"}</strong><span>técnico</span></div>
                    <div><strong>{tech?.lastRsi?.toFixed?.(0) ?? "—"}</strong><span>RSI</span></div>
                    <div><strong>{signalConfidence(tech, score, riskLevel).pct}</strong><span>confianza</span></div>
                  </div>
                </div>
              )}
              {verdict && <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 12 }}>{verdict.why}</p>}

              {tech && verdict && (() => {
                const timing = buildBuyTiming(tech, verdict, stop, displayPrice);
                if (!timing) return null;
                const cls = timing.color === "now" ? "v-buy" : timing.color === "scale" ? "v-scale" : timing.color === "no" ? "v-no" : "v-wait";
                return (
                  <div style={{ marginBottom: 14 }}>
                    <h3><Target size={14} /> ¿Cuándo comprar y a qué precio?</h3>
                    <div className="verdict" style={{ marginBottom: 10 }}>
                      <span className={`verdict-tag ${cls}`}>{timing.momento}</span>
                    </div>
                    <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 10 }}>{timing.detalle}</p>
                    <div className="stats">
                      <div className="stat"><div className="lbl">Precio ahora</div><div className="val">{fmt.price(timing.precioActual)}</div></div>
                      <div className="stat"><div className="lbl">Zona ideal</div><div className="val">{fmt.price(timing.zonaIdeal.min)} – {fmt.price(timing.zonaIdeal.max)}</div></div>
                      <div className="stat"><div className="lbl">Zona aceptable</div><div className="val">{fmt.price(timing.zonaAceptable.min)} – {fmt.price(timing.zonaAceptable.max)}</div></div>
                      <div className="stat"><div className="lbl">Stop</div><div className="val">{fmt.price(timing.stop)}</div></div>
                      <div className="stat"><div className="lbl">TP1</div><div className="val">{fmt.price(timing.tp1)}</div></div>
                      <div className="stat"><div className="lbl">TP2</div><div className="val">{fmt.price(timing.tp2)}</div></div>
                      <div className="stat"><div className="lbl">TP3</div><div className="val">{fmt.price(timing.tp3)}</div></div>
                      <div className="stat"><div className="lbl">Soporte</div><div className="val">{fmt.price(timing.soporte)}</div></div>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--muted)" }}>{timing.condicion}</p>
                  </div>
                );
              })()}

              <div className="stats">
                <div className="stat"><div className="lbl">24h</div><div className={`val ${(md?.price_change_percentage_24h || 0) >= 0 ? "up" : "down"}`}>{fmt.pct(md?.price_change_percentage_24h)}</div></div>
                <div className="stat"><div className="lbl">7d</div><div className={`val ${(md?.price_change_percentage_7d || 0) >= 0 ? "up" : "down"}`}>{fmt.pct(md?.price_change_percentage_7d)}</div></div>
                <div className="stat"><div className="lbl">Market Cap</div><div className="val">{fmt.compact(md?.market_cap?.usd)}</div></div>
                <div className="stat"><div className="lbl">Vol 24h</div><div className="val">{fmt.compact(md?.total_volume?.usd)}</div></div>
                <div className="stat"><div className="lbl">Tendencia</div><div className="val">{tech?.trend ?? "—"}</div></div>
                <div className="stat"><div className="lbl">Soporte</div><div className="val">{fmt.price(tech?.support)}</div></div>
                <div className="stat"><div className="lbl">vs ATH</div><div className="val">{fmt.pct(md?.ath_change_percentage?.usd)}</div></div>
                <div className="stat"><div className="lbl">Dist. soporte</div><div className="val">{tech ? tech.distSup.toFixed(1) + "%" : "—"}</div></div>
              </div>

              <h3><Activity size={14} /> Gráfico · entrada marcada en dorado</h3>
              <ChartBlock tech={tech} stop={stop} targets={tech ? [tech.res1, tech.res2, tech.res3] : null} entryMarks={entryMarks} />

              <h3 className="section-gap"><Wallet size={14} /> Registré compra (se guarda)</h3>
              <div className="buy-box">
                <div className="field">
                  <label>Precio entrada</label>
                  <input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} />
                </div>
                <div className="field">
                  <label>USD comprados</label>
                  <input value={buyUsd} onChange={(e) => setBuyUsd(e.target.value)} />
                </div>
                <button className="btn btn-buy btn-sm" type="button" onClick={registerBuy}>Registré compra</button>
              </div>

              {tech && (
                <>
                  <h3><Target size={14} /> Escenarios</h3>
                  <div className="scenarios">
                    <div className="sc up">
                      <div className="title"><TrendingUp size={14} /> Alcista</div>
                      <div className="row"><span>TP1</span><strong>{fmt.price(tech.res1)}</strong></div>
                      <div className="row"><span>TP2</span><strong>{fmt.price(tech.res2)}</strong></div>
                      <div className="row"><span>TP3</span><strong>{fmt.price(tech.res3)}</strong></div>
                      <p>Si aguanta el soporte.</p>
                    </div>
                    <div className="sc">
                      <div className="title"><Shield size={14} /> Base</div>
                      <div className="row"><span>Rango</span><strong>{fmt.price(Math.min(tech.price, tech.support * 1.02))} – {fmt.price((tech.price + tech.res1) / 2)}</strong></div>
                      <p>Lateral / consolidación.</p>
                    </div>
                    <div className="sc down">
                      <div className="title"><TrendingDown size={14} /> Bajista</div>
                      <div className="row"><span>Soporte</span><strong>{fmt.price(tech.support)}</strong></div>
                      <div className="row"><span>Stop</span><strong>{fmt.price(stop)}</strong></div>
                      <p>Si pierde soporte, reduce.</p>
                    </div>
                  </div>
                </>
              )}

              <h3><Wallet size={14} /> Plan de tamaño</h3>
              {plan?.tooSmall && <div className="error">{plan.msg}</div>}
              {plan && !plan.tooSmall && (
                <>
                  <div className="stats">
                    <div className="stat"><div className="lbl">Tamaño</div><div className="val">{fmt.usd(plan.size)}</div></div>
                    <div className="stat"><div className="lbl">Riesgo máx.</div><div className="val">{fmt.usd(plan.maxRisk)}</div></div>
                    <div className="stat"><div className="lbl">Stop</div><div className="val">{fmt.price(stop)}</div></div>
                    <div className="stat"><div className="lbl">Unidades</div><div className="val">{plan.units.toFixed(5)}</div></div>
                  </div>
                  <div className="tramos">
                    {plan.tramos.map((t, i) => (
                      <div className="tramo" key={i}><Wallet size={14} /> {t.label} <strong>{fmt.usd(t.usd)}</strong></div>
                    ))}
                  </div>
                </>
              )}

              <div className="warn">
                <AlertTriangle size={14} />
                <span>Escenarios técnicos, no promesas. No ejecuta órdenes. Los datos se guardan solo en este navegador (localStorage).</span>
              </div>
            </div>
          )}
        </div>

        <div className="card chat">
          <h3><Bot size={14} /> Guía / chat (sin Gemini)</h3>
          <div className="chat-msgs">
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role === "bot" ? "bot" : "me"}`}>
                {m.text.replace(/\*\*(.+?)\*\*/g, "$1")}
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="chat-input">
            <input
              value={chatIn}
              onChange={(e) => setChatIn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="Pregunta libre sobre Spot, riesgo, stops…"
            />
            <button className="btn btn-primary" onClick={sendChat}><Send size={16} /></button>
          </div>
          <div className="quick-q">
            {["¿Cómo empiezo?", "¿Cuándo comprar?", "Checklist", "¿Qué tan fiable?", "¿Cuánto compro?", "¿Dónde va el stop?"].map((q) => (
              <button key={q} type="button" onClick={() => setChatIn(q)}>{q}</button>
            ))}
          </div>
        </div>
      </div>

      <p className="footer">Grok Spot Desk · investigación Spot · no es asesoramiento financiero</p>
    </div>
  );
}
