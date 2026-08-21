# 🌍 Xanjo-World

A browser game built step by step. Current stage: **1 — a circle-shaped character moving on a blank canvas.**

## ✅ Stage 1 (current)

- A circle-shaped character (indigo, with simple eyes)
- Movement with **W A S D** (arrow keys also work)
- Smooth 60fps, diagonal movement normalized, character stays inside the canvas
- **Blank white canvas** — the world gets added next

## Tech stack

| Layer | Technology |
|---|---|
| Game engine | **Phaser 3** (bundled locally at `public/phaser.min.js`, no CDN) |
| Language | Plain JavaScript |
| Server | Node.js static file server (multiplayer comes later) |

## Run it

```bash
npm install
node server.js   # → http://localhost:8080
```

## Project layout

```
mmorpg/
├── server.js            # static file server
└── public/
    ├── index.html       # page shell
    ├── game.js          # Phaser 3 client (the circle + WASD)
    └── phaser.min.js    # Phaser 3, bundled locally
```

## Roadmap

1. ✅ Circle character + WASD + blank canvas
2. A tiled world + a camera that follows you
3. Obstacles + collision
4. Second player over WebSocket (server-authoritative)
5. Monsters, combat, chat, inventory, zones…
