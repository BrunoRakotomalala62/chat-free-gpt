/**
 * voice-handler.js — route /api/voice : la conversation vocale complète.
 *
 * Pipeline :  audio  --STT-->  texte  --LLM-->  réponse  --TTS-->  audio MP3
 *
 *   POST /api/voice  Content-Type: multipart/form-data
 *        champ « audio » (obligatoire) ; champs optionnels :
 *          system   : consigne système pour le LLM
 *          voice    : voix TTS (défaut fr-FR-DeniseNeural)
 *          history  : JSON d'historique [{role,content}, ...]
 *          language : langue STT (défaut fr)
 *          text     : si fourni, on saute l'étape STT (utile en test)
 *
 * Réponse par défaut : JSON
 *   { success, transcript, reply, audio (base64), mimeType, voice, timings }
 * Réponse ?format=audio : MP3 brut de la réponse, transcript/réponse dans les
 *   en-têtes X-Transcript / X-Reply (encodés en JSON, tronqués si trop longs).
 */

"use strict";

const {
  HttpError,
  collectJsonBody,
  collectMultipart,
  isMultipart,
  extractAudio,
  queryOf,
  sendJson,
  sendBinary,
  wantsAudio,
} = require("./http");
const { transcribe, generateReply } = require("./providers");
const { synthesize, DEFAULT_VOICE } = require("./edge-tts");

/** Extrait les options communes (query + champs) sans écraser par du vide. */
function pick(url, fields, key) {
  const fromQuery = url.get(key);
  if (fromQuery) return fromQuery;
  const fromFields = fields[key];
  return fromFields === undefined || fromFields === null || fromFields === "" ? undefined : String(fromFields);
}

/**
 * Rend une chaîne sûre pour un en-tête HTTP (ASCII uniquement).
 * Les caractères non-ASCII sont échappés en JSON (\uXXXX) : la valeur reste
 * lisible et le décodage côté client est un simple JSON.parse.
 */
function asciiHeader(value, max = 1800) {
  const json = JSON.stringify(String(value == null ? "" : value));
  const ascii = json.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return ascii.length > max ? `${ascii.slice(0, max)}"…"` : ascii;
}

async function handleVoiceRequest(req, res) {
  if (req.method !== "POST") {
    throw new HttpError(405, "method_not_allowed", "Méthode acceptée : POST.");
  }

  const url = queryOf(req);
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  const jsonBody = ct.includes("application/json") && !isMultipart(req) ? await collectJsonBody(req) : null;

  let audio = null;
  let filename = "audio.bin";
  let mimetype = "application/octet-stream";
  let fields = {};

  if (isMultipart(req)) {
    // On analyse le formulaire nous-mêmes : l'audio est FACULTATIF si « text » est fourni.
    const { fields: formFields, files } = await collectMultipart(req);
    fields = formFields;
    const file = files.find((f) => f.field === "audio" || f.field === "file" || f.field === "data") || files[0];
    if (file && file.buffer.length) {
      audio = file.buffer;
      filename = file.filename;
      mimetype = file.mimetype;
    }
  } else if (jsonBody) {
    fields = jsonBody;
    if (jsonBody.audio) {
      const extracted = await extractAudio(req, jsonBody);
      audio = extracted.audio;
      filename = extracted.filename;
      mimetype = extracted.mimetype;
    }
  } else {
    const extracted = await extractAudio(req, null);
    audio = extracted.audio;
    filename = extracted.filename;
    mimetype = extracted.mimetype;
  }

  if (!audio && !pick(url, fields, "text")) {
    throw new HttpError(
      400,
      "missing_audio",
      "Aucun audio reçu. Envoyez un fichier (champ « audio ») ou un texte (champ « text »).",
    );
  }

  const total0 = Date.now();
  const timings = {};

  // 1) STT — sauf si un texte est fourni directement.
  let transcript;
  const usedProviders = { stt: null, llm: null, tts: "edge" };
  if (audio) {
    const stt = await transcribe(audio, {
      filename,
      mimetype,
      language: pick(url, fields, "language"),
      model: pick(url, fields, "sttModel") || pick(url, fields, "model"),
    });
    transcript = stt.text;
    timings.stt = stt.ms;
    usedProviders.stt = stt.provider;
  } else {
    transcript = String(pick(url, fields, "text") || "").trim();
    timings.stt = 0;
  }
  if (!transcript) throw new HttpError(422, "empty_transcript", "Transcription vide : aucun texte à envoyer au LLM.");

  // 2) LLM — la réponse textuelle.
  let history = [];
  const rawHistory = pick(url, fields, "history");
  if (rawHistory) {
    try {
      const parsed = typeof rawHistory === "string" ? JSON.parse(rawHistory) : rawHistory;
      if (Array.isArray(parsed)) history = parsed;
    } catch (_) {
      throw new HttpError(400, "invalid_history", "Le champ « history » doit être un tableau JSON [{role,content}].");
    }
  }
  const llm = await generateReply({ prompt: transcript, system: pick(url, fields, "system"), history });
  timings.llm = llm.ms;
  usedProviders.llm = llm.provider;

  // 3) TTS — la voix de la réponse.
  const tts0 = Date.now();
  const tts = await synthesize(llm.text, {
    voice: pick(url, fields, "voice") || DEFAULT_VOICE,
    rate: pick(url, fields, "rate"),
    pitch: pick(url, fields, "pitch"),
    volume: pick(url, fields, "volume"),
  });
  timings.tts = Date.now() - tts0;
  timings.total = Date.now() - total0;

  if (wantsAudio(req, url.get("format"))) {
    sendBinary(res, 200, tts.audio, tts.mimeType, {
      "X-Transcript": asciiHeader(transcript),
      "X-Reply": asciiHeader(llm.text),
      "X-Voice": tts.voice,
    });
    return;
  }

  sendJson(res, 200, {
    success: true,
    transcript,
    reply: llm.text,
    voice: tts.voice,
    mimeType: tts.mimeType,
    audio: tts.audio.toString("base64"),
    providers: usedProviders,
    timings,
  });
}

module.exports = { handleVoiceRequest };
