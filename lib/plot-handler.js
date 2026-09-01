/**
 * lib/plot-handler.js — Logique HTTP de la route /api/plot (et /api/figure).
 *
 * Même architecture que lib/handler.js (réutilise collectBody) — deux modes :
 *
 * 1) Courbes mathématiques (déterministe, hors-ligne) :
 *      GET  /api/plot?expression=x-2ln(x)&xmin=0&xmax=10&width=800&height=600&format=json
 *      POST /api/plot  { "expression": "x - 2*ln(x)", "xmin": 0.1, "xmax": 10 }
 *
 * 2) Figures dynamiques par IA (n'importe quel sujet — physique, chimie, circuits…) :
 *      GET  /api/plot?subject=mise+en+%C3%A9vidence+de+l%27effet+photo%C3%A9lectrique
 *      GET  /api/plot?subject=circuit+%C3%A9lectrique+avec+lampe+et+interrupteur&model=gpt-5
 *      POST /api/plot  { "subject": "appareil de distillation en chimie" }
 *
 * Formats de sortie (paramètre `format`) :
 *   - json   (défaut) : { success, svg, … }
 *   - svg              : la figure brute en image/svg+xml
 *   - points           : courbes uniquement (mode 1) — { points: [[x, y], …] }
 *
 * Paramètres :
 *   expression (ou expr / f) : fonction à tracer (mode 1)
 *   subject (ou figure / description / topic) : sujet de la figure (mode 2)
 *   model                    : modèle IA pour le mode 2 (défaut gpt-5.6-luna)
 *   xmin, xmax, ymin, ymax   : domaine / échelle (mode 1, sinon automatique)
 *   width, height            : taille de la figure en pixels (défaut 800×600)
 *   samples                  : nombre de points (mode 1, défaut 800, max 4000)
 *   color                    : couleur (courbe #rrggbb en mode 1, teinte principale en mode 2)
 *   title                    : titre de la figure (mode 1)
 *   tangent                  : abscisse x0 du point de tangence (mode 1, optionnel)
 *
 * Analyse automatique (mode 1) : branches infinies / asymptotes verticales,
 * horizontales et obliques détectées et tracées en pointillés ; la tangente
 * n'est tracée que si `tangent` est fourni (rien sinon).
 */

"use strict";

const { buildFigure } = require("./plot");
const { buildFigureFromSubject } = require("./figures-ai");
const { collectBody } = require("./handler");

const MAX_BODY_BYTES = 4.5 * 1024 * 1024; // même limite que /api/chat

