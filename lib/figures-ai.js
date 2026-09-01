/**
 * lib/figures-ai.js — Génération dynamique de figures par IA (physique, chimie,
 * circuits électriques, effet photoélectrique… n'importe quel sujet).
 *
 * Principe : le sujet libre (« mise en évidence de l'effet photoélectrique »)
 * est envoyé au backend de chat (aichatting) avec une consigne stricte de
 * dessinateur SVG. On extrait, assainit et valide le SVG produit, avec une
 * seconde tentative si le modèle ne respecte pas le format.
 *
 * Utilisé par /api/plot (paramètre `subject=`), en complément des courbes
 * mathématiques (paramètre `expression=`).
 */

"use strict";

const { chatReliable } = require("./aichatting");

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const isHexColor = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c || ""));

function buildPrompt(subject, width, height, color, strict) {
  const colorLine = color ? `\nCouleur principale : ${color} (traits et titre).` : "";
  const strictLine = strict
    ? "\nTa réponse doit commencer exactement par <svg et se terminer par </svg>. RIEN d'autre."
    : "";
  return (
    `Tu es un dessinateur de figures techniques (physique, chimie, électricité, sciences).\n` +
    `Sujet : « ${subject} »\n` +
    `Réponds UNIQUEMENT avec le code SVG complet <svg>…</svg> — aucun texte autour, aucun markdown.\n` +
    `Règles : fond blanc ; schéma clair et pédagogique ; légende chaque élément avec <text> en français ` +
    `(police sans-serif) ; respecte les conventions du domaine (symboles de circuits électriques, ` +
    `appareils de chimie…) ; tout doit tenir dans le viewBox ${width}x${height} ; ` +
    `interdit : <script>, javascript:, attributs on*.\n` +
    `IMPORTANT — réponse courte : ta réponse doit tenir en moins de 2200 caractères. ` +
    `Utilise UNIQUEMENT <rect>, <circle>, <line>, <path>, <polyline>, <text> avec attributs directs ` +
    `(pas de <style>, pas de <defs>, pas de <marker>). Max 25 éléments. ` +
    `Simplifie la figure à l'essentiel (le plus important pour la compréhension).` +
    colorLine +
    strictLine
  );
}

/** Extrait la première balise <svg>…</svg> complète d'une réponse brute. */
function extractSvg(raw) {
  if (!raw) return null;
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 6);
}

/** Supprime tout contenu exécutable ou attribut événement (protection XSS). */
function sanitizeSvg(svg) {
  return String(svg)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[\s\S]*?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(xlink:href|href)\s*=\s*["']javascript:[^"']*["']/gi, '$1="#"')
    .replace(/javascript:/gi, "")
    .trim();
}

/** Vérification légère de bonne formation XML (balises imbriquées équilibrées). */
function isWellFormedXml(s) {
  const cleaned = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(cleaned))) {
    const tag = m[0];
    const name = m[2];
    const selfClosing = tag.endsWith("/>");
    if (tag.startsWith("</")) {
      if (!stack.length || stack[stack.length - 1] !== name) return false;
      stack.pop();
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

/** Extrait un extrait de la réponse pour le message d'erreur (sûr et court). */
function replyExcerpt(reply) {
  const clean = String(reply || "").slice(0, 300).replace(/\s+/g, " ").trim();
  return clean || "(réponse vide)";
}

/** Abandonne une promesse après `ms` (le fetch sous-jacent continue, on n'attend plus). */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`délai dépassé (${Math.round(ms / 1000)} s)`)),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chaîne de repli : si un modèle échoue (504, délai, SVG invalide), on passe au suivant. */
const MODEL_CHAIN = ["gpt-5.6-luna", "gpt-5", "deepseek-chat", "gemini-2.0-flash"];
const BUDGET_MS = 55000; // budget global (maxDuration Vercel : 60 s)
const ATTEMPT_TIMEOUT_MS = 45000;
const BACKOFF_MS = 1500; // pause entre tentatives (throttle du backend gratuit)

/**
 * Génère une figure SVG à partir d'un sujet libre (description en langage naturel).
 * @param {object} opts { subject, width, height, model, color }
 * @returns {Promise<{svg: string, subject: string, model: string, attempts: number}>}
 */
async function buildFigureFromSubject(opts = {}) {
  const subject = String(opts.subject || "").trim();
  if (!subject) throw new Error("Le paramètre 'subject' est obligatoire (sujet de la figure).");
  if (subject.length > 500) throw new Error("Sujet trop long (max 500 caractères).");

  const width = clamp(Number(opts.width) || 800, 200, 2400);
  const height = clamp(Number(opts.height) || 600, 200, 1600);
  const color = isHexColor(opts.color) ? String(opts.color) : null;

  // Modèle demandé en premier, puis repli sur la chaîne (sans doublons).
  const userModel = String(opts.model || "").trim();
  const candidates = [];
  for (const m of [userModel, ...MODEL_CHAIN]) {
    if (m && !candidates.includes(m)) candidates.push(m);
  }

  const deadline = Date.now() + BUDGET_MS;
  let lastError = "aucune information";
  let totalTries = 0;

  for (const model of candidates) {
    let attempt = 1;
    let reply = "";
    let received = false;

    // Tentative 1 : consigne normale. Tentative 2 (même modèle, visiteur neuf) :
    // uniquement si le modèle a répondu mais sans SVG valide.
    while (attempt <= 2) {
      totalTries++;
      const remaining = deadline - Date.now();
      if (remaining < 6000) {
        throw new Error(
          `Temps écoulé pour générer la figure. Dernière erreur : ${lastError}. Réessayez dans quelques secondes.`
        );
      }
      const timeoutMs = Math.min(ATTEMPT_TIMEOUT_MS, remaining - 3000);
      try {
        const result = await withTimeout(
          chatReliable({
            prompt: buildPrompt(subject, width, height, color, attempt === 2),
            model,
            lang: "fr",
          }),
          timeoutMs
        );
        reply = String(result && result.reply ? result.reply : "");
        received = true;
      } catch (err) {
        // Échec réseau / timeout / 504 → pause courte, puis modèle suivant (visiteur neuf).
        lastError = `${model} : ${String(err && err.message ? err.message : err)}`;
        await sleep(BACKOFF_MS);
        break;
      }

      if (/pro premium member/i.test(reply)) {
        lastError = `le modèle ${model} nécessite un compte PRO (aichatting.net)`;
        break; // inutile de retenter ce modèle → modèle suivant
      }

      const svg = sanitizeSvg(extractSvg(reply) || "");
      if (svg.startsWith("<svg") && svg.endsWith("</svg>") && isWellFormedXml(svg)) {
        return { svg, subject, model, attempts: totalTries };
      }
      lastError = `le modèle ${model} n'a pas produit de SVG valide (${replyExcerpt(reply)})`;
      attempt++; // 2ᵉ tentative, consigne stricte, visiteur neuf
      await sleep(BACKOFF_MS);
    }
  }

  throw new Error(
    `Impossible de produire une figure SVG valide pour « ${subject} ». ` +
      `Dernière erreur : ${lastError}. Réessayez dans quelques secondes.`
  );
}

module.exports = { buildFigureFromSubject, extractSvg, sanitizeSvg, isWellFormedXml };
