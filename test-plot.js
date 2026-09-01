/**
 * Test rapide du moteur de figures (lib/plot.js) — aucune dépendance.
 *
 *   node test-plot.js
 *
 * Vérifie : parsing (multiplication implicite, fonctions, puissances),
 * évaluation, domaine automatique (ln, sqrt), génération SVG.
 */

"use strict";

const { parseExpression, evaluate, buildFigure } = require("./lib/plot");

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`✅ ${name}`);
  } catch (err) {
    fail++;
    console.log(`❌ ${name}\n   → ${err.message}`);
  }
}

function approx(a, b, eps = 1e-9) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < eps;
}

function evalAt(expr, x) {
  const { ast } = parseExpression(expr);
  return evaluate(ast, x);
}

// ---- parsing / évaluation ----
check("x - 2ln(x) en x=2 → 2 - 2·ln2 ≈ 0.6137", () => {
  const v = evalAt("x - 2ln(x)", 2);
  if (!approx(v, 2 - 2 * Math.log(2), 1e-9)) throw new Error(`obtenu ${v}`);
});

check("x - 2*ln(x) (forme explicite) identique", () => {
  const v = evalAt("x - 2*ln(x)", 2);
  if (!approx(v, 2 - 2 * Math.log(2), 1e-9)) throw new Error(`obtenu ${v}`);
});

check("f(x)=x-2lnx (préfixe + ln sans parenthèses)", () => {
  const { ast, display } = parseExpression("f(x)=x-2lnx");
  if (display !== "x-2lnx") throw new Error(`display="${display}"`);
  const v = evaluate(ast, 2);
  if (!approx(v, 2 - 2 * Math.log(2), 1e-9)) throw new Error(`obtenu ${v}`);
});

check("2x en x=3 → 6 (multiplication implicite)", () => {
  const v = evalAt("2x", 3);
  if (!approx(v, 6)) throw new Error(`obtenu ${v}`);
});

check("x^2 en x=3 → 9 ; -x^2 en x=3 → -9", () => {
  if (!approx(evalAt("x^2", 3), 9)) throw new Error("x^2");
  if (!approx(evalAt("-x^2", 3), -9)) throw new Error("-x^2");
});

check("2^3^2 → 512 (puissance associative à droite)", () => {
  const v = evalAt("2^3^2", 0);
  if (!approx(v, 512)) throw new Error(`obtenu ${v}`);
});

check("sin(pi/2) → 1 ; sin pi/2 → 1 (l'argument sans parenthèses est la fraction)", () => {
  if (!approx(evalAt("sin(pi/2)", 0), 1)) throw new Error("sin(pi/2)");
  if (!approx(evalAt("sin pi/2", 0), 1)) throw new Error("sin pi/2");
  if (!approx(evalAt("sin(pi)/2", 0), 0)) throw new Error("sin(pi)/2");
});

check("sin(2x) en x=pi/4 → 1 (parenthèses)", () => {
  const v = evalAt("sin(2x)", Math.PI / 4);
  if (!approx(v, 1, 1e-9)) throw new Error(`obtenu ${v}`);
});

check("ln 2x en x=2 → ln(4) (appel sans parenthèses)", () => {
  const v = evalAt("ln 2x", 2);
  if (!approx(v, Math.log(4), 1e-9)) throw new Error(`obtenu ${v}`);
});

check("1/(x^2+1) en x=1 → 0.5", () => {
  const v = evalAt("1/(x^2+1)", 1);
  if (!approx(v, 0.5)) throw new Error(`obtenu ${v}`);
});

check("e^(-x) en x=0 → 1", () => {
  const v = evalAt("e^(-x)", 0);
  if (!approx(v, 1)) throw new Error(`obtenu ${v}`);
});

check("log = logarithme décimal : log(100) → 2", () => {
  const v = evalAt("log(100)", 0);
  if (!approx(v, 2)) throw new Error(`obtenu ${v}`);
});

check("ln(x) pour x≤0 → invalide (NaN)", () => {
  const v = evalAt("ln(x)", 0);
  if (Number.isFinite(v)) throw new Error(`obtenu ${v}`);
});

check("expressions invalides rejetées", () => {
  for (const bad of ["2+*3", "ln", "sin(", "x^", "foo(x)", "(x+1"]) {
    let threw = false;
    try {
      parseExpression(bad);
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error(`accepté à tort : "${bad}"`);
  }
});

// ---- génération SVG ----
check("buildFigure('x - 2*ln(x)') → SVG avec courbe", () => {
  const fig = buildFigure({ expression: "x - 2*ln(x)" });
  if (!fig.svg.includes("<svg")) throw new Error("pas de <svg");
  if (!fig.svg.includes("<path")) throw new Error("pas de <path (courbe)");
  if (!fig.points.length) throw new Error("aucun point");
  if (!(fig.domain.xmin < fig.domain.xmax)) throw new Error("domaine invalide");
});

check("domaine automatique : ln(x) démarre près de 0", () => {
  const fig = buildFigure({ expression: "ln(x)" });
  if (!(fig.domain.xmin > 0)) throw new Error(`xmin=${fig.domain.xmin}`);
});

check("domaine automatique : sqrt(x) idem", () => {
  const fig = buildFigure({ expression: "sqrt(x)" });
  if (!(fig.domain.xmin >= 0)) throw new Error(`xmin=${fig.domain.xmin}`);
});

check("domaine explicite respecté", () => {
  const fig = buildFigure({ expression: "sin(x)", xmin: -5, xmax: 5 });
  if (fig.domain.xmin !== -5 || fig.domain.xmax !== 5) {
    throw new Error(`domaine=${JSON.stringify(fig.domain)}`);
  }
});

check("sin(x) : aucun point invalide sur [-10,10]", () => {
  const fig = buildFigure({ expression: "sin(x)" });
  const invalid = fig.points.some(([, y]) => !Number.isFinite(y));
  if (invalid) throw new Error("points invalides");
  if (fig.points.length !== fig.samples) throw new Error("nb points");
});

check("tan(x) : SVG généré (asymptotes coupées)", () => {
  const fig = buildFigure({ expression: "tan(x)" });
  if (!fig.svg.includes("<path")) throw new Error("pas de courbe");
});

check("fonction sans point valide → erreur claire", () => {
  let threw = false;
  try {
    buildFigure({ expression: "ln(-x^2-1)" });
  } catch (e) {
    threw = true;
  }
  if (!threw) throw new Error("pas d'erreur levée");
});

check("taille personnalisée + couleur", () => {
  const fig = buildFigure({ expression: "x^2", width: 400, height: 300, color: "#ff0000" });
  if (!fig.svg.includes('width="400"')) throw new Error("largeur");
  if (!fig.svg.includes('stroke="#ff0000"')) throw new Error("couleur");
});

console.log(`\n${pass} test(s) OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
