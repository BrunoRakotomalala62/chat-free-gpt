/**
 * route.js — enveloppe commune à toutes les routes.
 *
 * Applique, dans l'ordre : CORS -> préflight OPTIONS -> clé d'accès optionnelle
 * (API_KEY) -> gestionnaire -> capture d'erreur normalisée (JSON).
 * Évite de dupliquer ce code dans chaque fichier de api/.
 */

"use strict";

const { applyCors, handlePreflight, sendError, assertApiKey } = require("./http");

/**
 * @param {(req:any, res:any)=>Promise<void>|void} handler
 * @returns {(req:any, res:any)=>Promise<void>}
 */
function createRoute(handler) {
  return async function route(req, res) {
    applyCors(res);
    if (handlePreflight(req, res)) return;
    try {
      assertApiKey(req);
      await handler(req, res);
    } catch (err) {
      sendError(res, err);
    }
  };
}

module.exports = { createRoute };
