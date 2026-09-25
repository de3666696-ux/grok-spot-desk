import { fmt } from "./fmt.js";

export function assistantReply(q, ctx) {
  const query = (q || "").toLowerCase();
  const { coin, score, global, news, movers } = ctx;

  if (/ayuda|c[oó]mo usar|gu[ií]a/.test(query)) {
    return [
      "1) Revisa dominancia BTC y market cap global.",
      "2) Analiza un activo y lee el resumen + métricas.",
      "3) Contrasta con noticias del día.",
      "4) Usa la watchlist para seguimiento.",
    ].join("\n");
  }
  if (/dominanc|btc|bitcoin.*mercado|mercado/.test(query)) {
    if (!global) return "Pulsa Actualizar para cargar el mercado.";
    return [
      `El mercado total vale unos ${fmt.compact(global.marketCap)}.`,
      `Bitcoin se lleva el ${global.btcDominance?.toFixed?.(1)}% de ese total.`,
      global.btcDominance > 55
        ? "Con Bitcoin tan fuerte, muchas monedas pequeñas suelen pasar más apuros."
        : "La dominancia de Bitcoin no está extrema; el resto del mercado tiene algo más de aire.",
    ].join("\n");
  }
  if (/noticia|news|titular|pasa/.test(query)) {
    if (!news?.length) return "Aún no hay noticias. Pulsa Actualizar.";
    return "Últimos titulares:\n" + news.slice(0, 5).map((n, i) => `${i + 1}. ${n.title}`).join("\n");
  }
  if (/sube|gainer|fuerte hoy/.test(query)) {
    if (!movers?.up?.length) return "Sin datos de subidas todavía.";
    return movers.up.map((g) => `${g.symbol}: ${fmt.pct(g.change24h)}`).join("\n");
  }
  if (/baja|cae|loser/.test(query)) {
    if (!movers?.down?.length) return "Sin datos de bajadas todavía.";
    return movers.down.map((g) => `${g.symbol}: ${fmt.pct(g.change24h)}`).join("\n");
  }
  if (/score|resumen|este proyecto|fundamental|qu[eé] tal/.test(query)) {
    if (!score || !coin) return "Elige un proyecto (por ejemplo BTC) para ver el resumen.";
    return [
      `${coin.name}: ${score.label} (${score.total}/100).`,
      score.plain,
      ...(score.bullets || []).slice(0, 3),
    ].join("\n");
  }
  if (/puede subir|subir[aá]|va a subir|precio.*sub|alcista|bajista|puede bajar/.test(query)) {
    if (!coin) return "Analiza un activo primero. Pregunta del estilo: «¿Puede subir SOL?» (escenarios, no certeza).";
    const bits = [];
    bits.push(`${coin.symbol}: no se puede afirmar que "va a subir". Sí se pueden plantear escenarios.`);
    if (coin.change24h != null) bits.push(`24h: ${coin.change24h}% · 7d: ${coin.change7d}% · 30d: ${coin.change30d}%.`);
    if (coin.percentFromAth != null) bits.push(`Respecto al ATH: ${coin.percentFromAth}%.`);
    if (global?.btcDominance != null) bits.push(`Dominancia BTC ~${Number(global.btcDominance).toFixed(1)}% (influye en alts).`);
    bits.push("Un escenario de subida suele pedir: mejor flujo de noticias, liquidez y que BTC no aplaste al resto.");
    bits.push("Un escenario de bajada: riesgo de proyecto, dominancia BTC alta o venta general del mercado.");
    bits.push("Pregunta recomendada: «¿Puede subir …?» → respuesta en condiciones, nunca «el precio va a subir».");
    return bits.join("\n");
  }
    if (/comprar|vender|cu[aá]ndo/.test(query)) {
    return [
      "Aquí el foco es contexto de mercado y fundamentos, no órdenes de entrada/salida.",
      coin ? `Activo cargado: ${coin.name}.` : "Analiza un activo para ver el resumen.",
    ].join("\n");
  }
  return [
    "Temas: resumen del activo, dominancia BTC, noticias, gainers/losers.",
    coin ? `Activo abierto: ${coin.name}.` : "Analiza BTC, ETH u otro símbolo.",
  ].join("\n");
}
