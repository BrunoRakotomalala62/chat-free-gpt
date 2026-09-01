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
 * 4. Génération de la figure SVG
 * ---------------------------------------------------------------- */

const M = { left: 70, right: 26, top: 48, bottom: 54 }; // marges (px)

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
 * @param {object} opts { expression, xmin, xmax, ymin, ymax, width, height, samples, color, title }
 * @returns {object} { svg, points, expression, domain, range, size, samples }
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

  const title = optTitle ? String(optTitle) : `f(x) = ${display}`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" role="img" aria-label="${escapeXml(title)}">` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${width / 2}" y="28" text-anchor="middle" font-size="17" font-weight="600" fill="#1e293b">${escapeXml(title)}</text>` +
    grid +
    frame +
    axesSvg +
    (d
      ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
      : "") +
    labels +
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
  };
}

module.exports = { parseExpression, evaluate, sample, buildFigure, normalizeInput };
