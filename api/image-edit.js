/**
 * api/image-edit.js — route Vercel : POST|GET /api/image-edit.
 *
 *   POST /api/image-edit   → édition d'image Magic Hour (nouvelle route, ajout)
 *   GET  /api/image-edit?id=… → état du projet (+ ?download=1 pour l'image)
 *
 * Logique dans lib/image-handler.js (partagée avec server.js).
 */

"use strict";

const { createRoute } = require("../lib/route");
const { handleImageEditRequest } = require("../lib/image-handler");

module.exports = createRoute(handleImageEditRequest);
