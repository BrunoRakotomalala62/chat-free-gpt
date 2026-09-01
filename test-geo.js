/**
 * Test du moteur géométrique (lib/geometry.js) — aucune dépendance.
 *   node test-geo.js
 */
"use strict";

const { buildGeoFigure } = require("./lib/geometry");

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; console.log("  \u2717 FAIL: " + name + (extra !== undefined ? "  → " + extra : "")); }
}
const geo = (text, extra = {}) => {
  try { return buildGeoFigure({ text, ...extra }); }
  catch (e) { return { error: String(e && e.message || e) }; }
};
const pts = (f) => (f.points || []).map((p) => p.name).sort().join("");
const lbls = (f) => (f.steps || []).map((s) => s.label).join(" | ");

console.log("--- Énoncé complet (questions successives en une figure) ---");
const f = geo("Soit A et B deux points. 1) Tracer la droite (AB). 2) Placer un point P sur (AB). 3) Tracer la droite passant par P perpendiculaire à (AB). 4) Tracer la droite passant par P parallèle à (AB).");
t("success", !f.error, f.error);
t("points A, B, P créés", pts(f) === "ABP", pts(f));
t("droite (AB) tracée", (f.lines || []).some((l) => l.name === "(AB)"), JSON.stringify(f.lines));
t("perpendiculaire (d) tracée", (f.steps || []).some((s) => s.kind === "perpendiculaire"), lbls(f));
t("parallèle tracée", (f.steps || []).some((s) => s.kind === "parallèle"), lbls(f));
t("P sur (AB) (milieu)", (() => {
  const p = (f.points || []).find((p2) => p2.name === "P");
  const a = (f.points || []).find((p2) => p2.name === "A");
  const b = (f.points || []).find((p2) => p2.name === "B");
  return p && Math.abs((p.x - (a.x + b.x) / 2)) < 1e-9 && Math.abs((p.y - (a.y + b.y) / 2)) < 1e-9;
})());
t("5 étapes interprétées (soit + 4 questions)", f.steps.length === 5, JSON.stringify(f.steps));
t("SVG : ligne, points, légende", f.svg.includes("<line") && f.svg.includes(">A<") && f.svg.includes(">P<") && f.svg.includes("1)"));
t("SVG : marque d'angle droit (perpendiculaire)", f.svg.includes('<path d="M'));

console.log("--- Triangle + hauteur + médiane + médiatrice + bissectrice ---");
const f2 = geo("Tracer le triangle ABC. Tracer la hauteur issue de A. Tracer la médiane issue de B. Tracer la médiatrice de [AB]. Tracer la bissectrice de l'angle ABC.");
t("success", !f2.error, f2.error);
t("triangle : 3 segments", (f2.lines || []).filter((l) => l.kind === "segment" && /[ABC]/.test(l.name)).length >= 3, JSON.stringify(f2.lines));
t("hauteur issue de A", (f2.steps || []).some((s) => s.kind === "hauteur"), lbls(f2));
t("médiane issue de B", (f2.steps || []).some((s) => s.kind === "médiane"), lbls(f2));
t("médiatrice de [AB]", (f2.steps || []).some((s) => s.kind === "médiatrice"), lbls(f2));
t("bissectrice", (f2.steps || []).some((s) => s.kind === "bissectrice"), lbls(f2));

console.log("--- Cercle ---");
const f3 = geo("Cercle de centre O passant par B.");
t("cercle passant par B", !f3.error && f3.circles.length === 1, JSON.stringify(f3.circles));
t("rayon = distance OB", (() => {
  const c = f3.circles[0];
  const o = f3.points.find((p) => p.name === "O");
  const b = f3.points.find((p) => p.name === "B");
  return c && Math.abs(c.radius - Math.hypot(o.x - b.x, o.y - b.y)) < 1e-6;
})());
const f3b = geo("Cercle de centre A et de rayon 3 cm.");
t("cercle de rayon 3", !f3b.error && Math.abs(f3b.circles[0].radius - 3) < 1e-9, JSON.stringify(f3b.circles));

