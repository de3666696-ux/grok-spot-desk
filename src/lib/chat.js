import { fmt } from "./fmt.js";
import { signalConfidence, sellAdvice } from "./signal.js";

export function assistantReply(q, ctx) {
  const query = (q || "").toLowerCase();
  const { tech, score, verdict, plan, capital, riskLevel, positions, timing, backtest } = ctx;
  const name = ctx.detail?.name;
  const conf = signalConfidence(tech, score, riskLevel);

  if (/empez|inicio|c[oó]mo empiezo/.test(query)) {
    return [
      "1) Define capital que puedas perder.",
      "2) Elige perfil de riesgo (Moderado al empezar).",
      "3) Analiza BTC o ETH primero.",
      "4) Lee momento + zona ideal + stop.",
      "5) Mira el backtest simple (histórico, no promesa).",
      "6) Si entras, registra la compra.",
      "7) Vendes según TP/stop.",
    ].join("\n");
  }
  if (/cu[aá]ndo comprar|a qu[eé] precio|zona/.test(query)) {
    if (!timing) return "Analiza una moneda primero para ver zona y momento.";
    return [
      `Momento: **${timing.momento}**`,
      timing.detalle,
      `Zona ideal: ${fmt.price(timing.zonaIdeal.min)} – ${fmt.price(timing.zonaIdeal.max)}`,
      `Stop: ${fmt.price(timing.stop)}`,
      `TP1/2/3: ${fmt.price(timing.tp1)} / ${fmt.price(timing.tp2)} / ${fmt.price(timing.tp3)}`,
      timing.condicion,
    ].join("\n");
  }
  if (/vender|cu[aá]ndo vender|salida|take profit/.test(query)) {
    const open = (positions || []).filter((p) => ctx.detail && p.id === ctx.detail.id);
    if (!open.length) {
      return "No hay posición en este activo. Registra la compra para guía de salida.";
    }
    const live = ctx.live || open[0].lastPrice || open[0].entryPrice;
    const s = sellAdvice(open[0], live, tech);
    return [`**${s.title}**`, s.why, s.action, `P&L: ${fmt.pct(s.pnlPct)} (${fmt.usd(s.pnlUsd)})`].join("\n");
  }
  if (/cu[aá]nto compro|tama[nñ]o|tramo/.test(query)) {
    if (!plan || plan.tooSmall) return plan?.msg || "Ajusta capital (≥ $5) y analiza un activo.";
    return [
      `Tamaño sugerido: **${fmt.usd(plan.size)}** (riesgo máx ${fmt.usd(plan.maxRisk)}).`,
      ...plan.tramos.map((t) => `· ${t.label}: ${fmt.usd(t.usd)}`),
      "Comprar por tramos = no meter todo de una vez.",
    ].join("\n");
  }
  if (/stop|d[oó]nde va/.test(query)) {
    if (!tech) return "Analiza primero.";
    const stop = Math.min(tech.support * 0.985, tech.price - (tech.lastAtr || tech.price * 0.03) * 1.35);
    return `Stop orientativo: **${fmt.price(stop)}** (bajo soporte / ATR).`;
  }
  if (/backtest|hist[oó]rico|simul/.test(query)) {
    if (!backtest) return "Analiza un activo con velas 1D para ver el backtest simple.";
    return [
      `Trades: ${backtest.trades} · Win rate ${backtest.winRate.toFixed(0)}%`,
      `Retorno simulado: ${fmt.pct(backtest.returnPct)} · Max DD ${backtest.maxDrawdownPct.toFixed(1)}%`,
      `Promedio/trade: ${fmt.pct(backtest.avgTradePct)}`,
      backtest.note,
    ].join("\n");
  }
  if (/alerta|notific/.test(query)) {
    return "En el análisis puedes añadir alerta de precio. El navegador te avisa si se cruza (con permiso de notificaciones).";
  }
  if (/checklist|regla|disciplina/.test(query)) {
    return [
      "Checklist antes de comprar:",
      "1) ¿Momento no es NO ENTRAR?",
      "2) ¿Zona y stop escritos?",
      "3) ¿Tamaño ≤ plan?",
      "4) ¿Si salta el stop, duele poco?",
      "5) ¿Vas a registrar la compra?",
    ].join("\n");
  }
  if (/fiable|confianza|segura/.test(query)) {
    return `Confianza de confluencia: **${conf.label} (${conf.pct}/100)**\n${conf.note}`;
  }
  if (/vela|gr[aá]fica|binance|leer|zoom/.test(query)) {
    return [
      "Velas: verde = cierre arriba, rojo = abajo.",
      "Rueda del ratón = zoom · arrastrar = pan.",
      "Líneas: stop, TPs, soporte, entrada, zona ideal.",
    ].join("\n");
  }
  if (/rsi|sma|tendencia|soporte/.test(query)) {
    if (!tech) return "Analiza una moneda primero.";
    return [
      `Tendencia: **${tech.trend}** · RSI ${tech.lastRsi?.toFixed?.(1)}`,
      `SMA20 ${fmt.price(tech.lastS20)} · SMA50 ${fmt.price(tech.lastS50)} · SMA200 ${fmt.price(tech.lastS200)}`,
      `Soporte ~${fmt.price(tech.support)} · R1/R2 ${fmt.price(tech.res1)} / ${fmt.price(tech.res2)}`,
    ].join("\n");
  }
  return [
    "Temas: comprar, vender, tramos, stops, velas, backtest, alertas, checklist.",
    name
      ? `Contexto: **${name}** · ${verdict?.tag || "—"} · confianza ${conf.label} (${conf.pct}/100).`
      : "Carga una moneda (Analizar) para números reales.",
  ].join("\n\n");
}
