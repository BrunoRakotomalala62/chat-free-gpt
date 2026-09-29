/**
 * magichour.js — client Magic Hour (édition d'image par IA).
 *
 * Fournisseur ajouté en complément des routes existantes : il ne touche ni
 * /api/chat, ni /api/plot, ni /api/geo, ni les routes vocales.
 *
 * API utilisée (documentée sur https://docs.magichour.ai) :
 *   POST /v1/files/upload-urls   → URL pré-signée + file_path pour un asset local
 *   PUT  <upload_url>            → envoi des octets (sans jeton)
 *   POST /v1/ai-image-editor     → création du projet d'édition (renvoie { id, credits_charged })
 *   GET  /v1/image-projects/{id} → statut (queued/rendering/complete/error/canceled) + downloads
 *
 * Authentification : en-tête `Authorization: Bearer <MAGIC_HOUR_API_KEY>`.
 * La clé se crée sur https://magichour.ai/developer (crédits gratuits à l'inscription).
 *
 * ⚡ Important pour le plan gratuit : le modèle ET la résolution comptent.
 *    Les modèles réellement disponibles en tier « free » sont listés dans
 *    EDIT_MODELS avec `freeTier: true` (flux-2-klein, krea-2, qwen-edit),
 *    et la résolution gratuite est `640px`.
 *
 * IMAGE_EDIT_PROVIDER=mock : rendu simulé, hors ligne, sans clé (tests).
 */

"use strict";

const { HttpError, ConfigError } = require("./http");

/** Racine de l'API Magic Hour (surchargeable pour un mock/serveur local). */
const MH_BASE = String(process.env.MAGIC_HOUR_BASE_URL || "https://api.magichour.ai").replace(/\/+$/, "");

/** Délai maximal d'un appel amont (aligné sur le budget des routes vocales). */
const DEFAULT_TIMEOUT_MS = Number(process.env.IMAGE_EDIT_TIMEOUT_MS || 45000);
/** Budget d'attente par défaut du mode synchrone (`wait=1`). */
const DEFAULT_WAIT_MS = Number(process.env.IMAGE_EDIT_WAIT_MS || 40000);
/** Intervalle entre deux sondages de statut. */
const DEFAULT_POLL_MS = Number(process.env.IMAGE_EDIT_POLL_MS || 2000);
/** Taille maximale d'une image acceptée (octets) — plafond du corps Vercel ~4,5 Mo. */
const MAX_IMAGE_BYTES = Number(process.env.IMAGE_EDIT_MAX_BYTES || Math.floor(4.5 * 1024 * 1024));

/** Modèle gratuit par défaut (le moins cher du tier free : 5 crédits/image). */
const DEFAULT_MODEL = process.env.IMAGE_EDIT_MODEL || "flux-2-klein";
/** Résolution par défaut : `640px` est la seule pleinement gratuite. */
const DEFAULT_RESOLUTION = process.env.IMAGE_EDIT_RESOLUTION || "640px";
const DEFAULT_ASPECT_RATIO = process.env.IMAGE_EDIT_ASPECT_RATIO || "auto";

/**
 * Catalogue des modèles d'édition d'image Magic Hour.
 * `freeTier: true` = utilisable avec un compte gratuit (crédits offerts à l'inscription).
 * Coûts/limites issus de https://docs.magichour.ai/api-reference/models.
 */
