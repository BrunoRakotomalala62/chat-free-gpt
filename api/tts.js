/**
 * api/tts.js — route Vercel : GET|POST /api/tts (texte -> MP3, sans clé).
 * Logique dans lib/tts-handler.js (partagée avec server.js).
 */

"use strict";

const { createRoute } = require("../lib/route");
const { handleTtsRequest } = require("../lib/tts-handler");

module.exports = createRoute(handleTtsRequest);
