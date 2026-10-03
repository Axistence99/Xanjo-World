/**
 * Xanjo-World — Stage 2 (Zenonia 4 inspired)
 *
 * What changed from Stage 1 (circle + blank canvas):
 *  - A big scrolling world (2560x1920) of painted grass: patches, a dirt
 *    path, flowers, tufts, pebbles, mushrooms — all drawn in code.
 *  - Forest clusters of trees + rocks with circle collision, y-sorted depth
 *    so you walk behind/in front of them like a classic top-down RPG.
 *  - Smooth camera that follows the circle hero (with walk-bob + shadow).
 *  - Zenonia-style HUD: HP bar, EXP bar, LVL badge, minimap, target plate,
 *    pause/bag/Shop cluster, and touch-style buttons bottom-right.
 *  - Slimes wander the world. Hit them with SPACE (or the ⚔ button):
 *    damage numbers, knockback, HP bars, death poof, EXP + level ups.
 *
 * Engine: Phaser 3 (bundled locally). Art: 100% procedural.
 */

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */
const VIEW_W = 960;
const VIEW_H = 600;
const WORLD_W = 2560;
const WORLD_H = 1920;
const PLAYER_R = 14;      // collision radius of the hero
const SPEED = 240;        // px per second
const SLIME_SPEED = 46;

/* Seeded RNG so the world is identical on every load (matters later,
   when the server needs to agree with clients about the map). */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261003);
const between = (a, b) => a + rand() * (b - a);

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
let S = null;             // the Phaser scene
let keys, cursors, spaceKey;
let player;               // logic state of the hero
let playerGfx, swordSprite, shadowSprite, pupilL, pupilR;
let hudG, mapG, plateG, hudLevelText, plateName, plateLvl;
let obstacles = [];       // { x, y, r } — tree trunks & rocks
let slimes = [];
let walkPhase = 0, moving = false, attackCooldown = 0, swinging = false;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  width: VIEW_W,
  height: VIEW_H,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: { create, update },
});

