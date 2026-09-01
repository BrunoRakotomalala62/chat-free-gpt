/**
 * lib/geo-verify.js — Vérification IA d'une construction géométrique.
 *
 * Le moteur déterministe (lib/geometry.js) construit la figure exacte ;
 * l'IA vérifie ensuite que la figure couvre BIEN toutes les constructions
 * demandées dans l'énoncé (dimensions données, points à placer, symétries,
 * angles mesurés…) et signale ce qui manque. Si des éléments manquent, la
 * figure est refaite/complétée par l'IA (voir lib/geo-handler.js).
 *
 * La vérification est RAPIDE et « best-effort » : modèle rapide, budget
 * court, et si l'IA ne répond pas un JSON valide, on considère la figure
 * complète (on ne bloque jamais l'utilisateur).
 */

"use strict";

const { chatReliable } = require("./aichatting");
const { withTimeout } = require("./figures-ai");

const VERIFY_BUDGET_MS = 15000;
const ATTEMPT_MS = 9000;
const VERIFY_MODELS = ["deepseek-chat", "gpt-5.1-mini", "gemini-2.0-flash", "gpt-5.6-luna"];

function buildVerifyPrompt(text, steps, ignored) {
  const built = steps && steps.length
    ? steps.map((s, i) => `${i + 1}) ${s.label || s.raw}`).join("\n")
    : "(aucune construction reconnue par le moteur exact)";
  const notBuilt = ignored && ignored.length
    ? "\nPhrases de l'énoncé NON construites par le moteur exact :\n" + ignored.map((s) => `- « ${s} »`).join("\n")
    : "";
  return (
    `Tu es un correcteur exigeant de figures de géométrie (niveau collège/lycée).\n` +
    `Énoncé de l'exercice : « ${String(text).slice(0, 1200)} »\n` +
    `Constructions déjà faites par le moteur exact :\n${built}` +
    notBuilt +
    `\n\nVérifie si la figure couvre TOUTES les constructions demandées dans l'énoncé. ` +
    `Signale surtout : un triangle/quadrilatère avec des DIMENSIONS données ` +
    `(ex. « tel que AB = 4 cm, AC = 5 cm, BC = 6 cm » : la figure doit les respecter), ` +
    `un point à placer (milieu, intersection, point sur une droite/cercle), ` +
    `une perpendiculaire/parallèle/tangente, une mesure d'angle (« = 45° »), ` +
    `une symétrie/translation/rotation/homothétie, une longueur donnée. ` +
    `Ne signale PAS comme manquant ce qui est purement décoratif ou déjà construit.\n` +
    `Réponds UNIQUEMENT avec un JSON valide, sans texte autour, de la forme :\n` +
    `{"complet": true ou false, "manquant": ["élément manquant 1", "…"], "note": "une phrase max en français"}\n` +
    `Si tout est construit : {"complet": true, "manquant": [], "note": "…"}`
  );
}

/** Extrait et parse un objet JSON d'une réponse (robuste : premier {…} équilibré). */
function extractJson(reply) {
  const s = String(reply || "");
  let start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Vérifie qu'une figure géométrique exacte couvre l'énoncé.
 * @param {object} opts { text, steps, ignored, budgetMs }
 * @returns {Promise<{complet: boolean, manquant: string[], note: string, model?: string}>}
 *   Ne rejette jamais : en cas d'échec IA, renvoie { complet: true, manquant: [], note }.
 */
async function verifyConstruction(opts = {}) {
  const text = String(opts.text || "").trim();
  if (!text) return { complet: true, manquant: [], note: "Aucun énoncé à vérifier." };
  const steps = Array.isArray(opts.steps) ? opts.steps : [];
  const ignored = Array.isArray(opts.ignored) ? opts.ignored : [];
  const budgetMs = Number(opts.budgetMs) > 0 ? Number(opts.budgetMs) : VERIFY_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const prompt = buildVerifyPrompt(text, steps, ignored);

  const models = (Array.isArray(opts.models) && opts.models.length ? opts.models : VERIFY_MODELS).slice();
  let lastError = "aucune information";

  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining < 2500) break;
    try {
      const result = await withTimeout(
        chatReliable({ prompt, model, lang: "fr" }),
        Math.min(ATTEMPT_MS, remaining - 1500)
      );
      const reply = String(result && result.reply ? result.reply : "");
      if (/pro premium member/i.test(reply)) {
        lastError = `${model} : compte PRO requis`;
        continue;
      }
      const obj = extractJson(reply);
      if (obj && typeof obj.complet === "boolean") {
        return {
          complet: obj.complet,
          manquant: Array.isArray(obj.manquant) ? obj.manquant.slice(0, 8) : [],
          note: String(obj.note || "").slice(0, 300),
          model,
        };
      }
      lastError = `${model} : réponse sans JSON valide (${String(reply).slice(0, 120)})`;
    } catch (err) {
      lastError = `${model} : ${String(err && err.message ? err.message : err)}`;
    }
  }

  // Jamais bloquant : sans JSON fiable, on considère la figure complète.
  return { complet: true, manquant: [], note: `Vérification IA indisponible (${lastError}).`, model: null };
}

module.exports = { verifyConstruction, extractJson, buildVerifyPrompt, VERIFY_BUDGET_MS };
