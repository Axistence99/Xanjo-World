# 🌍 Xanjo-World

**Play online (GitHub Pages): <https://axistence99.github.io/Xanjo-World/>** · [Progress tracker / changelog](CHANGELOG.md)

A browser game built step by step. Current stage: **2 — a Zenonia 4-inspired world with a chibi swordsman hero: grass map, forests, camera follow, HUD, minimap, slimes & sword combat.**

## ✅ Stage 2 (current) — Zenonia 4 inspired

- Painted top-down world (2560×1920): grass patches, dirt path, flowers, tufts, pebbles, mushrooms — 100% procedural art
- Forest clusters + rocks with circle collision; y-sorted depth so you walk behind/in front of props
- Smooth clamped camera follow; hero gets walk-bob, drop shadow, look-direction pupils and a sword
- Zenonia-style HUD: HP bar, EXP bar, LVL badge, minimap (trees/rocks/slimes/viewport), enemy target plate, pause/bag/Shop cluster, touch-style buttons bottom-right
- Slimes wander, hop, get knocked back, show HP bars, poof on death and respawn; killing them grants EXP and level-ups
- Combat: **SPACE** or the ⚔ button swings the sword in an arc in the facing direction
- Movement: **W A S D** / arrow keys
- **Chibi swordsman hero** (Zenonia-style: blond spiky hair, blue tunic, sword): code-painted sprite frames with a 4-frame walk cycle and 4-frame attack swing for down/up/side (right is mirrored), played via Phaser animations

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
├── server.js                   # static file server (local dev)
├── CHANGELOG.md                # progressive tracker of all updates
├── .github/workflows/pages.yml # deploys public/ to GitHub Pages on push
└── public/
    ├── index.html              # page shell
    ├── game.js                 # Phaser 3 client (world + swordsman + slimes)
    └── phaser.min.js           # Phaser 3, bundled locally
```

## Roadmap

1. ✅ Circle character + WASD + blank canvas
2. ✅ Zenonia 4-inspired world: grass map, forests + collision, camera follow, HUD, minimap, slimes + sword combat
3. Skills, more monsters, loot & inventory
4. Second player over WebSocket (server-authoritative)
5. Chat, zones/channels, persistence…