/* ------------------------------------------------------------------ */
/* create                                                              */
/* ------------------------------------------------------------------ */
function create() {
  S = this;

  makeTextures(S);
  paintGround(S);
  S.add.image(WORLD_W / 2, WORLD_H / 2, 'ground').setDepth(0);

  /* ---- scatter props: forests hug the edges like Zenonia maps ---- */
  const props = [];
  const clearOf = (x, y, d) => props.every((p) => Math.hypot(p.x - x, p.y - y) > d);
  const spawnClear = (x, y) => Math.hypot(x - WORLD_W / 2, y - WORLD_H / 2) > 180;

  const clusters = [
    [180, 180], [WORLD_W - 220, 200], [200, WORLD_H - 200],
    [WORLD_W - 200, WORLD_H - 220], [WORLD_W - 150, WORLD_H / 2], [WORLD_W / 2, 130],
  ];
  clusters.forEach(([cx, cy]) => {
    const n = 9 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
      const x = cx + between(-170, 170), y = cy + between(-130, 130);
      if (x < 60 || y < 80 || x > WORLD_W - 60 || y > WORLD_H - 40) continue;
      if (!spawnClear(x, y) || !clearOf(x, y, 64)) continue;
      props.push({ type: 'tree', x, y });
    }
  });
  for (let i = 0; i < 26; i++) {
    const x = between(80, WORLD_W - 80), y = between(90, WORLD_H - 50);
    if (!spawnClear(x, y) || !clearOf(x, y, 72)) continue;
    props.push({ type: 'tree', x, y });
  }
  for (let i = 0; i < 18; i++) {
    const x = between(70, WORLD_W - 70), y = between(80, WORLD_H - 40);
    if (!spawnClear(x, y) || !clearOf(x, y, 60)) continue;
    props.push({ type: rand() < 0.5 ? 'rock' : 'bush', x, y });
  }

  props.forEach((p) => {
    let sprite;
    if (p.type === 'tree') { sprite = S.add.image(p.x, p.y - 44, 'tree'); obstacles.push({ x: p.x, y: p.y, r: 16 }); }
    if (p.type === 'rock') { sprite = S.add.image(p.x, p.y - 12, 'rock'); obstacles.push({ x: p.x, y: p.y, r: 14 }); }
    if (p.type === 'bush') { sprite = S.add.image(p.x, p.y - 14, 'bush'); }
    sprite.setDepth(p.y);
  });
  S.props = props;

  /* ---- the hero (still our circle, now with shadow, bob & sword) ---- */
  player = {
    x: WORLD_W / 2, y: WORLD_H / 2,
    facing: Math.PI / 2,
    level: 1, exp: 0, expNext: 40,
    hp: 100, maxHp: 100,
  };
  shadowSprite = S.add.image(player.x, player.y + 12, 'shadow').setDepth(1);
  playerGfx = S.add.container(player.x, player.y);
  const body = S.add.circle(0, 0, 16, 0x4f46e5).setStrokeStyle(3, 0x3730a3);
  const eyeL = S.add.circle(-6, -4, 3.5, 0xffffff);
  const eyeR = S.add.circle(6, -4, 3.5, 0xffffff);
  pupilL = S.add.circle(-6, -4, 1.8, 0x111827);
  pupilR = S.add.circle(6, -4, 1.8, 0x111827);
  swordSprite = S.add.image(0, 0, 'sword').setOrigin(0.2, 0.5);
  swordSprite.rotation = player.facing + 0.9;
  playerGfx.add([swordSprite, body, eyeL, eyeR, pupilL, pupilR]);

  /* ---- slimes ---- */
  for (let i = 0; i < 5; i++) spawnSlime();

  /* ---- input ---- */
  keys = S.input.keyboard.addKeys({
    up: Phaser.Input.Keyboard.KeyCodes.W,
    down: Phaser.Input.Keyboard.KeyCodes.S,
    left: Phaser.Input.Keyboard.KeyCodes.A,
    right: Phaser.Input.Keyboard.KeyCodes.D,
  });
  cursors = S.input.keyboard.createCursorKeys();
  spaceKey = S.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  S.input.keyboard.addCapture(['SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT']);

  /* ---- HUD layers (screen-space) ---- */
  hudG = S.add.graphics().setScrollFactor(0).setDepth(1000);
  mapG = S.add.graphics().setScrollFactor(0).setDepth(1000);
  plateG = S.add.graphics().setScrollFactor(0).setDepth(1000);
  const txt = (x, y, str, size, color) =>
    S.add.text(x, y, str, {
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      fontSize: size + 'px', fontStyle: 'bold', color,
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1003);

  hudLevelText = txt(VIEW_W / 2, VIEW_H - 40 + 14 + 7 - 2, 'LVL 01', 11, '#ffffff');
  plateName = txt(VIEW_W / 2 + 14, 21, 'Slime', 13, '#ffffff');
  plateLvl = txt(VIEW_W / 2 - 115 + 30, 21, 'LVL 01', 10, '#ffcc80');
  plateName.setVisible(false); plateLvl.setVisible(false); plateG.setVisible(false);
  txt(132, 30, 'Shop', 12, '#ffffff');

  /* ---- buttons ---- */
  const mkBtn = (x, y, tex, tint, onClick) => {
    const b = S.add.image(x, y, tex).setScrollFactor(0).setDepth(1002).setInteractive();
    if (tint) b.setTint(tint);
    b.on('pointerdown', () => {
      S.tweens.add({ targets: b, scale: 0.85, yoyo: true, duration: 90 });
      onClick();
    });
    return b;
  };
  mkBtn(30, 30, 'btn', null, () => floatText(player.x, player.y - 40, 'Menu — coming soon', '#b0bec5', 12));
  mkBtn(72, 30, 'btn', null, () => floatText(player.x, player.y - 40, 'Bag — coming soon', '#b0bec5', 12));
  mkBtn(VIEW_W - 116, VIEW_H - 44, 'btn', 0x1e88e5, () => floatText(player.x, player.y - 40, 'Skills — Stage 3!', '#81d4fa', 12));
  mkBtn(VIEW_W - 44, VIEW_H - 116, 'btn', 0x8e24aa, () => floatText(player.x, player.y - 40, 'Skills — Stage 3!', '#ce93d8', 12));
  mkBtn(VIEW_W - 52, VIEW_H - 52, 'btnBig', null, () => tryAttack());
  S.add.image(VIEW_W - 52, VIEW_H - 52, 'sword').setScrollFactor(0).setDepth(1003).setRotation(-0.7).setScale(1.1);
  txt(VIEW_W - 116, VIEW_H - 44, '✦', 16, '#ffffff');
  txt(VIEW_W - 44, VIEW_H - 116, '❋', 16, '#ffffff');
}

