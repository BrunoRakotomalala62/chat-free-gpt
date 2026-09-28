# chat-free-gpt

API REST gratuite qui expose un endpoint `GET /api/chat` en s'appuyant sur le
backend du site **https://www.aichatting.net/fr/free-chatgpt/** (ChatGPT
gratuit en ligne, sans inscription), plus une route **`/api/plot`** qui
construit des **figures en SVG** : courbes mathématiques (`expression=`) **ou
n'importe quelle figure par IA** (`subject=` — physique, chimie, circuits
électriques…). Déployable tel quel sur **Vercel**.

Des **routes vocales** (additives, sans toucher au chat) complètent l'API :
`/api/tts` (texte → MP3, **sans clé**), `/api/stt` (audio → texte, Whisper),
`/api/voice` (audio → texte → réponse → voix) et `/api/voices`. Voir la section
[🎙️ Routes vocales](#-routes-vocales--api-tts-api-stt-api-voice).

> ⚠️ Projet à but éducatif. Non affilié à aichatting.net. Le backend gratuit
> octroie ~2 messages par visiteur : l'API génère un nouveau visiteur à
> chaque requête, ce qui la rend utilisable en continu.

## Endpoint

### GET (texte, simple)

```
GET /api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123&lang=fr
```

### POST (recommandé pour la vision / les images)

```
POST /api/chat
Content-Type: application/json

{
  "prompt": "Que voit-on sur cette photo ?",
  "model": "gpt-5.6-luna",
  "uid": "123",
  "lang": "fr",
  "images": ["data:image/jpeg;base64,…", "https://exemple.com/photo.jpg"]
}
```

| Paramètre | Type | Description |
|---|---|---|
| `prompt` | string (requis) | Texte à envoyer au modèle (optionnel si une image est fournie) |
| `model` | string | Nom du modèle (défaut : `gpt-5.6-luna`) |
| `image` / `images` | string \| string[] | **Vision** : image(s) à analyser — en GET répéter `image=` ; en POST envoyer le tableau `images`. URL ou data-URI base64, max 4 |
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
curl -X POST "https://<votre-deploiement>.vercel.app/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Décris cette photo","model":"gpt-5.6-luna","images":["https://http.cat/200.jpg"]}'
```

```json
{
  "success": true,
  "reply": "Sur cette image, je vois un chat blanc avec une expression…",
  "model": "gpt-5.6-luna",
  "images": ["https://http.cat/200.jpg"],
  "conversationId": 29879210
}
```

- **Plusieurs images** : tableau `images` (ou répéter `image=` en GET), max 4.
- **POST recommandé** : en GET, Vercel coupe les URL trop longues (HTTP **414** au-delà
  d'environ 34 Ko de base64). Les images locales (data-URI) doivent passer en POST.
- L'API télécharge les URL, les convertit en **base64 data-URI** et les envoie au
  backend — c'est le seul format accepté (les URL brutes sont bloquées par le filtre
  de modération du backend).
- Le backend gratuit rejette parfois une image (filtre de modération aléatoire) :
  l'API **réessaie automatiquement une fois** avec un visiteur neuf
  (`chatReliable` dans `lib/aichatting.js`).
- Limites : image < 5 Mo, formats jpg/png/gif/webp, ~2,2 Mo par data-URI envoyé.

---

## 📈 Endpoint figures : `/api/plot` (alias `/api/figure`)

Deux modes complémentaires, réponse en JSON avec la figure en **SVG** (ou SVG
brut / points) :

1. **Courbes mathématiques** — `expression=` (déterministe, instantané, hors-ligne)
2. **Figures dynamiques par IA** — `subject=` : **n'importe quelle figure** en
   langage naturel (physique, chimie, circuits électriques, effets, montages…)

```
GET /api/plot?expression=x-2ln(x)
GET /api/plot?subject=mise+en+%C3%A9vidence+de+l%27effet+photo%C3%A9lectrique
GET /api/plot?subject=circuit+%C3%A9lectrique+avec+lampe+et+interrupteur&format=svg
GET /api/plot?expression=sin(x)&xmin=-10&xmax=10&width=800&height=600&color=%23ff0000
GET /api/plot?expression=1/(x^2+1)&format=svg          → figure brute (image/svg+xml)
GET /api/plot?expression=tan(x)&format=points         → juste les points [[x,y],…]
POST /api/plot                                        → même chose, en JSON
{ "expression": "x - 2*ln(x)", "xmin": 0.1, "xmax": 10 }
{ "subject": "appareil de distillation simple en chimie" }
```

### 🎨 Mode dynamique par IA : n'importe quelle figure

Le sujet libre est envoyé au modèle de langage gratuit du backend
(`gpt-5.6-luna`, tentatives renouvelées avec un visiteur neuf en cas d'échec)
avec une consigne de dessinateur : l'API extrait, **assainit** (anti-XSS) et
**valide** le SVG (balances XML) avant de le renvoyer. Exemples testés :

- « mise en évidence de l'effet photoélectrique » → tube sous vide, cathode,
  anode, faisceau lumineux, ampèremètre μA, générateur
- « circuit électrique avec pile, ampoule et interrupteur » → schéma normalisé
- « appareil de distillation simple en chimie » → ballon, réfrigérant à eau, thermomètre
- « schéma d'une lentille convergente », « aimant et lignes de champ magnétique »…

```bash
curl "https://chat-free-gpt.vercel.app/api/plot?subject=mise%20en%20%C3%A9vidence%20de%20l%27effet%20photo%C3%A9lectrique"
```

```json
{
  "success": true,
  "subject": "mise en évidence de l'effet photoélectrique",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" …>…</svg>",
  "model": "gpt-5.6-luna",
  "attempts": 1,
  "generated": "ai"
}
```

- La figure est volontairement **compacte** (le backend gratuit tronque les
  réponses au-delà d'environ 2600 caractères) : schéma simplifié à l'essentiel.
- Si la génération échoue (timeout, 504, SVG invalide), l'API **réessaie avec
  un visiteur neuf** ; en cas d'échec total → HTTP 502 avec un message clair.
- `format=svg` renvoie la figure brute ; `format=points` n'existe que pour les courbes.

### Exemple — la courbe de `f(x) = x − 2·ln(x)`

```bash
curl "https://<votre-deploiement>.vercel.app/api/plot?expression=x-2ln(x)"
```

```json
{
  "success": true,
  "expression": "x-2ln(x)",
  "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"600\" …>…</svg>",
  "points": [[0.005, 10.596], [0.0175, 8.45], …],
  "domain": { "xmin": 0.005, "xmax": 10 },
  "range": { "ymin": 0.275, "ymax": 5.422 },
  "size": { "width": 800, "height": 600 },
  "samples": 800,
  "asymptotes": { "verticales": [{ "x": 0 }], "horizontales": [], "obliques": [] },
  "branches": [{ "side": "+∞", "type": "parabolique", "direction": "direction y = x" }],
  "tangente": null
}
```

- **`svg`** : la figure (grille, axes gradués, courbe, titre, **légende**) — à injecter
  dans le DOM (`element.innerHTML = svg`), à sauvegarder en `.svg`, ou à convertir
  en PNG (ex. `sharp` côté Node, ou `<img>` + canvas côté navigateur).
- **`points`** : les points échantillonnés `[x, y]` (pratique pour tracer
  soi-même, ou pour éviter de re-parser le SVG).

### 🧭 Branches infinies, asymptotes et tangente (mode courbe)

Le moteur **détecte automatiquement** les branches infinies de la fonction et les
**trace en pointillés** dans la figure, avec une petite légende :

| Élément | Détection | Exemple |
|---|---|---|
| **Asymptote verticale** (`x = x₀`) | pôles intérieurs (sauts de \|f\|) + frontières du domaine (`ln(x)` → x = 0) | `1/x`, `tan(x)`, `x-2ln(x)` |
| **Asymptote horizontale** (`y = L`) | limite finie en ±∞ | `1/x` → y = 0, `x/(x-1)` → y = 1 |
| **Asymptote oblique** (`y = ax+b`) | limite de f/x (extrapolation) + convergence de f−ax | `(2x²+1)/(x-1)` → y = 2x+2 |
| **Branche parabolique** | f/x → ∞ (direction Oy), f/x → 0 (direction Ox), ou direction y=ax | `x²`, `sqrt(x)`, `x-2ln(x)` |
| **Tangente** | **uniquement si `tangent=` est fourni** (point donné par le sujet/l'utilisateur) | `tangent=2` |

```bash
# 1/x : asymptotes verticale x=0 et horizontale y=0 (dessinées + légende)
curl "https://chat-free-gpt.vercel.app/api/plot?expression=1/x"

