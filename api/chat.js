/**
 * GET /api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123&lang=fr
 * GET /api/chat?prompt=decris cette photo&image=https://exemple.com/photo.jpg&uid=123   (vision)
 * POST /api/chat  { prompt, model, uid, lang, images: [data-URI ou URL] }               (vision, recommandé)
 *
 * Route Vercel (serverless) : interroge le modèle demandé via le backend
 * gratuit de aichatting.net et renvoie la réponse en JSON.
 *
 * Paramètres :
 *   - prompt : texte à envoyer au modèle (obligatoire, sauf si image fournie)
 *   - model  : nom du modèle (défaut : gpt-5.6-luna)
 *   - image / images : image(s) à analyser (vision) — en GET répéter `image=`,
 *     en POST envoyer un tableau `images` (URL ou data-URI base64), max 4
 *   - uid    : identifiant libre du client (renvoyé tel quel)
 *   - lang   : langue utilisée pour le backend (défaut : fr)
 *
 * Exemples :
 *   GET  /api/chat?prompt=Bonjour%20comment%20ca%20va&model=gpt-5.6-luna&uid=123
 *   POST /api/chat  { "prompt": "Que voit-on sur cette photo ?",
 *                     "images": ["data:image/jpeg;base64,…"], "model": "gpt-5.6-luna" }
 *
 * ⚠️ En GET, Vercel coupe les URL trop longues (414) : les images locales
 * (data-URI) doivent être envoyées en POST — c'est le mode recommandé.
 */

"use strict";

const { handleChatRequest } = require("../lib/handler");

exports.maxDuration = 60; // Vercel : jusqu'à 60 s pour cette fonction

module.exports = async function handler(req, res) {
  try {
    await handleChatRequest(req, res);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ success: false, error: message }));
  }
};