/* ------------------------------------------------------------------ */
/* update                                                              */
/* ------------------------------------------------------------------ */
function update(_time, delta) {
  const dt = Math.min(delta, 50) / 1000;
  attackCooldown = Math.max(0, attackCooldown - dt);

  /* ---- WASD / arrows ---- */
  const c = cursors;
  const dx = (keys.right.isDown || c.right.isDown ? 1 : 0) - (keys.left.isDown || c.left.isDown ? 1 : 0);
  const dy = (keys.down.isDown || c.down.isDown ? 1 : 0) - (keys.up.isDown || c.up.isDown ? 1 : 0);
  moving = !!(dx || dy);
  if (moving) {
    const len = Math.hypot(dx, dy);
    player.facing = Math.atan2(dy, dx);
    player.x += (dx / len) * SPEED * dt;
    player.y += (dy / len) * SPEED * dt;
    walkPhase += dt * 11;
  }
  if (spaceKey.isDown) tryAttack();

  /* ---- collide with trees & rocks, stay in the world ---- */
  for (const o of obstacles) {
    const ox = player.x - o.x, oy = player.y - o.y;
    const d = Math.hypot(ox, oy), min = o.r + PLAYER_R;
    if (d < min && d > 0.0001) { player.x = o.x + (ox / d) * min; player.y = o.y + (oy / d) * min; }
  }
  player.x = Phaser.Math.Clamp(player.x, PLAYER_R, WORLD_W - PLAYER_R);
  player.y = Phaser.Math.Clamp(player.y, PLAYER_R, WORLD_H - PLAYER_R);

  /* ---- hero visuals: bob, shadow, depth, pupils, sword carry ---- */
  const bob = moving ? Math.abs(Math.sin(walkPhase)) * 3 : 0;
  playerGfx.setPosition(player.x, player.y - bob);
  playerGfx.setDepth(player.y);
  shadowSprite.setPosition(player.x, player.y + 12);
  shadowSprite.setScale(1 - bob * 0.03);
  shadowSprite.setDepth(player.y - 1);
  const ex = Math.cos(player.facing) * 2.5, ey = Math.sin(player.facing) * 2.5 - 4;
  pupilL.setPosition(-6 + ex, ey);
  pupilR.setPosition(6 + ex, ey);
  if (!swinging) swordSprite.rotation = player.facing + 0.9;

  /* ---- slimes ---- */
  for (const s of slimes) updateSlime(s, dt);

  /* ---- smooth clamped camera follow ---- */
  const cam = S.cameras.main;
  const lerp = 1 - Math.exp(-6 * dt);
  cam.scrollX = Phaser.Math.Clamp(
    Phaser.Math.Linear(cam.scrollX, player.x - cam.width / 2, lerp), 0, WORLD_W - cam.width);
  cam.scrollY = Phaser.Math.Clamp(
    Phaser.Math.Linear(cam.scrollY, player.y - cam.height / 2, lerp), 0, WORLD_H - cam.height);

  /* ---- screen-space UI ---- */
  drawHUD();
  drawMinimap();
  drawTargetPlate();
}

/* ------------------------------------------------------------------ */
/* Slimes                                                              */
/* ------------------------------------------------------------------ */
function spawnSlime() {
  let x = 0, y = 0, tries = 0;
  do {
    x = between(120, WORLD_W - 120); y = between(120, WORLD_H - 120); tries++;
  } while (tries < 40 && (
    Math.hypot(x - player.x, y - player.y) < 320 ||
    obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + 26)
  ));
  const s = {
    x, y, hx: x, hy: y, tx: x, ty: y, wait: between(0.5, 2),
    hp: 100, maxHp: 100, alive: true, phase: rand() * 6,
    kbX: 0, kbY: 0, hurtT: 0,
    sprite: S.add.image(x, y, 'slime'),
    shadow: S.add.image(x, y + 9, 'shadow').setScale(0.7),
    hpBar: S.add.graphics().setVisible(false),
  };
  slimes.push(s);
  return s;
}