# (2x²+1)/(x-1) : asymptote verticale x=1 + asymptote oblique y=2x+2
curl "https://chat-free-gpt.vercel.app/api/plot?expression=(2x^2+1)/(x-1)"

# x²-2x+1 : pas d'asymptote (branches paraboliques) + tangente au point d'abscisse 2
curl "https://chat-free-gpt.vercel.app/api/plot?expression=x^2-2x+1&tangent=2"

# x²-2x+1 avec la droite d'équation y = 2x - 3 donnée directement (tracée en vert)
curl "https://chat-free-gpt.vercel.app/api/plot?expression=x^2-2x+1&line=2x-3"

# droite seule (sans fonction) : titre « Droite (d) : y = 2x - 3 »
curl "https://chat-free-gpt.vercel.app/api/plot?line=2x-3"
```

La tangente n'est tracée **que** si un point de tangence est donné (`tangent=2`,
abscisse x₀ ; la dérivée est calculée numériquement et l'équation affichée
provient de la formule **`(T) : y = f'(x₀)(x − x₀) + f(x₀)`**, développée en
`y = mx + b`). Sans `tangent`, aucune tangente n'est dessinée — conformément à
la consigne « si le sujet ne donne pas de point, on ne trace pas de tangente ».
Si le point est hors domaine ou la fonction non dérivable en ce point :
`tangente: { x0, impossible: "…" }` et la légende l'indique.

