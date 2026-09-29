/**
 * Test automatisé des routes d'édition d'image (additif).
 *
 *   node test-image-edit.js
 *
 * Le serveur est lancé avec IMAGE_EDIT_PROVIDER=mock : aucune clé Magic Hour et
 * aucun réseau ne sont requis. Les routes existantes (/api/chat, /api/plot,
 * /api/geo, /api/tts, /api/stt, /api/voice) ne sont pas touchées — voir
 * test.js / test-plot.js / test-geo.js / test-voice.js.
 */

"use strict";

const { spawn } = require("node:child_process");

const ROOT = __dirname;
const PORT = 3600 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", BOLD = "\x1b[1m", YELLOW = "\x1b[33m", RESET = "\x1b[0m";

let passed = 0, failed = 0, skipped = 0;
const failures = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (n, e = "") => { passed++; console.log(`  ${GREEN}✓${RESET} ${n}${e ? ` ${DIM}${e}${RESET}` : ""}`); };
const ko = (n, err) => { failed++; failures.push(n); console.log(`  ${RED}✗${RESET} ${n}\n     ${RED}${err}${RESET}`); };
const skip = (n, why) => { skipped++; console.log(`  ${YELLOW}○${RESET} ${n} ${DIM}(ignoré : ${why})${RESET}`); };
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion échouée"); }
async function test(name, fn) { try { await fn(); } catch (err) { ko(name, err.message); } }

/** Mini PNG 1×1 valide (mêmes octets que le mock serveur). */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const PNG_DATA_URI = "data:image/png;base64," + PNG_1PX.toString("base64");

function isPng(buf) {
  return buf.length > 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG";
}

const server = spawn(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), IMAGE_EDIT_PROVIDER: "mock" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitForServer(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (_) { /* pas prêt */ }
    await sleep(200);
  }
  throw new Error("Le serveur n'a pas démarré.\n" + serverLog);
}

async function main() {
  console.log(`\n${BOLD}chat-free-gpt — tests des routes d'édition d'image${RESET} ${DIM}(${BASE})${RESET}\n`);
  await waitForServer();
  console.log(`${DIM}serveur prêt (IMAGE_EDIT_PROVIDER=mock)${RESET}\n`);

  console.log(`${BOLD}1. /api/image-models${RESET}`);
  await test("catalogue gratuit par défaut", async () => {
    const r = await fetch(`${BASE}/api/image-models`);
    const d = await r.json();
    assert(r.status === 200 && d.success === true, `HTTP ${r.status}`);
    assert(d.freeOnly === true, "freeOnly attendu");
    const ids = d.models.map((m) => m.id);
    for (const expected of ["flux-2-klein", "qwen-edit", "krea-2"]) {
      assert(ids.includes(expected), `${expected} absent`);
    }
    assert(d.models.every((m) => m.freeTier === true), "un modèle payant s'est glissé dans la liste");
    assert(!ids.includes("gpt-image-2"), "gpt-image-2 (payant) ne doit pas apparaître sans all=1");
    ok("catalogue gratuit par défaut", `${ids.join(", ")}`);
  });
  await test("?all=1 expose aussi les modèles payants", async () => {
    const d = await (await fetch(`${BASE}/api/image-models?all=1`)).json();
    assert(d.freeOnly === false && d.count > 3, "catalogue complet attendu");
    assert(d.models.some((m) => m.id === "gpt-image-2" && m.freeTier === false), "gpt-image-2 absent du catalogue complet");
    ok("?all=1 expose aussi les modèles payants", `${d.count} modèles`);
  });
  await test("POST interdit -> 405", async () => {
    const r = await fetch(`${BASE}/api/image-models`, { method: "POST" });
    assert(r.status === 405, `attendu 405, reçu ${r.status}`);
    ok("POST interdit -> 405");
  });

  console.log(`\n${BOLD}2. POST /api/image-edit (JSON)${RESET}`);
  let createdId = null;
  await test("URL publique + prompt -> projet créé", async () => {
    const r = await fetch(`${BASE}/api/image-edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: "https://example.com/photo.png", prompt: "Ajoute des lunettes de soleil" }),
    });
    const d = await r.json();
    assert(r.status === 200 && d.success, `HTTP ${r.status} — ${d.error || ""}`);
    assert(d.id && d.status === "queued", "id/statut manquant");
    assert(d.model === "flux-2-klein", `modèle par défaut inattendu : ${d.model}`);
    assert(d.resolution === "640px", `résolution par défaut inattendue : ${d.resolution}`);
    createdId = d.id;
    ok("URL publique + prompt -> projet créé", `id=${d.id}`);
  });
  await test("data-URI base64 + wait=1 -> complete + downloads", async () => {
    const r = await fetch(`${BASE}/api/image-edit?wait=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: PNG_DATA_URI, prompt: "Rends l'image bleue", model: "qwen-edit" }),
    });
    const d = await r.json();
    assert(r.status === 200 && d.success, `HTTP ${r.status} — ${d.error || ""}`);
    assert(d.status === "complete", `statut inattendu : ${d.status}`);
    assert(Array.isArray(d.downloads) && d.downloads.length === 1, "downloads manquant");
    ok("data-URI base64 + wait=1 -> complete", `modèle ${d.model}`);
  });
  await test("champ « image » simple (base64 nu)", async () => {
    const d = await (await fetch(`${BASE}/api/image-edit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: PNG_1PX.toString("base64"), prompt: "Flou artistique" }),
    })).json();
    assert(d.success && d.id, `échec : ${d.error || ""}`);
    ok("champ « image » simple (base64 nu)");
  });

  console.log(`\n${BOLD}3. POST /api/image-edit (multipart & brut)${RESET}`);
  await test("multipart file=image + prompt", async () => {
    const fd = new FormData();
    fd.append("image", new Blob([PNG_1PX], { type: "image/png" }), "photo.png");
    fd.append("prompt", "Change le fond en ciel");
    const d = await (await fetch(`${BASE}/api/image-edit`, { method: "POST", body: fd })).json();
    assert(d.success && d.id, `échec : ${d.error || ""}`);
    ok("multipart file=image + prompt", `id=${d.id}`);
  });
  await test("corps brut image/png + ?prompt=", async () => {
    const r = await fetch(`${BASE}/api/image-edit?prompt=${encodeURIComponent("Retire le filigrane")}`, {
      method: "POST", headers: { "Content-Type": "image/png" }, body: PNG_1PX,
    });
    const d = await r.json();
    assert(r.status === 200 && d.success, `HTTP ${r.status} — ${d.error || ""}`);
    ok("corps brut image/png + ?prompt=");
  });

  console.log(`\n${BOLD}4. GET /api/image-edit (statut & téléchargement)${RESET}`);
  await test("sans id -> 400", async () => {
    const r = await fetch(`${BASE}/api/image-edit`);
    const d = await r.json();
    assert(r.status === 400 && d.code === "missing_id", `HTTP ${r.status} code ${d.code}`);
    ok("sans id -> 400");
  });
  await test("id=…&wait=1 -> complete", async () => {
    const d = await (await fetch(`${BASE}/api/image-edit?id=${encodeURIComponent(createdId)}&wait=1`)).json();
    assert(d.success && d.status === "complete" && d.pending === false, `statut : ${d.status}`);
    ok("id=…&wait=1 -> complete");
  });
  await test("id=…&download=1 -> image base64", async () => {
    const d = await (await fetch(`${BASE}/api/image-edit?id=${createdId}&download=1`)).json();
    assert(d.success && typeof d.image === "string", "champ image manquant");
    assert(isPng(Buffer.from(d.image, "base64")), "base64 non PNG");
    ok("id=…&download=1 -> image base64", `mime ${d.mimeType}`);
  });
  await test("id=…&download=1&format=image -> PNG binaire", async () => {
    const r = await fetch(`${BASE}/api/image-edit?id=${createdId}&download=1&format=image`);
    assert(r.status === 200 && (r.headers.get("content-type") || "").includes("image/png"), `HTTP ${r.status} type ${r.headers.get("content-type")}`);
    assert(isPng(Buffer.from(await r.arrayBuffer())), "PNG invalide");
    ok("id=…&download=1&format=image -> PNG binaire");
  });

  console.log(`\n${BOLD}5. Validation${RESET}`);
  await test("prompt manquant -> 400", async () => {
    const d = await (await fetch(`${BASE}/api/image-edit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: "https://example.com/a.png" }),
    })).json();
    assert(d.code === "empty_prompt", `code ${d.code}`);
    ok("prompt manquant -> 400");
  });
  await test("image manquante -> 400", async () => {
    const d = await (await fetch(`${BASE}/api/image-edit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    })).json();
    assert(d.code === "missing_image", `code ${d.code}`);
    ok("image manquante -> 400");
  });
  await test("modèle inconnu -> 400", async () => {
    const d = await (await fetch(`${BASE}/api/image-edit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: "https://example.com/a.png", prompt: "test", model: "bidon" }),
    })).json();
    assert(d.code === "invalid_model", `code ${d.code}`);
    ok("modèle inconnu -> 400");
  });
  await test("résolution inconnue -> 400", async () => {
    const d = await (await fetch(`${BASE}/api/image-edit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: "https://example.com/a.png", prompt: "test", resolution: "8k" }),
    })).json();
    assert(d.code === "invalid_resolution", `code ${d.code}`);
    ok("résolution inconnue -> 400");
  });
  await test("méthode PUT interdite -> 405", async () => {
    const r = await fetch(`${BASE}/api/image-edit`, { method: "PUT" });
    assert(r.status === 405, `attendu 405, reçu ${r.status}`);
    ok("méthode PUT interdite -> 405");
  });

  console.log(`\n${BOLD}6. Transversal${RESET}`);
  await test("préflight CORS -> 204", async () => {
    const r = await fetch(`${BASE}/api/image-edit`, { method: "OPTIONS" });
    assert(r.status === 204 && r.headers.get("access-control-allow-origin"), `HTTP ${r.status}`);
    ok("préflight CORS -> 204");
  });
  await test("routes historiques intactes (/api/chat répond)", async () => {
    const r = await fetch(`${BASE}/api/chat?prompt=bonjour&uid=t`);
    assert(r.status !== 404, "la route /api/chat a disparu");
    ok("routes historiques intactes", `HTTP ${r.status}`);
  });
  await test("routes vocales intactes (/api/health)", async () => {
    const d = await (await fetch(`${BASE}/api/health`)).json();
    assert(d.success && d.providers && d.providers.tts, "health cassé");
    ok("routes vocales intactes (/api/health)");
  });

  console.log(`\n${BOLD}Bilan${RESET}: ${GREEN}${passed} réussis${RESET}, ${failed ? RED : DIM}${failed} échoués${RESET}, ${YELLOW}${skipped} ignorés${RESET}`);
  if (failed) console.log(`${RED}Échecs :${RESET} ${failures.join(", ")}`);
  server.kill("SIGTERM");
  await sleep(150);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}Erreur de la suite :${RESET}`, err.message);
  console.error(serverLog);
  server.kill("SIGTERM");
  process.exit(1);
});
