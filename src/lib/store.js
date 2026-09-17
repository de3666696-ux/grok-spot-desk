const LS_KEY = "spot-desk:v4";

export function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      return { history: [], positions: [], capital: 25, riskLevel: "moderado", alerts: [] };
    }
    return {
      history: [],
      positions: [],
      capital: 25,
      riskLevel: "moderado",
      alerts: [],
      ...JSON.parse(raw),
    };
  } catch {
    return { history: [], positions: [], capital: 25, riskLevel: "moderado", alerts: [] };
  }
}

export function saveStore(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function requestNotifyPermission() {
  if (typeof Notification === "undefined") return Promise.resolve("denied");
  if (Notification.permission === "granted") return Promise.resolve("granted");
  if (Notification.permission === "denied") return Promise.resolve("denied");
  return Notification.requestPermission();
}

export function fireNotify(title, body) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, icon: undefined });
    }
  } catch { /* ignore */ }
}
