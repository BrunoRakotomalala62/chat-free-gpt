/**
 * Test automatisé de tous les modèles.
 *
 *   node test.js            # modèles gratuits (FREE_MODELS)
 *   node test.js --all      # gratuits + modèles PRO
 *
 * Chaque modèle est testé avec un visiteur neuf (quota gratuit).
 */

"use strict";

const { chat, FREE_MODELS, PRO_MODELS } = require("./lib/aichatting");

async function main() {
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
