/**
 * GET  /api/geo?text=Soit+A+et+B+deux+points.+1)+Tracer+(AB)...
 * POST /api/geo  { "text": "Tracer le triangle ABC. Tracer la hauteur issue de A." }
 *
 * Route Vercel (serverless) : construit UNE figure géométrique exacte (SVG)
 * à partir d'un énoncé d'exercice avec questions successives (moteur
 * déterministe lib/geometry.js — constructions calculées, pas d'IA).
 */

"use strict";

const { handleGeoRequest } = require("../lib/geo-handler");

exports.maxDuration = 60; // Vercel : tracé exact instantané, repli IA jusqu'à ~50 s

module.exports = async function handler(req, res) {
  try {
    await handleGeoRequest(req, res);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ success: false, error: message }));
  }
};
