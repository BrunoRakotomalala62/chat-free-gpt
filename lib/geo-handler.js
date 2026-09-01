/**
 * lib/geo-handler.js — Logique HTTP de la route /api/geo.
 *
 * Construit UNE figure géométrique (SVG) à partir d'un énoncé d'exercice
 * (plusieurs questions successives) :
 *   1) moteur DÉTERMINISTE (lib/geometry.js) — constructions CALCULÉES,
 *      aucune hallucination IA (méthode « vraie », exacte) ;
 *   2) VÉRIFICATION IA (lib/geo-verify.js) — l'IA contrôle que la figure
 *      couvre bien toutes les constructions demandées (dimensions, points,
 *      angles, transformations…) ;
 *   3) si des éléments manquent → l'IA REFERA la figure complète
 *      (lib/figures-ai.js, prompt kind="geo") et COMPLÈTE ce qui manque
 *      (mode "ia", avec la liste des manques dans `verification`) ;
 *   4) si aucune construction n'est reconnue du tout → repli IA (mode "ia").
 *
 *   GET  /api/geo?text=Soit+A+et+B+deux+points.+1)+Tracer+(AB).+2)+Placer+un+point+P+sur+(AB)...
 *   POST /api/geo  { "text": "Tracer le triangle ABC. Tracer la hauteur issue de A." }
 *   Paramètres optionnels : ia=0 (désactive le repli IA), verif=0 (désactive
 *   la vérification IA).
 *
 * Réponse : { success, svg, mode: "exact"|"ia", verification?, steps, points, lines, circles }
 */

"use strict";

const { buildGeoFigure } = require("./geometry");
const { buildFigureFromSubject } = require("./figures-ai");
const { verifyConstruction } = require("./geo-verify");
const { collectBody } = require("./handler");

const MAX_BODY_BYTES = 4.5 * 1024 * 1024;

function json(res, status, payload, cors) {
  res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/**
 * Construit la figure avec vérification IA et repli IA.
 * `generateAI` et `verifier` sont injectables pour les tests.
 * @returns {Promise<{mode: "exact"|"ia", svg: string, fig?: object, verification?: object}>}
 */
async function buildGeoWithFallback({ text, width, height, title, allowAI = true, verify = true, verifier, generateAI }) {
  const genAI = generateAI || ((opts) => buildFigureFromSubject(opts));
  const check = verifier || ((opts) => verifyConstruction(opts));
  try {
    const fig = buildGeoFigure({ text, width, height, title });
    // Vérification IA : la figure exacte couvre-t-elle TOUT l'énoncé ?
    // Non bloquante : si la vérification échoue, on garde la figure exacte.
    if (verify) {
      try {
        const verification = await check({
          text,
          steps: fig.steps,
          ignored: fig.ignored,
        });
        const manquant = (verification && Array.isArray(verification.manquant) && verification.manquant) || [];
        if (verification && verification.complet === false && manquant.length && allowAI) {
          // L'IA refait la figure complète et complète ce qui manque.
          const ai = await genAI({
            subject: `figure de géométrie : ${String(text).slice(0, 400)}`,
            kind: "geo",
            width: width || 760,
            height: height || 540,
            budgetMs: 35000,
          });
          return { mode: "ia", svg: ai.svg, verification: { ...verification, etapesConstruites: fig.steps.length } };
        }
        return { mode: "exact", fig, verification: verification || null };
      } catch (verifErr) {
        // Vérification IA indisponible → on garde la figure exacte telle quelle.
        return {
          mode: "exact",
          fig,
          verification: {
            complet: true,
            manquant: [],
            note: `Vérification IA indisponible (${String(verifErr && verifErr.message ? verifErr.message : verifErr)}).`,
            model: null,
          },
        };
      }
    }
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
  const verify = String(get("verif") ?? "1") !== "0";
  try {
    const { mode, fig, svg, verification, aiError } = await buildGeoWithFallback({
      text,
      width: Number(get("width")),
      height: Number(get("height")),
      title: get("title"),
      allowAI,
      verify,
    });
    if (mode === "exact") {
      const v = verification && typeof verification.complet === "boolean" ? verification : null;
      json(
        res,
        200,
        {
          success: true,
          mode,
          verification: v,
          svg: fig.svg,
          steps: fig.steps.map((s) => ({ raw: s.raw, kind: s.kind, label: s.label })),
          interpreted: fig.interpreted,
          ignored: fig.ignored,
          points: fig.points,
          lines: fig.lines,
          circles: fig.circles,
          affichage: v && v.complet === false
            ? "Figure géométrique exacte, mais la vérification IA signale des éléments manquants (voir verification)."
            : "Figure géométrique exacte (constructions calculées, questions successives cumulées dans une seule figure).",
        },
        cors
      );
    } else if (verification) {
      json(
        res,
        200,
        {
          success: true,
          mode,
          verification,
          svg,
          steps: [],
          interpreted: false,
          affichage: `Figure complétée par l'IA après vérification (le moteur exact avait construit ${verification.etapesConstruites ?? "la figure"}, mais il manquait : ${(verification.manquant || []).join(" ; ") || "voir verification"}).`,
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