const EDIT_MODELS = [
  {
    id: "flux-2-klein",
    label: "Flux 2 Klein",
    freeTier: true,
    creditsPerImage: 5,
    resolutions: ["640px", "1k", "2k"],
    maxInputImages: 5,
    bestFor: "Édition rapide et bon marché : retouche, restyle, ajout/retrait d'objets.",
  },
  {
    id: "qwen-edit",
    label: "Qwen Edit",
    freeTier: true,
    creditsPerImage: 10,
    resolutions: ["640px", "1k", "2k"],
    maxInputImages: 2,
    bestFor: "Inpainting guidé par prompt, suppression d'objets, changements de fond.",
  },
  {
    id: "krea-2",
    label: "Krea 2",
    freeTier: true,
    creditsPerImage: 10,
    resolutions: ["640px", "1k"],
    maxInputImages: 1,
    bestFor: "Restyle créatif à partir d'une seule image de référence.",
  },
  {
    id: "seedream-v4",
    label: "Seedream 4",
    freeTier: false,
    creditsPerImage: 40,
    resolutions: ["640px", "1k", "2k", "4k"],
    maxInputImages: 9,
    bestFor: "Rendu photoréaliste détaillé (plan payant).",
  },
  {
    id: "nano-banana",
    label: "Nano Banana",
    freeTier: false,
    creditsPerImage: 50,
    resolutions: ["640px", "1k"],
    maxInputImages: 9,
    bestFor: "Compositions stylisées (plan payant).",
  },
  {
    id: "nano-banana-2-lite",
    label: "Nano Banana 2 Lite",
    freeTier: false,
    creditsPerImage: 50,
    resolutions: ["640px", "1k"],
    maxInputImages: 9,
    bestFor: "Variante économique de Nano Banana 2 (plan payant).",
  },
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    freeTier: false,
    creditsPerImage: 50,
    resolutions: ["640px", "1k", "2k", "4k"],
    maxInputImages: 9,
    bestFor: "Suivi de prompt strict, haute résolution (plan payant).",
  },
  {
    id: "seedream-v4.5",
    label: "Seedream 4.5",
    freeTier: false,
    creditsPerImage: 50,
    resolutions: ["640px", "1k", "2k", "4k"],
    maxInputImages: 9,
    bestFor: "Qualité photoréaliste supérieure (plan payant).",
  },
  {
    id: "seedream-v5-pro",
    label: "Seedream 5 Pro",
    freeTier: false,
    creditsPerImage: 75,
    resolutions: ["640px", "1k", "2k"],
    maxInputImages: 9,
    bestFor: "Meilleur rendu Seedream (plan payant).",
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    freeTier: false,
    creditsPerImage: 100,
    resolutions: ["640px", "1k", "2k", "4k"],
    maxInputImages: 9,
    bestFor: "Haute fidélité, jusqu'à 4K (plan payant).",
  },
  {
    id: "gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    freeTier: false,
    creditsPerImage: 100,
    resolutions: ["640px", "1k", "2k", "4k"],
    maxInputImages: 9,
    bestFor: "Rendu premium GPT Image (plan payant).",
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    freeTier: false,
    creditsPerImage: 150,
    resolutions: ["1k", "2k", "4k"],
    maxInputImages: 9,
    bestFor: "Qualité maximale (plan payant).",
  },
  {
    id: "default",
    label: "Auto (choix Magic Hour)",
    freeTier: false,
    creditsPerImage: null,
    resolutions: ["auto", "640px", "1k", "2k", "4k"],
    maxInputImages: null,
    bestFor: "Laisse Magic Hour choisir ; peut basculer sur un modèle payant. À éviter en gratuit.",
  },
];

/** Identifiants valides acceptés par POST /v1/ai-image-editor. */
const EDIT_MODEL_IDS = EDIT_MODELS.map((m) => m.id);

/** Extensions image acceptées par Magic Hour (hors point). */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "jfif", "heic", "heif", "webp", "avif", "jp2", "tiff", "tif", "bmp"];
const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS);

/** Mime → extension (utilisé pour demander l'URL d'upload). */
const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/jfif": "jfif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/jp2": "jp2",
  "image/tiff": "tiff",
  "image/x-tiff": "tiff",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
};

/** Résout le fournisseur d'édition d'image actif. */
function resolveImageEditProvider() {
  const explicit = String(process.env.IMAGE_EDIT_PROVIDER || "").trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.MAGIC_HOUR_API_KEY) return "magichour";
  return "unconfigured";
}

