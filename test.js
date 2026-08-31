/**
 * Test automatisé de tous les modèles.
 *
 *   node test.js                 # modèles gratuits (FREE_MODELS)
 *   node test.js --all           # gratuits + modèles PRO
 *   node test.js --vision [url]  # vision : gpt-5.6-luna + claude sonnet 4
 *
 * Chaque modèle est testé avec un visiteur neuf (quota gratuit).
 */

"use strict";

const { chat, chatReliable, FREE_MODELS, PRO_MODELS } = require("./lib/aichatting");

async function testVision() {
  const idx = process.argv.indexOf("--vision");
  const imgUrl =
    process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")
      ? process.argv[idx + 1]
      : "https://http.cat/200.jpg";
  const models = ["gpt-5.6-luna", "claude-sonnet-4-20250514"];
  console.log(`🖼️  Test vision (${imgUrl}) sur ${models.length} modèles...\n`);
  let ok = 0;
  for (const model of models) {
    try {
      const { reply } = await chatReliable({ prompt: "décris cette image en une phrase", images: [imgUrl], model });
      const good = reply.length > 0 && !/pro premium member/i.test(reply);
      if (good) ok++;
      console.log(`${good ? "✅" : "⚠️"} ${model} => ${JSON.stringify(reply.slice(0, 140))}`);
    } catch (err) {
      console.log(`❌ ${model} => ${String(err.message).slice(0, 140)}`);
    }
  }
  console.log(`\nRésumé : ${ok}/${models.length} modèles vision OK.`);
  process.exit(ok > 0 ? 0 : 1);
}

async function main() {
  if (process.argv.includes("--vision")) return testVision();

  const includePro = process.argv.includes("--all");
  const models = [...FREE_MODELS, ...(includePro ? PRO_MODELS : [])];

  console.log(`Test de ${models.length} modèles...\n`);

  const results = [];
  for (const model of models) {
    try {
      const { reply } = await chat({ prompt: "dis juste bonjour", model });
      const ok = reply.length > 0 && !/pro premium member/i.test(reply);
      results.push({ model, status: ok ? "OK" : "PRO_ONLY", reply: reply.slice(0, 60) });
      console.log(`${ok ? "✅" : "🔒"} ${model} => ${JSON.stringify(reply.slice(0, 60))}`);
    } catch (err) {
      results.push({ model, status: "ERROR", reply: String(err.message).slice(0, 60) });
      console.log(`❌ ${model} => ${String(err.message).slice(0, 60)}`);
    }
  }

  const okCount = results.filter((r) => r.status === "OK").length;
  console.log(`\nRésumé : ${okCount}/${results.length} modèles répondent en gratuit.`);
  process.exit(okCount > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});
