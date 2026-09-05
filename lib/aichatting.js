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

/**
 * Modèles gratuits réellement fonctionnels.
 *
 * ⚠️ Résultat des tests du 2026-09-05 (question « qui es-tu ? » posée à
 * chaque nom via l'API déployée) : le backend aichatting n'expose qu'UN
 * seul moteur gratuit — le modèle officiel `gpt-5.6-luna`, qui s'identifie
 * comme ChatGPT (OpenAI). TOUS les autres noms autrefois listés ici
 * (gpt-5, gpt-4o-mini, claude-*, gemini-*, deepseek-*, llama, grok, qwen,
 * mixtral…) répondaient eux aussi « ChatGPT / créé par OpenAI » : ce sont
 * des alias que le backend accepte mais qui retombent silencieusement sur
 * le même moteur par défaut. Ils ne font PAS tourner le modèle annoncé →
 * supprimés de la liste (comportement mensonger).
 */
const FREE_MODELS = ["gpt-5.6-luna"];

// Modèles qui répondent « réservé aux membres PRO » (vérifié : HTTP 402
// avec le message du backend). Ce sont de vrais modèles, mais payants.
const PRO_MODELS = ["gpt-5.6-terra", "gpt-4o"];

/** Vrai si le nom demandé correspond à un modèle réellement supporté. */
function isSupportedModel(name) {
  return FREE_MODELS.includes(name) || PRO_MODELS.includes(name);
}

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
 * Convertit une URL (ou un data-URI déjà encodé) en data-URI base64.
 * Le backend aichatting rejette les URL brutes (filtre de modération) :
 * il n'accepte que les images en base64, comme le fait le frontend du site
 * (compression + readAsDataURL).
 *
 * Améliorations vs v1 :
 *   - en-têtes navigateur (certains hôtes refusent les clients sans UA)
 *   - 1 nouvelle tentative en cas d'échec de téléchargement (hôtes instables)
 *   - timeout porté à 30 s par tentative
 * @param {string} urlOrDataUri
 * @returns {Promise<string>} data URI (ex. data:image/jpeg;base64,...)
 */
async function toDataUri(urlOrDataUri) {
  if (/^data:image\//i.test(urlOrDataUri)) return urlOrDataUri;

  const attempts = 2;
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(urlOrDataUri, {
        signal: AbortSignal.timeout(30000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
      if (!res.ok) {
        throw new Error(
          `Impossible de télécharger l'image (HTTP ${res.status}) : ${urlOrDataUri.slice(0, 100)}`
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 5 * 1024 * 1024) {
        throw new Error("Image trop lourde (> 5 Mo) — compressez-la ou réduisez sa taille.");
      }
      const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch (err) {
      lastErr = err;
      if (!/télécharger|trop lourde/i.test(String(err.message))) {
        // erreur réseau/timeout : on réessaie une fois (hôte instable)
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      throw err; // erreur définitive (HTTP refusé, image trop lourde…)
    }
  }
  throw lastErr;
}

/**
 * Détecte le rejet de modération du backend gratuit aichatting
 * (il refuse parfois une image avec un message anglais générique).
 * @param {string} text
 * @returns {boolean}
 */
function isModerationReply(text) {
  return (
    typeof text === "string" &&
    /sorry|risk level|rephrase|inappropriate|modération|contenu.*risque|immodest/i.test(text)
  );
}

/**
 * Chat « fiable » : comme `chat()`, mais avec une nouvelle tentative
 * automatique quand le backend gratuit rejette l'image (filtre de
 * modération) ou renvoie une réponse vide. Chaque tentative utilise un
 * visiteur/conversation neufs (le quota gratuit est par visiteur).
 *
 * @param {object} opts - mêmes options que `chat()`
 * @returns {Promise<{reply: string, model: string, conversationId: number, vToken: string}>}
 */
async function chatReliable(opts) {
  const hasImages = !!opts.images && (Array.isArray(opts.images) ? opts.images.length : 1) > 0;
  const result = await chat(opts);
  if (!hasImages) return result;
  if (result.reply && result.reply.trim() && !isModerationReply(result.reply)) {
    return result; // réponse valide → terminé
  }
  // 1 nouvelle tentative avec un visiteur neuf (quota neuf)
  const retry = await chat({ ...opts, conversationId: undefined, vToken: undefined });
  if (retry.reply && retry.reply.trim() && !isModerationReply(retry.reply)) return retry;
  return result; // toujours rejeté → on renvoie la 1re réponse (le client affiche l'erreur)
}

/**
 * Envoie un prompt (avec optionnellement des images) au modèle demandé.
 *
 * @param {object} opts
 * @param {string} opts.prompt      - message utilisateur
 * @param {string|string[]} [opts.images] - URL(s) ou data-URI(s) d'images (vision)
 * @param {string} [opts.model]     - nom du modèle (défaut: gpt-5.6-luna)
 * @param {number} [opts.conversationId] - conversation existante
 * @param {string} [opts.vToken]    - jeton visiteur (sinon généré)
 * @param {string} [opts.lang]      - langue (header `lang`)
 * @param {string} [opts.visitorId] - visitorId fixe pour dériver le vToken
 * @returns {Promise<{reply: string, raw?: string, model: string, conversationId: number, vToken: string}>}
 */
async function chat({ prompt, images, model, conversationId, vToken, lang = "fr", visitorId }) {
  const finalModel = model || MODELS.LUNA;
  const finalVToken = vToken || createVisitorToken(visitorId);
  const finalConversationId =
    conversationId || (await createConversation(finalVToken, lang));

  const parts = [{ type: "text", text: prompt || "" }];
  if (images) {
    const list = Array.isArray(images) ? images : [images];
    for (const img of list) {
      const uri = await toDataUri(String(img));
      parts.push({ type: "image_url", image_url: { url: uri } });
    }
  }

  const body = {
    spaceHandle: true,
    roleId: 0,
    messages: [{ role: "user", content: parts }],
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
    signal: AbortSignal.timeout(100000),
  });

  const reply = await readSseText(res);
  return { reply, model: finalModel, conversationId: finalConversationId, vToken: finalVToken };
}

module.exports = {
  API_BASE,
  MODELS,
  FREE_MODELS,
  PRO_MODELS,
  isSupportedModel,
  createVisitorToken,
  createConversation,
  chat,
  chatReliable,
  isModerationReply,
  decodeStreamText,
  toDataUri,
};
