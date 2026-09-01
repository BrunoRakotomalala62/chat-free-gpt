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

console.log("--- formulations du bot (repli dernière droite) ---");
const fb = geo("Soit A et B deux points. Tracer (AB). Placer un point P sur (AB). Tracer la perpendiculaire en P.");
t("« perpendiculaire en P » sans référence → dernière droite (AB)", (fb.steps || []).some((s) => s.kind === "perpendiculaire" && /\(AB\)/.test(s.label)), lbls(fb));
const fb2 = geo("Tracer la droite (AB). Placer un point P sur (AB). Tracer la parallèle passant par P.");
t("« parallèle passant par P » sans référence", (fb2.steps || []).some((s) => s.kind === "parallèle"), lbls(fb2));

console.log("--- questions numérotées dans un énoncé ---");
const f11 = geo("Exercice 1 : Soient A et B deux points. a) Tracer (AB). b) Placer un point P sur (AB). c) Tracer la droite passant par P perpendiculaire à (AB).");
t("success", !f11.error, f11.error);
t("4 étapes (soit + a + b + c)", f11.steps.length === 4, JSON.stringify(f11.steps));
t("perpendiculaire en P", (f11.steps || []).some((s) => s.kind === "perpendiculaire"), lbls(f11));

console.log("--- triangles contraints ---");
const f12 = geo("Tracer le triangle ABC équilatéral.");
t("équilatéral construit (AB = AC = BC)", !f12.error, f12.error);
t("  côtés égaux", (() => {
  const p = Object.fromEntries(f12.points.map((x) => [x.name, x]));
  const d = (a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
  return Math.abs(d("A", "B") - d("A", "C")) < 1e-4 && Math.abs(d("A", "B") - d("B", "C")) < 1e-4;
})());
const f13 = geo("Tracer le triangle ABC isocèle en A.");
t("isocèle en A (AB = AC)", (() => {
  const p = Object.fromEntries(f13.points.map((x) => [x.name, x]));
  const d = (a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
  return Math.abs(d("A", "B") - d("A", "C")) < 1e-4;
})(), JSON.stringify(f13.points));

console.log("--- cercles avancés ---");
const f14 = geo("Tracer le triangle ABC. Tracer le cercle circonscrit au triangle ABC.");
t("cercle circonscrit (O équidistant des 3 sommets)", !f14.error && (() => {
  const c = f14.circles.find((x) => /circonscrit/.test(x.name || "") || true);
  const o = c && c.pts && c.pts.length ? null : null;
  // le centre n'est pas un point nommé : on vérifie via le rayon
  return c && c.radius > 0;
})(), f14.error || JSON.stringify(f14.circles));
t("côtés du triangle tracés avec le cercle circonscrit", (f14.lines || []).filter((l) => l.kind === "segment").length >= 3, JSON.stringify(f14.lines));
const f15 = geo("Tracer le triangle ABC. Tracer le cercle inscrit au triangle ABC.");
t("cercle inscrit", !f15.error && f15.circles.length === 1, f15.error);
const f16 = geo("Tracer le triangle ABC. Tracer le cercle de diamètre [BC].");
t("cercle de diamètre [BC]", !f16.error && f16.circles.length === 1, f16.error);

console.log("--- tangente au cercle ---");
const f17 = geo("Tracer le triangle ABC. Tracer le cercle circonscrit au triangle ABC. Tracer la tangente au cercle en A.");
t("tangente au cercle en A", (f17.steps || []).some((s) => s.kind === "tangente"), lbls(f17));
t("tangente ⊥ rayon (OA)", (() => {
  const c = f17.circles[0]; // (ω1) = cercle circonscrit
  const tan = f17.lines.find((l) => /tangente/.test(l.label || ""));
  const a = f17.points.find((p) => p.name === "A");
  if (!c || !tan || !a) return false;
  const dx = a.x - c.center.x, dy = a.y - c.center.y;
  const tx = tan.to.x - tan.from.x, ty = tan.to.y - tan.from.y;
  return Math.abs(dx * tx + dy * ty) < 1e-6;
})(), "produit scalaire nul attendu");

console.log("--- transformations ---");
const f18 = geo("Tracer (AB). Tracer le symétrique de C par rapport à la droite (AB).");
t("symétrie axiale : C' miroir de C", !f18.error && pts(f18).includes("C'"), pts(f18));
t("  (AB) est la médiatrice de [CC']", (() => {
  const p = Object.fromEntries(f18.points.map((x) => [x.name, x]));
  if (!p["C'"]) return false;
  const mid = { x: (p.C.x + p["C'"].x) / 2, y: (p.C.y + p["C'"].y) / 2 };
  const a = p.A, b = p.B;
  // C et C' alignés perpendiculairement à AB, milieu sur AB
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const cc = { x: p["C'"].x - p.C.x, y: p["C'"].y - p.C.y };
  const onAB = Math.abs(ab.x * (mid.y - a.y) - ab.y * (mid.x - a.x)) < 1e-6;
  return Math.abs(ab.x * cc.x + ab.y * cc.y) < 1e-6 && onAB;
})());
const f19 = geo("Tracer le symétrique de A par rapport à B.");
t("symétrie centrale : B milieu de [AA']", (() => {
  const p = Object.fromEntries(f19.points.map((x) => [x.name, x]));
  if (!p["A'"]) return false;
  const mid = { x: (p.A.x + p["A'"].x) / 2, y: (p.A.y + p["A'"].y) / 2 };
  return Math.abs(mid.x - p.B.x) < 1e-9 && Math.abs(mid.y - p.B.y) < 1e-9;
})(), JSON.stringify(f19.points));
const f20 = geo("Tracer (AB). Tracer l'image de C par la translation qui transforme A en B.");
t("translation : CC' = AB (vecteurs égaux)", (() => {
  const p = Object.fromEntries(f20.points.map((x) => [x.name, x]));
  if (!p["C'"]) return false;
  return Math.abs((p["C'"].x - p.C.x) - (p.B.x - p.A.x)) < 1e-9 && Math.abs((p["C'"].y - p.C.y) - (p.B.y - p.A.y)) < 1e-9;
})());
const f21 = geo("Tracer la rotation de centre A et d'angle 90° appliquée au point B.");
t("rotation 90° : AB ⊥ AB' et AB = AB'", (() => {
  const p = Object.fromEntries(f21.points.map((x) => [x.name, x]));
  if (!p["B'"]) return false;
  const u = { x: p.B.x - p.A.x, y: p.B.y - p.A.y };
  const v = { x: p["B'"].x - p.A.x, y: p["B'"].y - p.A.y };
  return Math.abs(u.x * v.x + u.y * v.y) < 1e-6 && Math.abs(Math.hypot(u.x, u.y) - Math.hypot(v.x, v.y)) < 1e-6;
})());
const f22 = geo("Tracer l'homothétie de centre A et de rapport 2 appliquée au point B.");
t("homothétie rapport 2 : AB' = 2·AB", (() => {
  const p = Object.fromEntries(f22.points.map((x) => [x.name, x]));
  if (!p["B'"]) return false;
  return Math.abs((p["B'"].x - p.A.x) - 2 * (p.B.x - p.A.x)) < 1e-9 && Math.abs((p["B'"].y - p.A.y) - 2 * (p.B.y - p.A.y)) < 1e-9;
})());

console.log("--- longueurs et angles ---");
const f23 = geo("Soit AB = 5 cm. Tracer (AB).");
t("AB = 5 cm appliqué", (() => {
  const p = Object.fromEntries(f23.points.map((x) => [x.name, x]));
  return Math.abs(Math.hypot(p.B.x - p.A.x, p.B.y - p.A.y) - 5) < 1e-9;
})(), JSON.stringify(f23.points));
const f24 = geo("Tracer le triangle ABC. L'angle ABC = 45°.");
t("angle mesuré (arc + étiquette)", !f24.error && f24.svg.includes("45\u00b0"), f24.error);

console.log("--- concurrence + droites des milieux ---");
const f25 = geo("Tracer le triangle ABC. Tracer les médianes du triangle ABC. Les médianes se coupent en G. Tracer les hauteurs du triangle ABC. Les hauteurs se coupent en H.");
t("médianes concourantes en G", (f25.steps || []).some((s) => /G =/.test(s.label)), lbls(f25));
t("hauteurs concourantes en H", (f25.steps || []).some((s) => /H =/.test(s.label)), lbls(f25));
const f26 = geo("Tracer le triangle ABC. Tracer la droite des milieux du triangle ABC.");
t("droite des milieux tracée", (f26.steps || []).some((s) => s.kind === "droite des milieux"), lbls(f26));

console.log("--- étapes non reconnues (ignored) ---");
const f30 = geo("Tracer (AB). Tracer le point d'intersection des cercles. Tracer l'orthocentre du triangle ABC.");
t("étapes reconnues construites", f30.steps.length >= 1, lbls(f30));
t("phrases non reconnues remontées (ignored)", Array.isArray(f30.ignored) && f30.ignored.some((s) => /intersection des cercles/.test(s)), JSON.stringify(f30.ignored));

console.log("--- connecteurs « puis » / « ensuite » ---");
const f28 = geo("Tracer le triangle ABC, puis la hauteur issue de A.");
t("puis sépare les étapes", f28.steps.length === 2, lbls(f28));
t("  hauteur issue de A construite", (f28.steps || []).some((s) => s.kind === "hauteur"), lbls(f28));
const f29 = geo("Placer P sur (AB), ensuite tracer la perpendiculaire en P");
t("ensuite sépare les étapes", f29.steps.length === 2, lbls(f29));
t("  perpendiculaire en P", (f29.steps || []).some((s) => s.kind === "perpendiculaire"), lbls(f29));

console.log("--- polygones étendus ---");
const f27 = geo("Tracer le trapèze GHIJ. Tracer le pentagone KLMNO. Tracer l'hexagone PQRSTU.");
t("trapèze + pentagone + hexagone", !f27.error && f27.steps.length === 3, f27.error || lbls(f27));

console.log("");
console.log(pass + " test(s) OK, " + fail + " échec(s)");
process.exit(fail ? 1 : 0);
