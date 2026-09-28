/**
 * http.js — utilitaires HTTP communs (serverless Vercel + serveur Node local).
 *
 * Ne dépend que de "busboy" (analyse multipart / formulaire audio).
 * Fournit : en-têtes CORS, lecture du corps (JSON / brut / multipart),
 * réponses JSON normalisées et classe d'erreur HTTP typée.
 */

"use strict";

const Busboy = require("busboy");

/** Limite de corps (alignée sur la limite Vercel ~4,5 Mo). */
const MAX_BODY_BYTES = 4.5 * 1024 * 1024;
/** Taille maximale d'un fichier audio téléversé (25 Mo = limite Groq Whisper). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Taille maximale d'un champ texte (system prompt, historique…). */
const MAX_FIELD_BYTES = 100 * 1024;

/** Erreur HTTP typée : statusCode + code machine + message lisible. */
class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = Number(status) || 500;
    this.code = code || "error";
    this.details = details;
  }
}

/** Erreur de configuration (variable d'environnement manquante). */
class ConfigError extends HttpError {
  constructor(message, details) {
    super(500, "config_error", message, details);
    this.name = "ConfigError";
  }
}

/** En-têtes CORS (origines configurables via CORS_ORIGIN). */
function corsHeaders() {
  const allowed = process.env.CORS_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Ajoute les en-têtes CORS à une réponse. */
function applyCors(res) {
  const headers = corsHeaders();
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
}

/**
 * Réponse JSON.
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {object} payload
 * @param {object} [extraHeaders]
 */
function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

/** Réponse binaire (audio). */
function sendBinary(res, status, buffer, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": contentType || "application/octet-stream",
    "Content-Length": buffer.length,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(buffer);
}

/** Convertit une erreur quelconque en réponse JSON propre. */
function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const payload = {
    success: false,
    error: String((err && err.message) || err),
    code: (err && err.code) || "internal_error",
  };
  if (err && err.details) payload.details = err.details;
  if (status >= 500) {
    // Journalisé côté serveur, jamais renvoyé au client.
    console.error("[voice-api]", err && err.stack ? err.stack : err);
  }
  try {
    sendJson(res, status, payload);
  } catch (_) {
    /* socket déjà fermé */
  }
}

/** Gère un préflight CORS (OPTIONS). Renvoie true si la requête est terminée. */
function handlePreflight(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return true;
  }
  return false;
}

/** Lit le corps brut d'une requête (Buffer), avec plafond de taille. */
function collectRawBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req.body)) return resolve(req.body);
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "payload_too_large", `Corps de requête trop volumineux (max ${Math.round(limit / 1024 / 1024)} Mo).`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (err) => reject(new HttpError(400, "bad_request", `Lecture du corps impossible : ${err.message}`)));
  });
}

/** Lit et parse un corps JSON. */
async function collectJsonBody(req, limit = MAX_BODY_BYTES) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = await collectRawBody(req, limit);
  const text = raw.toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new HttpError(400, "invalid_json", "Corps JSON invalide.");
  }
}

/** Vrai si la requête est de type multipart/form-data. */
function isMultipart(req) {
  const ct = String(req.headers["content-type"] || "");
  return ct.toLowerCase().includes("multipart/form-data");
}

/**
 * Lit un corps multipart/form-data : renvoie { fields, files }.
 * @returns {Promise<{fields: Record<string,string>, files: Array<{field:string,filename:string,mimetype:string,buffer:Buffer}>}>}
 */
function collectMultipart(req, { maxFileBytes = MAX_AUDIO_BYTES, maxFiles = 2, maxFields = 30 } = {}) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { fileSize: maxFileBytes, files: maxFiles, fields: maxFields, fieldSize: MAX_FIELD_BYTES },
      });
    } catch (err) {
      reject(new HttpError(400, "invalid_multipart", `Multipart invalide : ${err.message}`));
      return;
    }

    const fields = {};
    const files = [];
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    bb.on("field", (name, value) => {
      fields[name] = value;
    });
    bb.on("file", (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on("data", (c) => chunks.push(c));
      stream.on("limit", () => {
        truncated = true;
        stream.resume();
      });
      stream.on("end", () => {
        if (truncated) {
          fail(new HttpError(413, "audio_too_large", `Fichier audio trop volumineux (max ${Math.round(maxFileBytes / 1024 / 1024)} Mo).`));
          return;
        }
        files.push({
          field: name,
          filename: info.filename || `${name}.bin`,
          mimetype: info.mimeType || "application/octet-stream",
          buffer: Buffer.concat(chunks),
        });
      });
    });
    bb.on("error", (err) => fail(new HttpError(400, "invalid_multipart", `Multipart invalide : ${err.message}`)));
    bb.on("close", () => {
      if (settled) return;
      settled = true;
      resolve({ fields, files });
    });

    req.pipe(bb);
  });
}

