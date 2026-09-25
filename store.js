const LS_KEY = "spot-desk:fund:v2";

export function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { history: [], watchlist: [], alerts: [], chatHistory: [] };
    const j = JSON.parse(raw);
    return {
      history: j.history || [],
      watchlist: j.watchlist || [],
      alerts: j.alerts || [],
      chatHistory: j.chatHistory || [],
    };
  } catch {
    return { history: [], watchlist: [], alerts: [], chatHistory: [] };
  }
}

export function saveStore(data) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        history: data.history || [],
        watchlist: data.watchlist || [],
        alerts: data.alerts || [],
        chatHistory: (data.chatHistory || []).slice(-20),
      }),
    );
  } catch { /* quota */ }
}