function json(res, status, payload, cors) {
  res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseNum(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Valeur numérique invalide : "${v}"`);
  return n;
}

/**
 * Point d'entrée unique : CORS, GET et POST, puis génération de la figure.
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
async function handlePlotRequest(req, res) {
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
  const expression = String(get("expression") || get("expr") || get("f") || "").trim();
  const subject = String(get("subject") || get("figure") || get("description") || get("topic") || "").trim();
  const line = String(get("line") || get("droite") || "").trim();
  const format = String(get("format") || "json").toLowerCase();

  if (!expression && !subject && !line) {
    json(
      res,
      400,
      {
        success: false,
        error: "Le paramètre 'expression' (courbe mathématique), 'subject' (figure par IA) ou 'line' (droite y=ax+b) est obligatoire.",
        usage_courbe: "GET /api/plot?expression=x-2ln(x)",
        usage_figure: "GET /api/plot?subject=mise+en+%C3%A9vidence+de+l%27effet+photo%C3%A9lectrique",
        usage_droite: "GET /api/plot?line=2x-3",
        exemple_courbe: "GET /api/plot?expression=sin(x)&xmin=-10&xmax=10&width=800&height=600",
        exemple_figure: "GET /api/plot?subject=circuit+%C3%A9lectrique+avec+lampe+et+interrupteur",
        exemple_droite: "GET /api/plot?expression=x^2-2x+1&line=2x-3&tangent=2",
        parametres: {
          expression: "fonction à tracer — ex. x - 2ln(x), sin(x), x^2, e^(-x), 1/(x^2+1)",
          subject: "sujet libre de la figure (IA) — ex. effet photoélectrique, circuit électrique, distillation",
          model: "modèle IA pour subject= (défaut : gpt-5.6-luna)",
          xmin_xmax: "domaine (défaut : détection automatique)",
          ymin_ymax: "échelle verticale (défaut : automatique)",
          width_height: "taille en pixels (défaut 800×600)",
          samples: "nombre de points (défaut 800, max 4000)",
          color: "couleur #rrggbb (courbe en mode expression, teinte principale en mode subject)",
          title: "titre de la figure (mode expression)",
          tangent: "abscisse x0 du point de tangence (mode expression, optionnel) — trace la tangente en ce point",
          line: "droite donnée directement par l'exercice (mode expression, optionnel) — ex. '2x-3' ou 'y=2x-3' ; tracée en vert, avec la courbe ou seule",
          format: "json (défaut) | svg | points (courbes uniquement)",
        },
        fonctions: [
          "ln, log (base 10), log10, log2, exp, sqrt, cbrt, abs, sign, floor, ceil, round",
          "sin, cos, tan, asin, acos, atan, atan2(y,x), sinh, cosh, tanh, asinh, acosh, atanh",
          "min(...), max(...) — constantes : pi, e — multiplication implicite : 2x, 2ln(x)",
        ],
      },
      cors
    );
    return;
  }

  try {
    // ---- Mode 2 : figure dynamique par IA (subject=) ----
    if (subject && !expression) {
      if (format === "points") {
        json(
          res,
          400,
          {
            success: false,
            error: "format=points n'existe que pour les courbes mathématiques (expression=). Utilisez format=json ou format=svg.",
          },
          cors
        );
        return;
      }
      const fig = await buildFigureFromSubject({
        subject,
        width: parseNum(get("width")),
        height: parseNum(get("height")),
        model: get("model"),
        color: get("color"),
      }).catch((err) => {
        const message = String(err && err.message ? err.message : err);
        json(
          res,
          502,
          {
            success: false,
            error: message,
            hint: "Le générateur IA (backend aichatting) est instable — réessayez dans quelques secondes.",
          },
          cors
        );
        return null;
      });
      if (!fig) return;
      if (format === "svg") {
        res.writeHead(200, {
          ...cors,
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(fig.svg);
        return;
      }
      json(
        res,
        200,
        {
          success: true,
          subject: fig.subject || subject,
          svg: fig.svg,
          model: fig.model,
          attempts: fig.attempts,
          generated: "ai",
          affichage: "Figure générée par IA — le SVG est dans le champ 'svg' (à injecter dans le DOM ou à convertir en PNG).",
        },
        cors
      );
      return;
    }

    // ---- Mode 1 : courbe mathématique (expression=) ----
    const options = {
      expression,
      xmin: parseNum(get("xmin")),
      xmax: parseNum(get("xmax")),
      ymin: parseNum(get("ymin")),
      ymax: parseNum(get("ymax")),
      width: parseNum(get("width")),
      height: parseNum(get("height")),
      samples: parseNum(get("samples")),
      color: get("color"),
      title: get("title"),
      tangent: parseNum(get("tangent")), // abscisse du point de tangence (optionnel)
      line: get("line") || get("droite"), // droite y=ax+b donnée directement (optionnel)
    };

    const fig = buildFigure(options);

    if (format === "svg") {
      res.writeHead(200, {
        ...cors,
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(fig.svg);
      return;
    }

    if (format === "points") {
      json(
        res,
        200,
        {
          success: true,
          expression: fig.expression,
          points: fig.points,
          domain: fig.domain,
          range: fig.range,
          size: fig.size,
        },
        cors
      );
      return;
    }

    json(
      res,
      200,
      {
        success: true,
        expression: fig.expression,
        svg: fig.svg,
        points: fig.points,
        domain: fig.domain,
        range: fig.range,
        size: fig.size,
        samples: fig.samples,
        asymptotes: fig.asymptotes,
        branches: fig.branches,
        tangente: fig.tangente,
        droite: fig.droite,
        affichage: "La figure est dans le champ 'svg' (à injecter dans le DOM ou à convertir en PNG). Les asymptotes et branches infinies sont détectées automatiquement ; la tangente n'est tracée que si le paramètre 'tangent' est fourni ; une droite y=ax+b donnée directement se trace avec 'line'.",
      },
      cors
    );
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    json(res, 400, { success: false, error: message }, cors);
  }
}

module.exports = { handlePlotRequest };