console.log("--- Milieu + intersection ---");
const f4 = geo("Soit M le milieu de [AB]. Tracer la droite (AB). Tracer la droite (CD). Les droites (AB) et (CD) se coupent en N.");
t("milieu M", !f4.error && pts(f4).includes("M"), pts(f4));
t("M au milieu de A,B", (() => {
  const m = f4.points.find((p) => p.name === "M");
  const a = f4.points.find((p) => p.name === "A");
  const b = f4.points.find((p) => p.name === "B");
  return m && Math.abs(m.x - (a.x + b.x) / 2) < 1e-9 && Math.abs(m.y - (a.y + b.y) / 2) < 1e-9;
})());
t("intersection N", !f4.error && pts(f4).includes("N"), pts(f4));

console.log("--- Triangle rectangle ---");
const f5 = geo("Tracer le triangle ABC rectangle en A.");
t("success", !f5.error, f5.error);
t("marque d'angle droit en A", (f5.steps || []).some((s) => /rectangle en A/.test(s.label)), lbls(f5));
t("SVG contient la marque ∟", f5.svg.includes('<path d="M'));

console.log("--- Point sur cercle ---");
const f6 = geo("Cercle de centre O de rayon 3 cm. Placer un point A sur le cercle (O).");
t("success", !f6.error, f6.error);
t("A sur le cercle (distance = rayon)", (() => {
  const c = f6.circles[0];
  const a = f6.points.find((p) => p.name === "A");
  const o = f6.points.find((p) => p.name === "O");
  return c && a && Math.abs(Math.hypot(a.x - o.x, a.y - o.y) - c.radius) < 1e-6;
})());

console.log("--- Carré / quadrilatère ---");
const f7 = geo("Tracer le carré ABCD.");
t("carré : 4 sommets + 4 côtés", !f7.error && pts(f7) === "ABCD" && f7.lines.filter((l) => l.kind === "segment").length === 4, pts(f7));
t("carré : côtés égaux", (() => {
  const p = Object.fromEntries(f7.points.map((x) => [x.name, x]));
  const d = (a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
  return Math.abs(d("A", "B") - d("B", "C")) < 1e-9 && Math.abs(d("B", "C") - d("C", "D")) < 1e-9;
})());

console.log("--- Demi-droite + segment ---");
const f8 = geo("Tracer le segment [AB]. Tracer la demi-droite [BC).");
t("segment + demi-droite", !f8.error && f8.lines.some((l) => l.kind === "segment" && l.name === "[AB]") && f8.lines.some((l) => l.kind === "ray" && l.name === "[BC)"), JSON.stringify(f8.lines));

console.log("--- Robustesse ---");
const f9 = geo("Explique-moi la géométrie en général.");
t("texte non géométrique → erreur claire", !!f9.error && /Aucune construction/.test(f9.error), f9.error);
const f10 = geo("Tracer (AB).", { width: 600, height: 450 });
t("taille personnalisée", !f10.error && f10.svg.includes('width="600"'));
t("points auto sans 'soit'", pts(f10) === "AB", pts(f10));

console.log("--- questions numérotées dans un énoncé ---");
const f11 = geo("Exercice 1 : Soient A et B deux points. a) Tracer (AB). b) Placer un point P sur (AB). c) Tracer la droite passant par P perpendiculaire à (AB).");
t("success", !f11.error, f11.error);
t("4 étapes (soit + a + b + c)", f11.steps.length === 4, JSON.stringify(f11.steps));
t("perpendiculaire en P", (f11.steps || []).some((s) => s.kind === "perpendiculaire"), lbls(f11));

console.log("");
console.log(pass + " test(s) OK, " + fail + " échec(s)");
process.exit(fail ? 1 : 0);
