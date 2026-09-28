/**
 * Test automatisé des routes vocales ajoutées (additif).
 *
 *   node test-voice.js
 *
 * Le serveur est lancé avec STT_PROVIDER=mock et LLM_PROVIDER=mock : aucune clé
 * n'est requise. Le TTS est en revanche testé en réel contre Microsoft Edge
 * (sans clé). Les routes existantes (/api/chat, /api/plot, /api/geo) ne sont
 * pas touchées — voir test.js / test-plot.js / test-geo.js.
 */

"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = __dirname;
const PORT = 3200 + Math.floor(Math.random() * 400);
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

/** Magic bytes MP3 : frame sync 0xFFEx ou tag ID3. */
function isMp3(buf) {
  if (buf.length < 4) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

const server = spawn(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), STT_PROVIDER: "mock", LLM_PROVIDER: "mock", TTS_VOICE: "fr-FR-DeniseNeural" },
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

const SAMPLE = new Uint8Array([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32]); // RIFF/WAVE

async function main() {
  console.log(`\n${BOLD}chat-free-gpt — tests des routes vocales${RESET} ${DIM}(${BASE})${RESET}\n`);
  await waitForServer();
  console.log(`${DIM}serveur prêt${RESET}\n`);

  console.log(`${BOLD}1. /api/health${RESET}`);
  await test("état des fournisseurs", async () => {
    const r = await fetch(`${BASE}/api/health`);
    const d = await r.json();
    assert(r.status === 200 && d.success === true, `HTTP ${r.status}`);
    assert(d.providers.tts.provider === "edge", "TTS != edge");
    ok("état des fournisseurs", `STT=${d.providers.stt.provider} LLM=${d.providers.llm.provider}`);
  });

  console.log(`\n${BOLD}2. /api/voices${RESET}`);
  await test("voix françaises listées", async () => {
    const r = await fetch(`${BASE}/api/voices?language=fr`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    assert(d.count > 0 && d.voices.every((v) => v.language === "fr"), "liste invalide");
    ok("voix françaises listées", `${d.count} voix`);
  });

  console.log(`\n${BOLD}3. /api/tts (sans clé)${RESET}`);
  await test("POST JSON -> MP3", async () => {
    const r = await fetch(`${BASE}/api/tts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Bonjour, test des routes vocales.", rate: "+10%" }),
    });
    if (r.status === 502) return skip("POST JSON -> MP3", "Edge TTS injoignable");
    assert(r.status === 200 && r.headers.get("content-type").includes("audio/mpeg"), `HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    assert(isMp3(buf) && buf.length > 1000, "MP3 invalide");
    ok("POST JSON -> MP3", `${buf.length} octets`);
  });
  await test("GET querystring -> audio", async () => {
    const r = await fetch(`${BASE}/api/tts?text=${encodeURIComponent("Salut")}&voice=fr-FR-HenriNeural`);
    if (r.status === 502) return skip("GET querystring -> audio", "Edge TTS injoignable");
    assert(r.status === 200 && isMp3(Buffer.from(await r.arrayBuffer())), `HTTP ${r.status}`);
    ok("GET querystring -> audio");
  });
  await test("?format=json renvoie du base64", async () => {
    const r = await fetch(`${BASE}/api/tts?format=json`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Test" }),
    });
    if (r.status === 502) return skip("?format=json", "Edge TTS injoignable");
    const d = await r.json();
    assert(d.success && isMp3(Buffer.from(d.audio, "base64")), "base64 invalide");
    ok("?format=json renvoie du base64");
  });
  await test("texte vide -> 400", async () => {
    const r = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert(r.status === 400 && (await r.json()).code === "empty_text", `HTTP ${r.status}`);
    ok("texte vide -> 400");
  });
  await test("voix invalide -> 400", async () => {
    const r = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x", voice: "bidon" }) });
    assert(r.status === 400 && (await r.json()).code === "invalid_voice", `HTTP ${r.status}`);
    ok("voix invalide -> 400");
  });

  console.log(`\n${BOLD}4. /api/stt${RESET}`);
  await test("multipart", async () => {
    const fd = new FormData();
    fd.append("audio", new Blob([SAMPLE], { type: "audio/wav" }), "q.wav");
    fd.append("language", "fr");
    const d = await (await fetch(`${BASE}/api/stt`, { method: "POST", body: fd })).json();
    assert(d.success && d.text, "texte manquant");
    ok("multipart", `« ${d.text} »`);
  });
  await test("corps brut audio/wav", async () => {
    const d = await (await fetch(`${BASE}/api/stt`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: SAMPLE })).json();
    assert(d.success && d.text, "texte manquant");
    ok("corps brut audio/wav");
  });
  await test("JSON base64", async () => {
    const r = await fetch(`${BASE}/api/stt`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: "data:audio/wav;base64," + Buffer.from(SAMPLE).toString("base64") }),
    });
    const d = await r.json();
    assert(d.success && d.text, "texte manquant");
    ok("JSON base64");
  });
  await test("sans audio -> 400", async () => {
    const r = await fetch(`${BASE}/api/stt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert(r.status === 400 && (await r.json()).code === "missing_audio", `HTTP ${r.status}`);
    ok("sans audio -> 400");
  });
  await test("GET interdit -> 405", async () => {
    const r = await fetch(`${BASE}/api/stt`);
    assert(r.status === 405, `attendu 405, reçu ${r.status}`);
    ok("GET interdit -> 405");
  });

  console.log(`\n${BOLD}5. /api/voice (pipeline complet)${RESET}`);
  await test("audio -> texte -> réponse -> voix", async () => {
    const fd = new FormData();
    fd.append("audio", new Blob([SAMPLE], { type: "audio/wav" }), "q.wav");
    fd.append("language", "fr");
    const r = await fetch(`${BASE}/api/voice`, { method: "POST", body: fd });
    const d = await r.json();
    assert(r.status === 200 && d.success, `HTTP ${r.status} — ${d.error || ""}`);
    assert(d.transcript && d.reply, "transcript/reply manquant");
    assert(isMp3(Buffer.from(d.audio, "base64")), "audio de réponse invalide");
    assert(typeof d.timings.total === "number", "timings manquants");
    ok("audio -> texte -> réponse -> voix", `total ${d.timings.total} ms`);
  });
  await test("champ text (STT sauté)", async () => {
    const fd = new FormData();
    fd.append("text", "Bonjour");
    const d = await (await fetch(`${BASE}/api/voice`, { method: "POST", body: fd })).json();
    assert(d.success && d.transcript === "Bonjour" && d.timings.stt === 0, "comportement inattendu");
    ok("champ text (STT sauté)");
  });
  await test("?format=audio -> MP3 brut", async () => {
    const fd = new FormData();
    fd.append("text", "Bonjour");
    const r = await fetch(`${BASE}/api/voice?format=audio`, { method: "POST", body: fd });
    assert(r.status === 200 && r.headers.get("content-type").includes("audio/mpeg"), `HTTP ${r.status}`);
    assert(r.headers.get("x-transcript"), "X-Transcript manquant");
    assert(isMp3(Buffer.from(await r.arrayBuffer())), "MP3 invalide");
    ok("?format=audio -> MP3 brut");
  });
  await test("history invalide -> 400", async () => {
    const fd = new FormData();
    fd.append("text", "Salut"); fd.append("history", "{pas du json}");
    const d = await (await fetch(`${BASE}/api/voice`, { method: "POST", body: fd })).json();
    assert(d.code === "invalid_history", `code ${d.code}`);
    ok("history invalide -> 400");
  });

  console.log(`\n${BOLD}6. Transversal${RESET}`);
  await test("préflight CORS -> 204", async () => {
    const r = await fetch(`${BASE}/api/tts`, { method: "OPTIONS" });
    assert(r.status === 204 && r.headers.get("access-control-allow-origin"), `HTTP ${r.status}`);
    ok("préflight CORS -> 204");
  });
  await test("routes historiques intactes (/api/chat répond)", async () => {
    const r = await fetch(`${BASE}/api/chat?prompt=bonjour&uid=t`);
    assert(r.status !== 404, "la route /api/chat a disparu");
    ok("routes historiques intactes", `HTTP ${r.status}`);
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
