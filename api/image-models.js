/**
 * api/image-models.js — route Vercel : GET /api/image-models.
 *
 * Liste les modèles d'édition d'image Magic Hour (gratuits par défaut, ?all=1
 * pour tout le catalogue). Aucune clé requise : catalogue statique.
 */

"use strict";

const { createRoute } = require("../lib/route");
const { handleImageModelsRequest } = require("../lib/image-handler");

module.exports = createRoute(handleImageModelsRequest);