**Droite donnée directement** : si l'exercice donne « la droite d'équation
`y = ax+b` », passez `line=` (alias `droite=`) — la droite est **tracée en
vert** (solide) avec sa légende « Droite : y = ax + b », en plus de la courbe
ou seule (sans `expression=`). Seules les expressions **affines** sont
acceptées (`2x-3`, `y=-x+1`, `0.5x`, `x+2`) ; `x²`, `sin(x)`, produits → 400.

**Toutes les fonctions usuelles** sont tracées dynamiquement : `exp`/`e^x`,
`ln`, `log`, `sqrt`, `sin`, `cos`, `tan`, `sinh`, `cosh`, … avec asymptotes,
branches et tangentes comme pour les fonctions rationnelles.

---

## 📐 Constructions géométriques : `/api/geo`

Moteur **déterministe** (aucune hallucination IA) : il interprète un énoncé
d'exercice avec **questions successives** et construit **UNE figure exacte et
cumulative** — chaque question ajoute son élément.

```
GET  /api/geo?text=Soit+A+et+B+deux+points.+1)+Tracer+(AB).+2)+Placer+un+point+P+sur+(AB).+3)+Tracer+la+droite+passant+par+P+perpendiculaire+à+(AB).
POST /api/geo  { "text": "Tracer le triangle ABC. Tracer la hauteur issue de A." }
```

