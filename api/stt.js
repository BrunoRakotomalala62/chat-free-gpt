/**
 * api/stt.js — route Vercel : POST /api/stt (audio -> texte, Whisper).
 * Logique dans lib/stt-handler.js (partagée avec server.js).
 */

"use strict";

const { createRoute } = require("../lib/route");
const { handleSttRequest } = require("../lib/stt-handler");

module.exports = createRoute(handleSttRequest);
