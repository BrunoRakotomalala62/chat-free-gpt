/**
 * pdf-handler.js — Route /api/pdf : répondre à une question à partir d'un PDF.
 *
 * Ajout additif : ne modifie AUCUNE logique existante. Réutilise par import :
 *   - lib/aichatting.js -> chatReliable()  (le même moteur que /api/chat)
 *   - lib/handler.js    -> collectBody()   (lecture du corps JSON)
 *
 * Endpoints :
 *   GET  /api/pdf?url=https://…/doc.pdf&prompt=Quel%20est%20le%20budget%20%3F
 *   POST /api/pdf  { "url": "https://…/doc.pdf", "prompt": "…" }
 *   POST /api/pdf  { "pdf": "data:application/pdf;base64,…", "prompt": "…" }
 *
 * Le texte est extrait avec `pdf-parse` puis transmis au backend via chatReliable.
 * ⚠️ pdf-parse (pdf.js v1.10) lit le ArrayBuffer sous-jacent en ignorant
 * `byteOffset` : passer un Buffer Node (souvent une vue du pool mémoire, offset
 * ≠ 0) provoque « bad XRef entry ». On copie donc dans un Uint8Array à offset 0.
 */

"use strict";

const { chatReliable } = require("./aichatting"); // import seul
const { collectBody } = require("./handler");      // import seul

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 Mo (URL distante) — le corps Vercel est limité à ~4,5 Mo
const MAX_TEXT_CHARS = 12000;           // budget de texte injecté dans le prompt

let pdfParse = null;
function loadParser() {
  if (!pdfParse) pdfParse = require("pdf-parse");
  return pdfParse;
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

async function getPdfBuffer(query, body) {
  const url = (query && query.get("url")) || (body && (body.url || body.pdf_url));
  const dataUri = (body && (body.pdf || body.dataUri)) || (query && query.get("pdf"));

  if (dataUri && /^data:application\/pdf/i.test(dataUri)) {
    return Buffer.from(dataUri.split(",")[1], "base64");
  }
  if (url && /^https?:\/\//i.test(url)) {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; chat-free-gpt/1.0)" },
    });
    if (!r.ok) throw new Error(`Téléchargement du PDF impossible (HTTP ${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_PDF_BYTES) throw new Error("PDF trop lourd (> 20 Mo).");
    return buf;
  }
  throw new Error("Fournissez 'url' (PDF distant) ou 'pdf' (data-URI base64).");
}

async function handlePdfRequest(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });
    res.end();
    return;
  }

  const query = req.method === "GET" ? new URL(req.url, "http://localhost").searchParams : null;
  const body = req.method === "POST" ? await collectBody(req) : null;
  if (!query && !body) {
    json(res, 405, { success: false, error: "Méthode non autorisée (utilisez GET ou POST)." });
    return;
  }

  const question =
    (query && query.get("prompt")) || (body && body.prompt) || "Résume ce document.";
  const model = (body && body.model) || (query && query.get("model")) || undefined;

  const buf = await getPdfBuffer(query, body);
  const parser = loadParser();

  // Copie à offset 0 (voir avertissement en tête de fichier).
  const clean = new Uint8Array(buf.length);
  clean.set(buf);
  const parsed = await parser(clean);

  const text = (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
  if (!text) {
    json(res, 422, {
      success: false,
      error: "Aucun texte extractible (PDF scanné/image ? un OCR est nécessaire).",
    });
    return;
  }

  const prompt =
    "Voici le contenu d'un document PDF. Réponds à la question en te fondant " +
    "UNIQUEMENT sur ce contenu.\n--- DÉBUT PDF ---\n" +
    text +
    "\n--- FIN PDF ---\nQuestion : " +
    question;

  const result = await chatReliable({ prompt: prompt.slice(0, 30000), model });
  json(res, 200, {
    success: true,
    reply: result.reply,
    pages: parsed.numpages,
    chars: text.length,
    model: result.model,
  });
}

module.exports = { handlePdfRequest };
