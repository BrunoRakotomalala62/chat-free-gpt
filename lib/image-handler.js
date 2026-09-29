/**
 * image-handler.js — routes d'édition d'image Magic Hour (ajout, aucune route
 * existante n'est modifiée).
 *
 *   POST /api/image-edit            → crée un projet d'édition et renvoie son id
 *   GET  /api/image-edit?id=…       → état du projet (queued/rendering/complete/error/canceled)
 *   GET  /api/image-models          → catalogue des modèles (gratuits par défaut)
 *
 * Entrées acceptées (POST) — l'image peut venir de :
 *   • multipart/form-data : champ fichier « image » (ou « file »/« source »), répétable ;
 *   • JSON : « image » = data-URI/base64, ou « image_url »/« url » = URL publique,
 *            ou « image_paths » = tableau (URL publiques ou file_path Magic Hour) ;
 *   • corps brut : Content-Type image/* (le prompt passe alors par ?prompt=…).
 *
 * Le prompt est toujours requis. Par défaut : modèle gratuit (`flux-2-klein`),
 * résolution `640px`, une image. `wait=1` attend la fin du rendu (mode synchrone),
 * sinon on renvoie tout de suite l'id à re-sonder.
 */

"use strict";

const {
  HttpError,
  collectJsonBody,
  collectRawBody,
  collectMultipart,
  isMultipart,
  sendJson,
  sendBinary,
  queryOf,
} = require("./http");
const mh = require("./magichour");

/** Valeurs booléennes acceptées en query/formulaire. */
const TRUTHY = new Set(["1", "true", "yes", "on", "oui", "vrai"]);

/** Enums imposés par l'API Magic Hour. */
const RESOLUTIONS = ["auto", "640px", "1k", "2k", "4k"];
const ASPECT_RATIOS = ["auto", "16:9", "9:16", "4:3", "3:2", "1:1", "4:5", "2:3"];
const IMAGE_COUNTS = [1, 4, 9, 16];

function truthy(value) {
  return TRUTHY.has(String(value == null ? "" : value).trim().toLowerCase());
}

/** Vrai si la chaîne est une référence d'asset utilisable telle quelle. */
function isAssetRef(value) {
  const s = String(value || "").trim();
  return /^https?:\/\//i.test(s) || /^api-assets\//i.test(s);
}

/** Vrai si la chaîne ressemble à un base64 (et non à une URL/un chemin). */
function isProbablyBase64(value) {
  const s = String(value || "").trim();
  return s.length > 64 && /^[A-Za-z0-9+/=\r\n]+$/.test(s) && !/^https?:\/\//i.test(s);
}

/** Décode une chaîne « data:image/...;base64,… » ou un base64 nu. */
function decodeBase64Image(value, fallbackMime = "image/png") {
  const s = String(value || "").trim();
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(s);
  if (match) {
    const mime = match[1] || fallbackMime;
    const payload = match[3] || "";
    const buffer = match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "binary");
    if (!buffer.length) throw new HttpError(400, "invalid_image", "Image data-URI vide.");
    return { buffer, mimetype: mime };
  }
  const buffer = Buffer.from(s, "base64");
  if (!buffer.length) throw new HttpError(400, "invalid_image", "Base64 d'image invalide ou vide.");
  return { buffer, mimetype: fallbackMime };
}

/**
 * Résout une liste de valeurs « image » en références Magic Hour.
 * Upload les octets locaux, laisse passer les URL publiques / file_path existants.
 * @returns {Promise<string[]>} image_file_paths prêts pour l'API
 */
