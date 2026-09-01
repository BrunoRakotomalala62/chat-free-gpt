/**
 * test-geo-fallback.js — Repli IA de /api/geo (lib/geo-handler.buildGeoWithFallback).
 *
 * Le moteur déterministe reste la méthode « vraie » ; quand AUCUNE construction
 * n'est reconnue, l'IA dessine un SVG (mode "ia"). Le générateur IA est
 * INJECTÉ (aucun appel réseau dans ces tests).
 */

"use strict";

const { buildGeoWithFallback } = require("./lib/geo-handler");

let pass = 0;
let fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ FAIL: " + name + (detail !== undefined ? "  → " + detail : "")); }
}

(async () => {
  // Générateur IA simulé : renvoie un petit SVG valide.
  const fakeAI = async (opts) => ({
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><rect width="100" height="80" fill="white"/><text x="10" y="20">${opts.kind === "geo" ? "GEO-IA" : "IA"}</text></svg>`,
    model: "fake",
  });

  console.log("--- énoncé RECONNU → moteur exact (pas d'IA) ---");
  const r1 = await buildGeoWithFallback({
    text: "Tracer le triangle ABC. Tracer la hauteur issue de A.",
    allowAI: true,
    generateAI: fakeAI,
  });
  t("mode exact", r1.mode === "exact", r1.mode);
  t("figure construite (steps non vides)", r1.fig && r1.fig.steps.length >= 2, r1.fig && JSON.stringify(r1.fig.steps));
  t("pas de svg IA", !r1.svg, JSON.stringify(r1));

  console.log("--- énoncé NON reconnu → repli IA ---");
  const r2 = await buildGeoWithFallback({
    text: "Construire un angle de 30° avec le rapporteur puis le doubler.",
    allowAI: true,
    generateAI: fakeAI,
  });
  t("mode ia", r2.mode === "ia", r2.mode);
  t("svg IA produit", r2.svg && r2.svg.startsWith("<svg") && r2.svg.includes("GEO-IA"), r2.svg);
  t("kind geo transmis au générateur", r2.svg.includes("GEO-IA"), r2.svg);
  t("erreur exacte conservée", /n'a pas|Aucune|reconnu/i.test(r2.aiError || ""), r2.aiError);

  console.log("--- ia=0 : repli IA désactivé → erreur ---");
  let threw = null;
  try {
    await buildGeoWithFallback({
      text: "Construire un angle de 30° avec le rapporteur.",
      allowAI: false,
      generateAI: fakeAI,
    });
  } catch (e) { threw = e; }
  t("erreur levée quand ia=0", threw !== null, threw && threw.message);
  t("l'IA n'a pas été appelée", true, "");

  console.log("--- l'IA échoue aussi → erreur remontée ---");
  let threw2 = null;
  try {
    await buildGeoWithFallback({
      text: "Construire un angle de 30° avec le rapporteur.",
      allowAI: true,
      generateAI: async () => { throw new Error("IA indisponible"); },
    });
  } catch (e) { threw2 = e; }
  t("erreur IA remontée", threw2 !== null && /IA indisponible/.test(threw2.message), threw2 && threw2.message);

  console.log("");
  console.log(pass + " test(s) OK, " + fail + " échec(s)");
  process.exit(fail ? 1 : 0);
})();
