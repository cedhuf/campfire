# campfire

Un chat **éphémère et ambiant** : pas de compte, pas de base de données, pas d'historique.
Des visiteurs anonymes se rassemblent autour d'un feu de camp sur une plage — présence
visible, messages murmurés qui s'évanouissent au bout de quelques secondes. Tout l'état vit
en mémoire côté serveur et disparaît au redémarrage du process : c'est une caractéristique,
pas une limite.

## Fonctionnalités

- **Présence en temps réel** via WebSocket : silhouettes/oscillateurs autour du feu + compteur.
- **Chat éphémère** : zéro persistance, fondu progressif, plafond de 10 lignes affichées.
- **Scène ambiante en canvas** : feu, braises, vagues, et champ d'étoiles.
- **Cycle jour/nuit** piloté par l'heure **serveur** (cohérent entre tous les visiteurs,
  dérivé en UTC) : barre de progression 0h→24h en haut, et thème qui se réchauffe à
  l'aube/au crépuscule, vire au bleu froid à midi, et fait apparaître les étoiles la nuit.
- **Panneau de réglages minimaliste** : bascule `reduced-motion` (préférence OS par défaut,
  override persistant en `localStorage`).
- **Accessibilité** : `prefers-reduced-motion` respecté (scène statique, pas de scintillement),
  `aria-live` sur le chat.

## Stack

- **Backend** : [Bun](https://bun.sh) — serveur WebSocket, état 100 % en mémoire, sert aussi
  les assets statiques compilés.
- **Frontend** : TypeScript + canvas, bundlé par [Vite](https://vitejs.dev). Aucun framework.
- **Conteneur** : image unique (voir `Dockerfile` / `compose.yaml`), pas de volume à monter.

## Développement

```bash
bun install
bun dev          # serveur (hot) + Vite avec proxy /ws -> :3000
```

- Serveur seul : `bun dev:server`
- Front seul : `bun dev:web`

Ouvre l'app dans plusieurs onglets pour voir la présence évoluer.

## Build & production

```bash
bun run build    # compile le front dans dist/
bun start        # sert dist/ + le WebSocket sur le PORT (défaut 3000)
```

Variable d'environnement : `PORT` (défaut `3000`).

### Conteneur

```bash
docker compose up --build   # ou: podman-compose up --build
```

## Tests

Test d'intégration WebSocket (deux clients contre un serveur lancé) :

```bash
PORT=3100 bun server/index.ts &     # serveur de test
bun test/ws-it.ts                   # init, présence, rate-limit, sanitization, départ
```

## Déploiement & sécurité

- **À placer derrière un reverse proxy TLS** (Caddy/Traefik) qui gère nativement l'upgrade
  WebSocket. Servir en **WSS**, pas de WS en clair.
- Le serveur fait confiance à `X-Forwarded-For` pour le plafond de connexions par IP :
  **ne jamais l'exposer en direct**, seulement derrière un proxy de confiance qui réécrit
  cet en-tête.
- Garde-fous intégrés : `visitorId` crypto-random généré côté serveur (jamais lu du client),
  validation/troncature des messages, échappement HTML, rate-limit par connexion, plafonds
  par IP et globaux.

## Protocole WebSocket

Tous les messages portent `"v": 1`.

**Serveur → client** : `init` (visitorId, seatIndex, now, presence), `presence:join`,
`presence:leave`, `chat:message`, `error`.
**Client → serveur** : `chat:send`.

Diffusion best-effort sans accusé de réception ni rejeu — cohérent avec l'éphémère.
