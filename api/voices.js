/**
 * api/voices.js — route Vercel : GET /api/voices (liste des voix Edge).
 * Logique dans lib/meta-handler.js (partagée avec server.js).
 */

"use strict";

const { createRoute } = require("../lib/route");
const { handleVoicesRequest } = require("../lib/meta-handler");

module.exports = createRoute(handleVoicesRequest);
