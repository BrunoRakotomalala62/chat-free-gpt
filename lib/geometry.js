/**
 * lib/geometry.js — Moteur de construction géométrique DÉTERMINISTE.
 * Aucune dépendance externe (zéro npm install).
 *
 * Interprète un énoncé d'exercice de géométrie (plusieurs questions successives)
 * et construit UNE figure SVG exacte et cumulative : chaque question ajoute son
 * élément à la figure (droites, segments, cercles, perpendiculaires, parallèles,
 * milieux, médiatrices, médianes, hauteurs, bissectrices, intersections…).
 *
 * Méthode « vraie » : toutes les constructions sont CALCULÉES (coordonnées
 * exactes) — aucune hallucination IA. Exemple d'énoncé :
 *   « Soit A et B deux points. 1) Tracer la droite (AB). 2) Placer un point P
 *    sur (AB). 3) Tracer la droite passant par P perpendiculaire à (AB).
 *    4) Tracer la droite passant par P parallèle à (AB). »
 *
 * NB : les regex des interpréteurs sont volontairement SANS drapeau i —
 * les noms de points sont des MAJUSCULES (« de [AB] » ne doit pas créer des
 * points « d » et « e ») ; interpretStep met la première lettre en majuscule
 * pour les mots-clés de début d'étape.
 */

"use strict";

/* ---------------------------------------------------------------- *
 * 1. Géométrie élémentaire (calculs exacts)
 * ---------------------------------------------------------------- */

const EPS = 1e-9;
const isNum = (v) => Number.isFinite(v);

