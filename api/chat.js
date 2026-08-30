/**
 * GET /api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123&lang=fr
 *
 * Route Vercel (serverless) : interroge le modèle demandé via le backend
 * gratuit de aichatting.net et renvoie la réponse en JSON.
 *
 * Paramètres :
 *   - prompt : texte à envoyer au modèle (obligatoire)
 *   - model  : nom du modèle (défaut : gpt-5.6-luna)
 *   - uid    : identifiant libre du client (renvoyé tel quel)
 *   - lang   : langue utilisée pour le backend (défaut : fr)
 *
 * Exemple :
 *   GET /api/chat?prompt=Bonjour%20comment%20ca%20va&model=gpt-5.6-luna&uid=123
 */

"use strict";

const { chat } = require("../lib/aichatting");

exports.maxDuration = 60; // Vercel : jusqu'à 60 s pour cette fonction

module.exports = async function handler(req, res) {
  // CORS simple pour permettre l'appel depuis n'importe quel frontend.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "Méthode non autorisée (utilisez GET)" });
    return;
  }

  const { prompt, model, uid, lang } = req.query;

  if (!prompt || !String(prompt).trim()) {
    res.status(400).json({
      success: false,
      error: "Le paramètre 'prompt' est obligatoire",
      usage: "GET /api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123",
      models_disponibles: require("../lib/aichatting").FREE_MODELS,
    });
    return;
  }

  try {
    const result = await chat({
      prompt: String(prompt).slice(0, 4000), // limite de sécurité
      model: model ? String(model) : undefined,
      lang: lang ? String(lang) : "fr",
    });

    const isProOnly = /pro premium member/i.test(result.reply);

    res.status(isProOnly ? 402 : 200).json({
      success: !isProOnly,
      reply: result.reply,
      model: result.model,
      uid: uid !== undefined ? String(uid) : null,
      conversationId: result.conversationId,
      source: "https://www.aichatting.net/fr/free-chatgpt/",
      ...(isProOnly
        ? {
            error:
              "Ce modèle nécessite un compte PRO (aichatting.net). Essayez un modèle gratuit : gpt-5.6-luna, gpt-5, gpt-4o-mini, deepseek-chat, o3-mini, …",
          }
        : {}),
    });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    const isQuota = /quota/i.test(message);
    res.status(isQuota ? 429 : 502).json({
      success: false,
      error: message,
      hint: isQuota
        ? "Quota gratuit épuisé pour ce visiteur — réessayez (nouveau visiteur généré automatiquement)."
        : "Le backend aichatting a renvoyé une erreur.",
    });
  }
};