/** Vrai si le mode simulé (tests hors ligne) est actif. */
function isMock() {
  return resolveImageEditProvider() === "mock";
}

/** En-têtes d'authentification Magic Hour (jamais journalisés). */
function authHeaders() {
  const key = process.env.MAGIC_HOUR_API_KEY;
  if (!key) {
    throw new ConfigError(
      "MAGIC_HOUR_API_KEY est absente. Créez une clé sur https://magichour.ai/developer puis définissez-la dans Vercel (Settings > Environment Variables).",
    );
  }
  return { Authorization: `Bearer ${key}` };
}

/** fetch avec délai maximal et erreurs normalisées. */
async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new HttpError(504, "upstream_timeout", `Magic Hour n'a pas répondu en ${timeoutMs} ms.`);
    }
    throw new HttpError(502, "upstream_unreachable", `Magic Hour injoignable : ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Transforme une réponse d'erreur Magic Hour en HttpError lisible (code + message). */
async function upstreamError(res, what) {
  let code = "";
  let message = "";
  try {
    const text = (await res.text()).slice(0, 600);
    try {
      const data = JSON.parse(text);
      code = data.code || "";
      message = data.message || "";
    } catch (_) {
      message = text;
    }
  } catch (_) {
    /* ignore */
  }
  const detail = [code && `[${code}]`, message].filter(Boolean).join(" ").slice(0, 400) || `HTTP ${res.status}`;
  // 402 = crédits insuffisants : on relaie le code pour que le client sache quoi faire.
  const status = res.status === 402 ? 402 : res.status >= 500 ? 502 : 400;
  const machine = res.status === 401 ? "magichour_unauthorized" : res.status === 402 ? "insufficient_credits" : "magichour_error";
  throw new HttpError(status, machine, `${what} : ${detail}`, { upstreamStatus: res.status, upstreamCode: code || null });
}

/** Petite pause. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Devine l'extension d'image à partir du mime, du nom de fichier ou des octets. */
function guessImageExtension({ mimetype, filename, buffer } = {}) {
  const ct = String(mimetype || "").toLowerCase().split(";")[0].trim();
  if (MIME_TO_EXT[ct]) return MIME_TO_EXT[ct];

  const name = String(filename || "");
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1];
  if (ext && IMAGE_EXTENSION_SET.has(ext.toLowerCase())) return ext.toLowerCase();

  // Détection par « magic bytes » (couvre les cas sans extension fiable).
  if (Buffer.isBuffer(buffer) && buffer.length >= 12) {
    if (buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") return "png";
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
    if (buffer.toString("ascii", 0, 2) === "BM") return "bmp";
    if (buffer.toString("ascii", 0, 4) === "II*\u0000" || buffer.toString("ascii", 0, 4) === "MM\u0000*") return "tiff";
    if (buffer.toString("ascii", 4, 8) === "ftyp") {
      const brand = buffer.toString("ascii", 8, 12).toLowerCase();
      if (brand.startsWith("avif")) return "avif";
      if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) return "heic";
    }
  }
  return "png"; // repli raisonnable (l'API validera).
}

/**
 * Envoie une image locale sur le stockage Magic Hour.
 * @param {Buffer} buffer
 * @param {{mimetype?:string, filename?:string}} [meta]
 * @returns {Promise<{filePath:string, extension:string}>}
 */
async function uploadImage(buffer, meta = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new HttpError(400, "missing_image", "Image vide ou manquante.");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new HttpError(413, "image_too_large", `Image trop volumineuse (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} Mo).`);
  }
  if (isMock()) {
    const ext = guessImageExtension({ ...meta, buffer });
    return { filePath: `mock-assets/${Date.now()}.${ext}`, extension: ext };
  }

  const extension = guessImageExtension({ ...meta, buffer });
  const headers = { ...authHeaders(), "Content-Type": "application/json", accept: "application/json" };

  // 1) Demande d'URL pré-signée.
  const res = await fetchWithTimeout(`${MH_BASE}/v1/files/upload-urls`, {
    method: "POST",
    headers,
    body: JSON.stringify({ items: [{ type: "image", extension }] }),
  });
  if (!res.ok) await upstreamError(res, "Demande d'URL d'upload");
  const data = await res.json().catch(() => null);
  const item = data && data.items && data.items[0];
  if (!item || !item.upload_url || !item.file_path) {
    throw new HttpError(502, "upload_url_missing", "Magic Hour n'a pas renvoyé d'URL d'upload exploitable.");
  }

  // 2) PUT des octets sur l'URL pré-signée (sans jeton ; content-type volontairement omis,
  //    comme dans la documentation officielle).
  const put = await fetchWithTimeout(item.upload_url, { method: "PUT", body: buffer });
  if (!put.ok) {
    throw new HttpError(502, "upload_failed", `Envoi de l'image refusé par Magic Hour (HTTP ${put.status}).`);
  }
  return { filePath: item.file_path, extension };
}

