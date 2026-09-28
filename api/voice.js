/**
 * api/voice.js — route Vercel : POST /api/voice (audio -> texte -> réponse -> voix).
 * Logique dans lib/voice-handler.js (partagée avec server.js).
 */

"use strict";

const { createRoute } = require("../lib/route");
const { handleVoiceRequest } = require("../lib/voice-handler");

module.exports = createRoute(handleVoiceRequest);