function updateSlime(s, dt) {
  s.wait -= dt;
  if (s.wait <= 0) {
    s.wait = between(1.5, 4);
    if (rand() < 0.35) { s.tx = s.x; s.ty = s.y; }
    else {
      s.tx = Phaser.Math.Clamp(s.hx + between(-160, 160), 60, WORLD_W - 60);
      s.ty = Phaser.Math.Clamp(s.hy + between(-120, 120), 60, WORLD_H - 60);
    }
  }
  const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
  let vx = 0, vy = 0;
  if (d > 6) { vx = (dx / d) * SLIME_SPEED; vy = (dy / d) * SLIME_SPEED; s.phase += dt * 9; }

  s.x += (vx + s.kbX) * dt;
  s.y += (vy + s.kbY) * dt;
  const decay = Math.exp(-7 * dt);
  s.kbX *= decay; s.kbY *= decay;

  for (const o of obstacles) {
    const ox = s.x - o.x, oy = s.y - o.y;
    const dd = Math.hypot(ox, oy), min = o.r + 14;
    if (dd < min && dd > 0.001) { s.x = o.x + (ox / dd) * min; s.y = o.y + (oy / dd) * min; }
  }
  s.x = Phaser.Math.Clamp(s.x, 40, WORLD_W - 40);
  s.y = Phaser.Math.Clamp(s.y, 40, WORLD_H - 40);

  const hop = (vx || vy) ? Math.abs(Math.sin(s.phase)) * 4 : 0;
  s.sprite.setPosition(s.x, s.y - hop);
  s.sprite.setDepth(s.y);
  s.shadow.setPosition(s.x, s.y + 9);
  s.shadow.setDepth(s.y - 1);
  s.shadow.setScale(0.7 * (1 - hop * 0.02));

  if (s.hurtT > 0) {
    s.hurtT -= dt;
    const g = s.hpBar;
    g.clear(); g.setVisible(true); g.setDepth(s.y + 1);
    const w = 36, h = 5, x = s.x - w / 2, y = s.y - 34;
    g.fillStyle(0x000000, 0.6); g.fillRoundedRect(x - 1, y - 1, w + 2, h + 2, 3);
    barFill(g, x, y, w, h, 2.5, Math.max(0, s.hp) / s.maxHp, 0xe53935);
    if (s.hurtT <= 0) g.setVisible(false);
  }
}

/* ------------------------------------------------------------------ */
/* Combat                                                              */
/* ------------------------------------------------------------------ */
function tryAttack() {
  if (attackCooldown > 0 || swinging) return;
  attackCooldown = 0.38;
  swinging = true;
  swordSprite.rotation = player.facing - 1.15;
  S.tweens.add({
    targets: swordSprite, rotation: player.facing + 1.15, duration: 200, ease: 'Cubic.Out',
    onComplete: () => { swinging = false; },
  });
  S.time.addEvent({
    delay: 80,
    callback: () => {
      for (const s of slimes) {
        const dx = s.x - player.x, dy = s.y - player.y;
        const d = Math.hypot(dx, dy);
        if (d > 78) continue;
        let da = Math.atan2(dy, dx) - player.facing;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) > 1.15) continue;
        hitSlime(s, 34, dx / (d || 1), dy / (d || 1));
      }
    },
  });
}

function hitSlime(s, dmg, nx, ny) {
  s.hp -= dmg;
  s.kbX += nx * 260; s.kbY += ny * 260;
  s.sprite.setTint(0xff8a80);
  S.time.addEvent({ delay: 90, callback: () => s.sprite.clearTint() });
  floatText(s.x, s.y - 30, '-' + dmg, '#ff5252');
  s.hurtT = 3;
  if (s.hp <= 0) killSlime(s);
}

function killSlime(s) {
  s.alive = false;
  floatText(s.x, s.y - 34, '+12 EXP', '#ffee58');
  gainExp(12);
  S.tweens.add({
    targets: [s.sprite, s.shadow, s.hpBar], alpha: 0, duration: 260,
    onComplete: () => { s.sprite.destroy(); s.shadow.destroy(); s.hpBar.destroy(); },
  });
  slimes = slimes.filter((x) => x !== s);
  S.time.addEvent({ delay: 9000, callback: () => spawnSlime() });
}

function gainExp(amt) {
  player.exp += amt;
  while (player.exp >= player.expNext) {
    player.exp -= player.expNext;
    player.level++;
    player.expNext = 40 + (player.level - 1) * 25;
    player.hp = player.maxHp;
    floatText(player.x, player.y - 46, 'LEVEL UP!', '#ffd54f', 18);
    hudLevelText.setText('LVL ' + String(player.level).padStart(2, '0'));
  }
}