async function resolveImageRefs(values) {
  const refs = [];
  for (const raw of values) {
    const value = typeof raw === "object" && raw !== null ? raw : String(raw == null ? "" : raw);
    if (typeof value === "object") {
      if (!value.buffer || !value.buffer.length) continue;
      const { filePath } = await mh.uploadImage(value.buffer, { mimetype: value.mimetype, filename: value.filename });
      refs.push(filePath);
      continue;
    }
    const s = String(value).trim();
    if (!s) continue;
    if (isAssetRef(s)) {
      refs.push(s);
      continue;
    }
    if (/^data:image\//i.test(s) || isProbablyBase64(s)) {
      const { buffer, mimetype } = decodeBase64Image(s);
      const { filePath } = await mh.uploadImage(buffer, { mimetype });
      refs.push(filePath);
      continue;
    }
    throw new HttpError(
      400,
      "invalid_image",
      "Image non reconnue. Fournissez un fichier (multipart), un base64/data-URI, une URL publique http(s) ou un file_path Magic Hour (api-assets/…).",
    );
  }
  return refs;
}

/** Lit un paramètre depuis les champs de formulaire (tolère plusieurs casses). */
function field(fields, ...names) {
  for (const name of names) {
    if (fields && fields[name] != null && fields[name] !== "") return fields[name];
  }
  return undefined;
}

