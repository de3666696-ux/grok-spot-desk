# Spot Desk v4

Investigación Spot estilo Binance: velas OHLC, zoom/pan, zona de compra, stop/TP, tramos, posiciones, **cache de APIs**, **backtest simple** y **alertas de precio**.

## Arranque

```bash
npm install
npm run dev
```

## Estructura

```
src/
  App.jsx                 # UI
  components/BinanceCandleChart.jsx
  lib/
    api.js                # Binance multi-host + CoinGecko + cache
    indicators.js         # SMA/RSI/ATR + backtest
    signal.js             # score, veredicto, plan, venta
    store.js              # localStorage + notificaciones
    chat.js               # guía local
    fmt.js
```

## Aviso

No ejecuta órdenes. El backtest es simulación histórica, no predicción. No es asesoramiento financiero.
