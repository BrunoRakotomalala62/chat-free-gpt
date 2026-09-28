/**
 * scrape-handler.js — Route /api/scrape : extraire le texte d'une page web,
 * puis (optionnellement) répondre à une question à partir de ce texte.
 *
 * Ajout additif : ne modifie AUCUNE logique existante. Réutilise par import :
 *   - lib/aichatting.js -> chatReliable()  (le même moteur que /api/chat)
 *   - lib/handler.js    -> collectBody()   (lecture du corps JSON)
 *
 * Endpoints :
 *   GET  /api/scrape?url=https://exemple.com                → texte extrait
 *   GET  /api/scrape?url=https://exemple.com&prompt=Résume  → réponse IA
 *   POST /api/scrape  { "url": "…", "prompt": "…" }
 *
 * L'extraction HTML→texte se fait SANS dépendance (regex). `fetch` ne voit pas
 * les sites rendus en JavaScript (SPA) : il faudrait un navigateur headless.
 */

"use strict";

const { chatReliable } = require("./aichatting"); // import seul
const { collectBody } = require("./handler");      // import seul

const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3 Mo de HTML téléchargé
const MAX_TEXT_CHARS = 12000;           // budget de texte injecté dans le prompt

function json(res, status, payload) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

/**
 * Garde-fou SSRF : refuse les hôtes internes / de métadonnées.
 * @param {string} url
 * @returns {boolean} true si l'URL doit être refusée
 */
function isForbiddenUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return true;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
  // IPv4 privées / loopback / link-local / métadonnées cloud
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // IPv6 loopback / lien-local / unique-local
  if (host === "::1" || /^fe80:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  return false;
}

/** Extraction de texte sans dépendance : retire script/style puis toutes les balises. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleScrapeRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });
    res.end();
    return;
  }

  const query = req.method === "GET" ? new URL(req.url, "http://localhost").searchParams : null;
  const body = req.method === "POST" ? await collectBody(req) : null;
  if (!query && !body) {
    json(res, 405, { success: false, error: "Méthode non autorisée (utilisez GET ou POST)." });
    return;
  }

  const url = (query && query.get("url")) || (body && body.url);
  const question = (query && query.get("prompt")) || (body && body.prompt);
  const model = (body && body.model) || (query && query.get("model")) || undefined;

  if (!url || !/^https?:\/\//i.test(url)) {
    json(res, 400, { success: false, error: "Paramètre 'url' (http/https) requis." });
    return;
  }
  if (isForbiddenUrl(url)) {
    json(res, 403, { success: false, error: "URL refusée (hôte interne ou non autorisé)." });
    return;
  }

  const r = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; chat-free-gpt/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!r.ok) {
    json(res, 502, { success: false, error: `Page inaccessible (HTTP ${r.status})` });
    return;
  }
  const html = (await r.text()).slice(0, MAX_HTML_BYTES);
  const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);

  if (!question) {
    json(res, 200, { success: true, url, chars: text.length, text });
    return;
  }

  const prompt =
    "Voici le texte extrait d'une page web. Réponds à la question en te fondant " +
    "UNIQUEMENT sur ce contenu.\n--- DÉBUT PAGE ---\n" +
    text +
    "\n--- FIN PAGE ---\nQuestion : " +
    question;

  const result = await chatReliable({ prompt: prompt.slice(0, 30000), model });
  json(res, 200, { success: true, url, reply: result.reply, model: result.model, chars: text.length });
}

module.exports = { handleScrapeRequest, htmlToText, isForbiddenUrl };
