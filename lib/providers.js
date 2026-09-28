/**
 * providers.js — Fournisseurs STT (audio -> texte) et LLM (texte -> réponse).
 *
 * Choix par défaut : **Groq**, gratuit et fiable.
 *   - STT  : whisper-large-v3-turbo (free tier : ~2 000 req/j, 28 800 s audio/j)
 *   - LLM  : llama / gpt-oss selon le modèle choisi (free tier généreux)
 * Une seule clé Groq (GROQ_API_KEY) couvre donc le STT *et* le LLM.
 *
 * Alternatives supportées, toutes compatibles OpenAI :
 *   - tout endpoint /audio/transcriptions via STT_BASE_URL + STT_API_KEY ;
 *   - tout endpoint /chat/completions via LLM_BASE_URL + LLM_API_KEY ;
 *   - un endpoint de chat gratuit déjà déployé via CHAT_ENDPOINT
 *     (ex. https://<projet>.vercel.app/api/chat) ;
 *   - LLM_PROVIDER=none : aucun LLM, /api/voice renvoie le transcript tel quel.
 *
 * STT_PROVIDER=mock / LLM_PROVIDER=mock : réponses simulées, pour les tests
 * hors ligne (aucun réseau, aucune clé).
 */

"use strict";

const { HttpError, ConfigError } = require("./http");

const GROQ_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_STT_MODEL = process.env.STT_MODEL || "whisper-large-v3-turbo";
const DEFAULT_LLM_MODEL = process.env.GROQ_LLM_MODEL || "llama-3.3-70b-versatile";
const DEFAULT_TIMEOUT_MS = 60000;

