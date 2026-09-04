/**
 * conversation.js — Conversation continue côté serveur.
 *
 * Problème : le backend aichatting ne reçoit qu'UN message utilisateur (pas
 * d'historique). Si l'utilisateur écrit « plus de détails », « continue »,
 * « explique la question A) »…, le modèle ne sait pas de quoi il parle.
 *
 * Solution : l'API mémorise par `uid` les 1-2 derniers échanges texte
 * (question + réponse) et, à la demande suivante, décide :
 *   - la question ENCHAÎNE sur le précédent (courte, amorces du type
 *     « continue / plus de détails / réexplique… », renvoi à une partie
 *     précise « A) / 1) / la 2e question », vocabulaire commun) →
 *     on fabrique un prompt avec le mini-contexte de l'échange précédent ;
 *   - la question CHANGE de thème → AUCUN contexte n'est ajouté et la
 *     mémoire est réinitialisée (le modèle repart de zéro).
 *
 * Ça fonctionne pour le chat texte SEUL comme pour la VISION (images) :
 * le bloc de contexte est ajouté au texte du prompt, les images suivent
 * inchangées.
 *
 * ⚠️ Mémoire en mémoire de module (par instance serverless chaude). Pour un
 * résultat identique sur n'importe quelle instance, le client PEUT fournir
 * l'historique lui-même via le paramètre `history` (JSON [{q, a}, …]) — il
 * est alors prioritaire sur la mémoire interne.
 */

"use strict";

/* ------------------------------------------------------------------ */
/* Mémoire interne (derniers échanges par uid)                         */
/* ------------------------------------------------------------------ */

const MAX_EXCHANGES_PER_UID = 2;   // échanges (Q+R) retenus par uid
const MAX_UID_ENTRIES = 3000;      // filet anti-oubli : nb max d'uids suivis
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000; // 6 h sans activité → oublié

const memoryByUid = new Map(); // uid -> [{ q, a, ts }] (du plus ancien au plus récent)

function pruneMemory(now) {
  if (memoryByUid.size <= MAX_UID_ENTRIES) return;
  // Vide les entrées les plus anciennes jusqu'à repasser sous le seuil.
  const entries = [...memoryByUid.entries()].sort((x, y) => x[1][x[1].length - 1].ts - y[1][y[1].length - 1].ts);
  for (const [uid] of entries) {
    if (memoryByUid.size <= MAX_UID_ENTRIES * 0.8) break;
    memoryByUid.delete(uid);
  }
}

/** Historique interne d'un uid : [{q, a}] du plus récent au plus ancien. */
function internalHistory(uid, now = Date.now()) {
  const list = memoryByUid.get(uid);
  if (!list || !list.length) return [];
  const fresh = list.filter((e) => now - e.ts < MEMORY_TTL_MS);
  if (fresh.length !== list.length) {
    if (fresh.length) memoryByUid.set(uid, fresh);
    else memoryByUid.delete(uid);
  }
  return fresh.slice().reverse(); // plus récent d'abord
}

function rememberExchange(uid, q, a) {
  if (!uid || !q) return;
  const cleanQ = String(q).trim();
  const cleanA = String(a || "").trim();
  if (!cleanQ || !cleanA) return;
  const list = memoryByUid.get(uid) || [];
  list.push({ q: cleanQ.slice(0, 400), a: cleanA.slice(0, 700), ts: Date.now() });
  memoryByUid.set(uid, list.slice(-MAX_EXCHANGES_PER_UID));
  pruneMemory();
}

function clearMemory(uid) {
  if (uid) memoryByUid.delete(uid);
}

/* ------------------------------------------------------------------ */
/* Historique fourni par le client (prioritaire sur la mémoire)        */
/* ------------------------------------------------------------------ */

/**
 * Normalise le paramètre `history` envoyé par le client.
 * Formats acceptés :
 *   - [{ q: "…", a: "…" }, …]
 *   - [{ question: "…", reponse: "…" }, …]
 *   - [{ role: "user", content: "…" }, { role: "assistant", content: "…" }, …]
 * @param {*} raw - valeur du paramètre (chaîne JSON ou objet déjà parsé)
 * @returns {Array<{q: string, a: string}>} du plus récent au plus ancien
 */