function floatText(x, y, str, color, size = 14) {
  const t = S.add.text(x, y, str, {
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    fontSize: size + 'px', fontStyle: 'bold', color,
    stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5).setDepth(950);
  S.tweens.add({ targets: t, y: y - 44, alpha: 0, duration: 800, ease: 'Cubic.Out', onComplete: () => t.destroy() });
}

/* ------------------------------------------------------------------ */
/* HUD / minimap / target plate (screen-space)                         */
/* ------------------------------------------------------------------ */
function barFill(g, x, y, w, h, r, ratio, color) {
  const fw = Math.max(0, w * ratio);
  if (fw <= 0) return;
  g.fillStyle(color);
  g.fillRoundedRect(x, y, fw, h, Math.min(r, fw / 2, h / 2));
}

function drawHUD() {
  const g = hudG;
  g.clear();
  const cx = VIEW_W / 2;

  /* HP bar */
  const hw = 340, hh = 14, hx = cx - hw / 2, hy = VIEW_H - 40;
  g.fillStyle(0x2d1b12, 0.9); g.fillRoundedRect(hx - 3, hy - 3, hw + 6, hh + 6, 6);
  g.fillStyle(0x5d4037); g.fillRoundedRect(hx, hy, hw, hh, 4);
  barFill(g, hx, hy, hw, hh, 4, player.hp / player.maxHp, 0xe53935);
  g.fillStyle(0xffffff, 0.22);
  if (player.hp > 8) g.fillRoundedRect(hx + 2, hy + 2, hw * (player.hp / player.maxHp) - 4, 4, 2);

  /* EXP bar */
  const ew = 380, eh = 8, exx = cx - ew / 2, eyy = hy + hh + 6;
  g.fillStyle(0x2d1b12, 0.9); g.fillRoundedRect(exx - 2, eyy - 2, ew + 4, eh + 4, 5);
  g.fillStyle(0x5d4037); g.fillRoundedRect(exx, eyy, ew, eh, 3);
  barFill(g, exx, eyy, ew, eh, 3, Math.min(1, player.exp / player.expNext), 0xfdd835);

  /* LVL badge */
  g.fillStyle(0x111111, 0.95); g.fillRoundedRect(cx - 34, hy + hh - 4, 68, 18, 9);
  g.lineStyle(1.5, 0xfdd835, 0.9); g.strokeRoundedRect(cx - 34, hy + hh - 4, 68, 18, 9);

  /* top-left Shop pill (pause & bag are textured buttons) */
  g.fillStyle(0x00acc1, 0.95); g.fillRoundedRect(100, 17, 64, 26, 13);
  g.lineStyle(1.5, 0x006064, 0.9); g.strokeRoundedRect(100, 17, 64, 26, 13);
}

function drawMinimap() {
  const g = mapG;
  g.clear();
  const mw = 150, mh = 112, mx = VIEW_W - mw - 14, my = 12;
  g.fillStyle(0x14301a, 0.6); g.fillRect(mx, my, mw, mh);
  g.lineStyle(2, 0xffffff, 0.7); g.strokeRect(mx, my, mw, mh);
  const sx = mw / WORLD_W, sy = mh / WORLD_H;

  g.fillStyle(0x2e7d32, 0.9);
  for (const p of S.props) if (p.type === 'tree') g.fillRect(mx + p.x * sx - 1, my + p.y * sy - 1, 2, 2);
  g.fillStyle(0x9e9e9e, 0.9);
  for (const p of S.props) if (p.type === 'rock') g.fillRect(mx + p.x * sx - 1, my + p.y * sy - 1, 2, 2);
  g.fillStyle(0xfff3e0);
  for (const s of slimes) g.fillRect(mx + s.x * sx - 1.5, my + s.y * sy - 1.5, 3, 3);

  const cam = S.cameras.main;
  g.lineStyle(1, 0xffffff, 0.45);
  g.strokeRect(mx + cam.scrollX * sx, my + cam.scrollY * sy, cam.width * sx, cam.height * sy);
  g.fillStyle(0x4f46e5); g.fillCircle(mx + player.x * sx, my + player.y * sy, 3);
  g.lineStyle(1.5, 0xffffff); g.strokeCircle(mx + player.x * sx, my + player.y * sy, 3);
}

function drawTargetPlate() {
  let best = null, bd = 260;
  for (const s of slimes) {
    const d = Math.hypot(s.x - player.x, s.y - player.y);
    if (d < bd) { bd = d; best = s; }
  }
  const vis = !!best;
  plateG.setVisible(vis); plateName.setVisible(vis); plateLvl.setVisible(vis);
  if (!vis) return;

  const g = plateG;
  g.clear();
  const cx = VIEW_W / 2, w = 230, h = 34, x = cx - w / 2, y = 10;
  g.fillStyle(0x000000, 0.65); g.fillRoundedRect(x, y, w, h, 8);
  g.lineStyle(1.5, 0x8d6e63, 0.9); g.strokeRoundedRect(x, y, w, h, 8);
  g.fillStyle(0x3e2723); g.fillRoundedRect(x + 15, y + 21, w - 30, 7, 3);
  barFill(g, x + 15, y + 21, w - 30, 7, 3, Math.max(0, best.hp) / best.maxHp, 0xe53935);
}

/* ------------------------------------------------------------------ */
/* Procedural textures                                                 */
/* ------------------------------------------------------------------ */
function makeTextures(scene) {
  const g = scene.make.graphics();

  /* tree: trunk + lobed canopy (96x128, collision point = trunk base) */
  g.fillStyle(0x7a4a21); g.fillRect(42, 78, 12, 46);
  g.fillStyle(0x5d3817); g.fillRect(42, 78, 4, 46);
  const lobes = [[48, 44, 30], [26, 62, 20], [70, 62, 20], [48, 66, 24]];
  g.fillStyle(0x1b5e20); lobes.forEach(([x, y, r]) => g.fillCircle(x, y, r + 3));
  g.fillStyle(0x388e3c); lobes.forEach(([x, y, r]) => g.fillCircle(x, y, r));
  g.fillStyle(0x4caf50); lobes.forEach(([x, y, r]) => g.fillCircle(x - r * 0.25, y - r * 0.3, r * 0.62));
  g.fillStyle(0x81c784); g.fillCircle(40, 34, 8); g.fillCircle(60, 44, 5);
  g.generateTexture('tree', 96, 128); g.clear();

  /* bush */
  g.fillStyle(0x1b5e20); g.fillCircle(28, 24, 19); g.fillCircle(14, 28, 13); g.fillCircle(42, 28, 13);
  g.fillStyle(0x43a047); g.fillCircle(28, 24, 16); g.fillCircle(14, 28, 10); g.fillCircle(42, 28, 10);
  g.fillStyle(0x66bb6a); g.fillCircle(24, 20, 8); g.fillCircle(40, 25, 5);
  g.generateTexture('bush', 56, 40); g.clear();

  /* rock */
  const rock = [
    { x: 6, y: 26 }, { x: 2, y: 18 }, { x: 10, y: 6 }, { x: 24, y: 2 },
    { x: 36, y: 8 }, { x: 42, y: 20 }, { x: 34, y: 30 }, { x: 14, y: 31 },
  ];
  g.fillStyle(0x9e9e9e); g.fillPoints(rock, true);
  g.lineStyle(3, 0x616161); g.strokePoints(rock, true);
  g.fillStyle(0xcfcfcf); g.fillCircle(18, 12, 6);
  g.generateTexture('rock', 44, 34); g.clear();

  /* slime: cream blob with a face, like the Zenonia screenshot */
  g.fillStyle(0xbcaaa4); g.fillEllipse(22, 22, 40, 26);
  g.fillStyle(0xfff3e0); g.fillEllipse(22, 21, 34, 21);
  g.fillStyle(0xffffff); g.fillEllipse(15, 15, 12, 7);
  g.fillStyle(0x4e342e); g.fillCircle(16, 20, 2.4); g.fillCircle(28, 20, 2.4);
  g.lineStyle(1.6, 0x4e342e); g.beginPath(); g.arc(22, 24, 4, 0.2, Math.PI - 0.2); g.strokePath();
  g.lineStyle(2, 0x8d6e63); g.beginPath(); g.moveTo(22, 8); g.lineTo(24, 3); g.strokePath();
  g.generateTexture('slime', 44, 36); g.clear();

  /* sword (origin set to the grip when used) */
  g.fillStyle(0xcfd8dc); g.fillRect(10, 4, 24, 4);
  g.fillStyle(0x90a4ae); g.fillTriangle(34, 4, 34, 8, 40, 6);
  g.fillStyle(0xffd54f); g.fillRect(8, 2, 3, 8);
  g.fillStyle(0x6d4c41); g.fillRect(2, 4, 6, 4);
  g.generateTexture('sword', 40, 12); g.clear();

  /* soft drop shadow */
  g.fillStyle(0x000000, 0.25); g.fillEllipse(20, 8, 36, 14);
  g.generateTexture('shadow', 40, 16); g.clear();

  /* UI buttons */
  g.fillStyle(0x4e342e); g.fillCircle(22, 22, 21);
  g.fillStyle(0x8d6e63); g.fillCircle(22, 22, 18);
  g.fillStyle(0xa1887f, 0.6); g.fillCircle(18, 17, 9);
  g.generateTexture('btn', 44, 44); g.clear();
  g.fillStyle(0x8d2f23); g.fillCircle(30, 30, 29);
  g.fillStyle(0xd84335); g.fillCircle(30, 30, 25);
  g.fillStyle(0xef9a9a, 0.5); g.fillCircle(24, 23, 11);
  g.generateTexture('btnBig', 60, 60); g.clear();

  g.destroy();
}

/* The ground is painted once into a big canvas texture: grass base,
   light/dark mowed patches, a dirt path, speckles, tufts, flowers,
   pebbles and mushrooms. */
function paintGround(scene) {
  const ct = scene.textures.createCanvas('ground', WORLD_W, WORLD_H);
  const ctx = ct.context;

  ctx.fillStyle = '#9ccc50';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  for (let i = 0; i < 260; i++) {
    const x = rand() * WORLD_W, y = rand() * WORLD_H, r = between(40, 150);
    ctx.fillStyle = rand() < 0.5 ? 'rgba(178,220,116,0.35)' : 'rgba(138,184,68,0.30)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * between(0.5, 0.8), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  /* winding dirt path */
  ctx.strokeStyle = '#d9c58f'; ctx.lineWidth = 84; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-40, WORLD_H * 0.62);
  ctx.bezierCurveTo(WORLD_W * 0.3, WORLD_H * 0.55, WORLD_W * 0.45, WORLD_H * 0.30, WORLD_W * 0.72, WORLD_H * 0.34);
  ctx.bezierCurveTo(WORLD_W * 0.9, WORLD_H * 0.37, WORLD_W * 0.95, WORLD_H * 0.55, WORLD_W + 40, WORLD_H * 0.6);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(226,209,155,0.7)'; ctx.lineWidth = 52; ctx.stroke();

  for (let i = 0; i < 9000; i++) {
    const x = rand() * WORLD_W, y = rand() * WORLD_H;
    ctx.fillStyle = ['rgba(120,170,60,0.5)', 'rgba(190,230,130,0.5)', 'rgba(150,200,80,0.5)'][Math.floor(rand() * 3)];
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.strokeStyle = 'rgba(90,140,45,0.8)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 500; i++) {
    const x = rand() * WORLD_W, y = rand() * WORLD_H;
    for (let b = -1; b <= 1; b++) {
      ctx.beginPath(); ctx.moveTo(x + b * 3, y); ctx.lineTo(x + b * 4, y - 6); ctx.stroke();
    }
  }

  for (let i = 0; i < 240; i++) {
    const x = rand() * WORLD_W, y = rand() * WORLD_H;
    ctx.fillStyle = rand() < 0.7 ? '#ffffff' : '#f8bbd0';
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
  }

  for (let i = 0; i < 160; i++) {
    const x = rand() * WORLD_W, y = rand() * WORLD_H;
    ctx.fillStyle = 'rgba(160,160,160,0.8)';
    ctx.beginPath(); ctx.ellipse(x, y, between(2, 4), between(1.5, 3), 0, 0, Math.PI * 2); ctx.fill();
  }

  for (let i = 0; i < 70; i++) {
    const x = rand() * WORLD_W, y = rand() * WORLD_H;
    ctx.fillStyle = '#efebe9'; ctx.fillRect(x - 1.5, y - 2, 3, 5);
    ctx.fillStyle = rand() < 0.6 ? '#e53935' : '#8d6e63';
    ctx.beginPath(); ctx.arc(x, y - 2, 4.5, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(x - 1.5, y - 4, 1, 0, Math.PI * 2);
    ctx.arc(x + 1.5, y - 3.5, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  ct.refresh();
}