/** fetch avec délai maximal et erreurs normalisées. */
async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new HttpError(504, "upstream_timeout", `Le fournisseur n'a pas répondu en ${timeoutMs} ms.`);
    }
    throw new HttpError(502, "upstream_unreachable", `Fournisseur injoignable : ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Lit une réponse d'erreur amont et la transforme en HttpError lisible. */
async function upstreamError(res, provider) {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 400);
  } catch (_) {
    /* ignore */
  }
  const status = res.status === 401 || res.status === 403 ? 502 : 502;
  throw new HttpError(status, "upstream_error", `${provider} a répondu ${res.status}. ${detail}`);
}

/** Résout le fournisseur STT actif. */
function resolveSttProvider() {
  const explicit = String(process.env.STT_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.STT_BASE_URL) return "openai";
  return "unconfigured";
}

/**
 * Transcrit un audio en texte.
 * @param {Buffer} audio
 * @param {{filename?:string, mimetype?:string, language?:string, model?:string}} [opts]
 * @returns {Promise<{text:string, provider:string, model:string, language:string|null, ms:number}>}
 */
async function transcribe(audio, opts = {}) {
  if (!Buffer.isBuffer(audio) || !audio.length) {
    throw new HttpError(400, "missing_audio", "Audio vide ou manquant.");
  }
  const provider = resolveSttProvider();
  const language = opts.language ?? process.env.STT_LANGUAGE ?? null;
  const model = opts.model || DEFAULT_STT_MODEL;
  const filename = opts.filename || "audio.wav";
  const mimetype = opts.mimetype || "application/octet-stream";
  const t0 = Date.now();

  if (provider === "mock") {
    return { text: "Ceci est une transcription simulée.", provider: "mock", model: "mock", language: language || "fr", ms: Date.now() - t0 };
  }

  let base;
  let key;
  if (provider === "groq") {
    key = process.env.GROQ_API_KEY;
    if (!key) throw new ConfigError("STT_PROVIDER=groq mais GROQ_API_KEY est absente. Créez une clé gratuite sur https://console.groq.com/keys");
    base = GROQ_BASE;
  } else if (provider === "openai") {
    base = String(process.env.STT_BASE_URL || "").replace(/\/+$/, "");
    key = process.env.STT_API_KEY || process.env.OPENAI_API_KEY || "";
    if (!base) throw new ConfigError("STT_BASE_URL est requise pour STT_PROVIDER=openai.");
  } else {
    throw new ConfigError(
      "Aucun fournisseur STT configuré. Définissez GROQ_API_KEY (recommandé, gratuit) ou STT_BASE_URL + STT_API_KEY.",
    );
  }

  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimetype }), filename);
  form.append("model", model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (language) form.append("language", language);

  const res = await fetchWithTimeout(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: form,
  });
  if (!res.ok) await upstreamError(res, "Le service STT");

  const data = await res.json().catch(() => null);
  const text = data && (data.text || data.transcription);
  if (typeof text !== "string") {
    throw new HttpError(502, "stt_bad_response", "Réponse STT inattendue (champ « text » absent).");
  }
  return { text: text.trim(), provider, model, language: language || null, ms: Date.now() - t0 };
}

/** Résout le fournisseur LLM actif. */
function resolveLlmProvider() {
  const explicit = String(process.env.LLM_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.CHAT_ENDPOINT) return "chat-endpoint";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.LLM_BASE_URL) return "openai";
  return "none";
}

/** Extrait le texte utile d'une réponse JSON hétérogène (endpoint de chat). */
function pickText(data) {
  if (!data) return null;
  if (typeof data === "string") return data;
  const candidates = [data.response, data.reply, data.answer, data.text, data.message, data.content, data.output];
  for (const c of candidates) if (typeof c === "string" && c.trim()) return c.trim();
  if (data.choices && data.choices[0] && data.choices[0].message) {
    const m = data.choices[0].message.content;
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  if (data.data) return pickText(data.data);
  return null;
}

/**
 * Génère une réponse textuelle à partir du transcript.
 * @param {{prompt:string, system?:string, history?:Array<{role:string,content:string}>}} input
 * @returns {Promise<{text:string, provider:string, model:string, ms:number}>}
 */
async function generateReply(input) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new HttpError(400, "empty_prompt", "Le prompt est vide.");
  const provider = resolveLlmProvider();
  const t0 = Date.now();
  const system = input.system || "Tu es un assistant vocal. Réponds de façon brève, claire et naturelle, en français, en 2 à 4 phrases maximum.";
  const history = Array.isArray(input.history) ? input.history.slice(-10) : [];

  if (provider === "none") {
    return { text: prompt, provider: "none", model: "none", ms: Date.now() - t0 };
  }
  if (provider === "mock") {
    return { text: `Réponse simulée à : « ${prompt} »`, provider: "mock", model: "mock", ms: Date.now() - t0 };
  }

  if (provider === "chat-endpoint") {
    const endpoint = process.env.CHAT_ENDPOINT;
    if (!endpoint) throw new ConfigError("LLM_PROVIDER=chat-endpoint mais CHAT_ENDPOINT est absente.");
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model: process.env.LLM_MODEL || undefined }),
    });
    if (!res.ok) await upstreamError(res, "L'endpoint de chat");
    const data = await res.json().catch(() => null);
    const text = pickText(data);
    if (!text) throw new HttpError(502, "llm_bad_response", "Réponse de l'endpoint de chat illisible.");
    return { text, provider, model: process.env.LLM_MODEL || "chat-endpoint", ms: Date.now() - t0 };
  }

  let base;
  let key;
  let model;
  if (provider === "groq") {
    key = process.env.GROQ_API_KEY;
    if (!key) throw new ConfigError("LLM_PROVIDER=groq mais GROQ_API_KEY est absente.");
    base = GROQ_BASE;
    model = process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
  } else if (provider === "openai") {
    base = String(process.env.LLM_BASE_URL || "").replace(/\/+$/, "");
    key = process.env.LLM_API_KEY || "";
    model = process.env.LLM_MODEL || "gpt-4o-mini";
    if (!base) throw new ConfigError("LLM_BASE_URL est requise pour LLM_PROVIDER=openai.");
  } else {
    throw new ConfigError(`LLM_PROVIDER inconnu : « ${provider} ». Valeurs : groq | openai | chat-endpoint | none | mock.`);
  }

  const messages = [
    { role: "system", content: system },
    ...history.filter((m) => m && typeof m.content === "string"),
    { role: "user", content: prompt },
  ];

  const res = await fetchWithTimeout(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, messages, temperature: 0.6, max_tokens: 400 }),
  });
  if (!res.ok) await upstreamError(res, "Le service LLM");

  const data = await res.json().catch(() => null);
  const text = pickText(data);
  if (!text) throw new HttpError(502, "llm_bad_response", "Réponse LLM illisible.");
  return { text, provider, model, ms: Date.now() - t0 };
}

/** Décrit l'état des fournisseurs (pour /api/health, sans révéler les clés). */
function describeProviders() {
  return {
    stt: { provider: resolveSttProvider(), model: DEFAULT_STT_MODEL, language: process.env.STT_LANGUAGE || null },
    llm: { provider: resolveLlmProvider(), model: resolveLlmProvider() === "groq" ? (process.env.LLM_MODEL || DEFAULT_LLM_MODEL) : (process.env.LLM_MODEL || null) },
    tts: { provider: "edge", voice: process.env.TTS_VOICE || "fr-FR-DeniseNeural" },
  };
}

module.exports = { transcribe, generateReply, describeProviders, resolveSttProvider, resolveLlmProvider, pickText };