function normalizeClientHistory(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }
  if (!Array.isArray(data) || !data.length) return [];

  const out = [];
  const push = (q, a) => {
    const sq = String(q || "").trim().slice(0, 400);
    const sa = String(a || "").trim().slice(0, 700);
    if (sq && sa) out.push({ q: sq, a: sa });
  };

  // Format par paires {q, a} (ou variantes).
  const pairLike = data.every(
    (it) => it && typeof it === "object" && (it.q || it.question) && (it.a || it.reponse || it.answer)
  );
  if (pairLike) {
    for (const it of data) push(it.q || it.question, it.a || it.reponse || it.answer);
    return out.slice(0, MAX_EXCHANGES_PER_UID);
  }

  // Format « messages » à rôles : on assemble les paires user→assistant.
  const messages = data.filter((m) => m && typeof m.content === "string");
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "assistant") {
      let j = i - 1;
      while (j >= 0 && messages[j].role !== "user") j--;
      if (j >= 0) push(messages[j].content, messages[i].content);
    }
  }
  return out.slice(0, MAX_EXCHANGES_PER_UID);
}

/* ------------------------------------------------------------------ */
/* Décision : enchaînement ou nouveau thème ?                          */
/* ------------------------------------------------------------------ */

const FOLLOW_UP_MAX_LEN = 60;      // question plus courte que ça ⇒ suite
const CONTEXT_BUDGET = 3600;       // budget du bloc de contexte

/* Amorces qui montrent que l'utilisateur POURSUIT le sujet en cours. */
const FOLLOW_UP_RE =
  /(continue|poursuis|poursuit|la suite|et ensuite|plus de détails|détail(le|les|ler|lons)?|précise|précisions|approfondis|approfondir|développe|développer|explique encore|réexplique|ré-explique|reformule|autre exemple|un exemple|exemple concret|pas compris|comprends pas|n'ai pas compris|en savoir plus|vas-y|vas y|qu'?est-ce que tu (veux|voulais) dire)/i;

/* Formules explicites de changement de sujet : on coupe la mémoire. */
const NEW_TOPIC_RE =
  /^(chang(eons|er|e)( de)?|on (change|passe)|passons à|autre (sujet|thème|theme|question)|nouveau (sujet|thème|theme)|nouvelle question|oublie (ma |la |toute |tout |ça |cette )?(question|conversation|discussion|sujet)|ignore (ma |la |toute |tout |ça |cette )?(question|conversation|discussion|sujet)|parlons d'autre chose|repartons de zéro|question sans rapport|sujet sans rapport)/i;

/* Renvoi à une partie précise de la réponse précédente : A), 1), la 2e
   question, le point 3… → on enchaîne (même si la question est longue). */
const PART_REF_RE =
  /(^|[^a-z0-9])([a-z]|[0-9]{1,2})\)|la ([a-z0-9]|[0-9]{1,2})[eè]?[rm]?(re|ème|e)? (question|partie|étape|point)|question\s*([a-z]|[0-9]{1,2})\)|(première|deuxième|troisième|2e|3e|dernière|suivante) (question|partie|étape|point)/i;

/* Verbes qui introduisent une nouvelle demande complète. */
const FRESH_ASK_RE =
  /^(explique|donne|raconte|décris|présente|parle|que sais|c'?est quoi|qu'?est-ce que|quel|quelle|quels|quelles|liste|montre|trace|calcule|résume|compare|définis)/i;

const STOPWORDS = new Set([
  "avec", "dans", "pour", "mais", "donc", "alors", "quand", "quoi", "comment",
  "pourquoi", "est", "sont", "être", "avoir", "avez", "votre", "vous", "moi",
  "toi", "nous", "elle", "elles", "sur", "sous", "entre", "chez", "une",
  "des", "les", "aux", "pas", "plus", "très", "bien", "faire", "fait",
  "peux", "peut", "sais", "sait", "dire", "dis", "explique", "donne",
  "trouve", "montre", "trace", "calcule", "écris", "resume", "résume",
  "décris", "qui", "que", "quel", "quelle", "quels", "quelles", "ses",
  "son", "sa", "leur", "leurs", "tout", "tous", "toute", "toutes", "aussi",
  "encore", "ainsi", "comme", "sans", "depuis", "pendant", "avant", "après",
  "deux", "trois", "premier", "voici", "voilà", "sujet", "question", "merci",
  "ligne", "lignes", "maintenant", "reponse", "reponds", "réponds", "répondre",
]);

