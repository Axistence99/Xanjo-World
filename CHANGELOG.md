# 📜 Xanjo-World — Progress Tracker

Living changelog: newest entry on top. Every stage, feature, fix or change gets
appended here as the game grows, so anyone can follow the project's history
at a glance.

---

## 2026-10-03 — Stage 2.6 · GitHub hosting

### Added
- GitHub Actions workflow (`.github/workflows/pages.yml`) that deploys `public/` to **GitHub Pages** on every push to `main`
- Playable online URL: <https://axistence99.github.io/Xanjo-World/>
- This file (`CHANGELOG.md`) — the progressive tracker of all updates

### Changed
- `index.html` now loads scripts with **relative paths**, so the same files work both from the local Node server and from the Pages subfolder

### Fixed
- Pages workflow: dropped `actions/configure-pages` (it 404s on repos where Pages was never enabled); `actions/deploy-pages` provisions the site on first deploy

---

## 2026-10-03 — Stage 2.5 · Swordsman sprite

### Added
- **Chibi swordsman hero** (blond spiky hair, blue tunic, sword in hand) replacing the circle placeholder
- Code-painted sprite frames: 4-frame walk cycle + 4-frame attack swing for down / up / side; right direction mirrored via `flipX`
- Phaser animations `walk-*`, `idle-*`, `atk-*`; feet-anchored origin so depth-sorting with trees still works

### Changed
- Sword swing now plays the sprite attack animation; the damage hit-check fires mid-swing

---

## 2026-10-03 — Stage 2 · Zenonia 4-inspired world

### Added
- Painted top-down world (2560×1920): grass patches, winding dirt path, flowers, tufts, pebbles, mushrooms — 100% procedural art
- Forest clusters + rocks with circle collision; y-sorted depth (walk behind/in front of props)
- Smooth clamped camera follow; walk-bob and drop shadow for the hero
- Zenonia-style HUD: HP bar, EXP bar, LVL badge, minimap (trees/rocks/slimes/viewport), enemy target plate, pause/bag/Shop cluster, touch-style buttons
- Slimes: wander & hop, knockback, HP bars, death poof, respawn timer
- Progression: EXP from kills, level-ups with floating text
- Combat: **SPACE** / ⚔ button arc slash with damage numbers

---

## 2026-10-03 — Stage 1 · First steps

### Added
- Circle-shaped character with simple eyes
- **W A S D** + arrow-key movement, diagonal normalization, canvas clamping
- Phaser 3 bundled locally (no CDN), Node.js static file server
- Project setup: repository, README, .gitignore
