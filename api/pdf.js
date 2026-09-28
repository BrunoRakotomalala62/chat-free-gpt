/**
 * GET  /api/pdf?url=https://…/doc.pdf&prompt=Quel%20est%20le%20budget%20%3F
 * POST /api/pdf  { "pdf": "data:application/pdf;base64,…", "prompt": "…" }
 * POST /api/pdf  { "url": "https://…/doc.pdf", "prompt": "…" }
 *
 * Route Vercel (serverless) : extrait le texte d'un PDF et répond à une
 * question via le backend existant (lib/pdf-handler.js). N'affecte pas la
 * logique de /api/chat.
 */

"use strict";

const { handlePdfRequest } = require("../lib/pdf-handler");

exports.maxDuration = 60; // Vercel : extraction + appel IA jusqu'à ~60 s

module.exports = async function handler(req, res) {
  try {
    await handlePdfRequest(req, res);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ success: false, error: message }));
  }
};
