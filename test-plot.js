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

// ---- branches infinies / asymptotes ----
check("1/x : asymptote verticale x=0 + horizontale y=0", () => {
  const fig = buildFigure({ expression: "1/x" });
  const v = fig.asymptotes.verticales;
  if (!v.length || Math.abs(v[0].x) > 0.01) throw new Error(`verticales=${JSON.stringify(v)}`);
  const h = fig.asymptotes.horizontales;
  if (h.length !== 2 || !h.every((e) => Math.abs(e.y) < 0.01)) {
    throw new Error(`horizontales=${JSON.stringify(h)}`);
  }
  if (!fig.svg.includes('stroke-dasharray="7 5"')) throw new Error("pas de pointillés");
  if (!fig.svg.includes("Asymptote verticale")) throw new Error("légende manquante");
});

check("x/(x-1) : verticale x=1 + horizontale y=1", () => {
  const fig = buildFigure({ expression: "x/(x-1)" });
  const v = fig.asymptotes.verticales;
  if (!v.length || Math.abs(v[0].x - 1) > 0.01) throw new Error(`verticales=${JSON.stringify(v)}`);
  const h = fig.asymptotes.horizontales;
  if (!h.some((e) => Math.abs(e.y - 1) < 0.01)) throw new Error(`horizontales=${JSON.stringify(h)}`);
});

check("(2x^2+1)/(x-1) : verticale x=1 + oblique y=2x+2", () => {
  const fig = buildFigure({ expression: "(2x^2+1)/(x-1)" });
  const v = fig.asymptotes.verticales;
  if (!v.length || Math.abs(v[0].x - 1) > 0.01) throw new Error(`verticales=${JSON.stringify(v)}`);
  const o = fig.asymptotes.obliques;
  if (!o.length || !o.some((e) => Math.abs(e.a - 2) < 0.01 && Math.abs(e.b - 2) < 0.1)) {
    throw new Error(`obliques=${JSON.stringify(o)}`);
  }
  if (!fig.svg.includes("Asymptote oblique : y = 2x + 2")) {
    throw new Error("légende oblique incorrecte");
  }
});

check("x + 1/x : oblique y = x + verticale x=0", () => {
  const fig = buildFigure({ expression: "x+1/x" });
  const o = fig.asymptotes.obliques;
  if (!o.some((e) => Math.abs(e.a - 1) < 0.01 && Math.abs(e.b) < 0.1)) {
    throw new Error(`obliques=${JSON.stringify(o)}`);
  }
});

check("x-2ln(x) : verticale x≈0 (frontière) + branche parabolique direction y=x, pas d'oblique", () => {
  const fig = buildFigure({ expression: "x-2ln(x)" });
  const v = fig.asymptotes.verticales;
  if (!v.some((e) => Math.abs(e.x) < 0.05)) throw new Error(`verticales=${JSON.stringify(v)}`);
  if (fig.asymptotes.obliques.length) throw new Error(`obliques=${JSON.stringify(fig.asymptotes.obliques)}`);
  const b = fig.branches;
  if (!b.some((e) => e.type === "parabolique" && /y = x/.test(e.direction || ""))) {
    throw new Error(`branches=${JSON.stringify(b)}`);
  }
  if (!fig.svg.includes("Branche parabolique")) throw new Error("légende branche manquante");
});

check("x^2-2x+1 : aucune asymptote, branches paraboliques (Oy)", () => {
  const fig = buildFigure({ expression: "x^2-2x+1" });
  if (fig.asymptotes.verticales.length || fig.asymptotes.horizontales.length || fig.asymptotes.obliques.length) {
    throw new Error(`asymptotes=${JSON.stringify(fig.asymptotes)}`);
  }
  if (!fig.branches.length || !fig.branches.every((e) => e.type === "parabolique")) {
    throw new Error(`branches=${JSON.stringify(fig.branches)}`);
  }
  if (fig.svg.includes('stroke-dasharray="7 5"')) throw new Error("pointillés inattendus");
});

check("sin(x) : aucune asymptote ni branche infinie", () => {
  const fig = buildFigure({ expression: "sin(x)" });
  if (fig.asymptotes.verticales.length || fig.asymptotes.horizontales.length || fig.asymptotes.obliques.length) {
    throw new Error(`asymptotes=${JSON.stringify(fig.asymptotes)}`);
  }
  if (fig.branches.length) throw new Error(`branches=${JSON.stringify(fig.branches)}`);
});

