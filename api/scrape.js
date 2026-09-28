/**
 * GET  /api/scrape?url=https://exemple.com&prompt=Résume%20cette%20page
 * POST /api/scrape  { "url": "https://exemple.com", "prompt": "…" }
 *
 * Route Vercel (serverless) : extrait le texte d'une page web (sans
 * dépendance) et répond optionnellement à une question via le backend
 * existant (lib/scrape-handler.js). N'affecte pas la logique de /api/chat.
 */

"use strict";

const { handleScrapeRequest } = require("../lib/scrape-handler");

exports.maxDuration = 60;

module.exports = async function handler(req, res) {
  try {
    await handleScrapeRequest(req, res);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ success: false, error: message }));
  }
};
