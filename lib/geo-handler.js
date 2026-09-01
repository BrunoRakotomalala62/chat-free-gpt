/**
 * lib/geo-handler.js — Logique HTTP de la route /api/geo.
 *
 * Construit UNE figure géométrique (SVG) à partir d'un énoncé d'exercice
 * (plusieurs questions successives) :
 *   1) moteur DÉTERMINISTE (lib/geometry.js) — constructions CALCULÉES,
 *      aucune hallucination IA (méthode « vraie », exacte) ;
 *   2) repli IA (lib/figures-ai.js) si aucune construction n'est reconnue —
 *      le modèle dessine alors un SVG approximatif (mode "ia"), signalé
 *      honnêtement dans la réponse (affichage + mode).
 *
 *   GET  /api/geo?text=Soit+A+et+B+deux+points.+1)+Tracer+(AB).+2)+Placer+un+point+P+sur+(AB)...
 *   POST /api/geo  { "text": "Tracer le triangle ABC. Tracer la hauteur issue de A." }
 *   Paramètre optionnel : ia=0 pour désactiver le repli IA (mode exact uniquement).
 *
 * Réponse : { success, svg, mode: "exact"|"ia", steps, points, lines, circles, interpreted }
 */

"use strict";

const { buildGeoFigure } = require("./geometry");
const { buildFigureFromSubject } = require("./figures-ai");
const { collectBody } = require("./handler");

const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

function json(res, status, payload, cors) {
  res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/**
 * Construit la figure avec repli IA.
 * `generateAI` est injectable pour les tests (défaut : lib/figures-ai).
 * @returns {Promise<{mode: "exact"|"ia", svg: string, fig?: object}>}
 */
async function buildGeoWithFallback({ text, width, height, title, allowAI = true, generateAI }) {
  const genAI = generateAI || ((opts) => buildFigureFromSubject(opts));
  try {
    const fig = buildGeoFigure({ text, width, height, title });
    return { mode: "exact", fig };
  } catch (err) {
    if (!allowAI) throw err;
    const subject = `figure de géométrie : ${String(text).slice(0, 400)}`;
    const ai = await genAI({
      subject,
      kind: "geo",
      width: width || 760,
      height: height || 540,
    });
    return { mode: "ia", svg: ai.svg, aiError: String(err && err.message ? err.message : err) };
  }
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

  const allowAI = String(get("ia") ?? "1") !== "0";
  try {
    const { mode, fig, svg, aiError } = await buildGeoWithFallback({
      text,
      width: Number(get("width")),
      height: Number(get("height")),
      title: get("title"),
      allowAI,
    });
    if (mode === "exact") {
      json(
        res,
        200,
        {
          success: true,
          mode,
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
    } else {
      json(
        res,
        200,
        {
          success: true,
          mode,
          svg,
          steps: [],
          interpreted: false,
          affichage: `Figure générée par IA (approximative — le moteur exact n'a pas reconnu la construction : ${aiError}). Vérifiez la figure avec l'énoncé.`,
        },
        cors
      );
    }
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    json(res, 400, { success: false, error: message }, cors);
  }
}

module.exports = { handleGeoRequest, buildGeoWithFallback };
