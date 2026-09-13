import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import {
  Search, RefreshCw, TrendingUp, TrendingDown, AlertTriangle,
  Send, Bot, Zap, Target, Wallet, Shield, Activity,
} from "lucide-react";

const CG = "https://api.coingecko.com/api/v3";
const BN = "https://api.binance.com/api/v3";
const QUICK = ["BTC", "ETH", "SOL", "BNB", "XRP", "LINK", "AVAX", "SUI"];

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
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  },
  compact(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  },
};

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
  const vols = candles.map((c) => c.volume || 0);
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

  const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, vols.length));
  let quality = 50;
  if (trend === "alcista") quality += 18;
  if (trend === "bajista") quality -= 18;
  if (lastS200 && price > lastS200) quality += 8;
  if (lastS200 && price < lastS200) quality -= 8;
  if (lastRsi >= 40 && lastRsi <= 62) quality += 10;
  if (lastRsi > 75) quality -= 14;
  if (lastRsi < 28) quality -= 4;
  const distSup = ((price - support) / price) * 100;
  if (distSup <= 8) quality += 8;
  if (distSup > 20) quality -= 6;
  quality = Math.max(0, Math.min(100, Math.round(quality)));

  const chart = candles.slice(-120).map((c, i) => {
    const idx = candles.length - 120 + i;
    return {
      t: new Date(c.time).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
      close: c.close,
      s20: s20[idx],
      s50: s50?.[idx] ?? null,
      s200: s200?.[idx] ?? null,
      vol: c.volume,
      rsi: rs[idx],
    };
  });

  return {
    price, trend, lastRsi, lastAtr, lastS20, lastS50, lastS200, lastE20,
    support, res1, res2, res3, distSup, quality, avgVol, chart, candles,
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

  const total = Math.round(fund + tok + val + liq + tec + risk);
  return {
    total: Math.min(100, total),
    parts: { fund, tok, val, liq, tec, risk },
  };
}

function verdictFrom(score, tech, riskProfile) {
  const buy = riskProfile === "agresivo" ? 70 : riskProfile === "conservador" ? 82 : 76;
  const scale = riskProfile === "agresivo" ? 62 : riskProfile === "conservador" ? 72 : 68;
  if (!tech) return { tag: "OBSERVAR", cls: "v-wait", why: "Faltan datos técnicos de Binance." };
  if (tech.trend === "bajista" && score < buy) return { tag: "ESPERAR", cls: "v-wait", why: "Tendencia diaria bajista: mejor esperar soporte o giro." };
  if (tech.lastRsi > 78) return { tag: "ESPERAR", cls: "v-wait", why: "RSI muy alto: mala relación riesgo/beneficio ahora." };
  if (tech.distSup > 22) return { tag: "ESPERAR", cls: "v-wait", why: `Precio lejos del soporte (${tech.distSup.toFixed(0)}%). No perseguir.` };
  if (score >= buy) return { tag: "COMPRAR", cls: "v-buy", why: "Confluencia de score, liquidez y estructura técnica." };
  if (score >= scale) return { tag: "COMPRAR EN TRAMOS", cls: "v-scale", why: "Ventaja parcial: entrar por partes según tu plan." };
  if (score >= 55) return { tag: "OBSERVAR", cls: "v-wait", why: "Interesante para seguir, sin entrada clara hoy." };
  return { tag: "NO COMPRAR", cls: "v-no", why: "Calidad/riesgo no justifican entrada en Spot ahora." };
}

function buildPlan(capital, riskPct, entry, stop) {
  capital = Number(capital) || 0;
  if (capital < 5) {
    return { tooSmall: true, msg: `Con $${capital.toFixed(2)} es muy justo. Recomiendo al menos $5–$15 en Binance Spot (comisiones y mínimo práctico).` };
  }
  if (!entry || !stop || stop >= entry) return null;
  const maxRisk = capital * (riskPct / 100);
  const stopPct = (entry - stop) / entry;
  let size = Math.min(capital, maxRisk / stopPct);
  if (size < 5 && capital >= 5) size = 5;
  const units = size / entry;
  const tramos =
    size >= 15
      ? [
          { label: "Tramo 1 · zona actual / preferida", usd: size * 0.4 },
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
        .map((k) => ({
          time: k[0],
          open: +k[1],
          high: +k[2],
          low: +k[3],
          close: +k[4],
          volume: +k[5],
        }));
    } catch {
      /* next pair */
    }
  }
  return null;
}

