import { fmt } from "./fmt.js";

export const RISK_LEVELS = {
  conservador: { label: "Conservador", pct: 0.5, buy: 82, scale: 72 },
  moderado: { label: "Moderado", pct: 1.0, buy: 76, scale: 68 },
  agresivo: { label: "Agresivo", pct: 2.0, buy: 70, scale: 62 },
  muy_agresivo: { label: "Muy agresivo", pct: 3.0, buy: 66, scale: 58 },
};

export function scoreCoin(detail, tech) {
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

export function verdictFrom(score, tech, riskLevel) {
  const cfg = RISK_LEVELS[riskLevel] || RISK_LEVELS.moderado;
  if (!tech) return { tag: "OBSERVAR", cls: "v-wait", why: "Faltan datos técnicos para esta moneda." };
  if (tech.trend === "bajista" && score < cfg.buy)
    return { tag: "ESPERAR", cls: "v-wait", why: "Tendencia diaria bajista: mejor esperar soporte o giro." };
  if (tech.lastRsi > 78)
    return { tag: "ESPERAR", cls: "v-wait", why: "RSI muy alto: mala relación riesgo/beneficio ahora." };
  if (tech.distSup > 22)
    return { tag: "ESPERAR", cls: "v-wait", why: `Precio lejos del soporte (${tech.distSup.toFixed(0)}%). No perseguir.` };
  if (score >= cfg.buy)
    return { tag: "COMPRAR", cls: "v-buy", why: "Confluencia de score, liquidez y estructura para tu perfil." };
  if (score >= cfg.scale)
    return { tag: "COMPRAR EN TRAMOS", cls: "v-scale", why: "Ventaja parcial: entrar por partes según el plan." };
  if (score >= 55)
    return { tag: "OBSERVAR", cls: "v-wait", why: "Interesante para seguir, sin entrada clara hoy." };
  return { tag: "NO COMPRAR", cls: "v-no", why: "Calidad/riesgo no justifican entrada Spot ahora." };
}

export function buildPlan(capital, riskPct, entry, stop) {
  capital = Number(capital) || 0;
  if (capital < 5) {
    return { tooSmall: true, msg: `Con $${capital.toFixed(2)} es justo. Recomiendo al menos $5–$15 en Spot.` };
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

export function signalConfidence(tech, score, riskLevel) {
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
  pct = Math.max(5, Math.min(88, Math.round(pct)));
  let label = "Baja";
  if (pct >= 70) label = "Alta";
  else if (pct >= 55) label = "Media-alta";
  else if (pct >= 40) label = "Media";
  return {
    label,
    pct,
    note:
      pct >= 70
        ? "Confluencia razonable: aún así usa stop y tramos. No es probabilidad de ganar."
        : pct >= 50
          ? "Señal usable con cautela: no all-in."
          : "Poca confluencia: mejor esperar o tamaño mínimo.",
  };
}

export function buildBuyTiming(tech, verdict, stop, livePrice) {
  if (!tech) return null;
  const price = livePrice || tech.price;
  const support = tech.support;
  const zonaIdealMin = support * 0.99;
  const zonaIdealMax = Math.min(support * 1.025, price * 0.998);
  const zonaOkMin = support;
  const zonaOkMax = Math.max(support, Math.min(price * 1.008, support * 1.06));
  const overbought = tech.lastRsi > 72;
  let momento = "ESPERAR RETROCESO";
  let color = "wait";
  let detalle = "Sin confluencia fuerte. Esperar mejor precio cerca de soporte.";
  if (verdict?.tag === "NO COMPRAR" || (tech.trend === "bajista" && tech.lastRsi > 50)) {
    momento = "NO ENTRAR";
    color = "no";
    detalle = "Estructura o score no justifican compra ahora.";
  } else if (overbought || tech.distSup > 22) {
    momento = "ESPERAR RETROCESO";
    color = "wait";
    detalle = `Extendido (${tech.distSup.toFixed(1)}% del soporte) o RSI caliente. Zona ideal cerca de ${fmt.price(support)}.`;
  } else if (verdict?.tag === "COMPRAR" && tech.distSup <= 10) {
    momento = "VENTANA AHORA";
    color = "now";
    detalle = "Cerca de soporte, RSI no extremo y veredicto alineado. Entrar por tramos, no all-in.";
  } else if (verdict?.tag === "COMPRAR EN TRAMOS" || verdict?.tag === "COMPRAR") {
    momento = "COMPRAR EN TRAMOS";
    color = "scale";
    detalle = "Ventaja parcial. Un tramo ahora, el resto si vuelve a soporte.";
  }
  return {
    momento,
    color,
    detalle,
    precioActual: price,
    zonaIdeal: { min: zonaIdealMin, max: Math.max(zonaIdealMin, zonaIdealMax) },
    zonaAceptable: { min: zonaOkMin, max: Math.max(zonaOkMin, zonaOkMax) },
    stop,
    tp1: tech.res1,
    tp2: tech.res2,
    tp3: tech.res3,
    soporte: support,
    condicion: "Si el precio cierra bajo el stop, la idea queda invalidada. No promediar a lo loco.",
  };
}

export function sellAdvice(pos, live, tech) {
  const pnlPct = (live / pos.entryPrice - 1) * 100;
  const pnlUsd = pos.usd * (pnlPct / 100);
  const stop = pos.stopAtRegister;
  const { tp1, tp2, tp3 } = pos;

  if (stop && live <= stop) {
    return {
      title: "Vender ya — stop tocado",
      why: "Se invalidó la tesis. Cierra; no promediar.",
      action: `Mercado cerca de ${fmt.price(live)}.`,
      pnlPct, pnlUsd, cls: "v-no",
    };
  }
  if (tp3 && live >= tp3) {
    return {
      title: "TP3 — cerrar resto",
      why: "Último objetivo del plan. Protege la ganancia.",
      action: "Vende el resto de la posición.",
      pnlPct, pnlUsd, cls: "v-buy",
    };
  }
  if (tp2 && live >= tp2) {
    return {
      title: "TP2 — parcial + subir stop",
      why: "Segundo objetivo. Reduce riesgo de devolver ganancias.",
      action: "Vende ~50% de lo que quede y sube stop a entrada o mejor.",
      pnlPct, pnlUsd, cls: "v-scale",
    };
  }
  if (tp1 && live >= tp1) {
    return {
      title: "TP1 — tomar parcial",
      why: "Primer objetivo alcanzado.",
      action: "Vende 30–40%. Mueve stop a breakeven.",
      pnlPct, pnlUsd, cls: "v-scale",
    };
  }
  if (tech?.lastRsi > 78 && pnlPct > 0) {
    return {
      title: "RSI extremo — reducir",
      why: "Sobrecompra con beneficio. Retrocesos son comunes.",
      action: "Vende 25–40% y deja el resto con stop más alto.",
      pnlPct, pnlUsd, cls: "v-scale",
    };
  }
  if (pnlPct > 4) {
    return {
      title: "Mantener · subir stop",
      why: "Hay colchón. No dejes que una ganancia se vuelva pérdida.",
      action: `Sube stop hacia ${fmt.price(pos.entryPrice * 1.004)}.`,
      pnlPct, pnlUsd, cls: "v-wait",
    };
  }
  return {
    title: "Mantener según plan",
    why: "Sin objetivo ni invalidación. Esperar es parte del plan.",
    action: stop
      ? `Stop ${fmt.price(stop)} · TP1 ${tp1 ? fmt.price(tp1) : "—"}`
      : "Define stop si aún no lo tienes.",
    pnlPct, pnlUsd, cls: "v-wait",
  };
}

export function computeStop(tech) {
  if (!tech) return null;
  return Math.min(
    tech.support * 0.985,
    tech.price - (tech.lastAtr || tech.price * 0.03) * 1.35,
  );
}