/** Mots significatifs (≥ 4 lettres, sans accents, pluriel → singulier). */
function sigWords(text) {
  const plain = String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words = (plain.match(/[a-z0-9]{4,}/g) || [])
    .map((w) => (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w))
    .filter((w) => !STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Décide si `question` enchaîne sur l'échange le plus récent fourni.
 * @param {string} question - question brute de l'utilisateur
 * @param {{q: string, a: string}} last - dernier échange ({q, a})
 * @returns {boolean}
 */
function decideFollowUp(question, last) {
  const text = String(question || "").trim();
  const low = text.toLowerCase();
  if (!text) return false;
  if (NEW_TOPIC_RE.test(low)) return false;
  if (PART_REF_RE.test(low)) return true;      // « la question A) », « le point 2) »…
  if (FOLLOW_UP_RE.test(low)) return true;     // « continue », « plus de détails »…

  const a = sigWords(text);
  const b = new Set([...sigWords(last.q), ...sigWords(last.a)]);
  let overlap = 0;
  for (const w of a) if (b.has(w)) overlap++;

  const freshAsk = FRESH_ASK_RE.test(low) && a.size >= 2 && overlap === 0;
  if (text.length <= FOLLOW_UP_MAX_LEN) return !freshAsk; // courte → suite
  return overlap >= (text.length <= 160 ? 1 : 2);          // longue → vocabulaire
}

/* ------------------------------------------------------------------ */
/* Fabrication du prompt avec contexte                                 */
/* ------------------------------------------------------------------ */

/**
 * Construit le prompt final selon l'historique.
 *
 * @param {object} opts
 * @param {string} opts.uid           - identifiant utilisateur (peut être vide)
 * @param {string} opts.prompt        - question brute de l'utilisateur
 * @param {*}      [opts.history]     - historique fourni par le client (prioritaire)
 * @param {boolean} [opts.reset]      - force le nouveau sujet
 * @param {boolean} [opts.hasImages]  - la demande actuelle joint des images
 * @returns {{text: string, kind: "none"|"continued"|"new_topic", exchanges?: Array}}
 */
function buildPromptWithContext({ uid, prompt, history, reset, hasImages }) {
  const text = String(prompt || "").trim();
  if (!text) return { text: String(prompt || ""), kind: "none" };

  // 1) Sources d'historique : client d'abord, sinon mémoire interne.
  let exchanges = null;
  if (history !== undefined && history !== null && history !== "") {
    exchanges = normalizeClientHistory(history);
  } else if (uid) {
    exchanges = internalHistory(uid);
  }
  if (!exchanges || !exchanges.length) {
    // Rien à enchaîner : question brute, pas de contexte.
    return { text, kind: "none", exchanges: [] };
  }
  const last = exchanges[0];

  // 2) Nouveau sujet explicite : on coupe la mémoire et on repart de zéro.
  const low = text.toLowerCase();
  if (reset || NEW_TOPIC_RE.test(low)) {
    if (uid) clearMemory(uid);
    return { text, kind: "new_topic", exchanges };
  }

  // 3) Enchaînement ? (question courte, amorces, partie citée, vocabulaire)
  if (!decideFollowUp(text, last)) {
    // Changement de thème détecté : contexte ignoré, mémoire coupée.
    if (uid) clearMemory(uid);
    return { text, kind: "new_topic", exchanges };
  }

  // 4) Question démesurée : on n'attache pas de contexte (elle domine le prompt).
  if (text.length > CONTEXT_BUDGET - 250) {
    return { text, kind: "none", exchanges };
  }

  // 5) Fabrication du bloc de contexte (du plus ancien au plus récent).
  const chronological = exchanges.slice().reverse();
  const lines = [
    "[Contexte — conversation en cours avec l'utilisateur. Répondez à sa DERNIÈRE demande " +
    "en vous appuyant sur l'échange ci-dessous, SANS répéter ce qui a déjà été répondu. " +
    "Si la dernière demande cite une partie précise de votre réponse précédente " +
    "(« la question A) », « le point 2) », « la 2e étape »…), développez uniquement CETTE partie. " +
    "Si elle contient plusieurs questions (numérotées 1) 2) 3)… ou A) B) C)…), répondez à " +
    "chacune en gardant la même numérotation. Si elle change complètement de sujet, " +
    "ignorez le contexte et répondez-y comme à une nouvelle question.]",
  ];
  for (const e of chronological) {
    lines.push("— Question de l'utilisateur : « " + e.q + " »");
    lines.push("— Réponse déjà donnée : « " + e.a + " »");
  }
  let block = lines.join("\n");
  const demand = "— Dernière demande : « " + text + " »" + (hasImages ? " (l'utilisateur a joint une image à cette demande)" : "");
  const hardCap = CONTEXT_BUDGET - demand.length - 60;
  if (block.length > hardCap) block = block.slice(0, Math.max(0, hardCap));

  return { text: block + "\n" + demand, kind: "continued", exchanges };
}

module.exports = {
  buildPromptWithContext,
  decideFollowUp,
  rememberExchange,
  clearMemory,
  internalHistory,
  normalizeClientHistory,
  sigWords,
  // exposés pour tests
  _FOLLOW_UP_RE: FOLLOW_UP_RE,
  _NEW_TOPIC_RE: NEW_TOPIC_RE,
  _PART_REF_RE: PART_REF_RE,
};
