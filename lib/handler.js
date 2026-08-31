/**
 * handler.js — Logique HTTP commune de l'API /api/chat.
 *
 * Utilisée par les deux points d'entrée pour ne pas dupliquer le code :
 *   - api/chat.js   → fonction serverless Vercel
 *   - server.js     → serveur local de test (npm start)
 *
 * Endpoints :
 *   GET  /api/chat?prompt=…&model=…&uid=…&lang=…&image=url1&image=url2
 *   POST /api/chat   (Content-Type: application/json)
 *        { "prompt": "…", "model": "…", "uid": "…", "lang": "fr",
 *          "images": ["data:image/jpeg;base64,…", "https://…"] }
 *
 * Le POST lève la limite de longueur d'URL (Vercel renvoie 414 au-delà de
 * ~34 Ko de base64 en GET) : c'est le mode recommandé pour la vision.
 */

"use strict";

const { chatReliable, FREE_MODELS } = require("./aichatting");

const MAX_BODY_BYTES = 4.5 * 1024 * 1024; // limite Vercel (corps de requête)
const MAX_IMAGES = 4;
const MAX_IMAGE_LEN = 3 * 1024 * 1024; // par data-URI (≈ 2,2 Mo binaire)

function json(res, status, payload, cors) {
  res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/** Lit le corps JSON d'une requête (compatible serverless Vercel + node http). */
function collectBody(req) {
  return new Promise((resolve, reject) => {
    // Certains runtimes (Next.js / @vercel/node) fournissent req.body déjà parsé.
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Corps de requête trop volumineux (> 4,5 Mo)."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Corps JSON invalide."));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Point d'entrée unique : gère CORS, GET et POST, puis appelle le backend.
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
async function handleChatRequest(req, res) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  let query = null;
  let body = null;

  if (req.method === "GET") {
    query = new URL(req.url, "http://localhost").searchParams;
  } else if (req.method === "POST") {
    body = await collectBody(req);
  } else {
    json(res, 405, { success: false, error: "Méthode non autorisée (utilisez GET ou POST)." }, cors);
    return;
  }

  const get = (name) => (query ? query.get(name) : body && body[name]);

  const prompt = get("prompt");
  const model = get("model");
  const uid = get("uid");
  const lang = get("lang");

  let images = [];
  if (query) {
    images = query.getAll("image");
  } else if (body && typeof body === "object") {
    if (Array.isArray(body.images)) images = body.images;
    else if (Array.isArray(body.image)) images = body.image;
    else if (typeof body.image === "string") images = [body.image];
  }
  images = images
    .filter((i) => i && typeof i === "string" && i.trim())
    .slice(0, MAX_IMAGES)
    .map((i) => i.trim().slice(0, MAX_IMAGE_LEN));

  if ((!prompt || !String(prompt).trim()) && images.length === 0) {
    json(
      res,
      400,
      {
        success: false,
        error: "Le paramètre 'prompt' est obligatoire (ou fournissez 'images' / 'image').",
        usage: "GET /api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123",
        usage_vision: "POST /api/chat  { prompt: 'décris cette photo', images: ['data:image/jpeg;base64,…'] }",
        models_disponibles: FREE_MODELS,
      },
      cors
    );
    return;
  }

  try {
    const result = await chatReliable({
      prompt: prompt ? String(prompt).slice(0, 4000) : "",
      images,
      model: model ? String(model) : undefined,
      lang: lang ? String(lang) : "fr",
    });

    const isProOnly = /pro premium member/i.test(result.reply);

    json(
      res,
      isProOnly ? 402 : 200,
      {
        success: !isProOnly,
        reply: result.reply,
        model: result.model,
        uid: uid !== undefined ? String(uid) : null,
        images: images.length ? images : undefined,
        conversationId: result.conversationId,
        source: "https://www.aichatting.net/fr/free-chatgpt/",
        ...(isProOnly
          ? {
              error:
                "Ce modèle nécessite un compte PRO (aichatting.net). Essayez un modèle gratuit : gpt-5.6-luna, gpt-5, gpt-4o-mini, deepseek-chat, o3-mini, …",
            }
          : {}),
      },
      cors
    );
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    const isQuota = /quota/i.test(message);
    json(
      res,
      isQuota ? 429 : 502,
      {
        success: false,
        error: message,
        hint: isQuota
          ? "Quota gratuit épuisé pour ce visiteur — réessayez (nouveau visiteur généré automatiquement)."
          : "Le backend aichatting a renvoyé une erreur.",
      },
      cors
    );
  }
}

module.exports = { handleChatRequest, collectBody };
