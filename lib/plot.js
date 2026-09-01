/**
 * lib/plot.js — Moteur de construction de figures mathématiques (courbes).
 * Aucune dépendance externe (zéro npm install).
 *
 * Pipeline :
 *   1. parseExpression()  → analyse l'expression en un AST (parser récursif, PAS de eval)
 *   2. échantillonnage     → évaluation de l'AST sur un domaine (avec détection auto)
 *   3. buildFigure()       → génère une figure SVG : grille, axes, graduations, courbe, titre
 *
 * Exemples d'expressions acceptées :
 *   "x - 2ln(x)"   "x - 2*ln(x)"   "sin(x)"   "x^2 + 1"   "e^(-x) * cos(x)"
 *   "2x + 1"       "1/(x^2+1)"     "ln x"     "sin(2x)"   "sqrt(x)"   "|x|" (via abs)
 *
 * Fonctions : ln (naturel), log / log10 (base 10), log2, exp, sqrt, cbrt, abs,
 *             sign, floor, ceil, round, sin, cos, tan, asin, acos, atan, atan2(y,x),
 *             sinh, cosh, tanh, asinh, acosh, atanh, min(...), max(...)
 * Constantes : pi, e.  Variable : x.
 *
 * Conventions (notation mathématique française) :
 *   - multiplication implicite : 2x, 2ln(x), (x+1)(x-2), sin(x)cos(x)
 *   - appel de fonction sans parenthèses : ln x, sin 2x, ln x^2  →  ln(x), sin(2x), ln(x²)
 *   - log = logarithme décimal (base 10), ln = logarithme népérien
 */

"use strict";

/* ---------------------------------------------------------------- *
 * 1. Analyseur (tokenizer + parser récursif descendant)
 * ---------------------------------------------------------------- */

const FUNCTIONS = {
  ln: Math.log,
  log: (x) => Math.log10(x), // base 10 (convention française)
  log10: (x) => Math.log10(x),
  log2: (x) => Math.log2(x),
  exp: Math.exp,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: (y, x) => Math.atan2(y, x),
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  asinh: Math.asinh,
  acosh: Math.acosh,
  atanh: Math.atanh,
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
};

const CONSTANTS = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: 2 * Math.PI,
};

/** Noms connus, du plus court au plus long (pour découper "lnx" → "ln" + "x"). */
const KNOWN_NAMES = [...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS), "x"].sort(
  (a, b) => a.length - b.length
);

function findKnownPrefix(name) {
  for (const n of KNOWN_NAMES) {
    if (name.startsWith(n) && name.length > n.length) return n;
  }
  return null;
}

/** Normalise l'entrée : retire un préfixe éventuel (f(x)=, y=, f:) et les espaces superflus. */
function normalizeInput(input) {
  let s = String(input || "").trim();
  s = s.replace(/^f\s*\(\s*x\s*\)\s*[:=]\s*/i, "");
  s = s.replace(/^y\s*[:=]\s*/i, "");
  s = s.replace(/^f\s*[:=]\s*/i, "");
  s = s.replace(/\*\*/g, "^"); // 2**x → 2^x (affichage)
  return s.replace(/\s+/g, " ");
}

