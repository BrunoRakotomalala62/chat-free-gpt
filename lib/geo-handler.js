/**
 * lib/geo-handler.js — Logique HTTP de la route /api/geo.
 *
 * Construit UNE figure géométrique exacte (SVG) à partir d'un énoncé
 * d'exercice (plusieurs questions successives), par un moteur DÉTERMINISTE
 * (lib/geometry.js) — aucune hallucination IA, constructions calculées.
 *
 *   GET  /api/geo?text=Soit+A+et+B+deux+points.+1)+Tracer+(AB).+2)+Placer+un+point+P+sur+(AB)...
 *   POST /api/geo  { "text": "Tracer le triangle ABC. Tracer la hauteur issue de A." }
 *
 * Réponse : { success, svg, steps, points, lines, circles, interpreted }
 */

"use strict";

const { buildGeoFigure } = require("./geometry");
const { collectBody } = require("./handler");

const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

function json(res, status, payload, cors) {
  res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function handleGeoRequest(req, res) {
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
  const text = String(get("text") || get("enonce") || get("statement") || "").trim();
  if (!text) {
    json(
      res,
      400,
      {
        success: false,
        error: "Le paramètre 'text' (énoncé de l'exercice de géométrie) est obligatoire.",
        usage: "GET /api/geo?text=Soit%20A%20et%20B%20deux%20points.%201)%20Tracer%20(AB).%202)%20Placer%20un%20point%20P%20sur%20(AB).%203)%20Tracer%20la%20droite%20passant%20par%20P%20perpendiculaire%20à%20(AB).",
        exemple: "GET /api/geo?text=Tracer%20le%20triangle%20ABC%2C%20puis%20la%20hauteur%20issue%20de%20A.",
      },
      cors
    );
    return;
  }

  try {
    const fig = buildGeoFigure({
      text,
      width: Number(get("width")),
      height: Number(get("height")),
      title: get("title"),
    });
    json(
      res,
      200,
      {
        success: true,
        svg: fig.svg,
        steps: fig.steps.map((s) => ({ raw: s.raw, kind: s.kind, label: s.label })),
        interpreted: fig.interpreted,
        points: fig.points,
        lines: fig.lines,
        circles: fig.circles,
        affichage: "Figure géométrique exacte (constructions calculées, questions successives cumulées dans une seule figure).",
      },
      cors
    );
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    json(res, 400, { success: false, error: message }, cors);
  }
}

module.exports = { handleGeoRequest };
