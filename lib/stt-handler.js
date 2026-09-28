/**
 * stt-handler.js — route /api/stt (audio -> texte via Whisper).
 *
 *   POST /api/stt   Content-Type: multipart/form-data   (champ « audio » ou « file »)
 *   POST /api/stt   Content-Type: audio/wav             (corps brut)
 *   POST /api/stt   Content-Type: application/json      { "audio": "data:audio/wav;base64,..." }
 *
 * Options (query, champ de formulaire ou champ JSON) : language, model.
 * Réponse : { success, text, provider, model, language, ms }.
 */

"use strict";

const { HttpError, collectJsonBody, isMultipart, extractAudio, queryOf, sendJson } = require("./http");
const { transcribe } = require("./providers");

async function handleSttRequest(req, res) {
  if (req.method !== "POST") {
    throw new HttpError(405, "method_not_allowed", "Méthode acceptée : POST.");
  }

  const ct = String(req.headers["content-type"] || "").toLowerCase();
  // Un corps JSON est lu ici ; multipart et audio brut sont gérés par extractAudio.
  const body = ct.includes("application/json") && !isMultipart(req) ? await collectJsonBody(req) : null;

  const { audio, filename, mimetype, fields = {} } = await extractAudio(req, body);

  const url = queryOf(req);
  const language = url.get("language") || fields.language || undefined;
  const model = url.get("model") || fields.model || undefined;

  const result = await transcribe(audio, { filename, mimetype, language, model });

  sendJson(res, 200, {
    success: true,
    text: result.text,
    provider: result.provider,
    model: result.model,
    language: result.language,
    ms: result.ms,
    bytes: audio.length,
  });
}

module.exports = { handleSttRequest };
