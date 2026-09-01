# chat-free-gpt

API REST gratuite qui expose un endpoint `GET /api/chat` en s'appuyant sur le
backend du site **https://www.aichatting.net/fr/free-chatgpt/** (ChatGPT
gratuit en ligne, sans inscription), plus une route **`/api/plot`** qui
construit des **figures en SVG** : courbes mathématiques (`expression=`) **ou
n'importe quelle figure par IA** (`subject=` — physique, chimie, circuits
électriques…). Déployable tel quel sur **Vercel**.

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
{ "subject": "appareil de distillation simple en chimie", "model": "gpt-5" }
```

### 🎨 Mode dynamique par IA : n'importe quelle figure

Le sujet libre est envoyé à un modèle de langage (repli automatique entre
`gpt-5.6-luna`, `gpt-5`, `deepseek-chat`, `gemini-2.0-flash`) avec une consigne
de dessinateur : l'API extrait, **assainit** (anti-XSS) et **valide** le SVG
(balances XML) avant de le renvoyer. Exemples testés :

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
- Si un modèle échoue (timeout, 504, SVG invalide), l'API **réessaie avec les
  modèles suivants** ; en cas d'échec total → HTTP 502 avec un message clair.
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
| `model` | string | Modèle IA pour `subject=` (défaut `gpt-5.6-luna`, repli auto sur gpt-5, deepseek-chat, gemini-2.0-flash) |
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
```

## Structure

```
api/chat.js        → fonction serverless Vercel (GET + POST /api/chat)
api/plot.js        → fonction serverless Vercel (GET + POST /api/plot, alias /api/figure)
api/geo.js         → fonction serverless Vercel (GET + POST /api/geo — constructions géométriques)
lib/handler.js     → logique HTTP commune de /api/chat (CORS, GET, POST JSON, erreurs)
lib/plot.js        → moteur de courbes : parser d'expressions, échantillonnage, SVG (zéro dépendance)
lib/figures-ai.js  → génération de figures par IA : prompt, extraction/assainissement/validation SVG, repli multi-modèles
lib/plot-handler.js→ logique HTTP commune de /api/plot (CORS, GET, POST, modes expression/subject, formats)
lib/geometry.js    → moteur géométrique déterministe : interprétation de l'énoncé + constructions SVG
lib/geo-handler.js → logique HTTP commune de /api/geo
lib/aichatting.js  → client du backend aichatting (vToken RSA, conversation, SSE, vision, chatReliable)
server.js          → serveur local de test (zéro dépendance) — routes chat + plot + geo
test.js            → test automatisé des modèles + vision (node test.js --vision)
test-plot.js       → test automatisé du moteur de courbes (node test-plot.js)
test-geo.js        → test automatisé du moteur géométrique (node test-geo.js)
vercel.json        → configuration Vercel (routes + maxDuration)
```
