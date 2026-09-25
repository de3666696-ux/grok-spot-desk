/**
 * Chat IA multi-turno sobre el activo analizado.
 * API compatible OpenAI (xAI por defecto).
 */

const DEFAULT_BASE = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-2-latest";

export const AI_MODELS = [
  { id: "grok-2-latest", label: "Grok 2 (latest)" },
  { id: "grok-3", label: "Grok 3" },
  { id: "grok-3-mini", label: "Grok 3 mini" },
  { id: "grok-4", label: "Grok 4" },
];

export function loadAiSettings() {
  try {
    const raw = localStorage.getItem("spot-desk:ai");
    if (!raw) return { apiKey: "", baseUrl: DEFAULT_BASE, model: DEFAULT_MODEL };
    return { apiKey: "", baseUrl: DEFAULT_BASE, model: DEFAULT_MODEL, ...JSON.parse(raw) };
  } catch {
    return { apiKey: "", baseUrl: DEFAULT_BASE, model: DEFAULT_MODEL };
  }
}

export function saveAiSettings(settings) {
  try {
    localStorage.setItem(
      "spot-desk:ai",
      JSON.stringify({
        apiKey: settings.apiKey || "",
        baseUrl: settings.baseUrl || DEFAULT_BASE,
        model: settings.model || DEFAULT_MODEL,
      }),
    );
  } catch { /* ignore */ }
}

function buildSystemPrompt(ctx) {
  const { coin, score, global, news, compare } = ctx || {};
  const lines = [
    "Eres el asistente de investigación de Spot Desk.",
    "Respondes en español, claro y directo.",
    "Te centras en la moneda/proyecto analizado y el contexto de mercado.",
    "No inventes cifras: si no están en el contexto, dilo.",
    "Sobre el precio: NUNCA digas 'va a subir' o 'va a bajar' como hecho seguro.",
    "Si preguntan por dirección del precio, usa escenarios: 'puede subir si…', 'podría bajar si…'.",
    "Termina dejando claro que es análisis de escenarios, no predicción garantizada.",
    "No prometas ganancias.",
  ];

  if (global) {
    lines.push(
      "",
      "## Mercado global",
      `- Market cap: ${global.marketCap}`,
      `- Volumen 24h: ${global.volume24h}`,
      `- Dominancia BTC: ${global.btcDominance}%`,
      global.ethDominance != null ? `- Dominancia ETH: ${global.ethDominance}%` : null,
    );
  }

  if (coin) {
    lines.push(
      "",
      "## Activo principal",
      `- Nombre: ${coin.name}`,
      `- Símbolo: ${coin.symbol}`,
      `- Rank: ${coin.rank}`,
      `- Precio: ${coin.price}`,
      `- 24h: ${coin.change24h}% · 7d: ${coin.change7d}% · 30d: ${coin.change30d}%`,
      `- Market cap: ${coin.marketCap}`,
      `- Volumen 24h: ${coin.volume24h}`,
      `- ATH: ${coin.ath} · Desde ATH: ${coin.percentFromAth}%`,
      `- Circ / Max supply: ${coin.circulating} / ${coin.maxSupply}`,
      `- Open source: ${coin.openSource}`,
      `- Tags: ${(coin.tags || []).join(", ")}`,
      `- Web: ${coin.links?.website || "—"}`,
      coin.description ? `- Descripción: ${String(coin.description).slice(0, 1000)}` : null,
    );
  }

  if (compare) {
    lines.push(
      "",
      "## Activo en comparación",
      `- ${compare.name} (${compare.symbol}) rank ${compare.rank}`,
      `- Precio: ${compare.price} · 24h: ${compare.change24h}% · 7d: ${compare.change7d}%`,
      `- MCap: ${compare.marketCap} · Desde ATH: ${compare.percentFromAth}%`,
    );
  }

  if (score) {
    lines.push(
      "",
      "## Score app",
      `- ${score.total}/100 (${score.label}): ${score.plain}`,
    );
  }

  if (news?.length) {
    lines.push("", "## Noticias (priorizadas al activo si aplica)");
    for (const n of news.slice(0, 8)) {
      lines.push(`- ${n.title}`);
    }
  }

  return lines.filter((x) => x != null).join("\n");
}

/** historial: [{role:'user'|'assistant', content}] — solo los últimos N */
export async function askCoinAi(userMessage, ctx, settings, history = []) {
  const apiKey = (settings?.apiKey || "").trim();
  if (!apiKey) throw new Error("NO_KEY");

  const baseUrl = (settings.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const model = settings.model || DEFAULT_MODEL;

  const prior = (history || [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));

  const body = {
    model,
    temperature: 0.5,
    messages: [
      { role: "system", content: buildSystemPrompt(ctx) },
      ...prior,
      { role: "user", content: userMessage },
    ],
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j.error?.message || JSON.stringify(j).slice(0, 200);
    } catch {
      detail = (await res.text().catch(() => "")).slice(0, 200);
    }
    if (res.status === 401) throw new Error("API key inválida o sin permiso (401).");
    if (res.status === 404) throw new Error("Modelo o endpoint no encontrado (404). Revisa modelo y Base URL.");
    if (res.status === 429) throw new Error("Límite de la API (429). Espera e inténtalo de nuevo.");
    if (res.status === 0 || /Failed to fetch/i.test(detail))
      throw new Error("No se pudo conectar (red/CORS). Prueba otra Base URL o revisa la key.");
    throw new Error(detail || `Error API (${res.status})`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("La API no devolvió texto.");
  return text.trim();
}

export async function testAiConnection(settings) {
  const apiKey = (settings?.apiKey || "").trim();
  if (!apiKey) throw new Error("Falta API key.");
  const reply = await askCoinAi(
    "Responde solo: OK",
    { coin: null, global: null, news: [] },
    settings,
    [],
  );
  return reply;
}
