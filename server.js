/**
 * Serveur local de test (aucune dépendance) — miroir de la route Vercel.
 *
 *   node server.js
 *   curl "http://localhost:3000/api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123"
 */

"use strict";

const http = require("http");
const url = require("url");
const { chat, FREE_MODELS } = require("./lib/aichatting");

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method !== "GET" || parsed.pathname !== "/api/chat") {
    res.writeHead(404, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Not found. Utilisez GET /api/chat" }));
    return;
  }

  const { prompt, model, uid, lang, image } = parsed.query;
  const images = image ? (Array.isArray(image) ? image : [image]) : [];

  if ((!prompt || !String(prompt).trim()) && images.length === 0) {
    res.writeHead(400, { ...cors, "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        error: "Le paramètre 'prompt' est obligatoire (ou fournissez 'image')",
        usage: "GET /api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123",
        usage_vision: "GET /api/chat?prompt=decris%20cette%20photo&image=https://exemple.com/photo.jpg",
        models_disponibles: FREE_MODELS,
      })
    );
    return;
  }

  try {
    const result = await chat({
      prompt: prompt ? String(prompt).slice(0, 4000) : "",
      images: images.slice(0, 4).map((i) => String(i).slice(0, 100000)),
      model: model ? String(model) : undefined,
      lang: lang ? String(lang) : "fr",
    });
    const isProOnly = /pro premium member/i.test(result.reply);
    res.writeHead(isProOnly ? 402 : 200, { ...cors, "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: !isProOnly,
        reply: result.reply,
        model: result.model,
        uid: uid !== undefined ? String(uid) : null,
        images: images.length ? images : undefined,
        conversationId: result.conversationId,
        ...(isProOnly
          ? { error: "Ce modèle nécessite un compte PRO (aichatting.net)." }
          : {}),
      })
    );
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    res.writeHead(/quota/i.test(message) ? 429 : 502, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: message }));
  }
});

server.listen(PORT, () => {
  console.log(`API prête : http://localhost:${PORT}/api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123`);
});
