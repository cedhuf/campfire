# campfire

[![build](https://github.com/cedhuf/campfire/actions/workflows/docker.yml/badge.svg)](https://github.com/cedhuf/campfire/actions/workflows/docker.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

An **ephemeral, ambient chat**: no accounts, no database, no history. Anonymous
visitors gather around a campfire on a beach — visible presence, whispered
messages that fade away after a few seconds. All state lives in server memory and
vanishes when the process restarts: that's a feature, not a limitation.

## Features

- **Real-time presence** over WebSocket: oscillating silhouettes around the fire + a live counter.
  Each visitor gets a **stable, deterministic color** (derived from their `visitorId`) shared by
  their on-canvas marker and their chat messages — so you can spot who's who at a glance.
- **Ephemeral chat, two display modes**: messages drifting **in the air** around the fire
  (default) or a classic bottom log. Zero persistence either way.
- **Shared lofi radio**: a single switch synced across everyone (one toggles it for all), with a
  per-visitor local mute — plus a local **campfire crackle** ambience.
- **Ambient canvas scene**: a glowing fire, rising embers, waves, and a starfield visible all day
  (faint at midday, full at night).
- **Day/night cycle** driven by **server time** (consistent for all visitors, derived in UTC):
  a 0h→24h progress bar at the top, plus a theme that warms at dawn/dusk and cools to deep blue
  at midday.
- **Settings modal**: reduced-motion, chat mode, fire ambience, and **language (FR/EN)** — all
  persisted locally.
- **Share** the link (Web Share API / clipboard copy) to invite others to the same fire.
- **Optional password gate** (`ACCESS_PASSWORD`, off by default).
- **Accessibility**: respects `prefers-reduced-motion`, `aria-live` on the chat, keyboard focus.

## Stack

- **Backend**: [Bun](https://bun.sh) — WebSocket server, 100% in-memory state, also serves the
  compiled static assets.
- **Frontend**: TypeScript + canvas, bundled by [Vite](https://vitejs.dev). No framework.
- **Container**: single image (see `Dockerfile` / `compose.yaml`), no volume to mount.

## Development

```bash
bun install
bun dev          # server (hot) + Vite with a /ws -> :3000 proxy
```

- Server only: `bun dev:server`
- Frontend only: `bun dev:web`

Open the app in several tabs to watch presence update.

## Build & production

```bash
bun run build    # compiles the frontend into dist/
bun start        # serves dist/ + the WebSocket on PORT (default 3000)
```

## Configuration

All settings are environment variables. Bun auto-loads a `.env` file in development; in
production pass them through your container runtime. Copy `.env.example` to `.env` to start.

| Variable                  | Default | Description                                                        |
| ------------------------- | ------- | ------------------------------------------------------------------ |
| `PORT`                    | `3000`  | Port the server listens on.                                        |
| `TRUST_PROXY`             | `true`  | Trust `X-Forwarded-For` for per-IP limits. See the security note.  |
| `MAX_CONNECTIONS`         | `500`   | Max simultaneous connections (global) before new ones are refused. |
| `MAX_CONNECTIONS_PER_IP`  | `10`    | Max simultaneous connections per IP.                               |
| `MSG_MAX_LENGTH`          | `140`   | Max chat message length (chars); longer messages are rejected.     |
| `MSG_RATE_LIMIT_MS`       | `2200`  | Minimum delay between two messages from the same connection (ms).  |
| `ACCESS_PASSWORD`         | _(empty)_ | Optional. When set, visitors must enter this password to join.    |

### Audio

The campfire crackle lives in `static/` (`sounds_fx/`), served via Vite's public dir and
streamed/looped locally per visitor. The shared radio points at a public lofi stream by default —
change `RADIO_URL` in [web/radio.ts](web/radio.ts) to use another station (must be HTTPS).

## Container image

A multi-arch-ready image is built and published to the GitHub Container Registry on every push
to `main` and on version tags (see [.github/workflows/docker.yml](.github/workflows/docker.yml)).

```bash
docker run --rm -p 3000:3000 -e TRUST_PROXY=false ghcr.io/cedhuf/campfire:latest
```

Or with the full reverse-proxy setup:

```bash
docker compose up --build   # or: podman-compose up --build
```

## Tests

WebSocket integration test (two clients against a running server):

```bash
PORT=3100 bun server/index.ts &     # test server
bun test/ws-it.ts                   # init, presence, rate-limit, sanitization, leave
```

## Deployment & security

- **Put it behind a TLS reverse proxy** (Caddy/Traefik) that handles the WebSocket upgrade
  natively. Serve over **WSS**, never plaintext WS.
- The server trusts `X-Forwarded-For` for per-IP limits when `TRUST_PROXY=true`: **never expose
  it directly** in that mode (the header is spoofable). Set `TRUST_PROXY=false` for a directly
  exposed deployment so limits key on the real socket IP.
- Built-in guardrails: server-generated crypto-random `visitorId` (never read from the client),
  message validation/truncation, HTML escaping, per-connection rate limiting, and per-IP and
  global connection caps.

## WebSocket protocol

Every message carries `"v": 1`.

**Server → client**: `init` (visitorId, seatIndex, now, radio, presence), `presence:join`,
`presence:leave`, `chat:message`, `radio:state`, `error`, and `auth:required` (when a password is set).
**Client → server**: `chat:send`, `radio:set`, and `auth` (password).

Best-effort broadcast with no acknowledgement or replay — consistent with the ephemeral design.

## License

[AGPL-3.0](LICENSE) © Cedric Huf
