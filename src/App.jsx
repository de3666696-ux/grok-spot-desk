import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, RefreshCw, TrendingUp, TrendingDown, AlertTriangle,
  Send, Bot, Zap, Target, Wallet, Shield, Activity, Trash2, History, Briefcase, Bell,
} from "lucide-react";
import { fmt } from "./lib/fmt.js";
import { analyzeCandles, simpleBacktest } from "./lib/indicators.js";
import {
  RISK_LEVELS, scoreCoin, verdictFrom, buildPlan, signalConfidence,
  buildBuyTiming, sellAdvice, computeStop,
} from "./lib/signal.js";
import { fetchCandles, fetchLivePrice, fetchTicker24h, resolveAndDetail, KNOWN, humanError } from "./lib/api.js";
import { loadStore, saveStore, requestNotifyPermission, fireNotify } from "./lib/store.js";
import { assistantReply } from "./lib/chat.js";
import BinanceCandleChart from "./components/BinanceCandleChart.jsx";

const QUICK = [
  "BTC","ETH","SOL","BNB","XRP","ADA","DOGE","AVAX","DOT","LINK",
  "MATIC","LTC","ATOM","UNI","NEAR","APT","ARB","OP","SUI","INJ",
  "FET","RENDER","PEPE","WIF","TON","TRX","HBAR","FIL","AAVE","MKR",
];
const INTERVALS = [
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
  { id: "4h", label: "4h" },
  { id: "1d", label: "1D" },
  { id: "1w", label: "1S" },
];