function tokenize(src) {
  const s = String(src).replace(/\s+/g, "");
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      // notation scientifique : 1e5, 1.5e-3 (mais "2e^x" reste 2·eˣ)
      if ((s[j] === "e" || s[j] === "E") && /[0-9]/.test(s[j + 1])) {
        let k = j + 1;
        if (s[k] === "+" || s[k] === "-") k++;
        if (k < s.length && /[0-9]/.test(s[k])) {
          while (k < s.length && /[0-9]/.test(s[k])) k++;
          j = k;
        }
      }
      const raw = s.slice(i, j);
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new Error(`Nombre invalide : "${raw}"`);
      tokens.push({ type: "num", value: num });
      i = j;
    } else if (/[a-zA-Zπ]/.test(ch)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9]/.test(s[j])) j++;
      let name = s.slice(i, j).toLowerCase();
      if (name === "π") name = "pi";
      const known =
        name === "x" ||
        Object.prototype.hasOwnProperty.call(CONSTANTS, name) ||
        Object.prototype.hasOwnProperty.call(FUNCTIONS, name);
      if (!known) {
        // "lnx" → "ln"+"x", "log100" → "log"+"100", "2lnx" → 2·"ln"+"x"…
        const prefix = findKnownPrefix(name);
        if (prefix) {
          tokens.push({ type: "ident", value: prefix });
          i += prefix.length;
          continue;
        }
      }
      tokens.push({ type: "ident", value: name });
      i = j;
    } else if (ch === "*" && s[i + 1] === "*") {
      tokens.push({ type: "op", value: "^" }); // ** = puissance
      i += 2;
    } else if ("+-*/^".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
    } else if (ch === "(") {
      tokens.push({ type: "lp" });
      i++;
    } else if (ch === ")") {
      tokens.push({ type: "rp" });
      i++;
    } else if (ch === ",") {
      tokens.push({ type: "comma" });
      i++;
    } else {
      throw new Error(`Caractère inattendu : "${ch}"`);
    }
  }
  return tokens;
}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const isOp = (t, v) => t && t.type === "op" && t.value === v;
  const startsFactor = (t) => t && (t.type === "num" || t.type === "ident" || t.type === "lp");

  function parseAdd() {
    let left = parseMul();
    while (pos < tokens.length && (isOp(peek(), "+") || isOp(peek(), "-"))) {
      const op = next().value;
      const right = parseMul();
      left = { type: "bin", op, left, right };
    }
    return left;
  }

  function parseMul() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (!t) break;
      if (isOp(t, "*") || isOp(t, "/")) {
        const op = next().value;
        const right = parseUnary();
        left = { type: "bin", op, left, right };
      } else if (startsFactor(t)) {
        // multiplication implicite : 2x, 2(x+1), 2ln(x), (x+1)(x-1), sin(x)cos(x)…
        const right = parseUnary();
        left = { type: "bin", op: "*", left, right };
      } else {
        break;
      }
    }
    return left;
  }

  function parseUnary() {
    const t = peek();
    if (isOp(t, "+") || isOp(t, "-")) {
      next();
      const operand = parseUnary();
      if (t.value === "-") return { type: "neg", operand };
      return operand;
    }
    return parsePow();
  }

  function parsePow() {
    const base = parseAtom();
    if (isOp(peek(), "^")) {
      next();
      const exp = parseUnary(); // associative à droite : 2^3^2 = 2^(3^2) ; -x^2 = -(x^2)
      return { type: "bin", op: "^", left: base, right: exp };
    }
    return base;
  }

  function parseAtom() {
    const t = next();
    if (!t) throw new Error("Expression incomplète.");
    if (t.type === "num") return { type: "num", value: t.value };
    if (t.type === "lp") {
      const inner = parseAdd();
      const close = next();
      if (!close || close.type !== "rp") throw new Error("Parenthèse fermante manquante.");
      return inner;
    }
    if (t.type === "ident") {
      const name = t.value;
      if (name === "x") return { type: "var" };
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        return { type: "num", value: CONSTANTS[name] };
      }
      if (Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) {
        const nt = peek();
        if (nt && nt.type === "lp") {
          next(); // (
          const args = [];
          if (peek() && peek().type !== "rp") {
            args.push(parseAdd());
            while (peek() && peek().type === "comma") {
              next();
              args.push(parseAdd());
            }
          }
          const close = next();
          if (!close || close.type !== "rp") {
            throw new Error(`Parenthèse fermante manquante pour "${name}(…)"`);
          }
          return { type: "call", name, args };
        }
        if (startsFactor(nt)) {
          // appel sans parenthèses : ln x, sin 2x, ln x^2 → ln(x), sin(2x), ln(x²)
          const arg = parseMul();
          return { type: "call", name, args: [arg] };
        }
        throw new Error(`La fonction "${name}" doit être suivie de parenthèses : ${name}(x)`);
      }
      throw new Error(
        `Fonction ou constante inconnue : "${name}" (connues : x, pi, e, ln, log10, sqrt, sin, cos, tan, exp, abs, …)`
      );
    }
    throw new Error(`Expression invalide.`);
  }

  const ast = parseAdd();
  if (pos < tokens.length) {
    throw new Error(`Caractère(s) inattendu(s) en fin d'expression.`);
  }
  return ast;
}

/** Analyse une expression et renvoie { ast, display }. */
function parseExpression(input) {
  const display = normalizeInput(input);
  if (!display) throw new Error("Expression vide.");
  if (display.length > 500) throw new Error("Expression trop longue (max 500 caractères).");
  const ast = parse(tokenize(display));
  return { ast, display };
}

/* ---------------------------------------------------------------- *
 * 2. Évaluation
 * ---------------------------------------------------------------- */

const isNum = (v) => Number.isFinite(v);

function evaluate(ast, x) {
  switch (ast.type) {
    case "num":
      return ast.value;
    case "var":
      return x;
    case "neg": {
      const v = evaluate(ast.operand, x);
      return isNum(v) ? -v : NaN;
    }
    case "bin": {
      const a = evaluate(ast.left, x);
      const b = evaluate(ast.right, x);
      if (!isNum(a) || !isNum(b)) return NaN;
      switch (ast.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          if (b === 0) return a === 0 ? NaN : a > 0 ? Infinity : -Infinity;
          return a / b;
        case "^": {
          if (a < 0 && !Number.isInteger(b)) return NaN; // puissance non entière d'un négatif
          return Math.pow(a, b);
        }
      }
      return NaN;
    }
    case "call": {
      const fn = FUNCTIONS[ast.name];
      const args = ast.args.map((a) => evaluate(a, x));
      if (args.some((v) => !isNum(v))) return NaN;
      return fn(...args);
    }
    default:
      return NaN;
  }
}

/** Échantillonne la fonction sur [xmin, xmax] : points invalides → y = NaN. */
function sample(ast, xmin, xmax, n) {
  const pts = [];
  const step = (xmax - xmin) / (n - 1);
  for (let k = 0; k < n; k++) {
    const x = xmin + k * step;
    const y = evaluate(ast, x);
    pts.push({ x, y: isNum(y) ? y : NaN });
  }
  return pts;
}

/* ---------------------------------------------------------------- *
 * 3. Domaine & échelle automatiques
 * ---------------------------------------------------------------- */

