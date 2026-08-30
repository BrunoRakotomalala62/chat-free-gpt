# chat-free-gpt

API REST gratuite qui expose un endpoint `GET /api/chat` en s'appuyant sur le
backend du site **https://www.aichatting.net/fr/free-chatgpt/** (ChatGPT
gratuit en ligne, sans inscription). Déployable tel quel sur **Vercel**.

> ⚠️ Projet à but éducatif. Non affilié à aichatting.net. Le backend gratuit
> octroie ~2 messages par visiteur : l'API génère un nouveau visiteur à
> chaque requête, ce qui la rend utilisable en continu.

## Endpoint

```
GET /api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123&lang=fr
```

| Paramètre | Type | Description |
|---|---|---|
| `prompt` | string (requis) | Texte à envoyer au modèle (optionnel si `image` fournie) |
| `model` | string | Nom du modèle (défaut : `gpt-5.6-luna`) |
| `image` | string | **Vision** : URL d'une image à analyser (répéter pour plusieurs images, max 4) |
| `uid` | string | Identifiant libre du client (renvoyé tel quel) |
| `lang` | string | Langue du backend (défaut : `fr`) |

### Exemple

```bash
curl "https://<votre-deploiement>.vercel.app/api/chat?prompt=Bonjour%20comment%20ca%20va&model=gpt-5.6-luna&uid=123"
```

```json
{
  "success": true,
  "reply": "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
  "model": "gpt-5.6-luna",
  "uid": "123",
  "conversationId": 29879018,
  "source": "https://www.aichatting.net/fr/free-chatgpt/"
}
```

### 🖼️ Vision (répondre à une image)

Oui, l'API comprend les images — comme le site (qui les envoie en base64) :

```bash
curl "https://<votre-deploiement>.vercel.app/api/chat?prompt=Decris%20cette%20photo&image=https://picsum.photos/seed/cat/640/480&uid=42"
```

```json
{
  "success": true,
  "reply": "On voit une table de café en terrasse, entourée de chaises, avec des plantes…",
  "model": "gpt-5.6-luna",
  "uid": "42",
  "images": ["https://picsum.photos/seed/cat/640/480"],
  "conversationId": 29879210
}
```

- **Plusieurs images** : répéter `image=` (max 4), ex. `&image=url1&image=url2`
- L'API télécharge l'URL, la convertit en **base64 data-URI** et l'envoie au backend — c'est le seul format accepté (les URL brutes sont bloquées par le filtre de modération du backend, découvert en testant).
- Vous pouvez aussi passer directement un data-URI (`image=data:image/jpeg;base64,...`) mais attention à la limite de taille d'URL (≈8 Ko) : préférez une URL.
- Limites : image < 5 Mo, formats jpg/png/gif/webp.

## Modèles testés

Le site n'expose officiellement que deux modèles (`gpt-5.6-luna` gratuit et
`gpt-5.6-terra` réservé aux membres PRO), mais le backend accepte de nombreux
autres noms. Résultats des tests effectués (chaque nom testé avec un visiteur
neuf, prompt « dis juste bonjour ») :

### ✅ Fonctionnent en gratuit

`gpt-5.6-luna`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5.1`, `gpt-5.1-mini`,
`gpt-5.1-nano`, `gpt-5.2`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4.1`, `gpt-4.1-mini`,
`gpt-4.1-nano`, `gpt-4`, `gpt-3.5-turbo`, `o1`, `o1-mini`, `o3`, `o3-mini`,
`o4-mini`, `deepseek-chat`, `deepseek-reasoner`, `deepseek-v3`, `deepseek-r1`,
`claude-3-5-sonnet-20241022`, `claude-sonnet-4-20250514`, `claude-3-5-haiku`,
`claude-3-opus`, `gemini-1.5-pro`, `gemini-2.0-flash`, `gemini-2.5-flash`,
`gemini-2.5-pro`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `grok-2`,
`grok-3`, `qwen2.5-72b-instruct`, `mixtral-8x7b-instruct`

> Note : le backend retombe sur un modèle par défaut pour les noms inconnus —
> le paramètre `model` est donc transmis mais la réponse peut venir du même
> modèle sous-jacent selon le nom choisi.

### 🔒 Réservés aux membres PRO

`gpt-5.6-terra`, `gpt-4o` → réponse HTTP **402** avec le message du backend :
*« You are currently not a pro premium member. Please purchase a pro premium
membership before using it. »*

## Comment ça marche (reverse engineering)

Le site (Next.js) appelle l'API `https://aga-api.aichatting.net` :

1. `POST /aigc/chat/record/conversation/create` — crée une conversation (`{roleId: 0}`)
2. `POST /aigc/chat/v2/askai/stream` — chat en streaming (SSE)

Le header `vToken` est un **visitorId chiffré en RSA (PKCS#1 v1.5)** avec la
clé publique embarquée dans le bundle JS du site (`fingerprintInit` →
`encrypt(visitorId)`). Le corps de la requête :

```json
{
  "spaceHandle": true,
  "roleId": 0,
  "conversationId": 29879018,
  "model": "gpt-5.6-luna",
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "bonjour" }] }]
}
```

La réponse est un flux SSE (`data: ...`) terminé par `--@DONE@--`, avec des
tokens de mise en forme : `-=- --` → espace, `-=-n--` → retour à la ligne
(même logique de décodage que le frontend du site).

**Vision :** le frontend du site compresse l'image (≤ 1024 px, qualité 0.6)
puis l'envoie en **base64 data-URI** dans un bloc `image_url` — l'API
reproduit ce comportement (`toDataUri` dans `lib/aichatting.js`).

## Déploiement Vercel

```bash
# 1. pousser ce dépôt sur GitHub
# 2. importer le dépôt sur vercel.com (framework : Other / Node.js)
# ou en CLI :
npx vercel --prod
```

`vercel.json` configure la route `/api/chat` vers `api/chat.js` avec un
`maxDuration` de 60 s (les réponses courtes arrivent en quelques secondes).

## Test en local

```bash
npm start
curl "http://localhost:3000/api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123"
```

## Test automatisé de tous les modèles

```bash
node test.js          # teste la liste FREE_MODELS (gratuits)
node test.js --all    # inclut les modèles PRO (réponse attendue : message PRO)
```

## Structure

```
api/chat.js        → fonction serverless Vercel (GET /api/chat)
lib/aichatting.js  → client du backend aichatting (vToken RSA, conversation, SSE)
server.js          → serveur local de test (zéro dépendance)
test.js            → test automatisé de tous les modèles
vercel.json        → configuration Vercel (route + maxDuration)
```