export default function App() {
  const initial = loadStore();
  const [capital, setCapital] = useState(initial.capital);
  const [riskLevel, setRiskLevel] = useState(initial.riskLevel);
  const [query, setQuery] = useState("BTC");
  const [chartTf, setChartTf] = useState("1d");
  const [tab, setTab] = useState("analizar");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tech, setTech] = useState(null);
  const [displayCandles, setDisplayCandles] = useState(null);
  const [dailyCandles, setDailyCandles] = useState(null);
  const [live, setLive] = useState(null);
  const [dir, setDir] = useState(0);
  const [history, setHistory] = useState(initial.history || []);
  const [positions, setPositions] = useState(initial.positions || []);
  const [alerts, setAlerts] = useState(initial.alerts || []);
  const [alertPrice, setAlertPrice] = useState("");
  const [buyUsd, setBuyUsd] = useState("15");
  const [buyPrice, setBuyPrice] = useState("");
  const [chatIn, setChatIn] = useState("");
  const [msgs, setMsgs] = useState([
    {
      role: "bot",
      text: "Spot Desk local. Pregunta por comprar, vender, tramos, backtest o alertas. Datos reales; sin promesas de beneficio.",
    },
  ]);
  const endRef = useRef(null);
  const prevLive = useRef(null);
  const firedAlerts = useRef(new Set());

  useEffect(() => {
    saveStore({ capital, riskLevel, history, positions, alerts });
  }, [capital, riskLevel, history, positions, alerts]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const score = useMemo(
    () => (detail && tech ? scoreCoin(detail, tech) : null),
    [detail, tech],
  );
  const verdict = useMemo(
    () => (score ? verdictFrom(score.total, tech, riskLevel) : null),
    [score, tech, riskLevel],
  );
  const stop = useMemo(() => computeStop(tech), [tech]);
  const plan = useMemo(() => {
    if (!tech || !stop) return null;
    const cfg = RISK_LEVELS[riskLevel] || RISK_LEVELS.moderado;
    return buildPlan(capital, cfg.pct, live || tech.price, stop);
  }, [tech, stop, capital, riskLevel, live]);
  const timing = useMemo(
    () => buildBuyTiming(tech, verdict, stop, live),
    [tech, verdict, stop, live],
  );
  const backtest = useMemo(
    () => (dailyCandles ? simpleBacktest(dailyCandles) : null),
    [dailyCandles],
  );

  const run = useCallback(
    async (q, iv) => {
      const term = (q ?? query).trim();
      if (!term) return;
      const interval = iv ?? chartTf;
      setLoading(true);
      setError(null);
      setTab("analizar");
      try {
        const d = await resolveAndDetail(term);
        const symbol = (d.symbol || term).toUpperCase();
        const kl = await fetchCandles(symbol, interval);
        if (!kl) {
          setDetail(d);
          setTech(null);
          setDisplayCandles(null);
          setDailyCandles(null);
          setLive(d.market_data?.current_price?.usd ?? null);
          setError("No hay velas en Binance para este par. Prueba un USDT líquido.");
          setQuery(symbol);
          return;
        }
        const daily =
          interval === "1d"
            ? kl.candles
            : (await fetchCandles(symbol, "1d"))?.candles || kl.candles;
        const t = analyzeCandles(daily);
        if (!t) {
          setError("Velas insuficientes para analizar.");
          return;
        }
        setDetail(d);
        setTech(t);
        setDisplayCandles(kl.candles);
        setDailyCandles(daily);
        setLive(kl.candles.at(-1)?.close ?? t.price);
        setQuery(symbol);
        setBuyPrice(String(kl.candles.at(-1)?.close ?? t.price));
        setBuyUsd(String(Math.min(Math.max(capital, 5), 25)));
        setAlertPrice("");
        // Enrich 24h from Binance if CoinGecko fields missing
        try {
          const t24 = await fetchTicker24h(symbol);
          if (t24 && d.market_data) {
            if (d.market_data.price_change_percentage_24h == null && Number.isFinite(t24.priceChangePercent)) {
              d.market_data.price_change_percentage_24h = t24.priceChangePercent;
            }
            if (!d.market_data.total_volume?.usd && t24.quoteVolume) {
              d.market_data.total_volume = { usd: t24.quoteVolume };
            }
            setDetail({ ...d });
          }
        } catch { /* optional */ }

        setHistory((h) => {
          const entry = {
            id: d.id,
            symbol,
            name: d.name || KNOWN[symbol]?.name || symbol,
            image: d.image?.thumb || d.image?.small,
            at: Date.now(),
          };
          return [entry, ...h.filter((x) => x.id !== d.id)].slice(0, 40);
        });
      } catch (e) {
        setError(humanError(e) || "No se pudo analizar. Prueba BTC/ETH o espera 20 s.");
      } finally {
        setLoading(false);
      }
    },
    [query, chartTf, capital],
  );

  useEffect(() => {
    void run("BTC", "1d");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!detail?.symbol) return;
    let dead = false;
    const tick = async () => {
      try {
        const liveRes = await fetchLivePrice(detail.symbol);
        const px = liveRes?.price;
        if (dead || px == null) return;
        if (prevLive.current != null) {
          setDir(px > prevLive.current ? 1 : px < prevLive.current ? -1 : 0);
        }
        prevLive.current = px;
        setLive(px);
        setPositions((ps) =>
          ps.map((p) =>
            p.symbol === detail.symbol.toUpperCase()
              ? { ...p, lastPrice: px, lastAt: Date.now() }
              : p,
          ),
        );
        // alerts
        const sym = detail.symbol.toUpperCase();
        for (const a of alerts) {
          if (a.symbol !== sym) continue;
          const key = a.id;
          if (firedAlerts.current.has(key)) continue;
          const hit =
            (a.dir === "above" && px >= a.price) ||
            (a.dir === "below" && px <= a.price);
          if (hit) {
            firedAlerts.current.add(key);
            fireNotify(
              `${sym} alerta`,
              `Precio ${fmt.price(px)} cruzó ${fmt.price(a.price)} (${a.dir === "above" ? "arriba" : "abajo"})`,
            );
            setMsgs((m) => [
              ...m,
              {
                role: "bot",
                text: `🔔 Alerta ${sym}: ${fmt.price(px)} cruzó ${fmt.price(a.price)}.`,
              },
            ]);
          }
        }
      } catch { /* keep */ }
    };
    const id = window.setInterval(tick, 15000);
    void tick();
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [detail?.symbol, alerts]);

  function sendChat(text) {
    const q = (text ?? chatIn).trim();
    if (!q) return;
    setChatIn("");
    setMsgs((m) => [...m, { role: "me", text: q }]);
    const reply = assistantReply(q, {
      detail, tech, score, verdict, plan, capital, riskLevel,
      positions, history, live, timing, backtest,
    });
    setTimeout(() => setMsgs((m) => [...m, { role: "bot", text: reply }]), 100);
  }

  function registerBuy() {
    if (!detail || !tech) return;
    const entryPrice = Number(buyPrice) || live || tech.price;
    const usd = Number(buyUsd) || 0;
    if (!entryPrice || usd < 1) {
      setError("Indica precio de entrada y dólares (mín. ~$1).");
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
      tp1: tech.res1,
      tp2: tech.res2,
      tp3: tech.res3,
    };
    setPositions((ps) => [pos, ...ps].slice(0, 50));
    setError(null);
    setMsgs((m) => [
      ...m,
      {
        role: "bot",
        text: `Compra registrada: **${pos.symbol}** · ${fmt.usd(usd)} @ ${fmt.price(entryPrice)}.`,
      },
    ]);
    setTab("posiciones");
  }

  async function addAlert() {
    if (!detail) return;
    const px = Number(alertPrice);
    if (!px || !Number.isFinite(px)) {
      setError("Precio de alerta inválido.");
      return;
    }
    const livePx = live || tech?.price || 0;
    const dir = px >= livePx ? "above" : "below";
    await requestNotifyPermission();
    const a = {
      id: `${detail.symbol}-${px}-${Date.now()}`,
      symbol: detail.symbol.toUpperCase(),
      price: px,
      dir,
      at: Date.now(),
    };
    setAlerts((list) => [a, ...list].slice(0, 30));
    setMsgs((m) => [
      ...m,
      {
        role: "bot",
        text: `Alerta ${a.symbol}: avisar si precio va ${dir === "above" ? "por encima" : "por debajo"} de ${fmt.price(px)}.`,
      },
    ]);
  }

  const md = detail?.market_data;
  const displayPrice = live ?? tech?.price ?? md?.current_price?.usd;
  const openPos = positions.filter((p) => detail && p.id === detail.id);
  const sell =
    openPos[0] && displayPrice != null
      ? sellAdvice(openPos[0], displayPrice, tech)
      : null;

  const chartLevels = tech
    ? {
        stop,
        tp1: tech.res1,
        tp2: tech.res2,
        tp3: tech.res3,
        support: tech.support,
        entry: openPos[0]?.entryPrice,
        zonaMin: timing?.zonaIdeal?.min,
        zonaMax: timing?.zonaIdeal?.max,
        sma20: tech.sma20,
      }
    : null;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Spot Desk</h1>
          <p>Binance Spot · velas · cache · backtest · alertas · local</p>
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
          placeholder="BTC, ETH, SOL…"
        />
        <button className="btn btn-primary" onClick={() => run()} disabled={loading}>
          {loading ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
          Analizar
        </button>
      </div>
      <div className="quick">
        {QUICK.map((s) => (
          <button key={s} className="chip" type="button" onClick={() => { setQuery(s); run(s); }}>{s}</button>
        ))}
      </div>

      <div className="tabs">
        <button type="button" className={`tab ${tab === "analizar" ? "active" : ""}`} onClick={() => setTab("analizar")}>Analizar</button>
        <button type="button" className={`tab ${tab === "historial" ? "active" : ""}`} onClick={() => setTab("historial")}>
          <History size={13} style={{ verticalAlign: "middle" }} /> Historial ({history.length})
        </button>
        <button type="button" className={`tab ${tab === "posiciones" ? "active" : ""}`} onClick={() => setTab("posiciones")}>
          <Briefcase size={13} style={{ verticalAlign: "middle" }} /> Posiciones ({positions.length})
        </button>
      </div>

      {error && <div className="error"><AlertTriangle size={14} /> {error}</div>}

      {tab === "historial" && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3><History size={14} /> Búsquedas guardadas</h3>
          {!history.length && <div className="empty">Aún no hay búsquedas.</div>}
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
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setHistory([])}>
              Vaciar historial
            </button>
          )}
        </div>
      )}

      {tab === "posiciones" && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3><Briefcase size={14} /> Mis compras · cuándo vender</h3>
          {!positions.length && (
            <div className="empty">Registra una compra desde el análisis.</div>
          )}
          {positions.map((p) => {
            const adv = sellAdvice(p, p.lastPrice || p.entryPrice, tech);
            return (
              <div className="list-row" key={p.at} onClick={() => run(p.symbol)}>
                {p.image && <img src={p.image} alt="" />}
                <div>
                  <div className="name">{p.symbol} · {fmt.usd(p.usd)}</div>
                  <div className="sub">Entrada {fmt.price(p.entryPrice)} · {adv.title}</div>
                </div>
                <div className="right">
                  <div className={adv.pnlPct >= 0 ? "pnl-up" : "pnl-down"}>{fmt.pct(adv.pnlPct)}</div>
                  <div className="sub">{fmt.usd(adv.pnlUsd)}</div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPositions((ps) => ps.filter((x) => x.at !== p.at));
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          {!!alerts.length && (
            <>
              <h3 style={{ marginTop: 16 }}><Bell size={14} /> Alertas activas</h3>
              {alerts.map((a) => (
                <div className="list-row" key={a.id}>
                  <div>
                    <div className="name">{a.symbol} {a.dir === "above" ? "≥" : "≤"} {fmt.price(a.price)}</div>
                    <div className="sub">{fmt.date(a.at)}</div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ marginLeft: "auto" }}
                    onClick={() => setAlerts((list) => list.filter((x) => x.id !== a.id))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <div className="grid">
        <div>
          {loading && <div className="card loading"><RefreshCw className="spin" size={20} /> Analizando…</div>}
          {!loading && !detail && tab === "analizar" && (
            <div className="card empty">Busca una cripto o pulsa un chip.</div>
          )}
          {!loading && detail && tab === "analizar" && (
            <div className="card">
              <div className="coin-head">
                <div className="coin-id">
                  {detail.image?.small && <img src={detail.image.small} alt="" />}
                  <div>
                    <h2>
                      {detail.name || KNOWN[detail.symbol?.toUpperCase()]?.name || detail.symbol}{" "}
                      <span>{detail.symbol?.toUpperCase()}</span>
                    </h2>
                    <div className="meta">
                      Rank #{detail.market_cap_rank ?? "—"}
                      {" · "}
                      {detail._source === "binance-only"
                        ? "datos Binance (CG limitado)"
                        : detail._fromCache
                          ? "cache local"
                          : "CoinGecko + Binance"}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className={`price-big ${dir > 0 ? "up" : dir < 0 ? "down" : ""}`}>
                    {fmt.price(displayPrice)}
                  </div>
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
                    <div>
                      <strong>{signalConfidence(tech, score, riskLevel).pct}</strong>
                      <span>confianza*</span>
                    </div>
                  </div>
                </div>
              )}
              {verdict && (
                <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 12 }}>
                  {verdict.why}{" "}
                  <span style={{ opacity: 0.85 }}>*confluencia, no probabilidad de ganar.</span>
                </p>
              )}

              {timing && (
                <div style={{ marginBottom: 14 }}>
                  <h3><Target size={14} /> ¿Cuándo comprar y a qué precio?</h3>
                  <div className="verdict" style={{ marginBottom: 10 }}>
                    <span
                      className={`verdict-tag ${
                        timing.color === "now" ? "v-buy"
                          : timing.color === "scale" ? "v-scale"
                            : timing.color === "no" ? "v-no" : "v-wait"
                      }`}
                    >
                      {timing.momento}
                    </span>
                  </div>
                  <p style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 10 }}>{timing.detalle}</p>
                  <div className="stats">
                    <div className="stat"><div className="lbl">Precio ahora</div><div className="val">{fmt.price(timing.precioActual)}</div></div>
                    <div className="stat"><div className="lbl">Zona ideal</div><div className="val">{fmt.price(timing.zonaIdeal.min)} – {fmt.price(timing.zonaIdeal.max)}</div></div>
                    <div className="stat"><div className="lbl">Stop</div><div className="val">{fmt.price(timing.stop)}</div></div>
                    <div className="stat"><div className="lbl">TP1</div><div className="val">{fmt.price(timing.tp1)}</div></div>
                    <div className="stat"><div className="lbl">TP2</div><div className="val">{fmt.price(timing.tp2)}</div></div>
                    <div className="stat"><div className="lbl">TP3</div><div className="val">{fmt.price(timing.tp3)}</div></div>
                    <div className="stat"><div className="lbl">Soporte</div><div className="val">{fmt.price(timing.soporte)}</div></div>
                    <div className="stat"><div className="lbl">Zona OK</div><div className="val">{fmt.price(timing.zonaAceptable.min)} – {fmt.price(timing.zonaAceptable.max)}</div></div>
                  </div>
                </div>
              )}

              {sell && (
                <div className="sell-box">
                  <h3><TrendingDown size={14} /> Ya compraste — {sell.title}</h3>
                  <p>{sell.why}</p>
                  <p className="mono">P&amp;L {fmt.pct(sell.pnlPct)} ({fmt.usd(sell.pnlUsd)})</p>
                  <p className="muted">{sell.action}</p>
                </div>
              )}

              {backtest && (
                <div className="backtest-box">
                  <h3><Activity size={14} /> Backtest simple (histórico 1D)</h3>
                  <div className="stats">
                    <div className="stat"><div className="lbl">Trades</div><div className="val">{backtest.trades}</div></div>
                    <div className="stat"><div className="lbl">Win rate</div><div className="val">{backtest.winRate.toFixed(0)}%</div></div>
                    <div className="stat"><div className="lbl">Retorno</div><div className={`val ${backtest.returnPct >= 0 ? "up" : "down"}`}>{fmt.pct(backtest.returnPct)}</div></div>
                    <div className="stat"><div className="lbl">Max DD</div><div className="val">{backtest.maxDrawdownPct.toFixed(1)}%</div></div>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--muted)" }}>{backtest.note}</p>
                </div>
              )}

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

              <div className="tf-row">
                <h3 style={{ margin: 0 }}><Activity size={14} /> Velas</h3>
                <div className="tf-pills">
                  {INTERVALS.map((iv) => (
                    <button
                      key={iv.id}
                      type="button"
                      className={chartTf === iv.id ? "active" : ""}
                      onClick={() => {
                        setChartTf(iv.id);
                        void run(detail.symbol, iv.id);
                      }}
                    >
                      {iv.label}
                    </button>
                  ))}
                </div>
              </div>
              <BinanceCandleChart candles={displayCandles || tech?.candles} levels={chartLevels} />

              <h3 className="section-gap"><Bell size={14} /> Alerta de precio</h3>
              <div className="buy-box">
                <div className="field">
                  <label>Avisar en precio</label>
                  <input value={alertPrice} onChange={(e) => setAlertPrice(e.target.value)} placeholder={fmt.price(displayPrice)} />
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addAlert}>
                  <Bell size={14} /> Crear alerta
                </button>
              </div>

              <h3 className="section-gap"><Wallet size={14} /> Registré compra</h3>
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
                    </div>
                    <div className="sc">
                      <div className="title"><Shield size={14} /> Base</div>
                      <div className="row"><span>Rango</span><strong>{fmt.price(Math.min(tech.price, tech.support * 1.02))} – {fmt.price((tech.price + tech.res1) / 2)}</strong></div>
                    </div>
                    <div className="sc down">
                      <div className="title"><TrendingDown size={14} /> Bajista</div>
                      <div className="row"><span>Soporte</span><strong>{fmt.price(tech.support)}</strong></div>
                      <div className="row"><span>Stop</span><strong>{fmt.price(stop)}</strong></div>
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
                    <div className="stat"><div className="lbl">Unidades</div><div className="val">{plan.units.toFixed(6)}</div></div>
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
                <span>
                  Plan técnico. Backtest ≠ futuro. No ejecuta órdenes. Datos en este navegador.
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="card chat">
          <h3><Bot size={14} /> Guía Spot</h3>
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
              placeholder="comprar, vender, backtest, alertas…"
            />
            <button type="button" className="btn btn-primary" onClick={() => sendChat()}>
              <Send size={16} />
            </button>
          </div>
          <div className="quick-q">
            {["¿Cuándo comprar?", "¿Cuándo vender?", "Backtest", "Checklist", "¿Cuánto compro?", "Cómo leer velas"].map((q) => (
              <button key={q} type="button" onClick={() => sendChat(q)}>{q}</button>
            ))}
          </div>
        </div>
      </div>

      <p className="footer">Spot Desk · datos públicos · análisis técnico local · no predice el futuro · no es asesoramiento financiero</p>
    </div>
  );
}