/** Rassemble { refs, options } à partir de la requête (multipart / JSON / brut / URL). */
async function collectEditInput(req, url) {
  let fields = {};
  let values = []; // valeurs image (Buffers déjà prêts, ou chaînes)
  let rawPrompt;

  const ctSource = String(req.headers["content-type"] || "").toLowerCase();

  if (isMultipart(req)) {
    const { fields: formFields, files } = await collectMultipart(req, { maxFileBytes: mh.MAX_IMAGE_BYTES, maxFiles: 10, maxFields: 40 });
    fields = formFields || {};
    // Tous les fichiers = des images (le 1er est l'image de base, les suivants des références).
    for (const f of files) {
      if (f && f.buffer && f.buffer.length) values.push({ buffer: f.buffer, mimetype: f.mimetype, filename: f.filename });
    }
    const urlField = field(fields, "image_url", "url", "imageUrl");
    if (urlField) values.push(urlField);
    const inline = field(fields, "image_base64", "imageBase64");
    if (inline) values.push(inline);
  } else if (ctSource.includes("application/json")) {
    const body = await collectJsonBody(req, mh.MAX_IMAGE_BYTES);
    fields = body || {};
    const addImages = (v) => {
      if (v == null) return;
      if (Array.isArray(v)) values.push(...v);
      else values.push(v);
    };
    addImages(body.image_urls);
    addImages(body.image_url);
    addImages(body.images);
    addImages(body.image);
    addImages(body.image_paths);
    addImages(body.url);
    rawPrompt = body.prompt || body.text || body.q;
  } else if (ctSource.includes("application/x-www-form-urlencoded")) {
    const raw = (await collectRawBody(req)).toString("utf8");
    const form = new URLSearchParams(raw);
    fields = Object.fromEntries(form.entries());
    const v = field(fields, "image", "image_url", "url");
    if (v) values.push(v);
    rawPrompt = field(fields, "prompt", "text", "q");
  } else if (ctSource.startsWith("image/") || ctSource.startsWith("application/octet-stream")) {
    const buffer = await collectRawBody(req, mh.MAX_IMAGE_BYTES);
    if (!buffer.length) throw new HttpError(400, "missing_image", "Corps d'image vide.");
    values.push({ buffer, mimetype: ctSource.split(";")[0].trim(), filename: "image" });
  } else if (req.method === "POST") {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Type de corps non pris en charge. Utilisez multipart/form-data, application/json, ou un corps image/*.",
    );
  }

  // Le prompt peut aussi venir de la query (utile pour le corps brut image/*).
  const prompt = String(field(fields, "prompt", "text", "q") ?? rawPrompt ?? url.get("prompt") ?? url.get("text") ?? "").trim();

  const options = {
    prompt,
    model: field(fields, "model") || url.get("model"),
    resolution: field(fields, "resolution") || url.get("resolution"),
    aspectRatio: field(fields, "aspect_ratio", "aspectRatio", "ratio") || url.get("aspect_ratio") || url.get("ratio"),
    imageCount: field(fields, "image_count", "imageCount", "count") || url.get("image_count") || url.get("count"),
    name: field(fields, "name") || url.get("name"),
  };

  return { values, options };
}

/** Valide et normalise les options d'édition. */
function normalizeOptions(options) {
  const model = String(options.model || mh.DEFAULT_MODEL).trim();
  if (!mh.EDIT_MODEL_IDS.includes(model)) {
    throw new HttpError(400, "invalid_model", `Modèle inconnu : « ${model} ». Valeurs acceptées : ${mh.EDIT_MODEL_IDS.join(", ")}.`);
  }
  const resolution = String(options.resolution || mh.DEFAULT_RESOLUTION).trim();
  if (!RESOLUTIONS.includes(resolution)) {
    throw new HttpError(400, "invalid_resolution", `Résolution invalide : « ${resolution} ». Valeurs : ${RESOLUTIONS.join(", ")}.`);
  }
  const aspectRatio = String(options.aspectRatio || mh.DEFAULT_ASPECT_RATIO).trim();
  if (!ASPECT_RATIOS.includes(aspectRatio)) {
    throw new HttpError(400, "invalid_aspect_ratio", `Format invalide : « ${aspectRatio} ». Valeurs : ${ASPECT_RATIOS.join(", ")}.`);
  }
  const imageCount = Number(options.imageCount || 1);
  if (!IMAGE_COUNTS.includes(imageCount)) {
    throw new HttpError(400, "invalid_image_count", `Nombre d'images invalide : « ${options.imageCount} ». Valeurs : ${IMAGE_COUNTS.join(", ")}.`);
  }
  return { prompt: String(options.prompt || "").trim(), model, resolution, aspectRatio, imageCount, name: options.name ? String(options.name) : undefined };
}

/**
 * Vrai si le client veut l'image binaire plutôt que du JSON.
 * ?format=image|binary|png… → oui ; ?format=json → non ; sinon, uniquement
 * si l'en-tête Accept demande explicitement une image.
 */
function wantsImageBinary(req, format) {
  const f = String(format || "").toLowerCase();
  if (["image", "binary", "png", "jpeg", "jpg", "file"].includes(f)) return true;
  if (f === "json") return false;
  const accept = String(req.headers.accept || "");
  return accept.includes("image/") && !accept.includes("application/json");
}

/** Mise en forme homogène d'un projet Magic Hour pour la réponse JSON. */
function formatProject(project, extra = {}) {
  const downloads = Array.isArray(project.downloads) ? project.downloads : [];
  const status = project.status || "unknown";
  return {
    success: true,
    id: project.id,
    status,
    pending: !mh.TERMINAL_STATUSES.has(status),
    type: project.type || "AI_IMAGE_EDITOR",
    imageCount: project.image_count ?? null,
    creditsCharged: project.credits_charged ?? null,
    createdAt: project.created_at || null,
    name: project.name ?? null,
    downloads: downloads.map((d) => ({ url: d.url, expiresAt: d.expires_at || null })),
    error: project.error ?? null,
    ...extra,
  };
}

/** POST /api/image-edit — création d'un projet d'édition. */
async function handleCreate(req, res) {
  const url = queryOf(req);
  const { values, options } = await collectEditInput(req, url);
  const opts = normalizeOptions(options);

  if (!opts.prompt) {
    throw new HttpError(
      400,
      "empty_prompt",
      "Le paramètre « prompt » est requis : décrivez la modification souhaitée (ex. « ajoute des lunettes de soleil »).",
    );
  }
  if (!values.length) {
    throw new HttpError(
      400,
      "missing_image",
      "Aucune image reçue. Envoyez un fichier multipart « image », un champ JSON « image » (base64/data-URI), « image_url », ou un corps image/*.",
    );
  }

  const imagePaths = await resolveImageRefs(values);

  const created = await mh.createImageEdit({
    imagePaths,
    prompt: opts.prompt,
    model: opts.model,
    resolution: opts.resolution,
    aspectRatio: opts.aspectRatio,
    imageCount: opts.imageCount,
    name: opts.name,
  });

  const wait = truthy(field(options, "wait", "sync")) || truthy(url.get("wait")) || truthy(url.get("sync"));
  const base = {
    model: created.model,
    resolution: created.resolution,
    aspectRatio: created.aspectRatio,
    requestedImageCount: created.imageCount,
    images: imagePaths,
  };

  if (!wait) {
    sendJson(res, 200, {
      ...base,
      success: true,
      id: created.id,
      status: "queued",
      pending: true,
      creditsCharged: created.creditsCharged,
      poll: `/api/image-edit?id=${encodeURIComponent(created.id)}`,
      hint: "Rendu en cours. Rechargez /api/image-edit?id=… jusqu'au statut « complete », ou ajoutez wait=1 pour attendre côté serveur.",
    });
    return;
  }

  const project = await mh.waitForImageProject(created.id, {
    waitMs: Number(process.env.IMAGE_EDIT_WAIT_MS || mh.DEFAULT_WAIT_MS),
    pollMs: Number(process.env.IMAGE_EDIT_POLL_MS || mh.DEFAULT_POLL_MS),
  });

  sendJson(res, 200, formatProject(project, { ...base, creditsCharged: project.credits_charged ?? created.creditsCharged }));
}

/** GET /api/image-edit?id=… — état (et éventuellement téléchargement) d'un projet. */
async function handleStatus(req, res) {
  const url = queryOf(req);
  const id = url.get("id") || url.get("project") || url.get("projectId");
  if (!id) {
    throw new HttpError(
      400,
      "missing_id",
      "Paramètre « id » requis. Exemple : GET /api/image-edit?id=<id renvoyé par POST>.",
    );
  }

  const wait = truthy(url.get("wait")) || truthy(url.get("sync"));
  const download = truthy(url.get("download"));
  const format = url.get("format");

  const project = wait
    ? await mh.waitForImageProject(id, {
        waitMs: Number(process.env.IMAGE_EDIT_WAIT_MS || mh.DEFAULT_WAIT_MS),
        pollMs: Number(process.env.IMAGE_EDIT_POLL_MS || mh.DEFAULT_POLL_MS),
      })
    : await mh.getImageProject(id);

  const downloads = Array.isArray(project.downloads) ? project.downloads : [];

  // Téléchargement direct : ?download=1 (+ format=image) sur un projet terminé.
  if (download && project.status === "complete" && downloads.length && wantsImageBinary(req, format)) {
    const first = downloads[0];
    const { buffer, contentType } = await mh.downloadBuffer(first.url);
    sendBinary(res, 200, buffer, contentType, {
      "X-Project-Id": project.id,
      "X-Credits-Charged": String(project.credits_charged ?? ""),
    });
    return;
  }

  // ?download=1 sans format=image → renvoyer aussi l'image en base64 dans le JSON.
  let inline = {};
  if (download && project.status === "complete" && downloads.length) {
    try {
      const first = downloads[0];
      const { buffer, contentType } = await mh.downloadBuffer(first.url);
      inline = { image: buffer.toString("base64"), mimeType: contentType };
    } catch (err) {
      inline = { downloadError: String(err && err.message ? err.message : err) };
    }
  }

  sendJson(res, 200, formatProject(project, inline));
}

/** Aiguillage /api/image-edit (GET statut, POST création). */
async function handleImageEditRequest(req, res) {
  if (req.method === "POST") return handleCreate(req, res);
  if (req.method === "GET" || req.method === "HEAD") return handleStatus(req, res);
  throw new HttpError(405, "method_not_allowed", "Méthodes acceptées : GET, POST.");
}

/** GET /api/image-models?all=1 — catalogue des modèles (gratuits par défaut). */
async function handleImageModelsRequest(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw new HttpError(405, "method_not_allowed", "Méthode acceptée : GET.");
  }
  const url = queryOf(req);
  const all = truthy(url.get("all"));
  const freeOnly = !all; // par défaut, on ne montre que ce qui marche en gratuit
  const models = mh.listEditModels({ freeOnly });
  sendJson(res, 200, {
    success: true,
    provider: mh.describeImageProvider(),
    freeOnly,
    count: models.length,
    models,
  });
}

module.exports = { handleImageEditRequest, handleImageModelsRequest };
