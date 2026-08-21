# 🎮 Xanjo-World

A playable browser MMORPG prototype — a small open world where players (and monsters) live on an authoritative server and your browser just renders it.

## Tech stack (exactly as promised)

| Layer | Technology |
|---|---|
| **Game engine** | **Phaser 3** — v3.85.2, MIT license |
| Client rendering | Phaser 3 (bundled locally at `public/phaser.min.js` — no CDN at runtime) |
| Client language | Plain JavaScript (ES2020) |
| Server | **Node.js** + **`ws`** (WebSockets) — the only runtime dependency |
| Persistence | JSON file (`players.json`) — no database |
| Art | 100% procedural pixel-art (generated in code, no image files) |
| Network protocol | JSON over WebSocket |

> **Phaser 3 is the game engine.** It provides the render loop, sprites, camera, input, and
> tween/animation systems. It's a *framework* (a library you import), not an editor-based engine
> like Godot — so every line of game code is still written as plain JavaScript, exactly as promised.

## Architecture

```
 Browser (Phaser 3)                 Node.js server (source of truth)
 ┌─────────────────────┐   WS 20Hz  ┌──────────────────────────────┐
 │ predict your movement│◄─────────►│ validate input, move players │
 │ interpolate others   │  intents  │ monster AI (aggro/chase)     │
 │ render world + FX    │  state    │ area-of-interest snapshots   │
 └─────────────────────┘           │ combat, XP, respawns          │
                                   └──────────────────────────────┘
```

Key MMO techniques implemented:

- **Authoritative server** — clients send *intents* (`{t:'input', dir:[dx,dy]}`), never positions. The server is the only authority on where you are.
- **Client-side prediction + reconciliation** — you move instantly; the server's truth gently pulls you back if you drift.
- **Entity interpolation** — remote players & monsters glide smoothly between 20 Hz updates.
- **Area of interest** — each client only receives entities within 750 px, so the world scales beyond what one client can see.
- **Procedural world** — deterministic obstacle layout (seeded RNG), generated client art.

## Run it

```bash
cd mmorpg
npm install        # installs ws
node server.js     # starts on http://0.0.0.0:8080
```

Then open http://localhost:8080 in two browser tabs — pick a name in each, and you'll see each other move live.

## Controls

| Key / action | Effect |
|---|---|
| `WASD` / arrow keys | Move |
| `SPACE` | Attack nearest monster |
| Click a monster | Attack that monster |
| Chat box + `Enter` | Chat with everyone |

## Project layout

```
mmorpg/
├── server.js            # HTTP + WebSocket + 20 Hz game simulation
├── players.json         # persistent accounts (auto-created)
└── public/
    ├── index.html       # UI shell: login, HUD, chat
    ├── game.js          # Phaser client (render, netcode, prediction)
    └── phaser.min.js    # Phaser 3, bundled locally
```

## Roadmap (what to add next)

1. Zones / channels (split the world into maps like Flyff's Flaris → Saint Morning)
2. Items & inventory + equipment
3. Skills with cooldowns
4. Party / friends list
5. Account login (currently name-only) + real database
6. Bosses, quests, NPCs with dialog
