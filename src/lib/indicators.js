export function sma(arr, p) {
  return arr.map((_, i) => {
    if (i < p - 1) return null;
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += arr[j];
    return s / p;
  });
}

export function ema(arr, p) {
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

export function rsi(closes, p = 14) {
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

export function atr(candles, p = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  return sma(tr, p);
}

export function pivots(candles, w = 3) {
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

export function analyzeCandles(candles) {
  if (!candles || candles.length < 40) return null;
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const s20 = sma(closes, 20);
  const s50 = closes.length >= 50 ? sma(closes, 50) : null;
  const s200 = closes.length >= 200 ? sma(closes, 200) : null;
  const e20 = ema(closes, 20);
  const rs = rsi(closes, 14);
  const at = atr(candles, 14);
  const volSma = sma(vols, 20);
  const price = closes.at(-1);
  const lastRsi = rs.at(-1);
  const lastAtr = at.at(-1);
  const lastS20 = s20.at(-1);
  const lastS50 = s50?.at(-1);
  const lastS200 = s200?.at(-1);
  const lastE20 = e20.at(-1);
  const lastVol = vols.at(-1);
  const lastVolSma = volSma.at(-1);
  const volumeRatio = lastVolSma > 0 ? lastVol / lastVolSma : null;

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
  const pad = lastAtr || price * 0.04;
  const support = supports[0] ?? price - pad * 2;
  const res1 = resists[0] ?? price + pad * 1.8;
  const res2 = resists[1] ?? price + pad * 3.2;
  const res3 = resists[2] ?? price + pad * 5;
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
  if (volumeRatio != null && volumeRatio > 1.3 && trend === "alcista") quality += 4;
  quality = Math.max(0, Math.min(100, Math.round(quality)));

  return {
    price, trend, lastRsi, lastAtr, lastS20, lastS50, lastS200, lastE20,
    support, res1, res2, res3, distSup, quality, volumeRatio, candles,
    sma20: s20, sma50: s50, sma200: s200, rsiSeries: rs,
  };
}

/** Backtest simple: compra cerca de soporte + RSI 40-62, stop ATR, TP res1 */
export function simpleBacktest(candles) {
  if (!candles || candles.length < 80) return null;
  const closes = candles.map((c) => c.close);
  const rs = rsi(closes, 14);
  const at = atr(candles, 14);
  const s20 = sma(closes, 20);
  let capital = 1000;
  const riskPct = 0.01;
  let pos = null;
  const trades = [];
  let equityPeak = capital;
  let maxDd = 0;

  for (let i = 50; i < candles.length - 1; i++) {
    const price = closes[i];
    const atrV = at[i] || price * 0.03;
    const support = Math.min(...candles.slice(Math.max(0, i - 20), i + 1).map((c) => c.low));
    const dist = ((price - support) / price) * 100;
    const r = rs[i];

    if (pos) {
      const stop = pos.stop;
      const tp = pos.tp;
      const hi = candles[i].high;
      const lo = candles[i].low;
      if (lo <= stop) {
        const pnl = ((stop / pos.entry) - 1) * pos.size;
        capital += pnl;
        trades.push({ entry: pos.entry, exit: stop, pnlPct: (stop / pos.entry - 1) * 100, win: false });
        pos = null;
      } else if (hi >= tp) {
        const pnl = ((tp / pos.entry) - 1) * pos.size;
        capital += pnl;
        trades.push({ entry: pos.entry, exit: tp, pnlPct: (tp / pos.entry - 1) * 100, win: true });
        pos = null;
      }
    } else if (r != null && r >= 40 && r <= 62 && dist <= 8 && s20[i] && price >= s20[i] * 0.98) {
      const stop = Math.min(support * 0.985, price - atrV * 1.35);
      const risk = price - stop;
      if (risk > 0) {
        const size = Math.min(capital * 0.25, (capital * riskPct) / (risk / price));
        if (size >= 5) {
          pos = {
            entry: price,
            stop,
            tp: price + risk * 2,
            size,
          };
        }
      }
    }
    equityPeak = Math.max(equityPeak, capital);
    maxDd = Math.max(maxDd, ((equityPeak - capital) / equityPeak) * 100);
  }

  const wins = trades.filter((t) => t.win).length;
  const total = trades.length;
  const ret = ((capital - 1000) / 1000) * 100;
  const avg = total ? trades.reduce((a, t) => a + t.pnlPct, 0) / total : 0;
  return {
    trades: total,
    wins,
    winRate: total ? (wins / total) * 100 : 0,
    returnPct: ret,
    avgTradePct: avg,
    maxDrawdownPct: maxDd,
    finalCapital: capital,
    note: "Simulación sobre histórico 1D. No predice el futuro. Regla fija: soporte + RSI + stop ATR / TP 2R.",
  };
}
