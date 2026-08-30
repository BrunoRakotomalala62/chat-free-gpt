/**
 * aichatting.js — Client non-officiel pour le backend de aichatting.net
 * (https://www.aichatting.net/fr/free-chatgpt/)
 *
 * Le site web (Next.js) appelle l'API https://aga-api.aichatting.net avec :
 *   - POST /aigc/chat/record/conversation/create   -> crée une conversation
 *   - POST /aigc/chat/v2/askai/stream              -> chat en streaming (SSE)
 *
 * Le header `vToken` est un identifiant visiteur (fingerprint) chiffré en
 * RSA (PKCS#1 v1.5) avec la clé publique embarquée dans le JS du site.
 * Le serveur le déchiffre pour retrouver le visitorId et donner sa
 * "free quota" (2 messages gratuits par visiteur).
 *
 * Requête de chat attendue par le backend :
 *   { spaceHandle: true, roleId: 0, conversationId, model, messages:[...] }
 *   avec messages = [{ role, content: [{ type: "text", text }] }]
 *
 * Réponse : un flux SSE `data: ...` se terminant par `--@DONE@--`.
 * Les tokens `-=- --` (espace) et `-=-n--` (retour à la ligne) encodent la
 * mise en forme du texte.
 */

"use strict";

const crypto = require("crypto");

const API_BASE = "https://aga-api.aichatting.net";

// Clé publique RSA (SubjectPublicKeyInfo DER, base64) extraite du bundle JS du site.
const RSA_PUBLIC_KEY_DER = [
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCAdf/EyIbLBxjGqmh7qLU6/CPCzru+75+82OSPZ+",
  "nf4BFvg88drpZ6KigNW0J8TNgxe6Yms1irCZNVDyu+RXsl4y/7c2KOHc4OGTzHB5fUMiMasFUvcEs2P",
  "70e6yA/sKHZfBLG1XPhlb84Ibs3nhD3W5e2SuC+4EuVkaqzN08LQIDAQAB",
].join("");

const RSA_PUBLIC_KEY_PEM =
  "-----BEGIN PUBLIC KEY-----\n" +
  RSA_PUBLIC_KEY_DER.match(/.{1,64}/g).join("\n") +
  "\n-----END PUBLIC KEY-----";

// Modèles « officiels » exposés par la page free-chatgpt du site.
const MODELS = {
  LUNA: "gpt-5.6-luna", // gratuit
  TERRA: "gpt-5.6-terra", // réservé aux membres PRO
};

// Modèles testés fonctionnels en gratuit (le backend accepte beaucoup de noms ;
// les noms inconnus retombent sur le modèle par défaut).
const FREE_MODELS = [
  "gpt-5.6-luna", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1",
  "gpt-5.1-mini", "gpt-5.1-nano", "gpt-5.2", "gpt-4o-mini", "gpt-4-turbo",
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4", "gpt-3.5-turbo",
  "o1", "o1-mini", "o3", "o3-mini", "o4-mini",
  "deepseek-chat", "deepseek-reasoner", "deepseek-v3", "deepseek-r1",
  "claude-3-5-sonnet-20241022", "claude-sonnet-4-20250514",
  "claude-3-5-haiku", "claude-3-opus",
  "gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro",
  "llama-3.3-70b-versatile", "llama-3.1-8b-instant",
  "grok-2", "grok-3", "qwen2.5-72b-instruct", "mixtral-8x7b-instruct",
];

// Modèles qui répondent « réservé aux membres PRO ».
const PRO_MODELS = ["gpt-5.6-terra", "gpt-4o"];

/**
 * Génère un vToken (visitorId chiffré RSA) pour un visiteur donné.
 * Un visitorId est une chaîne de 32 hex (façon FingerprintJS).
 * @param {string} [visitorId] - identifiant visiteur (sinon aléatoire)
 * @returns {string} vToken base64 utilisable dans le header `vToken`
 */
