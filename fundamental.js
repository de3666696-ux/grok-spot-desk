/** Score + explicación en lenguaje simple */

export function scoreFundamental(coin, global) {
  if (!coin) return null;
  const parts = {};
  let total = 0;

  let rankS = 4;
  if (coin.rank != null) {
    if (coin.rank <= 10) rankS = 22;
    else if (coin.rank <= 30) rankS = 18;
    else if (coin.rank <= 50) rankS = 14;
    else if (coin.rank <= 100) rankS = 10;
    else if (coin.rank <= 200) rankS = 6;
  }
  if (coin.marketCap && coin.volume24h) {
    const vr = coin.volume24h / coin.marketCap;
    if (vr > 0.08) rankS = Math.min(22, rankS + 2);
    if (vr < 0.005) rankS = Math.max(0, rankS - 4);
  }
  parts.liquidez = rankS;
  total += rankS;

  let tok = 6;
  if (coin.circulating && coin.maxSupply) {
    const r = coin.circulating / coin.maxSupply;
    if (r > 0.85) tok += 10;
    else if (r > 0.5) tok += 7;
    else if (r > 0.25) tok += 4;
    else tok += 1;
  } else if (coin.maxSupply == null && coin.circulating) {
    tok += 4;
  }
  parts.tokenomics = Math.min(18, tok);
  total += parts.tokenomics;

  let val = 4;
  const fromAth = coin.percentFromAth;
  if (fromAth != null) {
    const d = Math.abs(fromAth);
    if (d >= 40 && d <= 75) val += 8;
    else if (d >= 20 && d < 40) val += 6;
    else if (d > 85) val += 2;
    else if (d < 10) val += 3;
  }
  parts.valoracion = Math.min(14, val);
  total += parts.valoracion;

  let proj = 4;
  if (coin.description && coin.description.length > 120) proj += 4;
  if (coin.openSource) proj += 4;
  if (coin.links?.website) proj += 2;
  if (coin.links?.sourceCode) proj += 3;
  if (coin.links?.whitepaper) proj += 2;
  if (coin.hardwareWallet) proj += 2;
  if (coin.tags?.length >= 3) proj += 2;
  if (coin.team?.length >= 2) proj += 2;
  if (coin.developmentStatus && /working|mvp|on.?going/i.test(coin.developmentStatus)) proj += 2;
  parts.proyecto = Math.min(24, proj);
  total += parts.proyecto;

  let mom = 4;
  const c7 = coin.change7d;
  const c30 = coin.change30d;
  if (c7 != null && c7 > 0 && c7 < 25) mom += 3;
  if (c7 != null && c7 > 40) mom -= 2;
  if (c30 != null && c30 > -15 && c30 < 40) mom += 3;
  if (c30 != null && c30 < -50) mom -= 2;
  parts.momentum = Math.max(0, Math.min(12, mom));
  total += parts.momentum;

  let risk = 8;
  if (coin.beta != null && coin.beta > 1.4) risk -= 2;
  if (coin.rank != null && coin.rank > 150) risk -= 3;
  if (!coin.isActive) risk = 0;
  parts.riesgo = Math.max(0, risk);
  total += parts.riesgo;

  total = Math.max(0, Math.min(100, Math.round(total)));

  let label = "Débil";
  let color = "no";
  let plain =
    "Con los datos públicos disponibles, el perfil se ve frágil o incompleto frente a activos más consolidados.";
  if (total >= 72) {
    label = "Sólido";
    color = "buy";
    plain =
      "Perfil sólido en datos públicos: liquidez, visibilidad e información del proyecto por encima de la media. No implica dirección del precio.";
  } else if (total >= 58) {
    label = "Aceptable";
    color = "scale";
    plain =
      "Señales mixtas en los datos. Conviene contrastar rank, supply y contexto de mercado antes de decidir.";
  } else if (total >= 45) {
    label = "Mixto";
    color = "wait";
    plain =
      "Señales mezcladas. Revisa descripción, rank y comparación con activos de referencia.";
  }

  const bullets = [];
  if (coin.rank != null && coin.rank <= 20)
    bullets.push("Alta capitalización relativa: mejor profundidad de mercado en general.");
  if (coin.rank != null && coin.rank > 100)
    bullets.push("Capitalización más baja: suele implicar mayor volatilidad.");
  if (coin.percentFromAth != null && Math.abs(coin.percentFromAth) > 50)
    bullets.push("Está bastante lejos de su máximo histórico: puede ser oportunidad o problema del proyecto.");
  if (coin.openSource) bullets.push("El código se declara abierto (más transparencia).");
  if (!coin.links?.website) bullets.push("No aparece web oficial en los datos: investiga bien antes.");
  if (global?.btcDominance != null && global.btcDominance > 55)
    bullets.push("Bitcoin domina el mercado ahora: muchas altcoins suelen ir más flojas en ese ambiente.");
  if (coin.change24h != null && Math.abs(coin.change24h) > 15)
    bullets.push("Movimiento fuerte en 24h: volatilidad elevada en la sesión.");

  return { total, label, color, plain, bullets, parts };
}

export function beginnerPicks(scan) {
  if (!scan?.length) return [];
  const want = ["BTC", "ETH", "SOL", "BNB", "XRP"];
  const out = [];
  for (const s of want) {
    const hit = scan.find((x) => x.symbol === s);
    if (hit) out.push(hit);
  }
  return out;
}

export function topMovers(scan) {
  if (!scan?.length) return { up: [], down: [] };
  const sorted = [...scan].sort((a, b) => (b.change24h || 0) - (a.change24h || 0));
  return {
    up: sorted.filter((x) => (x.change24h || 0) > 0).slice(0, 5),
    down: sorted.filter((x) => (x.change24h || 0) < 0).slice(-5).reverse(),
  };
}