check("tan(x) : ≥ 3 asymptotes verticales (π/2, 3π/2…)", () => {
  const fig = buildFigure({ expression: "tan(x)" });
  const v = fig.asymptotes.verticales;
  if (v.length < 3 || !v.some((e) => Math.abs(Math.abs(e.x) - Math.PI / 2) < 0.02)) {
    throw new Error(`verticales=${JSON.stringify(v)}`);
  }
});

check("sqrt(x) : pas d'asymptote verticale en 0, branche parabolique (Ox)", () => {
  const fig = buildFigure({ expression: "sqrt(x)" });
  if (fig.asymptotes.verticales.length) throw new Error(`verticales=${JSON.stringify(fig.asymptotes.verticales)}`);
  const b = fig.branches;
  if (!b.some((e) => e.type === "parabolique" && e.direction === "direction (Ox)")) {
    throw new Error(`branches=${JSON.stringify(b)}`);
  }
});

check("e^(-x) : asymptote horizontale y≈0 en +∞", () => {
  const fig = buildFigure({ expression: "e^(-x)" });
  const h = fig.asymptotes.horizontales;
  if (!h.some((e) => Math.abs(e.y) < 0.01 && e.side === "+∞")) {
    throw new Error(`horizontales=${JSON.stringify(h)}`);
  }
});

// ---- tangente ----
check("tangente de x^2-2x+1 en x=2 → y = 2x - 3 (tracée en pointillés rouges)", () => {
  const fig = buildFigure({ expression: "x^2-2x+1", tangent: 2 });
  if (!fig.tangente || Math.abs(fig.tangente.m - 2) > 1e-3 || Math.abs(fig.tangente.b + 3) > 1e-3) {
    throw new Error(`tangente=${JSON.stringify(fig.tangente)}`);
  }
  if (!fig.svg.includes('stroke-dasharray="6 4"')) throw new Error("tangente non tracée");
  if (!fig.svg.includes("<circle")) throw new Error("point de contact manquant");
  if (!fig.svg.includes("Tangente en x = 2 : y = 2x - 3")) throw new Error("légende tangente");
});

check("tangente de 1/x en x=2 → m=-0.25, b=1", () => {
  const fig = buildFigure({ expression: "1/x", tangent: 2 });
  if (!fig.tangente || Math.abs(fig.tangente.m + 0.25) > 1e-3 || Math.abs(fig.tangente.b - 1) > 1e-3) {
    throw new Error(`tangente=${JSON.stringify(fig.tangente)}`);
  }
});

check("pas de tangente sans paramètre", () => {
  const fig = buildFigure({ expression: "x^2-2x+1" });
  if (fig.tangente !== null) throw new Error(`tangente=${JSON.stringify(fig.tangente)}`);
});

check("tangente hors domaine affiché → impossible", () => {
  const fig = buildFigure({ expression: "x^2-2x+1", tangent: 50 });
  if (!fig.tangente || !fig.tangente.impossible) throw new Error(`tangente=${JSON.stringify(fig.tangente)}`);
  if (!fig.svg.includes("Tangente en x = 50 : impossible")) throw new Error("légende");
});

check("tangente hors domaine de définition → impossible (sqrt en x=-2)", () => {
  const fig = buildFigure({ expression: "sqrt(x)", tangent: -2 });
  if (!fig.tangente || !fig.tangente.impossible) throw new Error(`tangente=${JSON.stringify(fig.tangente)}`);
});

// ---- droite y = ax+b donnée directement (line=) ----
check("courbe + droite : line=2x-3 tracée en vert avec légende", () => {
  const fig = buildFigure({ expression: "x^2-2x+1", line: "2x-3" });
  if (!fig.droite || Math.abs(fig.droite.a - 2) > 1e-9 || Math.abs(fig.droite.b + 3) > 1e-9) {
    throw new Error(`droite=${JSON.stringify(fig.droite)}`);
  }
  if (!fig.svg.includes('stroke="#16a34a"')) throw new Error("droite non tracée en vert");
  if (!fig.svg.includes("Droite : y = 2x - 3")) throw new Error("légende droite manquante");
  if (!fig.svg.includes('stroke="#2563eb"')) throw new Error("courbe absente");
});

