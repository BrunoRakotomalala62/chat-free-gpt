/**
 * Serveur local de test (aucune dépendance) — même logique que la route Vercel.
 *
 *   node server.js
 *   curl "http://localhost:3000/api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123"
 *   curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" \
 *        -d '{"prompt":"décris cette photo","images":["data:image/jpeg;base64,…"]}'
 */

"use strict";

const http = require("http");
const { handleChatRequest } = require("./lib/handler");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  handleChatRequest(req, res).catch((err) => {
    const message = String(err && err.message ? err.message : err);
    try {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, error: message }));
    } catch (e) {
      /* socket déjà fermé */
    }
  });
});

server.listen(PORT, () => {
  console.log(`API prête : http://localhost:${PORT}/api/chat`);
  console.log(`GET  : http://localhost:${PORT}/api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123`);
  console.log(`POST : http://localhost:${PORT}/api/chat  (JSON { prompt, model, images })`);
});
