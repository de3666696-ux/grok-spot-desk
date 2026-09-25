import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, RefreshCw, AlertTriangle, Newspaper, TrendingUp, TrendingDown,
  ExternalLink, Star, Trash2, Send, Bot, BookOpen, HelpCircle, Bell,
  Download, GitCompare, CheckCircle2,
} from "lucide-react";
import { fmt } from "./lib/fmt.js";
import {
  fetchGlobal, fetchMarketScan, fetchCoinFundamental, fetchNews,
  filterNewsForCoin, humanError,
} from "./lib/api.js";
import { scoreFundamental, beginnerPicks, topMovers } from "./lib/fundamental.js";
import { loadStore, saveStore } from "./lib/store.js";
import { assistantReply } from "./lib/chat.js";
import { loadAiSettings, saveAiSettings, askCoinAi, testAiConnection, AI_MODELS } from "./lib/ai.js";

const QUICK = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "SUI"];

export default function App() {
  const initial = loadStore();
  const [query, setQuery] = useState("BTC");
  const [compareQuery, setCompareQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [global, setGlobal] = useState(null);
  const [scan, setScan] = useState([]);
  const [coin, setCoin] = useState(null);
  const [compare, setCompare] = useState(null);
  const [news, setNews] = useState([]);
  const [history, setHistory] = useState(initial.history || []);
  const [watchlist, setWatchlist] = useState(initial.watchlist || []);
  const [alerts, setAlerts] = useState(initial.alerts || []);
  const [alertPrice, setAlertPrice] = useState("");
  const [chatIn, setChatIn] = useState("");
  const [aiSettings, setAiSettings] = useState(() => loadAiSettings());
  const [showAiCfg, setShowAiCfg] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [aiHistory, setAiHistory] = useState(initial.chatHistory || []);
  const [msgs, setMsgs] = useState([
    {
      role: "bot",
      text: "Analiza un activo y pregunta lo que quieras.\nSin API key: guía local. Con key (Config IA): respuestas libres con contexto.\nSobre precio usa: «¿Puede subir SOL?» (escenarios, no certezas).",
    },
  ]);
  const runId = useRef(0);
  const firedAlerts = useRef(new Set());
  const endRef = useRef(null);

  useEffect(() => {
    saveStore({ history, watchlist, alerts, chatHistory: aiHistory });
  }, [history, watchlist, alerts, aiHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const score = useMemo(() => scoreFundamental(coin, global), [coin, global]);
  const scoreCompare = useMemo(() => scoreFundamental(compare, global), [compare, global]);
  const picks = useMemo(() => beginnerPicks(scan), [scan]);
  const movers = useMemo(() => topMovers(scan), [scan]);
  const rankedNews = useMemo(() => filterNewsForCoin(news, coin), [news, coin]);

  // Watchlist live quotes from scan
  const watchLive = useMemo(() => {
    return watchlist.map((w) => {
      const row = scan.find((s) => s.id === w.id || s.symbol === w.symbol);
      return {
        ...w,
        price: row?.price ?? w.price,
        change24h: row?.change24h ?? w.change24h,
      };
    });
  }, [watchlist, scan]);

  const boot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, s, n] = await Promise.all([
        fetchGlobal(),
        fetchMarketScan({ limit: 120 }),
        fetchNews({ limit: 24 }).catch(() => []),
      ]);
      setGlobal(g);
      setScan(s);
      setNews(n);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const analyze = useCallback(async (q) => {
    const term = (q ?? query).trim();
    if (!term) return;
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    try {
      const c = await fetchCoinFundamental(term);
      if (id !== runId.current) return;
      setCoin(c);
      setQuery(c.symbol || term);
      setHistory((h) => {
        const entry = { id: c.id, symbol: c.symbol, name: c.name, logo: c.logo, at: Date.now() };
        return [entry, ...h.filter((x) => x.id !== c.id)].slice(0, 20);
      });
    } catch (e) {
      if (id !== runId.current) return;
      setError(humanError(e));
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }, [query]);

  const analyzeCompare = useCallback(async (q) => {
    const term = (q ?? compareQuery).trim();
    if (!term) return;
    setLoading(true);
    try {
      const c = await fetchCoinFundamental(term);
      setCompare(c);
      setCompareQuery(c.symbol || term);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, [compareQuery]);

  useEffect(() => {
    (async () => {
      await boot();
      await analyze("BTC");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Price alerts: poll scan / coin price every 20s while open
  useEffect(() => {
    if (!alerts.length) return;
    const tick = () => {
      for (const a of alerts) {
        if (firedAlerts.current.has(a.id)) continue;
        const row = scan.find((s) => s.symbol === a.symbol);
        const px = row?.price ?? (coin?.symbol === a.symbol ? coin.price : null);
        if (px == null) continue;
        const hit =
          (a.dir === "above" && px >= a.price) ||
          (a.dir === "below" && px <= a.price);
        if (hit) {
          firedAlerts.current.add(a.id);
          setMsgs((m) => [
            ...m,
            {
              role: "bot",
              text: `🔔 Alerta ${a.symbol}: precio ${fmt.price(px)} cruzó ${fmt.price(a.price)} (${a.dir === "above" ? "arriba" : "abajo"}). Solo mientras la pestaña está abierta.`,
            },
          ]);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(`${a.symbol} alerta`, {
              body: `${fmt.price(px)} cruzó ${fmt.price(a.price)}`,
            });
          }
        }
      }
    };
    const id = window.setInterval(tick, 20000);
    tick();
    return () => clearInterval(id);
  }, [alerts, scan, coin]);

  // Refresh scan periodically for watchlist %
  useEffect(() => {
    const id = window.setInterval(() => {
      fetchMarketScan({ limit: 120 }).then(setScan).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, []);

  function toggleWatch() {
    if (!coin) return;
    setWatchlist((w) => {
      if (w.some((x) => x.id === coin.id)) return w.filter((x) => x.id !== coin.id);
      return [{
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        logo: coin.logo,
        price: coin.price,
        change24h: coin.change24h,
      }, ...w].slice(0, 30);
    });
  }

  function addAlert() {
    if (!coin) return;
    const px = Number(alertPrice);
    if (!px || !Number.isFinite(px)) {
      setError("Precio de alerta inválido.");
      return;
    }
    const live = coin.price || 0;
    const dir = px >= live ? "above" : "below";
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    const a = {
      id: `${coin.symbol}-${px}-${Date.now()}`,
      symbol: coin.symbol,
      price: px,
      dir,
      at: Date.now(),
    };
    setAlerts((list) => [a, ...list].slice(0, 20));
    setAlertPrice("");
    setMsgs((m) => [
      ...m,
      {
        role: "bot",
        text: `Alerta creada: ${a.symbol} ${dir === "above" ? "≥" : "≤"} ${fmt.price(px)}. Funciona con la pestaña abierta.`,
      },
    ]);
  }

  function exportReport() {
    if (!coin) return;
    const lines = [
      `Spot Desk — ${coin.name} (${coin.symbol})`,
      `Fecha: ${new Date().toISOString()}`,
      `Rank: ${coin.rank}`,
      `Precio: ${coin.price}`,
      `24h: ${coin.change24h}% · 7d: ${coin.change7d}% · 30d: ${coin.change30d}%`,
      `Market cap: ${coin.marketCap}`,
      `Volumen 24h: ${coin.volume24h}`,
      `ATH: ${coin.ath} · Desde ATH: ${coin.percentFromAth}%`,
      `Supply circ/max: ${coin.circulating} / ${coin.maxSupply}`,
      score ? `Score: ${score.total}/100 (${score.label})` : "",
      score ? score.plain : "",
      "",
      "Descripción:",
      (coin.description || "").slice(0, 1500),
      "",
      "Tags: " + (coin.tags || []).join(", "),
      "Web: " + (coin.links?.website || "—"),
      "",
      compare
        ? `Comparación con ${compare.symbol}: precio ${compare.price}, rank ${compare.rank}, 24h ${compare.change24h}%, mcap ${compare.marketCap}`
        : "",
    ].filter(Boolean);
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spot-desk-${coin.symbol}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendChat(text) {
    const q = (text ?? chatIn).trim();
    if (!q || aiBusy) return;
    setChatIn("");
    setMsgs((m) => [...m, { role: "me", text: q }]);

    const ctx = {
      coin,
      score,
      global,
      news: rankedNews,
      movers,
      compare,
    };

    if (!aiSettings.apiKey?.trim()) {
      const reply = assistantReply(q, ctx);
      setMsgs((m) => [
        ...m,
        {
          role: "bot",
          text:
            reply +
            "\n\n—\nIA libre: Config IA → pega API key (xAI). Sobre precio: «¿Puede subir…?»",
        },
      ]);
      return;
    }

    setAiBusy(true);
    setMsgs((m) => [
      ...m,
      { role: "bot", text: `Pensando sobre ${coin?.symbol || "mercado"}…` },
    ]);
    try {
      const reply = await askCoinAi(q, ctx, aiSettings, aiHistory);
      setAiHistory((h) => [
        ...h,
        { role: "user", content: q },
        { role: "assistant", content: reply },
      ].slice(-16));
      setMsgs((m) => {
        const copy = [...m];
        if (copy.length && String(copy[copy.length - 1].text).startsWith("Pensando")) copy.pop();
        return [...copy, { role: "bot", text: reply }];
      });
    } catch (e) {
      const msg = e?.message === "NO_KEY" ? "Falta API key." : e?.message || "Error IA.";
      setMsgs((m) => {
        const copy = [...m];
        if (copy.length && String(copy[copy.length - 1].text).startsWith("Pensando")) copy.pop();
        return [...copy, { role: "bot", text: "No pude responder con IA: " + msg }];
      });
    } finally {
      setAiBusy(false);
    }
  }

  function updateAi(partial) {
    setAiSettings((s) => {
      const next = { ...s, ...partial };
      saveAiSettings(next);
      return next;
    });
  }

  async function onTestAi() {
    setTestMsg("Probando…");
    try {
      const r = await testAiConnection(aiSettings);
      setTestMsg("Conexión OK: " + String(r).slice(0, 80));
    } catch (e) {
      setTestMsg("Fallo: " + (e?.message || "error"));
    }
  }

  const inWatch = coin && watchlist.some((w) => w.id === coin.id);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>Spot Desk · Black</h1>
          <p>Fondo negro · fundamentos · noticias · IA</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => boot()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Actualizar
        </button>
      </header>

      {global && (
        <div className="simple-banner">
          <div>
            <strong>Mercado</strong>
            <p>
              Market cap: <b>{fmt.compact(global.marketCap)}</b>
              {" · "}Vol 24h: <b>{fmt.compact(global.volume24h)}</b>
              {" · "}BTC dom: <b>{global.btcDominance?.toFixed?.(1)}%</b>
              {global.btcDominance > 55
                ? " — alta dominancia; alts suelen quedar rezagadas."
                : " — dominancia moderada."}
            </p>
          </div>
        </div>
      )}

      <div className="guide-card">
        <h3><HelpCircle size={15} /> Uso rápido</h3>
        <ol>
          <li>Analiza un activo y lee el resumen + métricas.</li>
          <li>Compara con otro si quieres (bloque comparación).</li>
          <li>Configura IA para preguntas libres sobre esa moneda.</li>
          <li>Watchlist y alertas para seguimiento (pestaña abierta).</li>
        </ol>
      </div>

      <div className="search-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && analyze()}
          placeholder="BTC, ETH, SOL, nombre…"
        />
        <button type="button" className="btn btn-primary" onClick={() => analyze()} disabled={loading}>
          {loading ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
          Analizar
        </button>
      </div>
      <div className="quick">
        {QUICK.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => { setQuery(s); analyze(s); }}>
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="error"><AlertTriangle size={14} /> {error}</div>
      )}

      <div className="grid">
        <div>
          <div className="card">
            {loading && !coin && (
              <div className="loading"><RefreshCw className="spin" size={18} /> Cargando…</div>
            )}
            {coin && (
              <>
                <div className="coin-head">
                  <div className="coin-id">
                    {coin.logo && <img src={coin.logo} alt="" />}
                    <div>
                      <h2>{coin.name} <span>{coin.symbol}</span></h2>
                      <div className="meta">Rank #{coin.rank ?? "—"} · {coin.type || "crypto"}</div>
                    </div>
                  </div>
                  <div className="head-right">
                    <div className="price-big">{fmt.price(coin.price)}</div>
                    <div className={`meta ${(coin.change24h || 0) >= 0 ? "up" : "down"}`}>
                      24h {fmt.pct(coin.change24h)}
                    </div>
                    <div className="head-actions">
                      <button type="button" className={`btn btn-sm ${inWatch ? "btn-buy" : "btn-ghost"}`} onClick={toggleWatch}>
                        <Star size={13} /> {inWatch ? "Watchlist" : "Watchlist"}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={exportReport}>
                        <Download size={13} /> Exportar
                      </button>
                    </div>
                  </div>
                </div>

                {score && (
                  <div className={`plain-verdict v-${score.color}`}>
                    <div className="pv-title">
                      <BookOpen size={16} /> {score.label} · {score.total}/100
                    </div>
                    <p>{score.plain}</p>
                    {score.bullets?.length > 0 && (
                      <ul>{score.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
                    )}
                  </div>
                )}

                <div className="stats">
                  <div className="stat"><div className="lbl">7 días</div><div className={`val ${(coin.change7d || 0) >= 0 ? "up" : "down"}`}>{fmt.pct(coin.change7d)}</div></div>
                  <div className="stat"><div className="lbl">30 días</div><div className={`val ${(coin.change30d || 0) >= 0 ? "up" : "down"}`}>{fmt.pct(coin.change30d)}</div></div>
                  <div className="stat"><div className="lbl">Market cap</div><div className="val">{fmt.compact(coin.marketCap)}</div></div>
                  <div className="stat"><div className="lbl">Volumen 24h</div><div className="val">{fmt.compact(coin.volume24h)}</div></div>
                  <div className="stat"><div className="lbl">Desde ATH</div><div className="val">{fmt.pct(coin.percentFromAth)}</div></div>
                  <div className="stat"><div className="lbl">ATH</div><div className="val">{fmt.price(coin.ath)}</div></div>
                </div>

                {coin.description && (
                  <>
                    <h3>Descripción</h3>
                    <p className="desc">{coin.description.slice(0, 900)}{coin.description.length > 900 ? "…" : ""}</p>
                  </>
                )}
                {!!coin.tags?.length && (
                  <div className="tags">{coin.tags.slice(0, 10).map((t) => <span key={t} className="tag">{t}</span>)}</div>
                )}
                <div className="links">
                  {coin.links?.website && <a href={coin.links.website} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Web</a>}
                  {coin.links?.whitepaper && <a href={coin.links.whitepaper} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Whitepaper</a>}
                  {coin.links?.sourceCode && <a href={coin.links.sourceCode} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Código</a>}
                </div>

                {/* Alertas */}
                <h3><Bell size={14} /> Alerta de precio</h3>
                <div className="alert-row">
                  <input
                    type="number"
                    step="any"
                    value={alertPrice}
                    onChange={(e) => setAlertPrice(e.target.value)}
                    placeholder={`Precio (ahora ${fmt.price(coin.price)})`}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addAlert}>Crear alerta</button>
                </div>
                {alerts.filter((a) => a.symbol === coin.symbol).map((a) => (
                  <div className="list-row" key={a.id}>
                    <div>
                      <div className="name">{a.symbol} {a.dir === "above" ? "≥" : "≤"} {fmt.price(a.price)}</div>
                      <div className="sub">{fmt.date(a.at)}</div>
                    </div>
                    <button type="button" className="icon-btn" style={{ marginLeft: "auto" }} onClick={() => setAlerts((list) => list.filter((x) => x.id !== a.id))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Comparar */}
          <div className="card" style={{ marginTop: 14 }}>
            <h3><GitCompare size={14} /> Comparar con otro activo</h3>
            <div className="search-row" style={{ marginBottom: 10 }}>
              <input
                value={compareQuery}
                onChange={(e) => setCompareQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && analyzeCompare()}
                placeholder="Ej. ETH"
              />
              <button type="button" className="btn btn-ghost" onClick={() => analyzeCompare()} disabled={loading}>
                Comparar
              </button>
            </div>
            {coin && compare && (
              <div className="compare-grid">
                <div className="compare-col">
                  <strong>{coin.symbol}</strong>
                  <div>{fmt.price(coin.price)}</div>
                  <div className={coin.change24h >= 0 ? "up" : "down"}>{fmt.pct(coin.change24h)} 24h</div>
                  <div className="sub">Rank #{coin.rank}</div>
                  <div className="sub">MCap {fmt.compact(coin.marketCap)}</div>
                  <div className="sub">ATH {fmt.pct(coin.percentFromAth)}</div>
                  {score && <div className="sub">Score {score.total}</div>}
                </div>
                <div className="compare-col">
                  <strong>{compare.symbol}</strong>
                  <div>{fmt.price(compare.price)}</div>
                  <div className={compare.change24h >= 0 ? "up" : "down"}>{fmt.pct(compare.change24h)} 24h</div>
                  <div className="sub">Rank #{compare.rank}</div>
                  <div className="sub">MCap {fmt.compact(compare.marketCap)}</div>
                  <div className="sub">ATH {fmt.pct(compare.percentFromAth)}</div>
                  {scoreCompare && <div className="sub">Score {scoreCompare.total}</div>}
                </div>
              </div>
            )}
          </div>

          {picks.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h3>Referencias de mercado</h3>
              <div className="pick-grid">
                {picks.map((p) => (
                  <button key={p.id} type="button" className="pick-card" onClick={() => analyze(p.id)}>
                    <strong>{p.symbol}</strong>
                    <span>{p.name}</span>
                    <span className="mono">{fmt.price(p.price)}</span>
                    <span className={p.change24h >= 0 ? "up" : "down"}>{fmt.pct(p.change24h)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(movers.up.length > 0 || movers.down.length > 0) && (
            <div className="card" style={{ marginTop: 14 }}>
              <h3>Movimiento 24h</h3>
              <div className="insight-row">
                <div>
                  <h4><TrendingUp size={12} /> Gainers</h4>
                  {movers.up.map((g) => (
                    <button key={g.id} type="button" className="mini-row" onClick={() => analyze(g.id)}>
                      {g.symbol} <span className="up">{fmt.pct(g.change24h)}</span>
                    </button>
                  ))}
                </div>
                <div>
                  <h4><TrendingDown size={12} /> Losers</h4>
                  {movers.down.map((g) => (
                    <button key={g.id} type="button" className="mini-row" onClick={() => analyze(g.id)}>
                      {g.symbol} <span className="down">{fmt.pct(g.change24h)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 14 }}>
            <h3><Newspaper size={14} /> Noticias {coin ? `· foco ${coin.symbol}` : ""}</h3>
            {!rankedNews.length && <div className="empty">Sin noticias. Actualiza datos.</div>}
            {rankedNews.slice(0, 12).map((n, i) => (
              <a key={i} className={`news-row ${n.related ? "news-related" : ""}`} href={n.link} target="_blank" rel="noreferrer">
                <div className="news-title">
                  {n.related && <span className="badge-rel">Relacionada</span>}
                  {n.title}
                </div>
                <div className="news-meta">{fmt.date(n.pubDate)}</div>
              </a>
            ))}
          </div>

          {(watchLive.length > 0 || history.length > 0) && (
            <div className="card" style={{ marginTop: 14 }}>
              {watchLive.length > 0 && (
                <>
                  <h3><Star size={14} /> Watchlist</h3>
                  {watchLive.map((w) => (
                    <div className="list-row" key={w.id} onClick={() => analyze(w.id)}>
                      {w.logo && <img src={w.logo} alt="" />}
                      <div>
                        <div className="name">{w.symbol} · {w.name}</div>
                        <div className="sub">
                          {w.price != null ? fmt.price(w.price) : "—"}{" "}
                          <span className={(w.change24h || 0) >= 0 ? "up" : "down"}>
                            {fmt.pct(w.change24h)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ marginLeft: "auto" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setWatchlist((list) => list.filter((x) => x.id !== w.id));
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {history.length > 0 && (
                <>
                  <h3 style={{ marginTop: watchLive.length ? 14 : 0 }}>Historial</h3>
                  {history.slice(0, 8).map((h) => (
                    <div className="list-row" key={h.id + h.at} onClick={() => analyze(h.id)}>
                      {h.logo && <img src={h.logo} alt="" />}
                      <div>
                        <div className="name">{h.symbol} · {h.name}</div>
                        <div className="sub">{fmt.date(h.at)}</div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Chat IA */}
        <div className="card chat">
          <div className="card-head">
            <h3><Bot size={14} /> IA · {coin ? coin.symbol : "mercado"}</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAiCfg((v) => !v)}>
              Config IA
            </button>
          </div>
          {showAiCfg && (
            <div className="ai-cfg">
              <p className="ai-cfg-note">
                Key solo en este navegador. La IA usa el activo analizado, comparación, score y noticias.
              </p>
              <div className="field">
                <label>API key</label>
                <input
                  type="password"
                  value={aiSettings.apiKey}
                  onChange={(e) => updateAi({ apiKey: e.target.value })}
                  placeholder="xai-... o sk-..."
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label>Base URL</label>
                <input
                  value={aiSettings.baseUrl}
                  onChange={(e) => updateAi({ baseUrl: e.target.value })}
                  placeholder="https://api.x.ai/v1"
                />
              </div>
              <div className="field">
                <label>Modelo</label>
                <select
                  value={aiSettings.model}
                  onChange={(e) => updateAi({ model: e.target.value })}
                >
                  {AI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                  <option value={aiSettings.model}>Personalizado: {aiSettings.model}</option>
                </select>
                <input
                  style={{ marginTop: 6 }}
                  value={aiSettings.model}
                  onChange={(e) => updateAi({ model: e.target.value })}
                  placeholder="o escribe el id del modelo"
                />
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onTestAi}>
                <CheckCircle2 size={13} /> Probar conexión
              </button>
              {testMsg && <p className="ai-cfg-note">{testMsg}</p>}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setAiHistory([]);
                  setMsgs([{ role: "bot", text: "Historial de IA borrado." }]);
                }}
              >
                Borrar memoria del chat
              </button>
            </div>
          )}
          <div className="chat-msgs">
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role === "bot" ? "bot" : "me"}`}>{m.text}</div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="chat-input">
            <input
              value={chatIn}
              onChange={(e) => setChatIn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder={coin ? `Pregunta sobre ${coin.symbol}…` : "Analiza una moneda…"}
              disabled={aiBusy}
            />
            <button type="button" className="btn btn-primary" onClick={() => sendChat()} disabled={aiBusy}>
              {aiBusy ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
            </button>
          </div>
          <div className="quick-q">
            {(coin
              ? [`¿Qué es ${coin.symbol}?`, `¿Puede subir ${coin.symbol}?`, `Riesgos de ${coin.symbol}`, compare ? `Compara con ${compare.symbol}` : "Tokenomics", "Resume noticias"]
              : ["Dominancia BTC", "Noticias", "Gainers"]
            ).map((q) => (
              <button key={q} type="button" onClick={() => sendChat(q)} disabled={aiBusy}>{q}</button>
            ))}
          </div>
        </div>
      </div>

      <p className="footer">Spot Desk · mercado · fundamentos · noticias · IA</p>
    </div>
  );
}