**Vérification IA de la construction** (depuis 2026-09) : après le tracé exact,
un modèle IA contrôle que la figure couvre **toutes** les constructions de
l'énoncé (dimensions données « tel que AB = 4 cm, AC = 5 cm, BC = 6 cm »,
points à placer, angles mesurés, transformations…). Si des éléments manquent,
l'IA **refait la figure complète** et les ajoute (réponse `mode: "ia"` avec
la liste des manques dans `verification.manquant`) ; sinon la figure exacte
est renvoyée (`mode: "exact"`, `verification.complet: true`). La vérification
est **non bloquante** : si l'IA est indisponible, la figure exacte est
renvoyée telle quelle. Paramètres : `ia=0` (pas de repli IA), `verif=0`
(pas de vérification IA). `ignored` : phrases de l'énoncé que le moteur exact
n'a pas pu construire (transmises au vérificateur).

| Construction | Exemple |
|---|---|
| Droite / segment / demi-droite | « Tracer (AB) », « le segment [AB] », « la demi-droite [BC) », « la droite passant par A et B » |
| Point sur une droite/segment/cercle | « Placer un point P sur (AB) », « P ∈ (AB) », « Soit P un point de (AB) », « P appartient à (AB) » |
| Perpendiculaire / parallèle | « la droite passant par P perpendiculaire à (AB) » (∟), « la perpendiculaire en P » (dernière droite), « la parallèle à (AB) passant par C » |
| Cercle | « de centre O passant par B », « de rayon 3 cm », « de diamètre [AB] », « circonscrit au triangle ABC », « inscrit au triangle ABC » |
| Tangente au cercle | « la tangente au cercle (C) en A » |
| Milieu / médiatrice | « Soit M le milieu de [AB] », « la médiatrice de [AB] » |
| Médiane / hauteur / bissectrice | « la médiane issue de A du triangle ABC », « la hauteur issue de A », « la bissectrice de l'angle ABC » — et les trois à la fois : « les médianes du triangle ABC » |
| Concurrence | « les médianes se coupent en G » (idem hauteurs → H, bissectrices → I, médiatrices → O) |
| Droite des milieux | « la droite des milieux du triangle ABC » |
| Triangles contraints | « équilatéral », « isocèle en A », « rectangle en A » (∟) — sommets construits exactement |
| Polygones | carré, rectangle, losange, parallélogramme, **trapèze**, quadrilatère, pentagone, hexagone |
| Symétrie | « le symétrique de A par rapport à B » (centrale), « par rapport à la droite (BC) » (axiale) |
| Translation / rotation / homothétie | « l'image de C par la translation qui transforme A en B », « la rotation de centre A et d'angle 90° appliquée au point B », « l'homothétie de centre A et de rapport 2 appliquée au point B » |
| Longueurs | « Soit AB = 5 cm » |
| Angles mesurés | « l'angle ABC = 45° » (arc + étiquette) |

- Points créés automatiquement (positions par défaut lisibles par lettre).
- Chaque étape est dessinée dans une couleur différente + **légende des étapes**
  en bas de la figure (« 1) droite (AB) 2) point P sur (AB) 3) (d) ⊥ (AB)… »).
- Les étapes non reconnues sont ignorées (la figure montre ce qui est compris) ;
  si aucune n'est reconnue → HTTP 400 avec des exemples.
- Réponse : `{ success, svg, steps, points, lines, circles }`.

```bash
curl "https://chat-free-gpt.vercel.app/api/geo?text=Tracer%20le%20triangle%20ABC%2C%20puis%20la%20hauteur%20issue%20de%20A."
```