/** Récupère un fichier audio depuis : multipart, corps brut, ou data-URI base64. */
async function extractAudio(req, body) {
  if (isMultipart(req)) {
    const { fields, files } = await collectMultipart(req);
    const file = files.find((f) => f.field === "audio" || f.field === "file" || f.field === "data") || files[0];
    if (!file || !file.buffer.length) {
      throw new HttpError(400, "missing_audio", "Aucun fichier audio reçu (champ attendu : « audio » ou « file »).");
    }
    return { audio: file.buffer, filename: file.filename, mimetype: file.mimetype, fields };
  }

  if (body && typeof body.audio === "string" && body.audio) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(body.audio);
    const base64 = match ? match[2] : body.audio;
    const mimetype = match ? match[1] : "application/octet-stream";
    let audio;
    try {
      audio = Buffer.from(base64, "base64");
    } catch (_) {
      throw new HttpError(400, "invalid_audio", "Le champ «audio» n'est pas un base64 valide.");
    }
    if (!audio.length) throw new HttpError(400, "invalid_audio", "Le champ «audio» est vide.");
    return { audio, filename: "audio.wav", mimetype, fields: body };
  }

  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (ct.startsWith("audio/") || ct.startsWith("application/octet-stream") || ct.startsWith("video/")) {
    const audio = await collectRawBody(req, MAX_AUDIO_BYTES);
    if (!audio.length) throw new HttpError(400, "missing_audio", "Corps audio vide.");
    return { audio, filename: "audio.bin", mimetype: ct, fields: {} };
  }

  throw new HttpError(
    400,
    "missing_audio",
    "Aucun audio fourni. Envoyez un fichier en multipart/form-data (champ « audio »), un corps brut audio/*, ou un champ JSON « audio » en base64.",
  );
}

/** Querystring de la requête, sous forme d'URLSearchParams. */
function queryOf(req) {
  const url = String(req.url || "/");
  const qIndex = url.indexOf("?");
  return new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : "");
}

/** Vrai si le client veut une réponse JSON (Accept ou ?format=json). */
function wantsJson(req, format) {
  if (format === "json") return true;
  if (format === "audio" || format === "mp3" || format === "binary") return false;
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json");
}

/**
 * Vrai si le client veut un flux audio brut (pour /api/voice, dont le défaut est JSON).
 * ?format=audio|mp3|binary, ou en-tête Accept: audio/*.
 */
function wantsAudio(req, format) {
  const f = String(format || "").toLowerCase();
  if (f === "audio" || f === "mp3" || f === "binary") return true;
  if (f === "json") return false;
  const accept = String(req.headers.accept || "");
  return accept.includes("audio/") || accept.includes("application/octet-stream");
}

/** Vérifie la clé d'accès optionnelle (API_KEY). */
function assertApiKey(req) {
  const expected = process.env.API_KEY;
  if (!expected) return;
  const url = String(req.url || "");
  const key = req.headers["x-api-key"] || (new URLSearchParams(url.split("?")[1] || "")).get("key");
  if (key !== expected) throw new HttpError(401, "unauthorized", "Clé d'accès invalide ou manquante.");
}

module.exports = {
  MAX_BODY_BYTES,
  MAX_AUDIO_BYTES,
  HttpError,
  ConfigError,
  corsHeaders,
  applyCors,
  sendJson,
  sendBinary,
  sendError,
  handlePreflight,
  collectRawBody,
  collectJsonBody,
  collectMultipart,
  extractAudio,
  isMultipart,
  queryOf,
  wantsJson,
  wantsAudio,
  assertApiKey,
};