/** Découpe le domaine en "runs" de points valides (gère ln, sqrt, etc.). */
function validRuns(ast, xmin, xmax, n) {
  const runs = [];
  let current = null;
  const step = (xmax - xmin) / (n - 1);
  for (let k = 0; k < n; k++) {
    const x = xmin + k * step;
    const ok = isNum(evaluate(ast, x));
    if (ok) {
      if (!current) current = { start: x, end: x };
      else current.end = x;
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

/**
 * Domaine automatique : si moins de 60 % du domaine par défaut est valide
 * (ex. ln(x), sqrt(x)…), on resserre sur le plus long intervalle valide.
 */
function guessDomain(ast, fallbackXmin, fallbackXmax) {
  const n = 400;
  const runs = validRuns(ast, fallbackXmin, fallbackXmax, n);
  const total = fallbackXmax - fallbackXmin;
  const validFraction =
    runs.reduce((s, r) => s + (r.end - r.start), 0) / total;
  if (validFraction >= 0.6) return { xmin: fallbackXmin, xmax: fallbackXmax };

  runs.sort((a, b) => b.end - b.start - (a.end - a.start));
  const best = runs[0];
  if (!best) {
    throw new Error(
      "La fonction n'a aucun point valide sur le domaine (domaine de définition vide ?)."
    );
  }
  const step = total / (n - 1);
  const atLeft = best.start <= fallbackXmin + step;
  const atRight = best.end >= fallbackXmax - step;
  const pad = (best.end - best.start) * 0.1;
  let lo = best.start - (atLeft ? 0 : pad);
  let hi = best.end + (atRight ? 0 : pad);
  // Ne jamais étendre au-delà de la frontière de validité (ln(x), sqrt(x)…).
  const loEdge = scanLeftmostValid(ast, lo, best.start);
  if (loEdge !== null) lo = loEdge; // ln(x) → bord réel ≈ 0
  else lo = best.start; // sqrt(x), zone franchement invalide
  const hiEdge = scanRightmostValid(ast, best.end, hi);
  if (hiEdge !== null) hi = hiEdge;
  else hi = best.end;
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  return { xmin: lo, xmax: hi };
}

function percentile(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Point valide le plus à gauche de [a, b) (null si aucun). */
function scanLeftmostValid(ast, a, b) {
  const n = 200;
  const step = (b - a) / (n - 1);
  for (let k = 0; k < n; k++) {
    const x = a + k * step;
    if (x >= b) break;
    if (isNum(evaluate(ast, x))) return x;
  }
  return null;
}

/** Point valide le plus à droite de (a, b] (null si aucun). */
function scanRightmostValid(ast, a, b) {
  const n = 200;
  const step = (b - a) / (n - 1);
  for (let k = n - 1; k >= 0; k--) {
    const x = a + k * step;
    if (x <= a) break;
    if (isNum(evaluate(ast, x))) return x;
  }
  return null;
}

/** Échelle y automatique : percentiles 5–95 pour ignorer les pics (asymptotes). */
function guessYRange(pts) {
  const values = pts.filter((p) => isNum(p.y)).map((p) => p.y).sort((a, b) => a - b);
  if (!values.length) {
    throw new Error("La fonction n'a aucun point valide sur le domaine choisi.");
  }
  let lo = percentile(values, 0.05);
  let hi = percentile(values, 0.95);
  if (lo <= 0 && 0 <= hi) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  let d = hi - lo;
  if (!isNum(d) || d < 1e-12) {
    const mid = lo || 0;
    return { ymin: mid - 1, ymax: mid + 1 };
  }
  lo -= 0.08 * d;
  hi += 0.08 * d;
  return { ymin: lo, ymax: hi };
}

/* ---------------------------------------------------------------- *
 * 4. Analyse des branches infinies, asymptotes et tangente
 * ---------------------------------------------------------------- */

/** Dérivée numérique f'(x) (différence centrale, h adaptatif). */
function numericDerivative(ast, x) {
  for (const base of [1e-6, 1e-5, 1e-4, 1e-3]) {
    const h = Math.max(Math.abs(x) * base, 1e-7);
    const f1 = evaluate(ast, x + h);
    const f2 = evaluate(ast, x - h);
    if (isNum(f1) && isNum(f2) && isNum((f1 - f2) / (2 * h))) {
      return (f1 - f2) / (2 * h);
    }
  }
  return NaN;
}

/**
 * Limite de f en ±∞ par évaluation à des abscisses croissantes.
 * Abscisses modérées (10³ … 10¹⁰) : assez loin pour « l'infini » des
 * fonctions usuelles, sans catastrophe numérique (cancellation).
 * @returns {object} { kind: 'finite', value } | { kind: 'infinite' } | { kind: 'none' }
 */
function limitAtInfinity(ast, side) {
  const vals = [];
  for (let k = 3; k <= 10; k++) {
    const x = side * Math.pow(10, k);
    const y = evaluate(ast, x);
    if (!isNum(y)) return { kind: "none" };
    if (Math.abs(y) > 1e12) return { kind: "infinite" };
    vals.push(y);
    if (vals.length >= 2) {
      const prev = vals[vals.length - 2];
      if (Math.abs(y - prev) <= 1e-6 * Math.max(1, Math.abs(y), Math.abs(prev))) {
        return { kind: "finite", value: y };
      }
    }
  }
  // pas de convergence : croissance lente et régulière (sqrt, ln…) → branche infinie.
  // Le plancher |y| > 10 élimine les fonctions oscillantes bornées (sin, …).
  const n = vals.length;
  if (n >= 4) {
    const a0 = Math.abs(vals[n - 4]), a1 = Math.abs(vals[n - 3]);
    const a2 = Math.abs(vals[n - 2]), a3 = Math.abs(vals[n - 1]);
    if (a3 > a2 && a2 > a1 && a1 > a0 && a3 > 10) return { kind: "infinite" };
  }
  return { kind: "none" };
}

/**
 * Asymptote oblique y = a·x + b en ±∞ (null si inexistante ou branche parabolique).
 * a = lim f(x)/x, extrapolé (Richardson) depuis x = 10⁷ et 10⁸ pour éliminer
 * le terme résiduel c/x ; b = lim (f − a·x) doit converger (sinon branche
 * parabolique de direction y = ax). Abscisses modérées pour éviter la
 * cancellation en y − a·x.
 */
function obliqueAsymptote(ast, side) {
  let q7 = NaN;
  let q8 = NaN;
  for (const k of [5, 6, 7, 8]) {
    const x = side * Math.pow(10, k);
    const y = evaluate(ast, x);
    if (!isNum(y)) return null;
    const q = y / x;
    if (Math.abs(q) > 1e4) return null; // f/x → ±∞ : branche parabolique de direction (Oy)
    if (k === 7) q7 = q;
    if (k === 8) q8 = q;
  }
  if (!isNum(q7) || !isNum(q8) || Math.abs(q8) < 1e-9) return null;
  const a = q8 + (q8 - q7) / 9; // extrapolation du terme c/x
  // b = lim (f(x) - a·x) — doit converger (sinon branche parabolique de direction y = ax)
  let b = NaN;
  let bConv = false;
  for (let k = 3; k <= 7; k++) {
    const x = side * Math.pow(10, k);
    const y = evaluate(ast, x);
    if (!isNum(y)) return null;
    const v = y - a * x;
    if (!isNum(v) || Math.abs(v) > 1e10) return null;
    if (isNum(b) && Math.abs(v - b) <= 1e-4 * Math.max(1, Math.abs(v), Math.abs(b))) {
      b = v;
      bConv = true;
      break;
    }
    b = v;
  }
  if (!bConv || !isNum(b)) return null;
  return { a, b };
}

/** Localise un pôle (asymptote verticale) entre a et b (a < b). */
function findPole(ast, a, b) {
  const fa = evaluate(ast, a);
  const fb = evaluate(ast, b);
  if ((fa > 0 && fb < 0) || (fa < 0 && fb > 0)) {
    // pôle simple : f change de signe → bissection sur f
    let lo = a, hi = b;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const fm = evaluate(ast, mid);
      if (!isNum(fm)) { hi = mid; continue; }
      if ((fa > 0 && fm >= 0) || (fa < 0 && fm <= 0)) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // pôle d'ordre pair : |f| → ∞ sans changement de signe → minimiser |1/f|
  let lo = a, hi = b;
  for (let i = 0; i < 70; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const g1 = Math.abs(1 / evaluate(ast, m1));
    const g2 = Math.abs(1 / evaluate(ast, m2));
    if (g1 < g2) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

/**
 * Détecte les asymptotes verticales dans [xmin, xmax] :
 *   - pôles intérieurs : pic local de |f| (avec ou sans changement de signe) ;
 *   - frontière du domaine de définition avec |f| → ∞ (ex. x = 0 pour ln(x)).
 */
function detectVerticalAsymptotes(ast, xmin, xmax) {
  const out = [];
  const n = 3000;
  const step = (xmax - xmin) / (n - 1);

  const absY = [];
  const ys = [];
  for (let k = 0; k < n; k++) {
    const y = evaluate(ast, xmin + k * step);
    ys.push(y);
    if (isNum(y)) absY.push(Math.abs(y));
  }
  if (!absY.length) return out;
  absY.sort((p, q) => p - q);
  const q95 = absY[Math.min(absY.length - 1, Math.floor(0.95 * absY.length))] || 0;
  if (q95 <= 0) return out; // fonction plate (ex. f(x) = 0) : pas de pôle
  const poleThresh = Math.max(10 * q95, 1e-6);

  // pôles intérieurs : pics locaux de |f| (≥ 10 × q95)
  for (let k = 1; k < n - 1; k++) {
    const y0 = ys[k - 1], y1 = ys[k], y2 = ys[k + 1];
    const a0 = isNum(y0) ? Math.abs(y0) : NaN;
    const a1 = isNum(y1) ? Math.abs(y1) : NaN;
    const a2 = isNum(y2) ? Math.abs(y2) : NaN;
    if (isNum(a1) && a1 >= poleThresh && a1 >= a0 && a1 >= a2) {
      out.push(findPole(ast, xmin + (k - 1) * step, xmin + (k + 1) * step));
    } else if (!isNum(a1) && isNum(a0) && isNum(a2) && a0 > poleThresh && a2 > poleThresh) {
      // échantillon exactement sur le pôle (y = ±∞) entre deux valeurs grandes
      out.push(findPole(ast, xmin + (k - 1) * step, xmin + (k + 1) * step));
    }
  }

  // frontières du domaine (ex. ln(x) : x = 0) — la fonction doit y diverger
  for (const side of [-1, 1]) {
    const edge = side === -1 ? xmin : xmax;
    let isBoundary = false;
    let outside = edge;
    for (const mult of [0.5, 2, 8, 32]) {
      outside = edge + side * step * mult; // à l'extérieur du domaine
      if (!isNum(evaluate(ast, outside))) { isBoundary = true; break; }
    }
    if (!isBoundary) continue;
    // |f| diverge-t-elle en approchant la frontière ? (points entre le bord
    // visible et la frontière : x = edge ∓ δ, δ croissant de step/64 à 2·step)
    let prevAbs = NaN;
    let firstAbs = NaN;
    let grows = 0;
    let decreasing = false;
    let lastAbs = NaN;
    for (let k = 0; k < 8; k++) {
      const delta = (step * Math.pow(2, k)) / 64;
      const x = edge + side * delta;
      const y = evaluate(ast, x);
      if (!isNum(y)) break; // frontière atteinte : les valeurs précédentes suffisent
      const av = Math.abs(y);
      lastAbs = av;
      if (k === 0) firstAbs = av;
      if (isNum(prevAbs)) {
        if (av > prevAbs * 1.001 + 1e-9) grows++;
        else if (av < prevAbs * 0.999) { decreasing = true; break; } // limite finie (ex. √x)
      }
      prevAbs = av;
    }
    // croissance régulière ET divergence nette (|f| augmente d'au moins 15 %)
    if (decreasing || grows < 5 || !(firstAbs > 0) || lastAbs < firstAbs * 1.15) continue;
    // frontière exacte = dernier point valide
    const inside = edge + side * step * 0.05;
    let lo = inside, hi = outside;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (isNum(evaluate(ast, mid))) lo = mid;
      else hi = mid;
    }
    out.push(lo);
  }

  // fusion des pôles très proches + tri
  const merged = [];
  for (const x0 of out.sort((p, q) => p - q)) {
    if (!merged.length || Math.abs(x0 - merged[merged.length - 1]) > step * 2) {
      merged.push(x0);
    }
  }
  return merged;
}

/**
 * Analyse complète des branches infinies (asymptotes + branches paraboliques).
 * @returns {object} { verticales, horizontales, obliques, branches }
 */
function analyzeBranches(ast) {
  const verticales = [];
  const horizontales = [];
  const obliques = [];
  const branches = [];
  for (const side of [-1, 1]) {
    const sideLabel = side === 1 ? "+∞" : "-∞";
    const lim = limitAtInfinity(ast, side);
    if (lim.kind === "finite") {
      horizontales.push({ y: lim.value, side: sideLabel });
      branches.push({ side: sideLabel, type: "horizontale", asymptote: { y: lim.value } });
    } else if (lim.kind === "infinite") {
      const obl = obliqueAsymptote(ast, side);
      if (obl) {
        obliques.push({ a: obl.a, b: obl.b, side: sideLabel });
        branches.push({ side: sideLabel, type: "oblique", asymptote: obl });
      } else {
        // branche parabolique : direction (Oy) si f/x → ±∞, (Ox) si f/x → 0,
        // sinon « direction y = ax » (ex. x - 2ln(x) → direction y = x)
        const xBig = side * 1e8;
        const yBig = evaluate(ast, xBig);
        const q = isNum(yBig) ? yBig / xBig : NaN;
        let direction;
        if (!isNum(q) || Math.abs(q) > 1e4) direction = "direction (Oy)";
        else if (Math.abs(q) < 1e-3) direction = "direction (Ox)";
        else direction = "direction " + formatAffine(q, 0);
        branches.push({ side: sideLabel, type: "parabolique", direction });
      }
    }
  }
  return { verticales, horizontales, obliques, branches };
}

/** Tangente en x0 : { x0, y0, m, b, equation } ou null si impossible. */
function tangentAt(ast, x0) {
  const y0 = evaluate(ast, x0);
  if (!isNum(y0)) return null;
  const m = numericDerivative(ast, x0);
  if (!isNum(m)) return null;
  const b = y0 - m * x0;
  return { x0, y0, m, b, equation: formatAffine(m, b) };
}

/* ---------------------------------------------------------------- *
 * 4. Génération de la figure SVG
 * ---------------------------------------------------------------- */

const M = { left: 70, right: 26, top: 48, bottom: 54 }; // marges (px)

/** Nombre lisible (2 décimales max, sans -0). */
function fmtNum(v) {
  if (!isNum(v)) return "?";
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

/** Équation affine "y = mx + b" propre (ex. "y = 2x - 3", "y = x + 1"). */
function formatAffine(m, b) {
  let s = "y = ";
  const mr = Math.round(m * 100) / 100;
  if (Math.abs(mr - Math.round(mr)) < 1e-9) {
    const mi = Math.round(mr);
    if (mi === 1) s += "x";
    else if (mi === -1) s += "-x";
    else s += mi + "x";
  } else {
    s += fmtNum(mr) + "x";
  }
  const br = Math.round(b * 100) / 100;
  if (br > 0) s += " + " + fmtNum(br);
  else if (br < 0) s += " - " + fmtNum(Math.abs(br));
  return s;
}

/** Clippe un segment [p1,p2] au rectangle [x0,y0,x1,y1] (Cohen–Sutherland). */
function clipSegment(ax, ay, bx, by, x0, y0, x1, y1) {
  let p = { x: ax, y: ay };
  let q = { x: bx, y: by };
  const code = (p) =>
    (p.x < x0 ? 1 : 0) | (p.x > x1 ? 2 : 0) | (p.y < y0 ? 4 : 0) | (p.y > y1 ? 8 : 0);
  for (let i = 0; i < 4; i++) {
    const c1 = code(p);
    const c2 = code(q);
    if (!(c1 | c2)) return [p, q];
    if (c1 & c2) return null;
    const c = c1 || c2;
    let x = 0, y = 0;
    if (c & 8) { y = y1; x = p.x + ((q.x - p.x) * (y1 - p.y)) / (q.y - p.y); }
    else if (c & 4) { y = y0; x = p.x + ((q.x - p.x) * (y0 - p.y)) / (q.y - p.y); }
    else if (c & 2) { x = x1; y = p.y + ((q.y - p.y) * (x1 - p.x)) / (q.x - p.x); }
    else if (c & 1) { x = x0; y = p.y + ((q.y - p.y) * (x0 - p.x)) / (q.x - p.x); }
    if (c === c1) p = { x, y };
    else q = { x, y };
  }
  return [p, q];
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Graduations "propres" (pas 1, 2, 5 × 10^k) pour un intervalle donné. */
function niceTicks(min, max, target) {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [];
  const rough = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const start = Math.ceil(min / step) * step;
  const count = Math.max(0, Math.round((max - start) / step));
  const out = [];
  for (let i = 0; i <= count; i++) {
    out.push(Number((start + i * step).toPrecision(12)));
  }
  return out;
}

function formatTick(v) {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(1).replace("e", "e");
  return String(parseFloat(v.toPrecision(6)));
}

const fmtPx = (v) => String(Math.round(v * 100) / 100); // coords SVG : 2 décimales

/**
 * Construit la figure complète.
 * @param {object} opts { expression, xmin, xmax, ymin, ymax, width, height, samples, color, title, tangent }
 *   tangent : abscisse x0 où tracer la tangente (optionnel — rien sans cela)
 * @returns {object} { svg, points, expression, domain, range, size, samples, asymptotes, branches, tangente }
 */
function buildFigure(opts = {}) {
  const {
    expression,
    xmin: optXmin,
    xmax: optXmax,
    ymin: optYmin,
    ymax: optYmax,
    width: optWidth,
    height: optHeight,
    samples: optSamples,
    color: optColor,
    title: optTitle,
    tangent: optTangent,
  } = opts;

  if (!expression) throw new Error("Paramètre 'expression' manquant.");

  const { ast, display } = parseExpression(expression);

  const width = Math.min(2400, Math.max(200, Math.round(Number(optWidth) || 800)));
  const height = Math.min(1600, Math.max(200, Math.round(Number(optHeight) || 600)));
  const samples = Math.min(4000, Math.max(100, Math.round(Number(optSamples) || 800)));
  const color = /^#[0-9a-fA-F]{6}$/.test(String(optColor || ""))
    ? String(optColor)
    : "#2563eb";

  const hasXRange = optXmin !== undefined && optXmin !== null && optXmin !== "" && optXmax !== undefined && optXmax !== null && optXmax !== "";
  const hasYRange = optYmin !== undefined && optYmin !== null && optYmin !== "" && optYmax !== undefined && optYmax !== null && optYmax !== "";

  let xmin, xmax;
  if (hasXRange) {
    xmin = Number(optXmin);
    xmax = Number(optXmax);
    if (!isNum(xmin) || !isNum(xmax) || xmin >= xmax) {
      throw new Error("'xmin' et 'xmax' doivent être des nombres avec xmin < xmax.");
    }
  } else {
    const g = guessDomain(ast, -10, 10);
    xmin = g.xmin;
    xmax = g.xmax;
  }

  const pts = sample(ast, xmin, xmax, samples);

  let ymin, ymax;
  if (hasYRange) {
    ymin = Number(optYmin);
    ymax = Number(optYmax);
    if (!isNum(ymin) || !isNum(ymax) || ymin >= ymax) {
      throw new Error("'ymin' et 'ymax' doivent être des nombres avec ymin < ymax.");
    }
  } else {
    const g = guessYRange(pts);
    ymin = g.ymin;
    ymax = g.ymax;
  }

  const plotW = width - M.left - M.right;
  const plotH = height - M.top - M.bottom;
  const px = (x) => M.left + ((x - xmin) / (xmax - xmin)) * plotW;
  const py = (y) => M.top + ((ymax - y) / (ymax - ymin)) * plotH;

  // ---- analyse des branches infinies (asymptotes) et tangente ----
  const verticales = detectVerticalAsymptotes(ast, xmin, xmax);
  const { horizontales, obliques, branches } = analyzeBranches(ast);

  let tangent = null;
  if (optTangent !== undefined && optTangent !== null && optTangent !== "") {
    const x0 = Number(optTangent);
    if (isNum(x0) && x0 >= xmin && x0 <= xmax) {
      tangent = tangentAt(ast, x0) || { x0, impossible: "f non définie ou non dérivable en ce point" };
    } else if (isNum(x0)) {
      tangent = { x0, impossible: "abscisse hors du domaine affiché" };
    }
  }

  // ---- courbe (coupe les trous et les asymptotes verticales) ----
  let d = "";
  let started = false;
  let prevY = NaN;
  const jumpThresh = Math.max((ymax - ymin) * 0.9, 1e-9);
  for (const p of pts) {
    if (!isNum(p.y)) {
      started = false;
      prevY = NaN;
      continue;
    }
    const xc = px(p.x);
    const yc = py(p.y);
    if (!started) {
      d += `M${fmtPx(xc)} ${fmtPx(yc)}`;
    } else if (Math.abs(p.y - prevY) > jumpThresh) {
      d += `M${fmtPx(xc)} ${fmtPx(yc)}`; // saut (asymptote) → nouveau trait
    } else {
      d += `L${fmtPx(xc)} ${fmtPx(yc)}`;
    }
    started = true;
    prevY = p.y;
  }

  // ---- grille + graduations ----
  const xTicks = niceTicks(xmin, xmax, 8);
  const yTicks = niceTicks(ymin, ymax, 6);

  let grid = "";
  for (const t of xTicks) {
    if (t < xmin || t > xmax) continue;
    const xc = fmtPx(px(t));
    grid += `<line x1="${xc}" y1="${M.top}" x2="${xc}" y2="${M.top + plotH}" stroke="#e2e8f0" stroke-width="1"/>`;
  }
  for (const t of yTicks) {
    if (t < ymin || t > ymax) continue;
    const yc = fmtPx(py(t));
    grid += `<line x1="${M.left}" y1="${yc}" x2="${M.left + plotW}" y2="${yc}" stroke="#e2e8f0" stroke-width="1"/>`;
  }

  // ---- axes (si 0 est dans le domaine, sinon cadre) ----
  const axisX = xmin <= 0 && 0 <= xmax;
  const axisY = ymin <= 0 && 0 <= ymax;

  let axesSvg = "";
  let labels = "";
  const axisColor = "#475569";
  if (axisY) {
    const x0 = fmtPx(px(0));
    axesSvg += `<line x1="${x0}" y1="${M.top}" x2="${x0}" y2="${M.top + plotH}" stroke="${axisColor}" stroke-width="1.5"/>`;
  }
  if (axisX) {
    const y0 = fmtPx(py(0));
    axesSvg += `<line x1="${M.left}" y1="${y0}" x2="${M.left + plotW}" y2="${y0}" stroke="${axisColor}" stroke-width="1.5"/>`;
  }
  // graduations
  for (const t of xTicks) {
    if (t < xmin || t > xmax) continue;
    const xc = fmtPx(px(t));
    const baseY = axisX ? fmtPx(py(0)) : fmtPx(M.top + plotH);
    axesSvg += `<line x1="${xc}" y1="${baseY - 4}" x2="${xc}" y2="${baseY + 4}" stroke="${axisColor}" stroke-width="1.5"/>`;
    labels += `<text x="${xc}" y="${Number(baseY) + 18}" text-anchor="middle" font-size="12" fill="#64748b">${escapeXml(formatTick(t))}</text>`;
  }
  for (const t of yTicks) {
    if (t < ymin || t > ymax) continue;
    const yc = fmtPx(py(t));
    const baseX = axisY ? fmtPx(px(0)) : fmtPx(M.left);
    axesSvg += `<line x1="${Number(baseX) - 4}" y1="${yc}" x2="${Number(baseX) + 4}" y2="${yc}" stroke="${axisColor}" stroke-width="1.5"/>`;
    labels += `<text x="${Number(baseX) - 8}" y="${Number(yc) + 4}" text-anchor="end" font-size="12" fill="#64748b">${escapeXml(formatTick(t))}</text>`;
  }
  // cadre (toujours, discret)
  const frame = `<rect x="${M.left}" y="${M.top}" width="${plotW}" height="${plotH}" fill="none" stroke="#cbd5e1" stroke-width="1"/>`;

  // ---- asymptotes (pointillés gris) ----
  const asymptoteColor = "#64748b";
  let extraSvg = "";
  for (const x0 of verticales) {
    // visible même si le pôle est légèrement hors fenêtre (ex. ln(x) en x = 0)
    const vx = Math.min(xmax, Math.max(xmin, x0));
    extraSvg += `<line x1="${fmtPx(px(vx))}" y1="${M.top}" x2="${fmtPx(px(vx))}" y2="${M.top + plotH}" stroke="${asymptoteColor}" stroke-width="1.5" stroke-dasharray="7 5"/>`;
  }
  for (const h of horizontales) {
    const clip = clipSegment(px(xmin), py(h.y), px(xmax), py(h.y), M.left, M.top, M.left + plotW, M.top + plotH);
    if (clip) {
      extraSvg += `<line x1="${fmtPx(clip[0].x)}" y1="${fmtPx(clip[0].y)}" x2="${fmtPx(clip[1].x)}" y2="${fmtPx(clip[1].y)}" stroke="${asymptoteColor}" stroke-width="1.5" stroke-dasharray="7 5"/>`;
    }
  }
  for (const o of obliques) {
    const clip = clipSegment(px(xmin), py(o.a * xmin + o.b), px(xmax), py(o.a * xmax + o.b), M.left, M.top, M.left + plotW, M.top + plotH);
    if (clip) {
      extraSvg += `<line x1="${fmtPx(clip[0].x)}" y1="${fmtPx(clip[0].y)}" x2="${fmtPx(clip[1].x)}" y2="${fmtPx(clip[1].y)}" stroke="${asymptoteColor}" stroke-width="1.5" stroke-dasharray="7 5"/>`;
    }
  }
  // ---- tangente (pointillés rouges) + point de contact ----
  const tangentColor = "#dc2626";
  if (tangent && tangent.impossible === undefined) {
    const clip = clipSegment(
      px(xmin), py(tangent.m * xmin + tangent.b),
      px(xmax), py(tangent.m * xmax + tangent.b),
      M.left, M.top, M.left + plotW, M.top + plotH
    );
    if (clip) {
      extraSvg += `<line x1="${fmtPx(clip[0].x)}" y1="${fmtPx(clip[0].y)}" x2="${fmtPx(clip[1].x)}" y2="${fmtPx(clip[1].y)}" stroke="${tangentColor}" stroke-width="2" stroke-dasharray="6 4"/>`;
    }
    extraSvg += `<circle cx="${fmtPx(px(tangent.x0))}" cy="${fmtPx(py(tangent.y0))}" r="4.5" fill="${tangentColor}" stroke="#ffffff" stroke-width="1.5"/>`;
  }

  // ---- légende : branches infinies / asymptotes / tangente ----
  const legendEntries = [];
  for (const x0 of verticales) {
    legendEntries.push({ text: `Asymptote verticale : x = ${fmtNum(x0)}`, color: asymptoteColor });
  }
  for (const h of horizontales) {
    legendEntries.push({ text: `Asymptote horizontale : y = ${fmtNum(h.y)}`, color: asymptoteColor });
  }
  for (const o of obliques) {
    legendEntries.push({ text: `Asymptote oblique : ${formatAffine(o.a, o.b)}`, color: asymptoteColor });
  }
  const para = branches.filter((b) => b.type === "parabolique");
  if (para.length) {
    legendEntries.push({
      text: `Branche parabolique (${para[0].direction}) en ${para.map((b) => b.side).join(" et ")}`,
      color: asymptoteColor,
    });
  }
  if (tangent) {
    if (tangent.impossible === undefined) {
      legendEntries.push({ text: `Tangente en x = ${fmtNum(tangent.x0)} : ${tangent.equation}`, color: tangentColor });
    } else {
      legendEntries.push({ text: `Tangente en x = ${fmtNum(tangent.x0)} : impossible`, color: tangentColor });
    }
  }
  // dédoublonnage (même asymptote des deux côtés)
  const seen = new Set();
  const legend = legendEntries.filter((e) => {
    if (seen.has(e.text)) return false;
    seen.add(e.text);
    return true;
  });

  let legendSvg = "";
  if (legend.length) {
    const fs = 11.5;
    const pad = 8;
    const lineH = 16;
    const maxW = Math.max(...legend.map((e) => e.text.length)) * 6.6 + 2 * pad + 14;
    const boxW = Math.min(plotW - 8, maxW);
    const boxH = legend.length * lineH + 2 * pad;
    const bx = M.left + plotW - boxW - 6;
    const by = M.top + plotH - boxH - 6;
    legendSvg =
      `<rect x="${bx}" y="${by}" width="${boxW}" height="${boxH}" fill="#ffffff" fill-opacity="0.92" stroke="#cbd5e1" stroke-width="1" rx="6"/>`;
    legend.forEach((e, i) => {
      const ty = by + pad + (i + 0.8) * lineH;
      legendSvg += `<circle cx="${bx + pad + 3.5}" cy="${ty - 4}" r="3" fill="${e.color}"/>`;
      legendSvg += `<text x="${bx + pad + 11}" y="${ty}" font-size="${fs}" fill="#334155">${escapeXml(e.text)}</text>`;
    });
  }

  const title = optTitle ? String(optTitle) : `f(x) = ${display}`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" role="img" aria-label="${escapeXml(title)}">` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${width / 2}" y="28" text-anchor="middle" font-size="17" font-weight="600" fill="#1e293b">${escapeXml(title)}</text>` +
    grid +
    frame +
    axesSvg +
    extraSvg +
    (d
      ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
      : "") +
    labels +
    legendSvg +
    `<text x="${M.left + plotW - 6}" y="${(axisX ? py(0) : M.top + plotH) - 8}" text-anchor="end" font-size="13" font-style="italic" fill="#475569">x</text>` +
    `<text x="${(axisY ? px(0) : M.left) + 10}" y="${M.top + 4}" text-anchor="start" font-size="13" font-style="italic" fill="#475569">y</text>` +
    `</svg>`;

  const points = pts
    .filter((p) => isNum(p.y))
    .map((p) => [Number(p.x.toPrecision(8)), Number(p.y.toPrecision(8))]);

  return {
    svg,
    points,
    expression: display,
    domain: { xmin: Number(xmin.toPrecision(10)), xmax: Number(xmax.toPrecision(10)) },
    range: { ymin: Number(ymin.toPrecision(10)), ymax: Number(ymax.toPrecision(10)) },
    size: { width, height },
    samples,
    asymptotes: {
      verticales: verticales.map((x0) => ({ x: Number(x0.toPrecision(10)) })),
      horizontales: horizontales.map((h) => ({ y: Number(h.y.toPrecision(10)), side: h.side })),
      obliques: obliques.map((o) => ({
        a: Number(o.a.toPrecision(8)),
        b: Number(o.b.toPrecision(8)),
        side: o.side,
      })),
    },
    branches: branches.map((b) => ({
      side: b.side,
      type: b.type,
      ...(b.asymptote ? { asymptote: { a: b.asymptote.a, b: b.asymptote.b, y: b.asymptote.y } } : {}),
      ...(b.direction ? { direction: b.direction } : {}),
    })),
    tangente: tangent,
  };
}

module.exports = { parseExpression, evaluate, sample, buildFigure, normalizeInput };