function createVisitorToken(visitorId) {
  const id = visitorId || crypto.randomBytes(16).toString("hex");
  const encrypted = crypto.publicEncrypt(
    { key: RSA_PUBLIC_KEY_PEM, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(id, "utf8")
  );
  return encrypted.toString("base64");
}

/**
 * Appel JSON générique vers le backend aichatting.
 */
async function apiRequest(path, { method = "GET", body, vToken, lang = "fr" } = {}) {
  const headers = {
    Accept: "application/json",
    source: "web",
    lang,
    vToken,
  };
  const init = { method, headers, signal: AbortSignal.timeout(20000) };
  if (body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + path, init);
  return res.json();
}

/**
 * Crée une conversation (rôle « chatbot » id 0) pour un visiteur.
 * @returns {Promise<number>} conversationId
 */
async function createConversation(vToken, lang = "fr") {
  const data = await apiRequest("/aigc/chat/record/conversation/create", {
    method: "POST",
    body: { roleId: 0 },
    vToken,
    lang,
  });
  if (data.code !== 0 || !data.data || !data.data.conversationId) {
    throw new Error(data.message || "Échec de la création de conversation");
  }
  return data.data.conversationId;
}

/**
 * Reformate le texte brut du flux SSE (même logique que le frontend du site).
 *   - `-=- --`  -> espace
 *   - `-=-n--`  -> retour à la ligne
 *   - `\n`      -> espace
 */
function decodeStreamText(raw) {
  return raw.replace(/(\n|-=- --)/g, " ").replace(/-=-n--/g, "\n").trim();
}

/**
 * Lit un flux SSE (fetch streaming) et assemble le texte de la réponse.
 * Si la réponse n'est pas du SSE (ex. « pro premium member » en texte brut,
 * erreurs JSON), tout le corps est renvoyé tel quel.
 * @param {Response} res - réponse fetch (body stream)
 * @returns {Promise<string>} texte complet
 */
async function readSseText(res) {
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Réponse inattendue du serveur (${res.status}): ${errText.slice(0, 300)}`
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let raw = "";
  let rawBody = "";
  let sawDataEvent = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    rawBody += chunk;
    // Les événements SSE sont séparés par des lignes vides.
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of event.split("\n")) {
        if (line.startsWith("data:")) {
          sawDataEvent = true;
          const payload = line.slice(5).trim();
          if (payload === "--@DONE@--") return decodeStreamText(raw);
          raw += payload;
        }
      }
    }
  }
  // Dernier événement sans séparateur final.
  for (const line of buffer.split("\n")) {
    if (line.startsWith("data:")) {
      sawDataEvent = true;
      const payload = line.slice(5).trim();
      if (payload === "--@DONE@--") break;
      raw += payload;
    }
  }
  if (!sawDataEvent) {
    // Pas de SSE : le serveur a renvoyé du texte/JSON brut (erreur, PRO requis…)
    const text = rawBody.trim();
    if (!text) throw new Error("Réponse vide du serveur aichatting");
    return text;
  }
  return decodeStreamText(raw);
}

/**
 * Envoie un prompt au modèle demandé via le endpoint streaming du site.
 *
 * @param {object} opts
 * @param {string} opts.prompt      - message utilisateur
 * @param {string} [opts.model]     - nom du modèle (défaut: gpt-5.6-luna)
 * @param {number} [opts.conversationId] - conversation existante
 * @param {string} [opts.vToken]    - jeton visiteur (sinon généré)
 * @param {string} [opts.lang]      - langue (header `lang`)
 * @param {string} [opts.visitorId] - visitorId fixe pour dériver le vToken
 * @returns {Promise<{reply: string, raw?: string, model: string, conversationId: number, vToken: string}>}
 */
async function chat({ prompt, model, conversationId, vToken, lang = "fr", visitorId }) {
  const finalModel = model || MODELS.LUNA;
  const finalVToken = vToken || createVisitorToken(visitorId);
  const finalConversationId =
    conversationId || (await createConversation(finalVToken, lang));

  const body = {
    spaceHandle: true,
    roleId: 0,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    conversationId: finalConversationId,
    model: finalModel,
  };

  const res = await fetch(`${API_BASE}/aigc/chat/v2/askai/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream,application/json",
      source: "web",
      lang,
      vToken: finalVToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });

  const reply = await readSseText(res);
  return { reply, model: finalModel, conversationId: finalConversationId, vToken: finalVToken };
}

module.exports = {
  API_BASE,
  MODELS,
  FREE_MODELS,
  PRO_MODELS,
  createVisitorToken,
  createConversation,
  chat,
  decodeStreamText,
};
