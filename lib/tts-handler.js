/**
 * tts-handler.js — route /api/tts (texte -> audio MP3, sans clé).
 *
 *   GET  /api/tts?text=Bonjour&voice=fr-FR-DeniseNeural&rate=+10%
 *   POST /api/tts   Content-Type: application/json
 *        { "text": "Bonjour", "voice": "fr-FR-DeniseNeural", "rate": "+10%", "pitch": "+2Hz", "volume": "+0%" }
 *   POST /api/tts   Content-Type: text/plain        (corps = texte brut)
 *
 * Réponse par défaut : audio/mpeg binaire.
 * Réponse JSON (base64) si ?format=json ou en-tête Accept: application/json.
 */

"use strict";

const { HttpError, collectJsonBody, collectRawBody, sendJson, sendBinary, queryOf, wantsJson } = require("./http");
const { synthesize } = require("./edge-tts");

async function handleTtsRequest(req, res) {
  const url = queryOf(req);
  const format = url.get("format");
  const asJson = wantsJson(req, format);

  let text = "";
  let voice = url.get("voice") || undefined;
  let rate = url.get("rate") || undefined;
  let pitch = url.get("pitch") || undefined;
  let volume = url.get("volume") || undefined;

  if (req.method === "GET" || req.method === "HEAD") {
    text = url.get("text") || url.get("q") || "";
  } else if (req.method === "POST") {
    const ct = String(req.headers["content-type"] || "").toLowerCase();
    if (ct.includes("application/json")) {
      const body = await collectJsonBody(req);
      text = body.text || body.q || body.input || "";
      voice = body.voice || voice;
      rate = body.rate || rate;
      pitch = body.pitch || pitch;
      volume = body.volume || volume;
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const raw = (await collectRawBody(req)).toString("utf8");
      const form = new URLSearchParams(raw);
      text = form.get("text") || form.get("q") || "";
      voice = form.get("voice") || voice;
      rate = form.get("rate") || rate;
      pitch = form.get("pitch") || pitch;
      volume = form.get("volume") || volume;
    } else {
      text = (await collectRawBody(req)).toString("utf8");
    }
  } else {
    throw new HttpError(405, "method_not_allowed", "Méthodes acceptées : GET, POST.");
  }

  const result = await synthesize(text, { voice, rate, pitch, volume });

  if (asJson) {
    sendJson(res, 200, {
      success: true,
      voice: result.voice,
      mimeType: result.mimeType,
      chars: result.chars,
      bytes: result.audio.length,
      audio: result.audio.toString("base64"),
      subtitle: result.subtitle,
    });
    return;
  }

  sendBinary(res, 200, result.audio, result.mimeType, {
    "X-Voice": result.voice,
    "X-Chars": String(result.chars),
  });
}

module.exports = { handleTtsRequest };