async function resolveAndDetail(query) {
  const q = query.trim();
  // try search
  let id = q.toLowerCase();
  try {
    const search = await getJson(`${CG}/search?query=${encodeURIComponent(q)}`);
    const coins = search.coins || [];
    const exact =
      coins.find((c) => c.symbol?.toLowerCase() === q.toLowerCase()) ||
      coins.find((c) => c.id === q.toLowerCase()) ||
      coins[0];
    if (exact) id = exact.id;
  } catch {
    /* use raw */
  }
  const detail = await getJson(
    `${CG}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true&sparkline=false`
  );
  return detail;
}

function ChartBlock({ tech, stop, targets }) {
  if (!tech?.chart?.length) return null;
  return (
    <>
      <div className="chart-box">
        <ResponsiveContainer>
          <ComposedChart data={tech.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#243041" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "#8b9bb0", fontSize: 10 }} minTickGap={32} axisLine={false} tickLine={false} />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "#8b9bb0", fontSize: 10 }} width={64} axisLine={false} tickLine={false} tickFormatter={(v) => fmt.price(v)} />
            <Tooltip
              contentStyle={{ background: "#11171f", border: "1px solid #243041", borderRadius: 10, fontSize: 12 }}
              formatter={(v, n) => [n === "Vol" ? fmt.compact(v) : fmt.price(v), n]}
            />
            {stop && <ReferenceLine y={stop} stroke="#f07178" strokeDasharray="4 3" />}
            {targets?.map((t, i) => t && <ReferenceLine key={i} y={t} stroke="#3ecf8e" strokeDasharray="4 3" />)}
            <ReferenceLine y={tech.support} stroke="#5b9fd4" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="close" stroke="#e8edf4" strokeWidth={2} dot={false} name="Precio" />
            <Line type="monotone" dataKey="s20" stroke="#e6b84d" strokeWidth={1.2} dot={false} name="SMA20" />
            <Line type="monotone" dataKey="s50" stroke="#5b9fd4" strokeWidth={1.1} dot={false} name="SMA50" />
            <Line type="monotone" dataKey="s200" stroke="#9b7bdb" strokeWidth={1} dot={false} strokeDasharray="5 3" name="SMA200" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-sub">
        <ResponsiveContainer>
          <ComposedChart data={tech.chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <YAxis domain={[0, 100]} tick={{ fill: "#8b9bb0", fontSize: 9 }} width={64} axisLine={false} tickLine={false} />
            <XAxis dataKey="t" hide />
            <ReferenceLine y={70} stroke="#f07178" strokeDasharray="3 3" strokeOpacity={0.5} />
            <ReferenceLine y={30} stroke="#3ecf8e" strokeDasharray="3 3" strokeOpacity={0.5} />
            <ReferenceArea y1={40} y2={60} fill="#e6b84d" fillOpacity={0.06} />
            <Line type="monotone" dataKey="rsi" stroke="#e6b84d" strokeWidth={1.4} dot={false} name="RSI" />
            <Tooltip contentStyle={{ background: "#11171f", border: "1px solid #243041", borderRadius: 8, fontSize: 11 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function assistantReply(q, ctx) {
  const query = q.toLowerCase();
  const { detail, tech, score, verdict, plan, capital, riskPct } = ctx;
  const name = detail?.name || "el activo";
  const price = tech?.price;

  if (/cu[aá]nto|comprar|posici[oó]n|tama[nñ]o|d[oó]lar|\$|invertir|tramo/.test(query)) {
    if (!plan) return "Primero analiza una moneda y configura tu capital arriba.";
    if (plan.tooSmall) return plan.msg;
    return [
      `Con capital de operación **$${Number(capital).toFixed(2)}** y riesgo **${riskPct}%**:`,
      `• Tamaño sugerido total: **${fmt.usd(plan.size)}**`,
      `• Unidades aprox.: **${plan.units.toFixed(6)}** @ ${fmt.price(price)}`,
      `• Riesgo máximo si salta el stop: **${fmt.usd(plan.maxRisk)}** (~${plan.stopPct.toFixed(1)}%)`,
      "",
      ...plan.tramos.map((t) => `– ${t.label}: **${fmt.usd(t.usd)}**`),
      "",
      "Hazlo **manual** en Binance Spot. Yo no ejecuto órdenes.",
    ].join("\n");
  }

  if (/subir|bajar|predic|objetivo|tp|escenario|a cu[aá]nto|hacia/.test(query)) {
    if (!tech) return "Analiza una moneda para ver escenarios técnicos.";
    const p = tech.price;
    const pct = (x) => fmt.pct((x / p - 1) * 100);
    return [
      `⚠️ No es una predicción garantizada. Son **niveles técnicos** (ATR + pivots).`,
      "",
      `Precio ref. **${fmt.price(p)}** · ATR ~${fmt.price(tech.lastAtr)}`,
      "",
      `📈 Alcista`,
      `• TP1 ${fmt.price(tech.res1)} (${pct(tech.res1)})`,
      `• TP2 ${fmt.price(tech.res2)} (${pct(tech.res2)})`,
      `• TP3 ${fmt.price(tech.res3)} (${pct(tech.res3)})`,
      "",
      `📉 Bajista`,
      `• Soporte ${fmt.price(tech.support)} (${pct(tech.support)})`,
      `• Stop ${fmt.price(Math.min(tech.support * 0.96, p - tech.lastAtr * 1.4))} (${pct(Math.min(tech.support * 0.96, p - tech.lastAtr * 1.4))})`,
      "",
      `Veredicto actual: **${verdict?.tag}** — ${verdict?.why}`,
    ].join("\n");
  }

  if (/stop|invalid|riesgo|perder/.test(query)) {
    if (!tech) return "Necesito un análisis primero.";
    const stop = Math.min(tech.support * 0.96, tech.price - tech.lastAtr * 1.4);
    return `Stop sugerido para ${name}: **${fmt.price(stop)}** (${fmt.pct((stop / tech.price - 1) * 100)} desde el precio). Si cierra con fuerza debajo, la tesis de entrada se invalida.`;
  }

  if (/veredicto|debo|momento|se[nñ]al|entrar/.test(query)) {
    if (!verdict) return "Analiza una moneda (BTC, ETH, SOL…) y te digo el veredicto.";
    return `**${verdict.tag}**\n${verdict.why}\nScore ${score?.total ?? "—"}/100 · Tendencia ${tech?.trend ?? "—"} · RSI ${tech?.lastRsi?.toFixed?.(1) ?? "—"}`;
  }

  return [
    `Puedo ayudarte con datos reales de **${name !== "el activo" ? name : "el mercado"}**:`,
    "1) ¿Cuánto comprar con tu capital?",
    "2) Escenarios de precio (arriba / abajo)",
    "3) Stop y veredicto",
    "",
    name === "el activo" ? "Tip: escribe BTC o ETH arriba y pulsa Analizar." : `Tengo cargado ${name}. Pregunta lo que necesites.`,
  ].join("\n");
}

export default function App() {
  const [capital, setCapital] = useState(25);
  const [riskPct, setRiskPct] = useState(1);
  const [riskProfile, setRiskProfile] = useState("moderado");
  const [query, setQuery] = useState("BTC");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tech, setTech] = useState(null);
  const [live, setLive] = useState(null);
  const [dir, setDir] = useState(0);
  const [msgs, setMsgs] = useState([
    {
      role: "bot",
      text: "Soy Grok Spot Desk. Analizo Spot con datos reales (CoinGecko + Binance).\nPregúntame cuánto comprar, escenarios de precio o el stop.\nNo ejecuto órdenes ni garantizo ganancias.",
    },
  ]);
  const [chatIn, setChatIn] = useState("");
  const endRef = useRef(null);

  const score = useMemo(() => (detail && tech ? scoreCoin(detail, tech) : null), [detail, tech]);
  const stop = useMemo(() => {
    if (!tech) return null;
    return Math.min(tech.support * 0.96, tech.price - (tech.lastAtr || tech.price * 0.03) * 1.4);
  }, [tech]);
  const verdict = useMemo(() => (score && tech ? verdictFrom(score.total, tech, riskProfile) : null), [score, tech, riskProfile]);
  const plan = useMemo(() => buildPlan(capital, riskPct, live || tech?.price, stop), [capital, riskPct, live, tech, stop]);

  const run = useCallback(async (q) => {
    const term = (q || query).trim();
    if (!term) return;
    setLoading(true);
    setError(null);
    try {
      const d = await resolveAndDetail(term);
      const symbol = d.symbol?.toUpperCase();
      const candles = await fetchCandles(symbol);
      const t = analyzeCandles(candles);
      setDetail(d);
      setTech(t);
      setLive(t?.price ?? d.market_data?.current_price?.usd ?? null);
      setQuery(symbol || term);
    } catch (e) {
      setError(e.message || "No se pudo analizar. Prueba BTC, ETH o SOL.");
      setDetail(null);
      setTech(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // live price
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
            }
            return;
          }
        }
        // fallback CG
        const j = await getJson(`${CG}/simple/price?ids=${detail.id}&vs_currencies=usd`);
        const px = j?.[detail.id]?.usd;
        if (Number.isFinite(px) && !stopPoll) setLive(px);
      } catch { /* ignore */ }
    };
    tick();
    const iv = setInterval(tick, 10000);
    return () => { stopPoll = true; clearInterval(iv); };
  }, [detail?.id, detail?.symbol]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  function sendChat() {
    const q = chatIn.trim();
    if (!q) return;
    setChatIn("");
    setMsgs((m) => [...m, { role: "me", text: q }]);
    const reply = assistantReply(q, { detail, tech, score, verdict, plan, capital, riskPct });
    setTimeout(() => setMsgs((m) => [...m, { role: "bot", text: reply }]), 200);
  }

  const md = detail?.market_data;
  const displayPrice = live ?? tech?.price ?? md?.current_price?.usd;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="logo">GS</div>
          <div>
            <h1>Grok Spot Desk</h1>
            <p>Spot Binance · datos reales · capital pequeño</p>
          </div>
        </div>
        <div className="badge-live"><span className="dot" /> precios en vivo</div>
      </header>

      <div className="profile-bar">
        <div className="field">
          <label>Capital operación ($)</label>
          <input type="number" min={5} step={1} value={capital} onChange={(e) => setCapital(+e.target.value || 0)} />
        </div>
        <div className="field">
          <label>Riesgo por trade (%)</label>
          <input type="number" min={0.25} max={5} step={0.25} value={riskPct} onChange={(e) => setRiskPct(+e.target.value || 1)} />
        </div>
        <div className="field">
          <label>Perfil</label>
          <select value={riskProfile} onChange={(e) => setRiskProfile(e.target.value)}>
            <option value="conservador">Conservador</option>
            <option value="moderado">Moderado</option>
            <option value="agresivo">Agresivo</option>
          </select>
        </div>
        <div className="field">
          <label>Exchange</label>
          <input value="Binance Spot" readOnly />
        </div>
        <div className="field">
          <label>Mínimo práctico</label>
          <input value="~$5 – $15" readOnly />
        </div>
      </div>

      <div className="search-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="BTC, ETH, SOL, LINK…"
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

      {error && <div className="error"><AlertTriangle size={14} /> {error}</div>}

      <div className="grid">
        <div>
          {loading && <div className="card loading"><RefreshCw className="spin" size={20} /> Analizando mercado y velas…</div>}
          {!loading && !detail && (
            <div className="card empty">Elige una moneda y pulsa Analizar. Empieza por BTC o ETH si tu capital es pequeño.</div>
          )}
          {!loading && detail && (
            <div className="card">
              <div className="coin-head">
                <div className="coin-id">
                  <img src={detail.image?.small} alt="" />
                  <div>
                    <h2>{detail.name} <span>{detail.symbol?.toUpperCase()}</span></h2>
                    <div className="meta">Rank #{detail.market_cap_rank ?? "—"} · Spot research</div>
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
                  </div>
                </div>
              )}
              {verdict && <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 12 }}>{verdict.why}</p>}

              <div className="stats">
                <div className="stat"><div className="lbl">24h</div><div className={`val ${(md?.price_change_percentage_24h || 0) >= 0 ? "up" : "down"}`}>{fmt.pct(md?.price_change_percentage_24h)}</div></div>
                <div className="stat"><div className="lbl">7d</div><div className={`val ${(md?.price_change_percentage_7d || 0) >= 0 ? "up" : "down"}`}>{fmt.pct(md?.price_change_percentage_7d)}</div></div>
                <div className="stat"><div className="lbl">Market Cap</div><div className="val">{fmt.compact(md?.market_cap?.usd)}</div></div>
                <div className="stat"><div className="lbl">Vol 24h</div><div className="val">{fmt.compact(md?.total_volume?.usd)}</div></div>
                <div className="stat"><div className="lbl">Tendencia 1D</div><div className="val">{tech?.trend ?? "—"}</div></div>
                <div className="stat"><div className="lbl">Soporte</div><div className="val">{fmt.price(tech?.support)}</div></div>
                <div className="stat"><div className="lbl">vs ATH</div><div className="val">{fmt.pct(md?.ath_change_percentage?.usd)}</div></div>
                <div className="stat"><div className="lbl">Dist. soporte</div><div className="val">{tech ? tech.distSup.toFixed(1) + "%" : "—"}</div></div>
              </div>

              <h3><Activity size={14} /> Gráfico · SMA · RSI</h3>
              <ChartBlock tech={tech} stop={stop} targets={tech ? [tech.res1, tech.res2, tech.res3] : null} />

              {tech && (
                <>
                  <h3 style={{ marginTop: 8 }}><Target size={14} /> Escenarios de precio</h3>
                  <div className="scenarios">
                    <div className="sc up">
                      <div className="title"><TrendingUp size={14} /> Alcista</div>
                      <div className="row"><span>TP1</span><strong>{fmt.price(tech.res1)}</strong></div>
                      <div className="row"><span>TP2</span><strong>{fmt.price(tech.res2)}</strong></div>
                      <div className="row"><span>TP3</span><strong>{fmt.price(tech.res3)}</strong></div>
                      <p>Si aguanta sobre el soporte y no se rompe la estructura.</p>
                    </div>
                    <div className="sc">
                      <div className="title"><Shield size={14} /> Base</div>
                      <div className="row"><span>Rango</span><strong>{fmt.price(Math.min(tech.price, tech.support * 1.02))} – {fmt.price((tech.price + tech.res1) / 2)}</strong></div>
                      <p>Consolidación / lateral. Normal si el mercado duda.</p>
                    </div>
                    <div className="sc down">
                      <div className="title"><TrendingDown size={14} /> Bajista</div>
                      <div className="row"><span>Soporte</span><strong>{fmt.price(tech.support)}</strong></div>
                      <div className="row"><span>Stop</span><strong>{fmt.price(stop)}</strong></div>
                      <p>Si pierde el soporte con fuerza, sal o reduce.</p>
                    </div>
                  </div>
                </>
              )}

              <h3><Wallet size={14} /> Cuánto comprar (tu plan)</h3>
              {!plan && <p style={{ color: "var(--muted)", fontSize: 13 }}>Configura capital y analiza una moneda.</p>}
              {plan?.tooSmall && <div className="error">{plan.msg}</div>}
              {plan && !plan.tooSmall && (
                <>
                  <div className="stats">
                    <div className="stat"><div className="lbl">Tamaño total</div><div className="val">{fmt.usd(plan.size)}</div></div>
                    <div className="stat"><div className="lbl">Riesgo máx.</div><div className="val">{fmt.usd(plan.maxRisk)}</div></div>
                    <div className="stat"><div className="lbl">Stop</div><div className="val">{fmt.price(stop)}</div></div>
                    <div className="stat"><div className="lbl">Unidades</div><div className="val">{plan.units.toFixed(5)}</div></div>
                  </div>
                  <div className="tramos">
                    {plan.tramos.map((t, i) => (
                      <div className="tramo" key={i}>
                        <Wallet size={14} /> {t.label} <strong>{fmt.usd(t.usd)}</strong>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="warn">
                <AlertTriangle size={14} />
                <span>
                  Escenarios técnicos, no promesas. La app no compra por ti. Crypto puede perder valor rápido.
                  Opera solo en Binance Spot con dinero que puedas arriesgar.
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="card chat">
          <h3><Bot size={14} /> Asistente</h3>
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
              placeholder="¿Cuánto compro con $10?"
            />
            <button className="btn btn-primary" onClick={sendChat}><Send size={16} /></button>
          </div>
          <div className="quick-q">
            {["¿Cuánto compro?", "¿Subirá o bajará?", "¿Dónde va el stop?", "¿Veredicto?"].map((q) => (
              <button key={q} type="button" onClick={() => { setChatIn(q); }}>{q}</button>
            ))}
          </div>
        </div>
      </div>

      <p className="footer">Grok Spot Desk · investigación Spot · no es asesoramiento financiero · no ejecuta trades</p>
    </div>
  );
}
