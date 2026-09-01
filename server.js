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
const { handlePlotRequest } = require("./lib/plot-handler"); // route /api/plot (figures)

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Route figures — logique du chat inchangée ci-dessous.
  const pathname = (req.url || "/").split("?")[0];
  if (pathname === "/api/plot" || pathname === "/api/figure") {
    handlePlotRequest(req, res).catch((err) => {
      const message = String(err && err.message ? err.message : err);
      try {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: message }));
      } catch (e) {
        /* socket déjà fermé */
      }
    });
    return;
  }

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
  console.log(`Figures : GET http://localhost:${PORT}/api/plot?expression=x-2ln(x)`);
});