check("droite seule : line=2x-3 (sans expression) → titre 'Droite (d)…'", () => {
  const fig = buildFigure({ line: "2x-3" });
  if (!fig.svg.includes("Droite (d) : y = 2x - 3")) throw new Error("titre");
  if (!fig.droite || Math.abs(fig.droite.a - 2) > 1e-9) throw new Error(`droite=${JSON.stringify(fig.droite)}`);
  if (fig.asymptotes.obliques.length) throw new Error("fausse asymptote oblique");
  if (fig.svg.includes('stroke="#2563eb"')) throw new Error("courbe bleue inattendue");
});

check("line avec préfixe y= (line=y=-x+1) → a=-1, b=1", () => {
  const fig = buildFigure({ line: "y=-x+1" });
  if (!fig.droite || Math.abs(fig.droite.a + 1) > 1e-9 || Math.abs(fig.droite.b - 1) > 1e-9) {
    throw new Error(`droite=${JSON.stringify(fig.droite)}`);
  }
});

check("expressions non affines rejetées pour line=", () => {
  for (const bad of ["x^2", "sin(x)", "x*x", "2^x"]) {
    let threw = false;
    try {
      buildFigure({ line: bad });
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error(`accepté à tort : "${bad}"`);
  }
});

check("courbe + droite + tangente ensemble", () => {
  const fig = buildFigure({ expression: "x^2-2x+1", line: "2x-3", tangent: 2 });
  if (!fig.droite || !fig.tangente || fig.tangente.impossible) {
    throw new Error(JSON.stringify({ d: fig.droite, t: fig.tangente }));
  }
  if (!fig.svg.includes("Tangente en x = 2 : y = 2x - 3")) throw new Error("légende tangente");
});

// ---- fonctions usuelles : exp, ln, sin, cos, tan (dynamiques) ----
check("fonctions usuelles tracées dynamiquement (exp, ln, sin, cos, tan…)", () => {
  for (const expr of ["e^(-x)", "exp(x)", "ln(x)", "sin(x)", "cos(x)", "tan(x)", "2sin(x)cos(x)", "e^(-x^2)", "1/(1+e^(-x))"]) {
    const fig = buildFigure({ expression: expr });
    if (fig.error || !fig.svg.includes("<path") || !fig.points.length) {
      throw new Error(`${expr} : ${fig.error || "pas de courbe"}`);
    }
  }
});

check("tangente sur exp, sin, cos, ln (formule f'(x0)(x-x0)+f(x0))", () => {
  const cases = [
    ["e^(-x)", 1, -Math.exp(-1)],          // f'(1) = -e^{-1}
    ["sin(x)", Math.PI / 2, 0],            // f'(π/2) = cos(π/2) = 0
    ["cos(2x)", 1, -2 * Math.sin(2)],      // f'(x) = -2sin(2x)
    ["ln(x)", 2, 0.5],                     // f'(2) = 1/2
  ];
  for (const [expr, x0, expectedM] of cases) {
    const fig = buildFigure({ expression: expr, tangent: x0 });
    if (!fig.tangente || fig.tangente.impossible) throw new Error(`${expr} : ${JSON.stringify(fig.tangente)}`);
    if (Math.abs(fig.tangente.m - expectedM) > 1e-3) {
      throw new Error(`${expr} en x=${x0} : m=${fig.tangente.m} attendu ${expectedM}`);
    }
    // vérifie y = f'(x0)(x-x0)+f(x0) : b = f(x0) - m·x0
    const f = { "e^(-x)": Math.exp(-1), "sin(x)": 1, "cos(2x)": Math.cos(2), "ln(x)": Math.log(2) }[expr];
    if (Math.abs(fig.tangente.b - (f - fig.tangente.m * x0)) > 1e-6) {
      throw new Error(`${expr} : b=${fig.tangente.b} ≠ f(x0)-m·x0=${f - fig.tangente.m * x0}`);
    }
  }
});

check("tangente de sin(x) en π/2 → y = 1 (pente nulle propre)", () => {
  const fig = buildFigure({ expression: "sin(x)", tangent: Math.PI / 2 });
  if (!fig.tangente || fig.tangente.equation !== "y = 1") {
    throw new Error(`equation=${fig.tangente && fig.tangente.equation}`);
  }
});

console.log(`\n${pass} test(s) OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