/**
 * Crée un projet d'édition d'image.
 * @param {{imagePaths:string[], prompt:string, model?:string, resolution?:string,
 *          aspectRatio?:string, imageCount?:number, name?:string}} input
 * @returns {Promise<{id:string, creditsCharged:number, model:string, resolution:string, aspectRatio:string, imageCount:number}>}
 */
async function createImageEdit(input) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new HttpError(400, "empty_prompt", "Le paramètre « prompt » est requis (décrivez la modification souhaitée).");
  const imagePaths = (input.imagePaths || []).map((p) => String(p).trim()).filter(Boolean);
  if (!imagePaths.length) throw new HttpError(400, "missing_image", "Au moins une image est requise (image, image_url ou fichier « image »).");
  if (imagePaths.length > 10) throw new HttpError(400, "too_many_images", "Maximum 10 images par requête (limite Magic Hour).");

  const model = String(input.model || DEFAULT_MODEL);
  const resolution = String(input.resolution || DEFAULT_RESOLUTION);
  const aspectRatio = String(input.aspectRatio || DEFAULT_ASPECT_RATIO);
  const imageCount = Number(input.imageCount || 1);

  if (isMock()) {
    return {
      id: `mock-${Date.now().toString(36)}`,
      creditsCharged: 0,
      model,
      resolution,
      aspectRatio,
      imageCount,
    };
  }

  const body = {
    name: input.name || `Image edit - ${new Date().toISOString()}`,
    image_count: imageCount,
    model,
    aspect_ratio: aspectRatio,
    resolution,
    style: { prompt },
    assets: { image_file_paths: imagePaths },
  };

  const res = await fetchWithTimeout(`${MH_BASE}/v1/ai-image-editor`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await upstreamError(res, "Création de l'édition d'image");
  const data = await res.json().catch(() => null);
  if (!data || !data.id) throw new HttpError(502, "magichour_bad_response", "Réponse Magic Hour illisible (champ « id » absent).");

  return {
    id: data.id,
    creditsCharged: Number(data.credits_charged || 0),
    model,
    resolution,
    aspectRatio,
    imageCount,
  };
}

/** Récupère l'état complet d'un projet image. */
async function getImageProject(id) {
  const projectId = String(id || "").trim();
  if (!projectId) throw new HttpError(400, "missing_id", "Identifiant de projet manquant.");

  if (isMock()) {
    return {
      id: projectId,
      name: "Image éditée (simulation)",
      status: "complete",
      image_count: 1,
      type: "AI_IMAGE_EDITOR",
      created_at: new Date().toISOString(),
      enabled: true,
      credits_charged: 0,
      downloads: [{ url: MOCK_PNG_DATA_URI, expires_at: new Date(Date.now() + 3600e3).toISOString() }],
      error: null,
    };
  }

  const res = await fetchWithTimeout(`${MH_BASE}/v1/image-projects/${encodeURIComponent(projectId)}`, {
    method: "GET",
    headers: { ...authHeaders(), accept: "application/json" },
  });
  if (!res.ok) await upstreamError(res, "Lecture du projet image");
  const data = await res.json().catch(() => null);
  if (!data || !data.id) throw new HttpError(502, "magichour_bad_response", "Réponse Magic Hour illisible (projet image).");
  return data;
}

