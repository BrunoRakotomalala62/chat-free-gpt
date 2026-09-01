/**
 * test-geo-fallback.js — Repli IA + VÉRIFICATION IA de /api/geo
 * (lib/geo-handler.buildGeoWithFallback).
 *
 * Le moteur déterministe reste la méthode « vraie » ; l'IA vérifie ensuite
 * que la figure couvre tout l'énoncé, et si des éléments manquent, elle
 * REFERA la figure complète (mode "ia"). Vérificateur ET générateur IA sont
 * INJECTÉS (aucun appel réseau dans ces tests).
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><rect width="100" height="80" fill="white"/><text x="10" y="20">${opts.kind === "geo" ? "GEO-IA" : "IA"}</text><text x="10" y="40">${opts.budgetMs || ""}</text></svg>`,
    model: "fake",
  });
  const fakeVerifier = (v) => async (opts) => v;

  console.log("--- énoncé RECONNU + vérif OK → figure exacte ---");
  const r1 = await buildGeoWithFallback({
    text: "Tracer le triangle ABC. Tracer la hauteur issue de A.",
    allowAI: true,
    verify: true,
    generateAI: fakeAI,
    verifier: fakeVerifier({ complet: true, manquant: [], note: "tout est construit", model: "fake" }),
  });
  t("mode exact", r1.mode === "exact", r1.mode);
  t("figure construite (steps non vides)", r1.fig && r1.fig.steps.length >= 2, r1.fig && JSON.stringify(r1.fig.steps));
  t("verification.complet = true", r1.verification && r1.verification.complet === true, JSON.stringify(r1.verification));
  t("pas de svg IA", !r1.svg, JSON.stringify(r1));

  console.log("--- énoncé RECONNU mais INCOMPLET → l'IA refait/complète la figure ---");
  const manquant = ["triangle ABC avec dimensions AB=4, AC=5, BC=6 non respectées"];
  const r2 = await buildGeoWithFallback({
    text: "Tracer le triangle ABC tel que AB = 4 cm, AC = 5 cm, BC = 6 cm.",
    allowAI: true,
    verify: true,
    generateAI: fakeAI,
    verifier: fakeVerifier({ complet: false, manquant, note: "dimensions absentes", model: "fake" }),
  });
  t("mode ia (complété)", r2.mode === "ia", r2.mode);
  t("svg IA produit", r2.svg && r2.svg.startsWith("<svg") && r2.svg.includes("GEO-IA"), r2.svg);
  t("kind geo transmis au générateur", r2.svg.includes("GEO-IA"), r2.svg);
  t("verification.complet = false", r2.verification && r2.verification.complet === false, JSON.stringify(r2.verification));
  t("manquant transmis", r2.verification && r2.verification.manquant[0] === manquant[0], JSON.stringify(r2.verification));

  console.log("--- vérification indisponible → on garde la figure exacte (jamais bloquant) ---");
  const r3 = await buildGeoWithFallback({
    text: "Tracer le triangle ABC.",
    allowAI: true,
    verify: true,
    generateAI: fakeAI,
    verifier: async () => { throw new Error("IA injoignable"); },
  });
  t("mode exact conservé", r3.mode === "exact", r3.mode);
  t("pas de régénération IA", !r3.svg, JSON.stringify(r3));

  console.log("--- verif=0 : pas d'appel au vérificateur ---");
  let verifierCalled = 0;
  await buildGeoWithFallback({
    text: "Tracer le triangle ABC.",
    allowAI: true,
    verify: false,
    generateAI: fakeAI,
    verifier: async () => { verifierCalled++; return { complet: false, manquant: ["x"], note: "" }; },
  });
  t("vérificateur non appelé", verifierCalled === 0, String(verifierCalled));

  console.log("--- énoncé NON reconnu → repli IA (sans vérification) ---");
  const r4 = await buildGeoWithFallback({
    text: "Construire un angle de 30° avec le rapporteur puis le doubler.",
    allowAI: true,
    verify: true,
    generateAI: fakeAI,
    verifier: async () => { throw new Error("ne doit pas être appelé"); },
  });
  t("mode ia", r4.mode === "ia", r4.mode);
  t("pas de verification (repli pur)", !r4.verification, JSON.stringify(r4.verification));

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
