/**
 * api/health.js — route Vercel : GET /api/health (état des fournisseurs).
 * Logique dans lib/meta-handler.js (partagée avec server.js).
 */

"use strict";

const { createRoute } = require("../lib/route");
const { handleHealthRequest } = require("../lib/meta-handler");

module.exports = createRoute(handleHealthRequest);