function dist(p, q) {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

function midpoint(p, q) {
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

/** Droite ax + by + c = 0 passant par p et q (normalisée). */
function lineThrough(p, q) {
  const a = p.y - q.y;
  const b = q.x - p.x;
  const c = -(a * p.x + b * p.y);
  return { a, b, c };
}

/** Intersection de deux droites (null si parallèles/confondues). */
function intersectLines(L1, L2) {
  const det = L1.a * L2.b - L2.a * L1.b;
  if (Math.abs(det) < EPS) return null;
  const x = (L1.b * L2.c - L2.b * L1.c) / det;
  const y = (L2.a * L1.c - L1.a * L2.c) / det;
  return { x, y };
}

/** Projection orthogonale de P sur la droite L. */
function projectOnLine(p, L) {
  const d = L.a * L.a + L.b * L.b;
  if (d < EPS) return null;
  const t = -(L.a * p.x + L.b * p.y + L.c) / d;
  return { x: p.x + L.a * t, y: p.y + L.b * t };
}

/* ---------------------------------------------------------------- *
 * 2. Modèle de la figure
 * ---------------------------------------------------------------- */

const FREE_POINTS = {
  A: [2, 3], B: [7, 3], C: [4.5, 6.5], D: [9, 1.5], E: [0.8, 5.2],
  F: [6.5, 0.8], G: [3.2, 8], H: [10, 5.5], I: [5, 8.5], J: [11, 2.5],
  K: [1, 1], L: [8, 8], M: [9.5, 7], N: [0.5, 8], O: [6, 4.5],
  P: [1.5, 1.5], Q: [10.5, 8.5], R: [8.5, 0.5], S: [3, 0.6], T: [0.8, 3.5],
  U: [11.5, 6], V: [5.5, 2.5], W: [7.5, 6.5], X: [0.2, 6.5], Y: [11.8, 1.2], Z: [4, 9],
};

/** Position libre par défaut d'un point jamais défini (lettre connue → position fixe). */
function defaultFreePoint(name) {
  if (FREE_POINTS[name]) return { x: FREE_POINTS[name][0], y: FREE_POINTS[name][1] };
  // au-delà de Z : spirale déterministe autour du centre
  const idx = name.charCodeAt(0) - 65;
  const angle = (idx * 137.5 * Math.PI) / 180; // nombre d'or
  const r = 0.9 + (idx % 6) * 0.7;
  return { x: 6 + r * Math.cos(angle), y: 4.5 + r * Math.sin(angle) * 0.8 };
}

function createModel() {
  return {
    points: {},   // nom → { x, y, step }
    lines: [],    // { name, kind: 'line'|'segment'|'ray', from, to, pts: [noms], step, label }
    circles: [],  // { name, center, radius, pts, step, label }
    marks: [],    // angles droits : { at, u, v, step }
    steps: [],    // { raw, kind, label, color }
    triangle: null, // dernier triangle tracé (hauteur/médiane sans « triangle » explicite)
    lineCounter: 0,
  };
}

const STEP_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
const BLACK = "#1e293b";

function ensurePoint(model, name, pos) {
  if (!model.points[name]) {
    model.points[name] = { x: pos.x, y: pos.y, step: model.steps.length };
  }
  return model.points[name];
}

function getPoint(model, name) {
  return model.points[name] || null;
}

function ensureDefinedPoint(model, name) {
  const p = getPoint(model, name);
  if (p) return p;
  const d = defaultFreePoint(name);
  return ensurePoint(model, name, d);
}

/** Nom de droite construite : (d), (d'), (d₁), (d₂)… */
function nextLineName(model) {
  model.lineCounter++;
  if (model.lineCounter === 1) return "(d)";
  if (model.lineCounter === 2) return "(d')";
  const sub = "\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089";
  const idx = model.lineCounter - 2;
  return `(d${idx <= 9 ? sub[idx - 1] : idx})`;
}

function pushLine(model, { name, kind, from, to, pts, label, step }) {
  const l = { name, kind: kind || "line", from, to, pts: pts || [], step: step === undefined ? model.steps.length : step, label };
  model.lines.push(l);
  return l;
}

function pushCircle(model, { name, center, radius, pts, label, step }) {
  const c = { name, center, radius, pts: pts || [], step: step === undefined ? model.steps.length : step, label };
  model.circles.push(c);
  return c;
}

function pushMark(model, { at, u, v, step }) {
  model.marks.push({ at, u, v, step: step === undefined ? model.steps.length : step });
}

/* ---------------------------------------------------------------- *
 * 3. Découpage de l'énoncé en étapes
 * ---------------------------------------------------------------- */

/**
 * Découpe un énoncé en étapes : items numérotés (« 1) », « 2. », « Q3 : »,
 * « a) »…) puis phrases (points, points-virgules, retours à la ligne).
 */
function splitSteps(text) {
  const t = String(text || "")
    .replace(/\r/g, "")
    .replace(/[«»"]/g, "")
    .replace(/^\s*(?:exercice\s*\d*\s*[:.\-–—]?\s*)+/i, "") // « Exercice 1 : » en tête
    .trim();
  if (!t) return [];
  const parts = [];
  // items numérotés (« 1) », « 2. », « a) », « Q3 : »…) + retours à la ligne
  const chunks = t.split(/\s+(?=\d+\s*[)\.:]\s*|[a-z][)\.]\s+|[Qq]\d+\s*[:.)])|\n+/);
  for (const chunk of chunks) {
    // phrases : point / point-virgule / ! suivi d'une majuscule ou d'une parenthèse
    const sub = chunk.split(/(?<=[.;!?])\s+(?=[A-Z(])/);
    for (const s of sub) {
      const v = s.trim();
      if (v) parts.push(v);
    }
  }
  return parts;
}

/* ---------------------------------------------------------------- *
 * 4. Interprétation d'une étape
 * ---------------------------------------------------------------- */

const APOS = /['’]/g;

function trySoit(model, s) {
  // « Soit A et B deux points », « Soient A, B, C trois points », « On considère les points A et B »
  let m = s.match(/^Soi(?:t|ent)\s+([A-Z])(?:\s*,\s*([A-Z]))?(?:\s*et\s+([A-Z]))?\s+(?:des|deux|trois|quatre|cinq|six)?\s*points?$/);
  if (!m) m = s.match(/^On consid[eè]re\s+(?:les\s+)?points?\s+([A-Z])(?:\s*,\s*([A-Z]))?(?:\s*et\s+([A-Z]))?$/);
  if (!m) return null;
  const names = [m[1], m[2], m[3]].filter(Boolean);
  if (!names.length) return null;
  names.forEach((n) => ensureDefinedPoint(model, n));
  return { kind: "soit", label: `points ${names.join(" et ")}` };
}

function tryTriangle(model, s) {
  // « Tracer le triangle ABC », « triangle ABC rectangle en A »
  const m = s.match(/triangle\s+([A-Z])([A-Z])([A-Z])(?:\s+(?:rectangle|isoc[eè]le|[\u00e9e]quilat[eé]ral)\s+en\s+([A-Z]))?/);
  if (!m) return null;
  const [A, B, C] = [m[1], m[2], m[3]];
  if (A === B || B === C || A === C) return null;
  const pa = ensureDefinedPoint(model, A);
  const pb = ensureDefinedPoint(model, B);
  const pc = ensureDefinedPoint(model, C);
  pushLine(model, { name: `[${A}${B}]`, kind: "segment", from: pa, to: pb, pts: [A, B], label: `segment [${A}${B}]` });
  pushLine(model, { name: `[${B}${C}]`, kind: "segment", from: pb, to: pc, pts: [B, C], label: `segment [${B}${C}]` });
  pushLine(model, { name: `[${C}${A}]`, kind: "segment", from: pc, to: pa, pts: [C, A], label: `segment [${C}${A}]` });
  let label = `triangle ${A}${B}${C}`;
  if (m[4]) {
    const right = m[4];
    if (right === A) pushMark(model, { at: pa, u: { x: pb.x - pa.x, y: pb.y - pa.y }, v: { x: pc.x - pa.x, y: pc.y - pa.y } });
    else if (right === B) pushMark(model, { at: pb, u: { x: pa.x - pb.x, y: pa.y - pb.y }, v: { x: pc.x - pb.x, y: pc.y - pb.y } });
    else pushMark(model, { at: pc, u: { x: pa.x - pc.x, y: pa.y - pc.y }, v: { x: pb.x - pc.x, y: pb.y - pc.y } });
    label += ` rectangle en ${right}`;
  }
  model.triangle = [A, B, C]; // pour hauteur/médiane sans « triangle » explicite
  return { kind: "triangle", label };
}

function tryQuadrilateral(model, s) {
  // « quadrilatère/carré/rectangle/losange/parallélogramme ABCD »
  const m = s.match(/(carr[eé]|rectangle|losange|parall[eé]logramme|quadrilat[eè]re)\s+([A-Z])([A-Z])([A-Z])([A-Z])/);
  if (!m) return null;
  const shape = m[1].toLowerCase();
  const [A, B, C, D] = [m[2], m[3], m[4], m[5]];
  if (new Set([A, B, C, D]).size < 4) return null;
  const shapes = {
    "carré": { A: [2, 3], B: [7, 3], C: [7, 8], D: [2, 8] },
    "rectangle": { A: [2, 3], B: [8, 3], C: [8, 6.5], D: [2, 6.5] },
    "losange": { A: [3, 3], B: [7, 3.6], C: [6, 7.4], D: [2, 6.8] },
    "parallélogramme": { A: [2, 3], B: [7, 3], C: [9, 6], D: [4, 6] },
    "quadrilatère": null,
  };
  const defs = shapes[shape];
  if (defs) {
    for (const n of [A, B, C, D]) ensurePoint(model, n, { x: defs[n][0], y: defs[n][1] });
  } else {
    for (const n of [A, B, C, D]) ensureDefinedPoint(model, n);
  }
  const pa = getPoint(model, A), pb = getPoint(model, B), pc = getPoint(model, C), pd = getPoint(model, D);
  pushLine(model, { name: `[${A}${B}]`, kind: "segment", from: pa, to: pb, pts: [A, B], label: `segment [${A}${B}]` });
  pushLine(model, { name: `[${B}${C}]`, kind: "segment", from: pb, to: pc, pts: [B, C], label: `segment [${B}${C}]` });
  pushLine(model, { name: `[${C}${D}]`, kind: "segment", from: pc, to: pd, pts: [C, D], label: `segment [${C}${D}]` });
  pushLine(model, { name: `[${D}${A}]`, kind: "segment", from: pd, to: pa, pts: [D, A], label: `segment [${D}${A}]` });
  return { kind: "quadrilatère", label: `${shape} ${A}${B}${C}${D}` };
}

function tryPointOn(model, s) {
  // « Placer le point P sur la droite (AB) », « Placer un point P sur (AB) »,
  // « Soit P un point de (AB) », « P appartient à (AB) », « P ∈ (AB) »,
  // « sur le segment [AB] », « sur le cercle (O) »
  const sup = "(?:la\\s+droite\\s+|le\\s+segment\\s+|le\\s+cercle\\s+)?(?:\\(?([A-Z]{2})\\)?|\\[?([A-Z]{2})\\]?|\\(([A-Z])\\))";
  let m = s.match(new RegExp("Placer\\s+(?:(?:le|un)\\s+)?point\\s+([A-Z])\\s+sur\\s+" + sup));
  if (!m) m = s.match(new RegExp("Soi(?:t|ent)\\s+([A-Z])\\s+un\\s+point\\s+(?:de|sur)\\s+" + sup));
  if (!m) m = s.match(new RegExp("([A-Z])\\s+appartient\\s+[àa]\\s+" + sup));
  if (!m) m = s.match(/([A-Z])\s*[∈]\s*(?:\(([A-Z]{2})\)|\[([A-Z]{2})\]|\(([A-Z])\))/);
  if (!m) return null;
  const name = m[1];
  const linePts = m[2] || m[3];
  const circleName = m[4];
  let label = "";
  if (linePts) {
    const [X, Y] = [linePts[0], linePts[1]];
    const px = ensureDefinedPoint(model, X);
    const py = ensureDefinedPoint(model, Y);
    const onSegment = /segment/.test(s) || /\[/.test(s);
    const t = 0.5; // milieu du segment — position déterministe et lisible
    ensurePoint(model, name, { x: px.x + t * (py.x - px.x), y: px.y + t * (py.y - px.y) });
    label = `point ${name} sur ${onSegment ? `le segment [${X}${Y}]` : `la droite (${X}${Y})`}`;
  } else if (circleName) {
    const c = model.circles.find((c2) => c2.pts[0] === circleName);
    const center = c ? c.center : ensureDefinedPoint(model, circleName);
    const r = c ? c.radius : 2;
    const angle = ((name.charCodeAt(0) - 65) * 137.5 * Math.PI) / 180;
    ensurePoint(model, name, { x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) });
    label = `point ${name} sur le cercle (${circleName})`;
  } else {
    return null;
  }
  return { kind: "point", label };
}

function tryLineByPoints(model, s) {
  // « Tracer la droite passant par A et B », « Tracer (AB) », « la droite (AB) »
  let m = s.match(/droite\s+passant\s+par\s+([A-Z])\s+et\s+([A-Z])/);
  let pts = null;
  if (m) pts = [m[1], m[2]];
  else {
    m = s.match(/\(([A-Z])([A-Z])\)/);
    if (m && !/perpendiculaire|parall[eè]le|m[eé]diatrice|bissectrice|intersection/.test(s)) pts = [m[1], m[2]];
  }
  if (!pts || pts[0] === pts[1]) return null;
  const [X, Y] = pts;
  const name = `(${X}${Y})`;
  if (model.lines.some((l) => l.name === name && l.kind === "line")) return null; // déjà tracée
  const px = ensureDefinedPoint(model, X);
  const py = ensureDefinedPoint(model, Y);
  pushLine(model, { name, kind: "line", from: px, to: py, pts: [X, Y], label: `droite (${X}${Y})` });
  return { kind: "droite", label: `droite (${X}${Y})` };
}

function trySegment(model, s) {
  const m = s.match(/segment\s*\[([A-Z])([A-Z])\]/) || s.match(/\[([A-Z])([A-Z])\]/);
  if (!m || m[1] === m[2]) return null;
  const [X, Y] = [m[1], m[2]];
  const px = ensureDefinedPoint(model, X);
  const py = ensureDefinedPoint(model, Y);
  pushLine(model, { name: `[${X}${Y}]`, kind: "segment", from: px, to: py, pts: [X, Y], label: `segment [${X}${Y}]` });
  return { kind: "segment", label: `segment [${X}${Y}]` };
}

function tryRay(model, s) {
  const m = s.match(/demi[- ]droite\s*\[([A-Z])([A-Z])\)/) || s.match(/\[([A-Z])([A-Z])\)/);
  if (!m || m[1] === m[2]) return null;
  const [X, Y] = [m[1], m[2]];
  const px = ensureDefinedPoint(model, X);
  const py = ensureDefinedPoint(model, Y);
  pushLine(model, { name: `[${X}${Y})`, kind: "ray", from: px, to: py, pts: [X, Y], label: `demi-droite [${X}${Y})` });
  return { kind: "demi-droite", label: `demi-droite [${X}${Y})` };
}

/** Dernière droite (infinie) tracée — référence implicite (« la perpendiculaire en P »). */
function lastLineRef(model) {
  for (let i = model.lines.length - 1; i >= 0; i--) {
    if (model.lines[i].kind === "line") return model.lines[i];
  }
  return null;
}

function tryPerp(model, s) {
  // « perpendiculaire à (AB) passant par P », « la droite passant par P perpendiculaire à (AB) »,
  // « la perpendiculaire à (AB) en P », « Tracer la perpendiculaire en P » (repli : dernière droite)
  if (!/perpendiculaire/.test(s)) return null;
  let m = s.match(/perpendiculaire\s+[àa]\s+(?:la\s+droite\s+)?\(?([A-Z]{2})\)?\s*(?:passant\s+par|en)\s+([A-Z])/);
  let linePts = null, pointName = null;
  if (m) { linePts = m[1]; pointName = m[2]; }
  else {
    m = s.match(/(?:passant\s+par|en)\s+([A-Z])\s+perpendiculaire\s+[àa]\s+(?:la\s+droite\s+)?\(?([A-Z]{2})\)?/);
    if (m) { pointName = m[1]; linePts = m[2]; }
    else {
      m = s.match(/perpendiculaire\s+(?:passant\s+par|en)\s+([A-Z])/);
      if (m) pointName = m[1];
      else {
        m = s.match(/(?:passant\s+par|en)\s+([A-Z])\s+perpendiculaire/);
        if (m) pointName = m[1];
      }
    }
  }
  if (!pointName) return null;
  const pp = ensureDefinedPoint(model, pointName);
  let refLine = null;
  if (linePts) refLine = model.lines.find((l) => l.pts.join("") === linePts);
  if (!refLine) refLine = lastLineRef(model); // « la perpendiculaire en P »
  if (!refLine) return null;
  const dx = refLine.to.x - refLine.from.x;
  const dy = refLine.to.y - refLine.from.y;
  const q = { x: pp.x - dy, y: pp.y + dx }; // direction perpendiculaire
  const name = nextLineName(model);
  const refName = linePts ? `(${linePts})` : refLine.name;
  pushLine(model, { name, kind: "line", from: pp, to: q, pts: [pointName], label: `${name} \u22a5 ${refName} en ${pointName}` });
  pushMark(model, { at: pp, u: { x: dx, y: dy }, v: { x: -dy, y: dx } });
  return { kind: "perpendiculaire", label: `${name} perpendiculaire \u00e0 ${refName} en ${pointName}` };
}

function tryParallel(model, s) {
  // « parallèle à (AB) passant par P », « la droite passant par P parallèle à (AB) »
  if (!/parall[eè]le/.test(s)) return null;
  let m = s.match(/parall[eè]le\s+[àa]\s+(?:la\s+droite\s+)?\(?([A-Z]{2})\)?\s*(?:passant\s+par|en)\s+([A-Z])/);
  let linePts = null, pointName = null;
  if (m) { linePts = m[1]; pointName = m[2]; }
  else {
    m = s.match(/(?:passant\s+par|en)\s+([A-Z])\s+parall[eè]le\s+[àa]\s+(?:la\s+droite\s+)?\(?([A-Z]{2})\)?/);
    if (m) { pointName = m[1]; linePts = m[2]; }
    else {
      m = s.match(/parall[eè]le\s+(?:passant\s+par|en)\s+([A-Z])/);
      if (m) pointName = m[1];
      else {
        m = s.match(/(?:passant\s+par|en)\s+([A-Z])\s+parall[eè]le/);
        if (m) pointName = m[1];
      }
    }
  }
  if (!pointName) return null;
  const pp = ensureDefinedPoint(model, pointName);
  let refLine = null;
  if (linePts) refLine = model.lines.find((l) => l.pts.join("") === linePts);
  if (!refLine) refLine = lastLineRef(model);
  if (!refLine) return null;
  const dx = refLine.to.x - refLine.from.x;
  const dy = refLine.to.y - refLine.from.y;
  const q = { x: pp.x + dx, y: pp.y + dy };
  const name = nextLineName(model);
  const refName = linePts ? `(${linePts})` : refLine.name;
  pushLine(model, { name, kind: "line", from: pp, to: q, pts: [pointName], label: `${name} \u2225 ${refName}` });
  return { kind: "parallèle", label: `${name} parall\u00e8le \u00e0 ${refName} en ${pointName}` };
}

function tryCircle(model, s) {
  // « Cercle de centre O passant par B », « Cercle de centre O de rayon 3 cm »,
  // « Cercle (C) de centre O et de rayon 2 »
  let m = s.match(/cercle\s+(?:\(([A-Z])\)\s+)?de\s+centre\s+([A-Z])\s+(?:passant\s+par\s+([A-Z])|(?:et\s+)?de\s+rayon\s+(\d+(?:[.,]\d+)?))/);
  if (!m) return null;
  const centerName = m[2];
  const through = m[3];
  const radiusRaw = m[4];
  const center = ensureDefinedPoint(model, centerName);
  let radius;
  if (through) {
    const pt = ensureDefinedPoint(model, through);
    radius = dist(center, pt);
  } else if (radiusRaw) {
    radius = Number(radiusRaw.replace(",", "."));
  } else {
    radius = 2;
  }
  const name = m[1] ? `(${m[1]})` : `(\u03c9${model.circles.length + 1})`;
  pushCircle(model, { name, center, radius, pts: [centerName], label: `cercle ${name} de centre ${centerName}` });
  return { kind: "cercle", label: `cercle ${name} de centre ${centerName}${through ? ` passant par ${through}` : ` de rayon ${radiusRaw || radius}`}` };
}

function tryMidpoint(model, s) {
  // « Soit M le milieu de [AB] », « Placer le point M milieu de [AB] », « le milieu de [AB] »
  let m = s.match(/(?:point\s+)?([A-Z])\s+(?:est\s+)?le\s+milieu\s+(?:(?:du\s+segment|de)\s+)?\[?([A-Z])([A-Z])\]?/)
    || s.match(/milieu\s+(?:(?:du\s+segment|de)\s+)?\[?([A-Z])([A-Z])\]?/);
  if (!m) return null;
  const name = m[1] && /^[A-Z]$/.test(m[1]) ? m[1] : "I";
  const [X, Y] = m.length >= 4 ? [m[2], m[3]] : [m[1], m[2]];
  if (X === Y) return null;
  const px = ensureDefinedPoint(model, X);
  const py = ensureDefinedPoint(model, Y);
  ensurePoint(model, name, midpoint(px, py));
  return { kind: "milieu", label: `${name} milieu de [${X}${Y}]` };
}

function tryMediatrice(model, s) {
  const m = s.match(/m[eé]diatrice\s+(?:(?:du\s+segment|de)\s+)?\[?([A-Z])([A-Z])\]?/);
  if (!m || m[1] === m[2]) return null;
  const [X, Y] = [m[1], m[2]];
  const px = ensureDefinedPoint(model, X);
  const py = ensureDefinedPoint(model, Y);
  const mid = midpoint(px, py);
  const dx = py.x - px.x;
  const dy = py.y - px.y;
  const q = { x: mid.x - dy, y: mid.y + dx };
  const name = nextLineName(model);
  pushLine(model, { name, kind: "line", from: mid, to: q, pts: [], label: `${name} m\u00e9diatrice de [${X}${Y}]` });
  return { kind: "médiatrice", label: `${name} m\u00e9diatrice de [${X}${Y}]` };
}

function tryMedian(model, s) {
  // « Médiane issue de A dans le triangle ABC » (ou triangle déjà tracé)
  let m = s.match(/m[eé]diane\s+issue\s+de\s+([A-Z])\s+(?:du|dans\s+le)\s+triangle\s+([A-Z])([A-Z])([A-Z])/);
  let T1, T2, T3, from;
  if (m) { from = m[1]; T1 = m[2]; T2 = m[3]; T3 = m[4]; }
  else {
    const m2 = s.match(/m[eé]diane\s+issue\s+de\s+([A-Z])/);
    if (!m2 || !model.triangle) return null;
    from = m2[1]; T1 = model.triangle[0]; T2 = model.triangle[1]; T3 = model.triangle[2];
  }
  const others = [T1, T2, T3].filter((n) => n !== from);
  if (others.length !== 2) return null;
  const pA = ensureDefinedPoint(model, from);
  const pB = ensureDefinedPoint(model, others[0]);
  const pC = ensureDefinedPoint(model, others[1]);
  const mid = midpoint(pB, pC);
  const name = nextLineName(model);
  pushLine(model, { name, kind: "segment", from: pA, to: mid, pts: [], label: `${name} m\u00e9diane issue de ${from}` });
  return { kind: "médiane", label: `${name} m\u00e9diane issue de ${from} du triangle ${T1}${T2}${T3}` };
}

function tryAltitude(model, s) {
  // « Hauteur issue de A du triangle ABC » (ou triangle déjà tracé)
  let m = s.match(/hauteur\s+issue\s+de\s+([A-Z])\s+(?:du|dans\s+le)\s+triangle\s+([A-Z])([A-Z])([A-Z])/);
  let T1, T2, T3, from;
  if (m) { from = m[1]; T1 = m[2]; T2 = m[3]; T3 = m[4]; }
  else {
    const m2 = s.match(/hauteur\s+issue\s+de\s+([A-Z])/);
    if (!m2 || !model.triangle) return null;
    from = m2[1]; T1 = model.triangle[0]; T2 = model.triangle[1]; T3 = model.triangle[2];
  }
  const others = [T1, T2, T3].filter((n) => n !== from);
  if (others.length !== 2) return null;
  const pA = ensureDefinedPoint(model, from);
  const pB = ensureDefinedPoint(model, others[0]);
  const pC = ensureDefinedPoint(model, others[1]);
  // hauteur : par A, perpendiculaire à (BC)
  const dx = pC.x - pB.x;
  const dy = pC.y - pB.y;
  const q = { x: pA.x - dy, y: pA.y + dx };
  const foot = projectOnLine(pA, lineThrough(pB, pC));
  const name = nextLineName(model);
  pushLine(model, { name, kind: "segment", from: pA, to: foot || q, pts: [], label: `${name} hauteur issue de ${from}` });
  if (foot) pushMark(model, { at: foot, u: { x: dx, y: dy }, v: { x: -dy, y: dx } });
  return { kind: "hauteur", label: `${name} hauteur issue de ${from} du triangle ${T1}${T2}${T3}` };
}

function tryBisector(model, s) {
  // « Bissectrice de l'angle ABC » (sommet = B)
  const m = s.match(/bissectrice\s+(?:de\s+l['’]angle\s+|de\s+l\s*angle\s+)([A-Z])([A-Z])([A-Z])/);
  if (!m) return null;
  const [X, A, Y] = [m[1], m[2], m[3]];
  const pA = ensureDefinedPoint(model, A);
  const pX = ensureDefinedPoint(model, X);
  const pY = ensureDefinedPoint(model, Y);
  const d1 = { x: pX.x - pA.x, y: pX.y - pA.y };
  const d2 = { x: pY.x - pA.x, y: pY.y - pA.y };
  const n1 = Math.hypot(d1.x, d1.y) || 1;
  const n2 = Math.hypot(d2.x, d2.y) || 1;
  const dir = { x: d1.x / n1 + d2.x / n2, y: d1.y / n1 + d2.y / n2 };
  const q = { x: pA.x + dir.x, y: pA.y + dir.y };
  const name = nextLineName(model);
  pushLine(model, { name, kind: "ray", from: pA, to: q, pts: [], label: `${name} bissectrice de l'angle ${X}${A}${Y}` });
  return { kind: "bissectrice", label: `${name} bissectrice de l'angle ${X}${A}${Y}` };
}

function tryIntersection(model, s) {
  // « Les droites (AB) et (CD) se coupent en M », « intersection de (AB) et (CD) »
  let m = s.match(/se\s+coupent\s+en\s+([A-Z])/) || s.match(/intersection\s+.*?\ben\s+([A-Z])/);
  if (!m) return null;
  const name = m[1];
  const cited = [...s.matchAll(/\(([A-Z]{2})\)/g)].map((x) => x[1]);
  let l1 = null, l2 = null;
  if (cited.length >= 2) {
    l1 = model.lines.find((l) => l.pts.join("") === cited[0]);
    l2 = model.lines.find((l) => l.pts.join("") === cited[1]);
  }
  if (!l1 || !l2) {
    const lines = model.lines.filter((l) => l.kind === "line");
    if (lines.length >= 2) {
      l2 = lines[lines.length - 1];
      l1 = lines[lines.length - 2];
    }
  }
  if (!l1 || !l2 || l1 === l2) return null;
  const p = intersectLines(lineThrough(l1.from, l1.to), lineThrough(l2.from, l2.to));
  if (!p) return null;
  ensurePoint(model, name, p);
  return { kind: "intersection", label: `${name} = ${l1.name} \u2229 ${l2.name}` };
}

const HANDLERS = [
  trySoit, tryTriangle, tryQuadrilateral, tryPointOn, tryPerp, tryParallel,
  tryCircle, tryMidpoint, tryMediatrice, tryMedian, tryAltitude, tryBisector,
  tryIntersection, tryRay, trySegment, tryLineByPoints,
];

/**
 * Interprète une étape : applique la construction au modèle.
 * @returns {object|null} { kind, label }
 */
function interpretStep(model, raw) {
  let s = String(raw || "").trim().replace(APOS, "'");
  if (!s) return null;
  // retire les marqueurs de numérotation (« 1) », « a) », « Q3 : »…) et la
  // ponctuation finale (« Soient A et B deux points. »)
  s = s.replace(/^(?:\d+\s*[)\.:]\s*|[a-z][)\.]\s+|[Qq]\d+\s*[:.)]\s*)+/i, "").trim();
  s = s.replace(/[.;:!?]+$/, "").trim();
  if (!s) return null;
  // Deux essais : le texte d'origine (noms de points en MAJUSCULES), puis la
  // première lettre en minuscule (mots-clés de début d'étape : « Cercle »…).
  // Les regex sont volontairement SANS drapeau i — « de [AB] » ne doit pas
  // créer des points « d » et « e ».
  const variants = [s, s.charAt(0).toLowerCase() + s.slice(1)];
  for (const v of variants) {
    for (const fn of HANDLERS) {
      try {
        const r = fn(model, v);
        if (r) return r;
      } catch (e) {
        // étape incompréhensible/erronée : on continue
      }
    }
  }
  return null;
}

/* ---------------------------------------------------------------- *
 * 5. Rendu SVG
 * ---------------------------------------------------------------- */

const PAD = 46;
const fmtPx = (v) => String(Math.round(v * 100) / 100);

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Clippe un segment au rectangle (Cohen–Sutherland). */
function clipSegment(ax, ay, bx, by, x0, y0, x1, y1) {
  let p = { x: ax, y: ay };
  let q = { x: bx, y: by };
  const code = (pt) =>
    (pt.x < x0 ? 1 : 0) | (pt.x > x1 ? 2 : 0) | (pt.y < y0 ? 4 : 0) | (pt.y > y1 ? 8 : 0);
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

/**
 * Construit la figure géométrique SVG.
 * @param {object} opts { text, width, height, title }
 * @returns {object} { svg, steps, points, lines, circles, interpreted }
 */
function buildGeoFigure(opts = {}) {
  const text = String(opts.text || "").trim();
  if (!text) throw new Error("Paramètre 'text' manquant (énoncé de l'exercice).");

  const width = Math.min(2400, Math.max(400, Math.round(Number(opts.width) || 820)));
  const height = Math.min(1600, Math.max(400, Math.round(Number(opts.height) || 620)));

  const model = createModel();
  const rawSteps = splitSteps(text);
  const interpreted = [];

  for (const raw of rawSteps) {
    const r = interpretStep(model, raw);
    if (r) {
      interpreted.push({ raw, ...r });
      model.steps.push({ raw, kind: r.kind, label: r.label, color: STEP_COLORS[model.steps.length % STEP_COLORS.length] });
    }
  }

  if (!interpreted.length) {
    throw new Error(
      "Aucune construction géométrique reconnue dans l'énoncé. " +
      "Exemples : « Tracer la droite passant par A et B », « Placer un point P sur (AB) », « Tracer la droite passant par P perpendiculaire à (AB) », « Cercle de centre O de rayon 3 cm »…"
    );
  }

  // ---- échelle : englober tous les points + cercles ----
  const xs = [0, 12], ys = [0, 9];
  for (const p of Object.values(model.points)) {
    xs.push(p.x); ys.push(p.y);
  }
  for (const c of model.circles) {
    xs.push(c.center.x - c.radius, c.center.x + c.radius);
    ys.push(c.center.y - c.radius, c.center.y + c.radius);
  }
  let xmin = Math.min(...xs), xmax = Math.max(...xs);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (xmax - xmin < 0.5) { xmin -= 1; xmax += 1; }
  if (ymax - ymin < 0.5) { ymin -= 1; ymax += 1; }
  const pad = 0.8;
  xmin -= pad; xmax += pad; ymin -= pad; ymax += pad;

  const scale = Math.min((width - 2 * PAD) / (xmax - xmin), (height - 2 * PAD) / (ymax - ymin));
  const ox = (width - scale * (xmax - xmin)) / 2;
  const oy = (height - scale * (ymax - ymin)) / 2;
  const px = (x) => ox + scale * (x - xmin);
  const py = (y) => oy + scale * (y - ymin);

  // ---- dessin ----
  let svg = "";
  svg += `<rect x="${PAD}" y="${PAD}" width="${width - 2 * PAD}" height="${height - 2 * PAD}" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>`;

  // lignes
  const toPx = (pt) => ({ x: px(pt.x), y: py(pt.y) });
  const pointPx = Object.values(model.points).map((p) => ({ x: px(p.x), y: py(p.y) }));
  const clearOfPoints = (x, y, r = 16) => pointPx.every((p) => Math.hypot(p.x - x, p.y - y) > r);
  const pickLabelPos = (seg, along) => {
    // milieux du segment dessiné + décalages perpendiculaire/longitudinal
    const mx = (seg[0].x + seg[1].x) / 2;
    const my = (seg[0].y + seg[1].y) / 2;
    const dx = seg[1].x - seg[0].x;
    const dy = seg[1].y - seg[0].y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const cands = [
      { x: mx - uy * 13, y: my + ux * 13 },           // perpendiculaire (+)
      { x: mx + uy * 13, y: my - ux * 13 },           // perpendiculaire (−)
      { x: mx + ux * 22, y: my + uy * 22 },           // le long de la droite
      { x: mx - ux * 22, y: my - uy * 22 },
      { x: mx, y: my - 14 },
      { x: mx, y: my + 16 },
    ];
    for (const c of cands) if (clearOfPoints(c.x, c.y)) return c;
    return cands[0];
  };
  for (const l of model.lines) {
    const color = l.step < model.steps.length ? model.steps[l.step].color : "#334155";
    let seg = null;
    if (l.kind === "segment") {
      seg = [toPx(l.from), toPx(l.to)];
    } else if (l.kind === "ray") {
      const dirX = l.to.x - l.from.x;
      const dirY = l.to.y - l.from.y;
      const len = Math.hypot(dirX, dirY) || 1;
      const ux = dirX / len, uy = dirY / len;
      const t = Math.max(width, height) / scale * 2;
      seg = [toPx(l.from), { x: px(l.from.x + ux * t), y: py(l.from.y + uy * t) }];
    } else {
      seg = clipSegment(px(l.from.x), py(l.from.y), px(l.to.x), py(l.to.y), PAD, PAD, width - PAD, height - PAD);
    }
    if (seg) {
      svg += `<line x1="${fmtPx(seg[0].x)}" y1="${fmtPx(seg[0].y)}" x2="${fmtPx(seg[1].x)}" y2="${fmtPx(seg[1].y)}" stroke="${color}" stroke-width="2"/>`;
    }
    if (seg && l.name && l.kind !== "segment") {
      const lp = pickLabelPos(seg);
      svg += `<text x="${fmtPx(lp.x)}" y="${fmtPx(lp.y)}" font-size="13" font-style="italic" fill="${color}">${escapeXml(l.name)}</text>`;
    }
  }

  // cercles
  for (const c of model.circles) {
    const color = c.step < model.steps.length ? model.steps[c.step].color : "#334155";
    svg += `<circle cx="${fmtPx(px(c.center.x))}" cy="${fmtPx(py(c.center.y))}" r="${fmtPx(c.radius * scale)}" fill="none" stroke="${color}" stroke-width="2"/>`;
    svg += `<text x="${fmtPx(px(c.center.x) + c.radius * scale + 4)}" y="${fmtPx(py(c.center.y))}" font-size="13" font-style="italic" fill="${color}">${escapeXml(c.name)}</text>`;
  }

  // angles droits
  for (const mk of model.marks) {
    const color = mk.step < model.steps.length ? model.steps[mk.step].color : "#334155";
    const u = { x: mk.u.x, y: mk.u.y };
    const v = { x: mk.v.x, y: mk.v.y };
    const nu = Math.hypot(u.x, u.y) || 1, nv = Math.hypot(v.x, v.y) || 1;
    const s = 0.32;
    const a = { x: mk.at.x + (u.x / nu) * s, y: mk.at.y + (u.y / nu) * s };
    const b = { x: mk.at.x + (v.x / nv) * s, y: mk.at.y + (v.y / nv) * s };
    const c = { x: a.x + (v.x / nv) * s, y: a.y + (v.y / nv) * s };
    svg += `<path d="M${fmtPx(px(a.x))} ${fmtPx(py(a.y))} L${fmtPx(px(c.x))} ${fmtPx(py(c.y))} L${fmtPx(px(b.x))} ${fmtPx(py(b.y))}" fill="none" stroke="${color}" stroke-width="1.4"/>`;
  }

  // points + étiquettes
  for (const [name, p] of Object.entries(model.points)) {
    const cx = px(p.x), cy = py(p.y);
    svg += `<circle cx="${fmtPx(cx)}" cy="${fmtPx(cy)}" r="3.6" fill="${BLACK}" stroke="#ffffff" stroke-width="1.2"/>`;
    let dx = 7, dy = -8;
    if (cx > width * 0.75) dx = -7;
    if (cy < height * 0.25) dy = 13;
    svg += `<text x="${fmtPx(cx + dx)}" y="${fmtPx(cy + dy)}" font-size="14" font-weight="600" fill="${BLACK}">${name}</text>`;
  }

  // légende des étapes (questions successives)
  const legendY = height - 26 - model.steps.length * 17;
  model.steps.forEach((st, i) => {
    const ty = legendY + 24 + i * 17;
    svg += `<circle cx="16" cy="${ty - 4}" r="3.4" fill="${st.color}"/>`;
    svg += `<text x="26" y="${ty}" font-size="11.5" fill="#334155">${escapeXml(`${i + 1}) ${st.label}`)}</text>`;
  });

  const title = opts.title ? String(opts.title) : "Construction géométrique";

  const full =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" role="img" aria-label="${escapeXml(title)}">` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${width / 2}" y="26" text-anchor="middle" font-size="17" font-weight="600" fill="#1e293b">${escapeXml(title)}</text>` +
    svg +
    `</svg>`;

  return {
    svg: full,
    steps: model.steps,
    interpreted,
    points: Object.entries(model.points).map(([name, p]) => ({ name, x: Number(p.x.toPrecision(8)), y: Number(p.y.toPrecision(8)) })),
    lines: model.lines.map((l) => ({ name: l.name, kind: l.kind, label: l.label })),
    circles: model.circles.map((c) => ({ name: c.name, center: c.pts[0], radius: Number(c.radius.toPrecision(8)) })),
  };
}

module.exports = { buildGeoFigure, splitSteps, interpretStep, createModel, intersectLines, lineThrough, midpoint };
