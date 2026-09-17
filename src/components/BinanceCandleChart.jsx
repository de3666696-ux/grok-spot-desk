import React, { useEffect, useRef } from "react";
import { fmt } from "../lib/fmt.js";

const UP = "#0ecb81";
const DOWN = "#f6465d";
const BG = "#0b0e11";
const GRID = "#1e2329";
const MUTED = "#848e9c";
const GOLD = "#f0b90b";

export default function BinanceCandleChart({ candles, levels }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const tipRef = useRef(null);
  const viewRef = useRef({ start: 0, end: 0 }); // visible range indices

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const full = candles || [];
    if (viewRef.current.end === 0 || viewRef.current.end > full.length) {
      viewRef.current = { start: Math.max(0, full.length - 120), end: full.length };
    }
    // clamp when new data
    viewRef.current.end = Math.min(viewRef.current.end, full.length);
    viewRef.current.start = Math.max(0, Math.min(viewRef.current.start, viewRef.current.end - 10));

    let hoverI = null;
    let dragging = false;
    let dragX = 0;
    let dragStartView = null;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      const { start, end } = viewRef.current;
      const data = full.slice(start, end);
      if (data.length < 2) {
        ctx.fillStyle = MUTED;
        ctx.font = "13px IBM Plex Sans, sans-serif";
        ctx.fillText("Sin velas suficientes", 16, h / 2);
        return;
      }

      const padL = 8, padR = 68, padT = 14;
      const volH = Math.floor(h * 0.18);
      const padB = 22 + volH;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      let min = Math.min(...data.map((c) => c.low));
      let max = Math.max(...data.map((c) => c.high));
      const lv = [
        levels?.stop, levels?.tp1, levels?.tp2, levels?.tp3,
        levels?.support, levels?.entry, levels?.zonaMin, levels?.zonaMax,
      ].filter((n) => typeof n === "number" && Number.isFinite(n));
      for (const n of lv) {
        min = Math.min(min, n);
        max = Math.max(max, n);
      }
      const span = max - min || 1;
      min -= span * 0.04;
      max += span * 0.04;
      const yOf = (p) => padT + ((max - p) / (max - min)) * plotH;
      const slot = plotW / data.length;
      const bodyW = Math.max(2, slot * 0.68);

      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillStyle = MUTED;
      for (let i = 0; i < 5; i++) {
        const p = min + ((max - min) * i) / 4;
        const y = yOf(p);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.fillText(fmt.price(p).replace("$", ""), w - padR + 6, y + 3);
      }

      const line = (price, color, dash) => {
        const y = yOf(price);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        if (dash) ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.restore();
      };

      if (levels?.zonaMin != null && levels?.zonaMax != null) {
        const y1 = yOf(levels.zonaMax);
        const y2 = yOf(levels.zonaMin);
        ctx.fillStyle = "rgba(14,203,129,0.08)";
        ctx.fillRect(padL, y1, plotW, Math.max(2, y2 - y1));
      }
      if (levels?.support) line(levels.support, "#3b82f6", true);
      if (levels?.stop) line(levels.stop, DOWN, true);
      if (levels?.tp1) line(levels.tp1, UP, true);
      if (levels?.tp2) line(levels.tp2, UP, true);
      if (levels?.tp3) line(levels.tp3, UP, true);
      if (levels?.entry) line(levels.entry, GOLD, false);

      if (levels?.sma20?.length) {
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < data.length; i++) {
          const v = levels.sma20[start + i];
          if (v == null) continue;
          const x = padL + i * slot + slot / 2;
          const y = yOf(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        if (started) ctx.stroke();
      }

      const maxVol = Math.max(...data.map((c) => c.volume), 1);
      data.forEach((c, i) => {
        const x = padL + i * slot + slot / 2;
        const up = c.close >= c.open;
        const color = up ? UP : DOWN;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, yOf(c.high));
        ctx.lineTo(x, yOf(c.low));
        ctx.stroke();
        const top = Math.min(yOf(c.open), yOf(c.close));
        const bh = Math.max(1, Math.abs(yOf(c.close) - yOf(c.open)));
        ctx.fillRect(x - bodyW / 2, top, bodyW, bh);
        const vh = (c.volume / maxVol) * (volH - 8);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x - bodyW / 2, h - 18 - vh, bodyW, vh);
        ctx.globalAlpha = 1;
      });

      ctx.fillStyle = MUTED;
      ctx.font = "10px IBM Plex Sans, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(
        new Date(data[0].time).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
        padL, h - 6,
      );
      ctx.textAlign = "right";
      ctx.fillText(
        new Date(data[data.length - 1].time).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
        w - padR, h - 6,
      );
      ctx.textAlign = "left";
      ctx.fillText(`${start + 1}–${end} / ${full.length} · rueda zoom · arrastra pan`, padL + 4, padT + 10);

      if (hoverI != null && data[hoverI]) {
        const c = data[hoverI];
        const x = padL + hoverI * slot + slot / 2;
        ctx.strokeStyle = "rgba(240,185,11,0.45)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, h - 18);
        ctx.stroke();
        ctx.setLineDash([]);
        if (tipRef.current) {
          const up = c.close >= c.open;
          tipRef.current.style.display = "block";
          tipRef.current.innerHTML =
            `<strong>${new Date(c.time).toLocaleString("es-ES", {
              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
            })}</strong><br/>` +
            `O ${fmt.price(c.open)} · H ${fmt.price(c.high)}<br/>` +
            `L ${fmt.price(c.low)} · C <span style="color:${up ? UP : DOWN}">${fmt.price(c.close)}</span>`;
          tipRef.current.style.left = `${Math.min(x + 10, w - 170)}px`;
          tipRef.current.style.top = "12px";
        }
      } else if (tipRef.current) {
        tipRef.current.style.display = "none";
      }
    };

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (dragging && dragStartView) {
        const { start, end } = dragStartView;
        const len = end - start;
        const plotW = rect.width - 76;
        const slot = plotW / Math.max(len, 1);
        const dx = e.clientX - dragX;
        const shift = Math.round(-dx / slot);
        let ns = Math.max(0, Math.min(full.length - len, start + shift));
        viewRef.current = { start: ns, end: ns + len };
        draw();
        return;
      }
      const { start, end } = viewRef.current;
      const dataLen = end - start;
      const padL = 8, padR = 68;
      const plotW = rect.width - padL - padR;
      const slot = plotW / Math.max(dataLen, 1);
      const i = Math.floor((x - padL) / slot);
      hoverI = i >= 0 && i < dataLen ? i : null;
      draw();
    };

    const onLeave = () => {
      hoverI = null;
      dragging = false;
      draw();
    };

    const onDown = (e) => {
      dragging = true;
      dragX = e.clientX;
      dragStartView = { ...viewRef.current };
    };
    const onUp = () => {
      dragging = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      const { start, end } = viewRef.current;
      const len = end - start;
      const center = (start + end) / 2;
      const factor = e.deltaY > 0 ? 1.15 : 0.85;
      let newLen = Math.round(len * factor);
      newLen = Math.max(20, Math.min(full.length, newLen));
      let ns = Math.round(center - newLen / 2);
      let ne = ns + newLen;
      if (ns < 0) {
        ns = 0;
        ne = newLen;
      }
      if (ne > full.length) {
        ne = full.length;
        ns = Math.max(0, ne - newLen);
      }
      viewRef.current = { start: ns, end: ne };
      draw();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [candles, levels]);

  return (
    <div className="bn-chart" ref={wrapRef}>
      <canvas ref={canvasRef} />
      <div className="bn-tip" ref={tipRef} />
      <div className="bn-legend">
        <span className="up">Verde ↑</span>
        <span className="down">Rojo ↓</span>
        <span>Vol · zoom rueda · pan arrastre</span>
      </div>
    </div>
  );
}