| Paramètre | Type | Description |
|---|---|---|
| `expression` (alias `expr`, `f`) | string | Fonction à tracer (mode courbe). Préfixe accepté : `f(x)=x-2lnx` |
| `subject` (alias `figure`, `description`, `topic`) | string | Sujet libre de la figure (mode IA) — ex. « effet photoélectrique » |
| `model` | string | Modèle IA pour `subject=` (défaut `gpt-5.6-luna` — seul modèle gratuit authentique ; les autres noms sont rejetés) |
| `xmin`, `xmax` | number | Domaine — par défaut **détection automatique** (ex. `ln(x)` → x>0) |
| `ymin`, `ymax` | number | Échelle verticale — par défaut auto (percentiles, ignore les pics) |
| `width`, `height` | number | Taille de la figure en px (défaut `800×600`, max 2400×1600) |
| `samples` | number | Nombre de points (défaut `800`, max `4000`) — mode courbe |
| `color` | string | Hex `#rrggbb` : couleur de la courbe (mode courbe) ou teinte principale (mode IA) |
| `title` | string | Titre de la figure (mode courbe) |
| `tangent` | number | Abscisse x₀ du point de tangence (mode courbe, **optionnel**) — trace la tangente en ce point, avec son équation dans la légende |
| `line` (alias `droite`) | string | Droite donnée directement par l'exercice (mode courbe, **optionnel**) — ex. `2x-3`, `y=-x+1` ; tracée en vert, avec la courbe ou seule |
| `format` | string | `json` (défaut) \| `svg` (image brute) \| `points` (courbes uniquement) |

### Syntaxe des expressions

Conventions mathématiques usuelles, **sans `eval`** (parser sûr) :

- Opérateurs : `+ - * / ^` (et `**`), parenthèses, **multiplication implicite**
  (`2x`, `2ln(x)`, `(x+1)(x-1)`, `sin(x)cos(x)`).
- Fonctions : `ln` (népérien), `log`/`log10` (décimal), `log2`, `exp`, `sqrt`,
  `cbrt`, `abs`, `sign`, `floor`, `ceil`, `round`, `sin`, `cos`, `tan`, `asin`,
  `acos`, `atan`, `atan2(y,x)`, `sinh`, `cosh`, `tanh`, `min(...)`, `max(...)`.
- Appels sans parenthèses acceptés : `ln x`, `sin 2x`, `ln x^2` → `ln(x)`, `sin(2x)`, `ln(x²)`.
- Constantes : `pi`, `e`. Variable : `x`. Notation scientifique : `1e-3`.
- Le domaine de définition est respecté : `ln(x)` (x>0), `sqrt(x)`, asymptotes
  verticales coupées (`tan(x)`, `1/x`), etc.

> 🎓 Astuce : combinez avec `/api/chat` — demandez au modèle de « construire la
> courbe représentative de f(x)=x-2ln(x) » ou « fais la figure de l'effet
> photoélectrique », puis appelez `/api/plot` avec l'`expression` ou le `subject`
> pour obtenir la figure. Pour la tangente : « trace la courbe de f(x)=x²-2x+1
> et la tangente au point d'abscisse 2 » → `/api/plot?expression=x^2-2x+1&tangent=2`.

## 🎙️ Routes vocales : `/api/tts`, `/api/stt`, `/api/voice`

> Ces routes sont **indépendantes du chat** : elles ne modifient aucune logique
> existante. Le TTS (Microsoft Edge « Read Aloud ») ne demande **aucune clé** ;
> seules la transcription (STT) et la réponse (LLM) ont besoin d'un fournisseur.

### Où est le STT / le LLM ?

| Étape | Fournisseur | Clé |
|---|---|---|
| **TTS** (texte → voix) | Microsoft Edge | **aucune, sans quota connu** |
| **STT** (audio → texte) | Groq `whisper-large-v3-turbo` | `GROQ_API_KEY` (gratuit) |
| **LLM** (texte → réponse) | Groq, via la **même clé** · ou ton `/api/chat` via `CHAT_ENDPOINT` · ou `none` | selon le mode |

