/**
 * edge-tts.js — Synthèse vocale via le service « Read Aloud » de Microsoft Edge.
 *
 * Pourquoi ce choix : c'est le seul TTS **sans clé, sans compte et sans quota
 * connu** qui reste stable depuis des années. Le navigateur Edge l'utilise
 * gratuitement ; la bibliothèque `edge-tts-universal` (portage TypeScript du
 * paquet Python `edge-tts`) parle le même protocole WebSocket.
 *
 * Bonnes pratiques appliquées ici :
 *  - réessais avec repli exponentiel sur erreur réseau / WS ;
 *  - délai maximal (timeout) pour ne jamais bloquer une fonction serverless ;
 *  - liste de voix mise en cache (6 h) ;
 *  - validation stricte des paramètres (voix, débit, hauteur, volume, longueur).
 */

"use strict";

const { Communicate, listVoices: fetchVoices } = require("edge-tts-universal");
const { HttpError } = require("./http");

const DEFAULT_VOICE = process.env.TTS_VOICE || "fr-FR-DeniseNeural";
const MAX_CHARS = Number(process.env.TTS_MAX_CHARS || 3000);
const DEFAULT_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS || 30000);
/** Une voix Edge ressemble à « fr-FR-DeniseNeural » (locale-NomNeural). */
const VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;
/** Débit / volume : « +20% », « -10% » (les décimales sont acceptées). */
const PERCENT_RE = /^[+-]\d{1,3}(?:\.\d+)?%$/;
/** Hauteur : « +5Hz », « -10Hz ». */
const HZ_RE = /^[+-]\d{1,3}(?:\.\d+)?Hz$/;

const VOICES_TTL_MS = 6 * 60 * 60 * 1000;
let voicesCache = { at: 0, data: null };

/** Réessaie une opération asynchrone (repli exponentiel). */
async function withRetry(fn, { retries = 2, baseDelayMs = 400, label = "opération" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(3, attempt);
        console.warn(`[voice-api] ${label} échec (tentative ${attempt + 1}/${retries + 1}) : ${err.message} — nouvel essai dans ${delay} ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

/** Rejette si la promesse dépasse `ms` millisecondes. */
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new HttpError(504, "tts_timeout", message || `Délai TTS dépassé (${ms} ms).`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Valide et normalise les options de synthèse. */
function normalizeOptions({ voice, rate, pitch, volume } = {}) {
  const v = String(voice || DEFAULT_VOICE).trim();
  if (!VOICE_RE.test(v)) {
    throw new HttpError(
      400,
      "invalid_voice",
      `Voix invalide : « ${v} ». Format attendu : locale-NomNeural (ex. fr-FR-DeniseNeural). Voir GET /api/voices.`,
    );
  }
  const opts = { voice: v };
  if (rate) {
    if (!PERCENT_RE.test(String(rate))) throw new HttpError(400, "invalid_rate", "« rate » doit ressembler à « +20% » ou « -10% ».");
    opts.rate = String(rate);
  }
  if (volume) {
    if (!PERCENT_RE.test(String(volume))) throw new HttpError(400, "invalid_volume", "« volume » doit ressembler à « +50% » ou « -20% ».");
    opts.volume = String(volume);
  }
  if (pitch) {
    if (!HZ_RE.test(String(pitch))) throw new HttpError(400, "invalid_pitch", "« pitch » doit ressembler à « +5Hz » ou « -10Hz ».");
    opts.pitch = String(pitch);
  }
  return opts;
}

/**
 * Synthétise un texte en MP3.
 * @param {string} text
 * @param {{voice?:string, rate?:string, pitch?:string, volume?:string, timeoutMs?:number, retries?:number, withSubtitle?:boolean}} [options]
 * @returns {Promise<{audio:Buffer, mimeType:string, voice:string, chars:number, subtitle:Array}>}
 */
async function synthesize(text, options = {}) {
  const clean = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (!clean) throw new HttpError(400, "empty_text", "Le texte à synthétiser est vide.");
  if (clean.length > MAX_CHARS) {
    throw new HttpError(413, "text_too_long", `Texte trop long (${clean.length} caractères, max ${MAX_CHARS}). Découpez en plusieurs requêtes.`);
  }

  const opts = normalizeOptions(options);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const withSubtitle = options.withSubtitle !== false;
  const subtitle = [];

  const run = async () => {
    const communicate = new Communicate(clean, { ...opts, connectionTimeout: timeoutMs });
    const audioChunks = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === "audio" && chunk.data) {
        audioChunks.push(Buffer.from(chunk.data));
      } else if (chunk.type === "WordBoundary" && chunk.text) {
        subtitle.push({ text: chunk.text, offset: chunk.offset, duration: chunk.duration });
      }
    }
    const audio = Buffer.concat(audioChunks);
    if (!audio.length) {
      throw new HttpError(502, "tts_no_audio", "Le service Edge TTS n'a renvoyé aucun audio.");
    }
    return audio;
  };

  try {
    const audio = await withTimeout(withRetry(run, { retries: options.retries ?? 2, label: "TTS Edge" }), timeoutMs + 5000);
    return {
      audio,
      mimeType: "audio/mpeg",
      voice: opts.voice,
      chars: clean.length,
      subtitle: withSubtitle ? subtitle : [],
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "tts_failed", `Échec de la synthèse vocale : ${err.message}`);
  }
}

/**
 * Liste les voix disponibles (cache 6 h).
 * @param {{locale?:string, language?:string, gender?:string, refresh?:boolean}} [filter]
 * @returns {Promise<Array<{name:string,locale:string,language:string,gender:string,personalities:string[]}>>}
 */
async function listVoices(filter = {}) {
  const now = Date.now();
  if (!voicesCache.data || filter.refresh || now - voicesCache.at > VOICES_TTL_MS) {
    const raw = await withRetry(() => fetchVoices(), { retries: 2, label: "liste des voix Edge" }).catch((err) => {
      throw new HttpError(502, "voices_failed", `Impossible de récupérer la liste des voix : ${err.message}`);
    });
    voicesCache = {
      at: now,
      data: raw.map((v) => ({
        name: v.ShortName,
        friendlyName: v.FriendlyName,
        locale: v.Locale,
        language: String(v.Locale || "").split("-")[0],
        gender: v.Gender,
        personalities: (v.VoiceTag && v.VoiceTag.VoicePersonalities) || [],
      })),
    };
  }

  let out = voicesCache.data;
  if (filter.locale) out = out.filter((v) => v.locale.toLowerCase() === String(filter.locale).toLowerCase());
  if (filter.language) out = out.filter((v) => v.language.toLowerCase() === String(filter.language).toLowerCase());
  if (filter.gender) out = out.filter((v) => v.gender.toLowerCase() === String(filter.gender).toLowerCase());
  return out;
}

module.exports = { synthesize, listVoices, normalizeOptions, DEFAULT_VOICE, MAX_CHARS };