/** États terminaux d'un projet. */
const TERMINAL_STATUSES = new Set(["complete", "error", "canceled"]);

/**
 * Attend la fin d'un rendu en sondant GET /v1/image-projects/{id}.
 * @returns {Promise<object>} le dernier état connu (terminal, ou en cours si le budget est épuisé)
 */
async function waitForImageProject(id, { waitMs = DEFAULT_WAIT_MS, pollMs = DEFAULT_POLL_MS } = {}) {
  const budget = Math.max(0, Number(waitMs) || 0);
  const interval = Math.max(500, Number(pollMs) || DEFAULT_POLL_MS);
  const deadline = Date.now() + budget;

  let project = await getImageProject(id);
  while (!TERMINAL_STATUSES.has(project.status)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return project; // budget épuisé : on rend l'état courant (à re-sonder)
    await sleep(Math.min(interval, remaining));
    project = await getImageProject(id);
  }
  return project;
}

/** Télécharge une sortie Magic Hour. Gère aussi les data-URI (mode mock). */
async function downloadBuffer(url) {
  const target = String(url || "");
  if (/^data:/i.test(target)) {
    const match = /^data:([^;]*);base64,(.*)$/s.exec(target);
    if (!match) throw new HttpError(502, "bad_download_url", "Data-URI de sortie illisible.");
    return { buffer: Buffer.from(match[2], "base64"), contentType: match[1] || "application/octet-stream" };
  }
  const res = await fetchWithTimeout(target, { method: "GET" });
  if (!res.ok) throw new HttpError(502, "download_failed", `Téléchargement du résultat refusé (HTTP ${res.status}).`);
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: res.headers.get("content-type") || "image/png" };
}

/** Liste du catalogue de modèles (copie), filtrable sur le tier gratuit. */
function listEditModels({ freeOnly = false } = {}) {
  const models = freeOnly ? EDIT_MODELS.filter((m) => m.freeTier) : EDIT_MODELS;
  return models.map((m) => ({ ...m }));
}

/** Décrit l'état du fournisseur d'image (pour /api/image-models, sans révéler la clé). */
function describeImageProvider() {
  return {
    provider: resolveImageEditProvider(),
    defaultModel: DEFAULT_MODEL,
    defaultResolution: DEFAULT_RESOLUTION,
    defaultAspectRatio: DEFAULT_ASPECT_RATIO,
    freeModels: EDIT_MODELS.filter((m) => m.freeTier).map((m) => m.id),
    configured: Boolean(process.env.MAGIC_HOUR_API_KEY) || isMock(),
  };
}

/** Petit PNG 1×1 valide (transparent), servi par le mode mock. */
const MOCK_PNG_DATA_URI =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

module.exports = {
  MH_BASE,
  DEFAULT_MODEL,
  DEFAULT_RESOLUTION,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WAIT_MS,
  DEFAULT_POLL_MS,
  MAX_IMAGE_BYTES,
  EDIT_MODELS,
  EDIT_MODEL_IDS,
  IMAGE_EXTENSIONS,
  TERMINAL_STATUSES,
  resolveImageEditProvider,
  isMock,
  guessImageExtension,
  uploadImage,
  createImageEdit,
  getImageProject,
  waitForImageProject,
  downloadBuffer,
  listEditModels,
  describeImageProvider,
};