Définis `GROQ_API_KEY` (gratuit, <https://console.groq.com/keys>) — une seule
clé couvre le STT **et** le LLM. Sans aucune clé, `/api/tts` fonctionne déjà seul.

### `GET|POST /api/tts` — texte → MP3 *(sans clé)*

```bash
curl "http://localhost:3000/api/tts?text=Bonjour&voice=fr-FR-DeniseNeural" -o bonjour.mp3

curl -X POST http://localhost:3000/api/tts -H "Content-Type: application/json" \
  -d '{"text":"Bonjour !","voice":"fr-FR-HenriNeural","rate":"+10%"}' -o bonjour.mp3

# réponse JSON (base64 + sous-titres mot à mot)
curl -X POST "http://localhost:3000/api/tts?format=json" -H "Content-Type: application/json" -d '{"text":"Bonjour"}'
```

Paramètres : `text` (requis, max 3 000 car.), `voice`, `rate` (`+20%`), `pitch` (`+5Hz`),
`volume` (`+50%`), `format` (`audio` par défaut, `json` pour du base64).

### `POST /api/stt` — audio → texte

Trois formats d'entrée au choix :

```bash
# a) multipart/form-data (navigateur)
curl -X POST http://localhost:3000/api/stt -F "audio=@question.wav" -F "language=fr"

# b) corps brut
curl -X POST http://localhost:3000/api/stt -H "Content-Type: audio/wav" --data-binary @question.wav

# c) JSON base64 (data-URI acceptée)
curl -X POST http://localhost:3000/api/stt -H "Content-Type: application/json" \
  -d '{"audio":"data:audio/wav;base64,UklGRiQAAABXQVZFZm10..."}'
```

### `POST /api/voice` — la conversation vocale complète

Un seul appel enchaîne **STT → LLM → TTS** :

```bash
curl -X POST http://localhost:3000/api/voice \
  -F "audio=@question.wav" -F "language=fr" -F "voice=fr-FR-DeniseNeural" \
  -F "system=Tu es un assistant bref et clair."
```

Réponse JSON (l'audio est renvoyé en base64, car une fonction serverless ne peut
pas renvoyer deux corps binaires) :

```json
{
  "success": true,
  "transcript": "Quel temps fait-il ?",
  "reply": "Je ne peux pas accéder à la météo en temps réel, mais…",
  "voice": "fr-FR-DeniseNeural",
  "mimeType": "audio/mpeg",
  "audio": "//uQxAAA…",
  "providers": { "stt": "groq", "llm": "groq", "tts": "edge" },
  "timings": { "stt": 412, "llm": 655, "tts": 380, "total": 1447 }
}
```

- `?format=audio` → renvoie le **MP3 brut** de la réponse (transcript et réponse
  dans les en-têtes `X-Transcript` / `X-Reply`, encodés en JSON ASCII).
- Champ `text` au lieu de `audio` → l'étape STT est sautée (utile si le client a
  déjà transcrit avec la Web Speech API du navigateur).
- `history` : JSON `[{"role":"user","content":"…"}]` pour garder le contexte.

### `GET /api/voices` — liste des voix

```bash
curl "http://localhost:3000/api/voices?language=fr"
curl "http://localhost:3000/api/voices?locale=fr-FR&gender=Female"
```

### `GET /api/health` — état des fournisseurs

Renvoie le fournisseur STT/LLM/TTS actif, **sans jamais exposer les clés**.

### Configuration des routes vocales

