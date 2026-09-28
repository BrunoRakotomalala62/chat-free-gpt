/**
 * meta-handler.js — routes utilitaires /api/health et /api/voices.
 *
 *   GET /api/health  -> état des fournisseurs (sans révéler les clés)
 *   GET /api/voices?locale=fr-FR&language=fr&gender=Female
 *        -> liste des voix TTS Edge disponibles (mis en cache 6 h)
 */

"use strict";

const { sendJson, queryOf } = require("./http");
const { listVoices } = require("./edge-tts");
const { describeProviders } = require("./providers");

function handleHealthRequest(req, res) {
  sendJson(res, 200, {
    success: true,
    service: "voice-api",
    version: require("../package.json").version,
    uptimeSeconds: Math.round(process.uptime()),
    providers: describeProviders(),
    endpoints: {
      tts: "GET|POST /api/tts   (texte -> MP3, sans clé)",
      stt: "POST /api/stt       (audio -> texte, Whisper)",
      voice: "POST /api/voice   (audio -> texte -> réponse -> voix)",
      voices: "GET /api/voices    (liste des voix Edge)",
      health: "GET /api/health",
    },
  });
}

async function handleVoicesRequest(req, res) {
  const url = queryOf(req);
  const voices = await listVoices({
    locale: url.get("locale") || undefined,
    language: url.get("language") || undefined,
    gender: url.get("gender") || undefined,
    refresh: url.get("refresh") === "1",
  });
  sendJson(res, 200, { success: true, count: voices.length, voices });
}

module.exports = { handleHealthRequest, handleVoicesRequest };
