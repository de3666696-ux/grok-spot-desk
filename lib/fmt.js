export const fmt = {
  price(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (a >= 1) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    if (a >= 0.01) return "$" + n.toFixed(5);
    return "$" + n.toFixed(8);
  },
  pct(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";
  },
  usd(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  },
  compact(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  },
  date(ts) {
    try {
      return new Date(ts).toLocaleString("es-ES", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch { return "—"; }
  },
};