| Variable | Rôle |
|---|---|
| `GROQ_API_KEY` | **Recommandé.** Active STT (Whisper) + LLM via Groq |
| `STT_PROVIDER` | `groq` \| `openai` \| `mock` (auto par défaut) |
| `STT_BASE_URL` / `STT_API_KEY` | Tout endpoint compatible OpenAI `/audio/transcriptions` |
| `LLM_PROVIDER` | `groq` \| `openai` \| `chat-endpoint` \| `none` \| `mock` |
| `CHAT_ENDPOINT` | Réutiliser un endpoint de chat gratuit (ex. l'API `/api/chat` de ce projet) comme LLM |
| `LLM_PROVIDER=none` | Aucun LLM : `/api/voice` renvoie le transcript tel quel (STT + TTS suffisent) |
| `TTS_VOICE` | Voix par défaut (défaut `fr-FR-DeniseNeural`) |
| `API_KEY` | Optionnel : exige `?key=…` ou l'en-tête `x-api-key` |

> 💡 Limite Vercel : corps de requête ≤ ~4,5 Mo (environ 1 à 2 minutes d'audio
> compressé). Pour de longs enregistrements, découper côté client.

## ⏱️ Budget de temps (pourquoi l'API ne reste jamais bloquée)

Une fonction Vercel de ce projet est coupée à **60 s** (`maxDuration` dans
`vercel.json`). Si le backend gratuit aichatting ralentit, une requête doit donc
**rendre la main avant**, avec une vraie erreur JSON — sinon la requête meurt en
silence et le navigateur attend son propre délai (90 s) avant d'afficher une
erreur trompeuse (« impossible de joindre l'API »).

C'est pourquoi `lib/aichatting.js` fixe un **budget global de 45 s**
(`REQUEST_BUDGET_MS`), **partagé par toutes les étapes** d'une même requête :

```
création de conversation  +  téléchargement des images  +  flux SSE  ≤  45 s
```

- Le flux SSE reçoit « ce qu'il reste » du budget, jamais 100 s comme avant.
- `chatReliable()` **partage** le même budget entre sa 1re tentative et le réessai
  (visiteur neuf) : les deux tiennent ensemble dans les 45 s.
- Tout dépassement, à n'importe quelle étape, renvoie un message clair :
  *« Le modèle met trop de temps à répondre (délai dépassé). Réessayez, ou posez
  une question plus courte. »*
  ⚠️ Piège : `AbortSignal.timeout()` rejette une **`TimeoutError`**, pas une
  `AbortError` — les deux doivent être testées.
- Surchargeable : `CHAT_BUDGET_MS` (ex. `60000` sur un plan Vercel Pro).

Les routes vocales suivent la même règle : `lib/providers.js` limite les appels
amont à **45 s** (`UPSTREAM_TIMEOUT_MS`).

## Modèles testés (mise à jour 2026-09-05)

Le site n'expose officiellement que deux modèles (`gpt-5.6-luna` gratuit et
`gpt-5.6-terra` réservé aux membres PRO), et le backend ne fait tourner en
réalité **qu'un seul moteur gratuit** : `gpt-5.6-luna` (qui s'identifie
lui-même comme ChatGPT / OpenAI).

Nous avons retesté **tous** les noms autrefois listés (38 noms) en posant la
question « qui es-tu ? Donne le nom exact de ton modèle » à chacun, avec un
visiteur neuf :

### ✅ Le seul modèle gratuit authentique

`gpt-5.6-luna` → répond « Je suis ChatGPT, un modèle d'IA d'OpenAI » :
c'est le modèle officiel gratuit du site, il fonctionne.

### ❌ Anciens noms supprimés (alias trompeurs)

`gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5.1`, `gpt-5.1-mini`, `gpt-5.1-nano`,
`gpt-5.2`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4.1`, `gpt-4.1-mini`,
`gpt-4.1-nano`, `gpt-4`, `gpt-3.5-turbo`, `o1`, `o1-mini`, `o3`, `o3-mini`,
`o4-mini`, `deepseek-chat`, `deepseek-reasoner`, `deepseek-v3`, `deepseek-r1`,
`claude-3-5-sonnet-20241022`, `claude-sonnet-4-20250514`, `claude-3-5-haiku`,
`claude-3-opus`, `gemini-1.5-pro`, `gemini-2.0-flash`, `gemini-2.5-flash`,
`gemini-2.5-pro`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `grok-2`,
`grok-3`, `qwen2.5-72b-instruct`, `mixtral-8x7b-instruct`

→ interrogés avec « qui es-tu ? », **tous** répondent « ChatGPT / créé par
OpenAI » (plusieurs déclarent même « je suis le modèle GPT-5 »). Ces noms ne
font **pas** tourner le modèle annoncé : le backend les accepte et retombe
silencieusement sur le moteur gratuit par défaut. Ils ont donc été **retirés**
de l'API (`model=` hors liste → HTTP 400 avec la liste des modèles valides).

### 🔒 Réservés aux membres PRO

`gpt-5.6-terra`, `gpt-4o` → réponse HTTP **402** avec le message du backend :
*« You are currently not a pro premium member. Please purchase a pro premium
membership before using it. »* (modèles réels, mais payants).

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

`vercel.json` configure les routes `/api/chat` (vers `api/chat.js`, `maxDuration` 60 s)
et `/api/plot` + `/api/figure` (vers `api/plot.js`, `maxDuration` 10 s).

## Test en local

```bash
npm start
curl "http://localhost:3000/api/chat?prompt=bonjour&model=gpt-5.6-luna&uid=123"
curl "http://localhost:3000/api/plot?expression=x-2ln(x)"
curl "http://localhost:3000/api/plot?expression=sin(x)&format=svg"
```

## Tests automatisés

```bash
node test.js          # teste la liste FREE_MODELS (gratuits)
node test.js --all    # inclut les modèles PRO (réponse attendue : message PRO)
node test-plot.js     # teste le moteur de figures (parser, domaine auto, SVG)
node test-voice.js    # teste les routes vocales (npm run test:voice)
```

## Structure

```
api/chat.js        → fonction serverless Vercel (GET + POST /api/chat)
api/plot.js        → fonction serverless Vercel (GET + POST /api/plot, alias /api/figure)
api/geo.js         → fonction serverless Vercel (GET + POST /api/geo — constructions géométriques)
api/tts.js         → fonction serverless Vercel (GET + POST /api/tts — texte → MP3, sans clé)
api/stt.js         → fonction serverless Vercel (POST /api/stt — audio → texte, Whisper)
api/voice.js       → fonction serverless Vercel (POST /api/voice — STT → LLM → TTS)
api/voices.js      → fonction serverless Vercel (GET /api/voices — liste des voix Edge)
api/health.js      → fonction serverless Vercel (GET /api/health — état des fournisseurs)
lib/handler.js     → logique HTTP commune de /api/chat (CORS, GET, POST JSON, erreurs)
lib/plot.js        → moteur de courbes : parser d'expressions, échantillonnage, SVG (zéro dépendance)
lib/figures-ai.js  → génération de figures par IA : prompt, extraction/assainissement/validation SVG, retries visiteur neuf
lib/plot-handler.js→ logique HTTP commune de /api/plot (CORS, GET, POST, modes expression/subject, formats)
lib/geometry.js    → moteur géométrique déterministe : interprétation de l'énoncé + constructions SVG
lib/geo-handler.js → logique HTTP commune de /api/geo
lib/edge-tts.js    → synthèse vocale Edge (réessais, délai max, cache des voix, validation)
lib/providers.js   → fournisseurs STT (Whisper) et LLM (Groq / OpenAI / endpoint de chat libre)
lib/http.js        → utilitaires HTTP (CORS, corps JSON/brut/multipart, réponses, erreurs typées)
lib/route.js       → enveloppe commune des routes vocales (CORS + préflight + API_KEY + erreurs)
lib/tts-handler.js · lib/stt-handler.js · lib/voice-handler.js · lib/meta-handler.js → logique des routes vocales
lib/aichatting.js  → client du backend aichatting (vToken RSA, conversation, SSE, vision, chatReliable)
server.js          → serveur local de test (zéro dépendance) — routes chat + plot + geo + voix
test.js            → test automatisé des modèles + vision (node test.js --vision)
test-plot.js       → test automatisé du moteur de courbes (node test-plot.js)
test-geo.js        → test automatisé du moteur géométrique (node test-geo.js)
test-voice.js      → test automatisé des routes vocales (node test-voice.js)
vercel.json        → configuration Vercel (routes + maxDuration)
```
