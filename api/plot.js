/**
 * GET  /api/plot?expression=x-2ln(x)&xmin=0.1&xmax=10&width=800&height=600
 * GET  /api/plot?expression=sin(x)&format=svg            → figure brute image/svg+xml
 * GET  /api/plot?subject=effet+photo%C3%A9lectrique      → figure dynamique générée par IA
 * POST /api/plot  { "expression": "x - 2*ln(x)", "xmin": 0.1, "xmax": 10 }
 * POST /api/plot  { "subject": "circuit électrique avec lampe et interrupteur", "model": "gpt-5.6-luna" }
 * Alias : /api/figure
 *
 * Route Vercel (serverless) : construit la figure d'une fonction (courbe SVG)
 * ou d'un sujet libre (figure par IA) et la renvoie en JSON (champ `svg`) —
 * ou en SVG brut / points selon `format`. N'affecte pas la logique de /api/chat.
 */

"use strict";

const { handlePlotRequest } = require("../lib/plot-handler");

exports.maxDuration = 60; // Vercel : le tracé est quasi instantané, l'IA peut prendre ~10-30 s

module.exports = async function handler(req, res) {
  try {
    await handlePlotRequest(req, res);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ success: false, error: message }));
  }
};
