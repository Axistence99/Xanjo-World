/**
 * ============================================================================
 *  Xanjo-World — Phaser 3 client
 *  ----------------------------------------------------------------------------
 *  - Renders the world with procedural pixel-art textures (no image assets)
 *  - Sends INPUT INTENTS to the server (never claims its own position)
 *  - Client-side prediction: you move instantly, server gently corrects drift
 *  - Entity interpolation: other players & monsters glide smoothly between ticks
 * ============================================================================
 */

/* ----------------------------- Global state ------------------------------ */
const NET = { ws: null, myId: null, myName: null, welcomeReceived: false };

const GS = {
  world: { w: 2200, h: 2200 },
  obstacles: [],
  self: null,                    // { sprite, targetX, targetY, hp, maxHp, level, xp, kills, nameTxt }
  players: new Map(),            // remote players  id -> entity
  monsters: new Map(),           // id -> entity
  dead: false,
  lastAtk: 0,
  seq: 0,
  inputTimer: 0,
  keys: { up: false, down: false, left: false, right: false },
  seenPlayers: new Set(),
  seenMonsters: new Set(),
  hudTimer: 0,
};

let scene = null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const NAME_STYLE = {
  fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', color: '#ffffff',
  stroke: '#000000', strokeThickness: 3,
};

/* ------------------------------ Phaser boot ------------------------------ */
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 960, height: 600,
  backgroundColor: '#2a3d2a',
  render: { pixelArt: true, roundPixels: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: { create, update },
});

/* --------------------------- Procedural textures ------------------------- */
function makeTextures() {
  const g = scene.add.graphics();

  // grass tile (64x64)
  g.fillStyle(0x4f7f3c, 1); g.fillRect(0, 0, 64, 64);
  const greens = [0x4f7f3c, 0x578a41, 0x5f9746, 0x477335];
  for (let i = 0; i < 46; i++) { g.fillStyle(greens[i % 4], 1); g.fillRect((i * 13) % 64, (i * 29) % 64, 2, 2); }
  g.generateTexture('grass', 64, 64);

  // player (white so we can tint per-name)
  g.clear();
  g.fillStyle(0x000000, 0.22); g.fillEllipse(20, 35, 24, 8);            // shadow
  g.fillStyle(0xf4f6f8, 1);  g.fillRoundedRect(11, 20, 18, 15, 6);      // body
  g.fillStyle(0xf4f6f8, 1);  g.fillRect(11, 20, 3, 8); g.fillRect(26, 20, 3, 8); // arms
  g.fillStyle(0xffffff, 1);  g.fillCircle(20, 10, 9);                   // hair
  g.fillStyle(0xffd9b0, 1);  g.fillCircle(20, 15, 7);                   // face
  g.fillStyle(0x20242c, 1);  g.fillCircle(17, 14, 2); g.fillCircle(23, 14, 2);   // eyes
  g.generateTexture('player', 40, 40);

  // slime
  g.clear();
  g.fillStyle(0x000000, 0.22); g.fillEllipse(20, 35, 22, 7);
  g.fillStyle(0x79c64f, 1);    g.fillRoundedRect(7, 20, 26, 14, { tl: 6, tr: 6, bl: 8, br: 8 });
  g.fillStyle(0x79c64f, 1);    g.fillCircle(20, 18, 13);
  g.fillStyle(0x8fdc66, 1);    g.fillCircle(20, 16, 11);
  g.fillStyle(0xffffff, 1);    g.fillCircle(15, 16, 4); g.fillCircle(25, 16, 4);
  g.fillStyle(0x1c2318, 1);    g.fillCircle(16, 16, 2); g.fillCircle(26, 16, 2);
  g.fillStyle(0x1c2318, 1);    g.fillRect(18, 22, 5, 2);
  g.generateTexture('slime', 40, 40);

  // bat
  g.clear();
  g.fillStyle(0x000000, 0.22); g.fillEllipse(20, 35, 20, 7);
  g.fillStyle(0x9a6cdb, 1);    g.fillCircle(20, 20, 11);
  g.fillStyle(0x9a6cdb, 1);    g.fillTriangle(10, 12, 2, 4, 12, 20);
  g.fillStyle(0x9a6cdb, 1);    g.fillTriangle(30, 12, 38, 4, 28, 20);
  g.fillStyle(0xffffff, 1);    g.fillCircle(16, 18, 4); g.fillCircle(24, 18, 4);
  g.fillStyle(0x1c2318, 1);    g.fillCircle(17, 18, 2); g.fillCircle(25, 18, 2);
  g.fillStyle(0xffffff, 1);    g.fillTriangle(19, 24, 21, 24, 20, 27);
  g.generateTexture('bat', 40, 40);

  // tree (64x64)
  g.clear();
  g.fillStyle(0x000000, 0.20); g.fillEllipse(32, 58, 26, 9);
  g.fillStyle(0x7a5230, 1);    g.fillRect(28, 34, 8, 22);
  g.fillStyle(0x2e7d32, 1);    g.fillCircle(32, 24, 20);
  g.fillStyle(0x3b9440, 1);    g.fillCircle(23, 30, 12); g.fillCircle(41, 30, 12); g.fillCircle(32, 16, 12);
  g.generateTexture('tree', 64, 64);

  // rock (48x48)
  g.clear();
  g.fillStyle(0x000000, 0.18); g.fillEllipse(24, 44, 26, 7);
  g.fillStyle(0x8d97a6, 1);    g.fillEllipse(24, 30, 30, 24);
  g.fillStyle(0xa9b4c4, 1);    g.fillEllipse(18, 26, 14, 10);
  g.generateTexture('rock', 48, 48);

  // flower (10x10)
  g.clear();
  g.fillStyle(0xffffff, 1); g.fillCircle(5, 5, 2);
  g.fillStyle(0xffd75e, 1); g.fillCircle(5, 5, 1);
  g.generateTexture('flower', 10, 10);

  g.destroy();
}

/* ------------------------------- Scene create ---------------------------- */
function create() {
  scene = this;
  makeTextures();

  // ground
  scene.add.tileSprite(0, 0, GS.world.w, GS.world.h, 'grass').setOrigin(0).setDepth(-10);
  for (let i = 0; i < 70; i++) {                       // flowers (visual only)
    scene.add.image(Math.random() * GS.world.w, Math.random() * GS.world.h, 'flower').setDepth(1);
  }

  // input
  scene.input.on('pointerdown', (p) => {
    if (!GS.self || GS.dead) return;
    let best = null, bestD = 40;
    for (const [id, m] of GS.monsters) {
      const d = Math.hypot(m.sprite.x - p.worldX, m.sprite.y - p.worldY);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (best) attack(best);
  });

  setupKeyboard();
  setupLogin();
}

/* ------------------------------- Scene update ---------------------------- */
function update(time, delta) {
  const dt = Math.min(delta, 50) / 1000;

  // 1) local movement (client prediction) + server reconciliation
  if (GS.self && !GS.dead) {
    const dx = (GS.keys.right ? 1 : 0) - (GS.keys.left ? 1 : 0);
    const dy = (GS.keys.down ? 1 : 0) - (GS.keys.up ? 1 : 0);
    if (dx || dy) localMove(dx, dy, dt);

    const s = GS.self;
    s.sprite.x += (s.targetX - s.sprite.x) * Math.min(1, dt * 5);   // gentle pull to authority
    s.sprite.y += (s.targetY - s.sprite.y) * Math.min(1, dt * 5);
    s.sprite.depth = s.sprite.y;
    s.nameTxt.setPosition(s.sprite.x, s.sprite.y - 30);
  }

  // 2) send intent at 20 Hz
  GS.inputTimer += delta;
  if (GS.inputTimer >= 50) { GS.inputTimer = 0; sendInput(); }

  // 3) interpolate remote entities
  for (const e of GS.players.values()) lerpEntity(e, dt);
  for (const m of GS.monsters.values()) { lerpEntity(m, dt); updateMonsterVisual(m); }

  // 4) HUD (throttled)
  GS.hudTimer += delta;
  if (GS.hudTimer >= 100) { GS.hudTimer = 0; updateHUD(); }
}

/* ------------------------------ Local movement --------------------------- */
function localMove(dx, dy, dt) {
  const s = GS.self, speed = 170;
  const len = Math.hypot(dx, dy) || 1;
  let nx = s.sprite.x + (dx / len) * speed * dt;
  let ny = s.sprite.y + (dy / len) * speed * dt;
  nx = clamp(nx, 16, GS.world.w - 16);
  ny = clamp(ny, 16, GS.world.h - 16);
  for (const o of GS.obstacles) {
    const d = Math.hypot(nx - o.x, ny - o.y), min = o.r + 12;
    if (d < min) { const a = Math.atan2(ny - o.y, nx - o.x); nx = o.x + Math.cos(a) * min; ny = o.y + Math.sin(a) * min; }
  }
  s.sprite.x = nx; s.sprite.y = ny;
  if (dx !== 0) s.sprite.setFlipX(dx < 0);
}

function sendInput() {
  if (!NET.ws || NET.ws.readyState !== 1) return;
  const dx = (GS.keys.right ? 1 : 0) - (GS.keys.left ? 1 : 0);
  const dy = (GS.keys.down ? 1 : 0) - (GS.keys.up ? 1 : 0);
  GS.seq++;
  NET.ws.send(JSON.stringify({ t: 'input', seq: GS.seq, dir: [dx, dy] }));
}

/* ------------------------------ Entity helpers --------------------------- */
function lerpEntity(e, dt) {
  e.sprite.x += (e.targetX - e.sprite.x) * Math.min(1, dt * 9);
  e.sprite.y += (e.targetY - e.sprite.y) * Math.min(1, dt * 9);
  e.sprite.depth = e.sprite.y;
  e.nameTxt && e.nameTxt.setPosition(e.sprite.x, e.sprite.y - 30);
  if (e.barBg) {
    e.barBg.setPosition(e.sprite.x, e.sprite.y - 24);
    e.barFill.setPosition(e.sprite.x - 16, e.sprite.y - 24);
  }
}

function upsertPlayer(d) {
  let e = GS.players.get(d.id);
  if (!e) {
    const sprite = scene.add.sprite(d.x, d.y, 'player').setDepth(d.y);
    sprite.setTint(nameTint(d.name));
    const nameTxt = scene.add.text(d.x, d.y - 30, '', NAME_STYLE).setOrigin(0.5).setDepth(9998);
    const barBg = scene.add.rectangle(d.x, d.y - 24, 32, 4, 0x101318).setOrigin(0.5).setDepth(9998);
    const barFill = scene.add.rectangle(d.x - 16, d.y - 24, 32, 4, 0x4dd964).setOrigin(0, 0.5).setDepth(9998);
    e = { id: d.id, sprite, nameTxt, barBg, barFill, targetX: d.x, targetY: d.y, data: d };
    GS.players.set(d.id, e);
  }
  e.targetX = d.x; e.targetY = d.y; e.data = d;
  e.nameTxt.setText(`${d.name} · Lv${d.level}`);
  e.barFill.width = 32 * (d.hp / d.maxHp);
  if (d.dir !== 0) e.sprite.setFlipX(d.dir < 0);
}

function upsertMonster(d) {
  let m = GS.monsters.get(d.id);
  if (!m) {
    const sprite = scene.add.sprite(d.x, d.y, d.kind).setDepth(d.y);
    const barBg = scene.add.rectangle(d.x, d.y - 26, 30, 4, 0x101318).setOrigin(0.5).setDepth(9998);
    const barFill = scene.add.rectangle(d.x - 15, d.y - 26, 30, 4, 0xe64545).setOrigin(0, 0.5).setDepth(9998);
    m = { id: d.id, sprite, barBg, barFill, targetX: d.x, targetY: d.y, data: d };
    GS.monsters.set(d.id, m);
  }
  m.targetX = d.x; m.targetY = d.y; m.data = d;
  m.barFill.width = 30 * (d.hp / d.maxHp);
}

function updateMonsterVisual(m) {
  if (m.data.dir !== 0) m.sprite.setFlipX(m.data.dir < 0);
  m.sprite.setTint(m.data.aggro ? 0xff8a8a : 0xffffff);
}

function destroyEntity(e) {
  e.sprite.destroy();
  e.nameTxt && e.nameTxt.destroy();
  e.barBg && e.barBg.destroy();
  e.barFill && e.barFill.destroy();
}

function nameHue(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function nameTint(name) { return Phaser.Display.Color.HSLToColor(nameHue(name) / 360, 0.7, 0.55).color; }

/* ------------------------------- Networking ------------------------------ */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  NET.ws = new WebSocket(`${proto}://${location.host}/ws`);
  NET.ws.onopen = () => NET.ws.send(JSON.stringify({ t: 'join', name: NET.myName }));
  NET.ws.onmessage = (e) => handle(JSON.parse(e.data));
  NET.ws.onclose = () => {
    if (NET.welcomeReceived) showLogin('Connection lost. Click to reconnect.');
    else showLogin('Could not reach the game server.');
  };
  NET.ws.onerror = () => {};
}

function handle(msg) {
  switch (msg.t) {
    case 'welcome': onWelcome(msg); break;
    case 'state': onState(msg); break;
    case 'chat': appendChat(msg.name, msg.msg, msg.system); break;
    case 'fx': onFx(msg); break;
    case 'youDied': onDeath(); break;
    case 'respawned': onRespawn(msg); break;
    case 'rejected': showLogin(msg.reason || 'Rejected by server.'); break;
  }
}

function onWelcome(m) {
  NET.welcomeReceived = true;
  NET.myId = m.id;
  GS.world = m.world;
  GS.obstacles = m.obstacles;

  GS.self = {
    sprite: scene.add.sprite(m.x, m.y, 'player').setDepth(m.y),
    targetX: m.x, targetY: m.y,
    hp: m.hp, maxHp: m.maxHp, level: m.level, xp: m.xp, kills: m.kills,
    nameTxt: scene.add.text(m.x, m.y - 30, m.name, NAME_STYLE).setOrigin(0.5).setDepth(9998),
  };
  GS.self.sprite.setTint(nameTint(m.name));

  scene.cameras.main.setBounds(0, 0, m.world.w, m.world.h);
  scene.cameras.main.startFollow(GS.self.sprite, true, 0.12, 0.12);

  for (const o of GS.obstacles) {
    scene.add.image(o.x, o.y, o.type === 'tree' ? 'tree' : 'rock').setDepth(o.y);
  }

  document.getElementById('login').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  document.getElementById('hudName').textContent = m.name;
  appendChat('', `Welcome, ${m.name}! WASD to move · SPACE or click a monster to attack.`, true);
  updateHUD();
}

function onState(m) {
  document.getElementById('onlineCount').textContent = m.online;
  GS.seenPlayers.clear(); GS.seenMonsters.clear();

  for (const d of m.players) {
    GS.seenPlayers.add(d.id);
    if (d.id === NET.myId) {
      GS.self.targetX = d.x; GS.self.targetY = d.y;
      GS.self.hp = d.hp; GS.self.maxHp = d.maxHp; GS.self.level = d.level;
      if (d.xp != null) { GS.self.xp = d.xp; GS.self.kills = d.kills; }
      if (d.dir !== 0) GS.self.sprite.setFlipX(d.dir < 0);
    } else {
      upsertPlayer(d);
    }
  }
  for (const d of m.monsters) { GS.seenMonsters.add(d.id); upsertMonster(d); }

  for (const [id, e] of GS.players) if (!GS.seenPlayers.has(id)) { destroyEntity(e); GS.players.delete(id); }
  for (const [id, e] of GS.monsters) if (!GS.seenMonsters.has(id)) { destroyEntity(e); GS.monsters.delete(id); }
}

/* ---------------------------------- FX ----------------------------------- */
function onFx(m) {
  if (m.kind === 'hit') {
    floatText(m.x, m.y - 10, `-${m.dmg}`, m.onPlayer ? '#ff5b5b' : '#ffe27a');
  } else if (m.kind === 'death') {
    puff(m.x, m.y, m.isPlayer ? 0x8fb6ff : (m.kind === 'bat' ? 0x9a6cdb : 0x6cc24a));
  } else if (m.kind === 'levelup') {
    floatText(m.x, m.y - 30, 'LEVEL UP!', '#7ee0a3');
  }
}

function floatText(x, y, str, color) {
  const t = scene.add.text(x, y, str, {
    fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', fontStyle: 'bold',
    color, stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5).setDepth(10000);
  scene.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
}

function puff(x, y, color) {
  for (let i = 0; i < 8; i++) {
    const c = scene.add.circle(x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 10, 3, color);
    scene.tweens.add({ targets: c, x: c.x + (Math.random() - 0.5) * 40, y: c.y - Math.random() * 26 - 6, alpha: 0, scale: 1.6, duration: 500, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
  }
}

/* ------------------------------ Combat input ----------------------------- */
function tryAttackNearest() {
  if (!GS.self || GS.dead || !NET.ws || NET.ws.readyState !== 1) return;
  if (Date.now() - GS.lastAtk < 500) return;
  let best = null, bestD = 90;
  for (const [id, m] of GS.monsters) {
    const d = Math.hypot(m.sprite.x - GS.self.sprite.x, m.sprite.y - GS.self.sprite.y);
    if (d < bestD) { bestD = d; best = id; }
  }
  if (best) attack(best);
}

function attack(id) {
  GS.lastAtk = Date.now();
  NET.ws.send(JSON.stringify({ t: 'attack', targetId: id }));
}

/* ------------------------------ Death / respawn -------------------------- */
function onDeath() {
  GS.dead = true;
  GS.self.sprite.setTint(0x55606e).setAlpha(0.6);
  document.getElementById('death').style.display = 'flex';
}
function onRespawn(m) {
  GS.dead = false;
  GS.self.sprite.setPosition(m.x, m.y).setTint(nameTint(NET.myName)).setAlpha(1);
  GS.self.targetX = m.x; GS.self.targetY = m.y;
  document.getElementById('death').style.display = 'none';
}

/* ---------------------------------- HUD ---------------------------------- */
function updateHUD() {
  if (!GS.self) return;
  const s = GS.self;
  document.getElementById('hpFill').style.width = `${(s.hp / s.maxHp) * 100}%`;
  document.getElementById('xpFill').style.width = `${(s.xp / (s.level * 100)) * 100}%`;
  document.getElementById('hpText').textContent = `${Math.max(0, s.hp)}/${s.maxHp}`;
  document.getElementById('xpText').textContent = `${s.xp}/${s.level * 100}`;
  document.getElementById('killText').textContent = s.kills;
  document.getElementById('hudLvl').textContent = `Lv ${s.level}`;
}

/* ---------------------------------- Chat --------------------------------- */
function appendChat(name, msg, system) {
  const log = document.getElementById('chatLog');
  const div = document.createElement('div');
  if (system) { div.className = 'sys'; div.textContent = msg; }
  else { div.className = name === NET.myName ? 'me' : 'who'; div.textContent = `${name}: ${msg}`; }
  log.appendChild(div);
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function setupLogin() {
  const nameInput = document.getElementById('nameInput');
  const playBtn = document.getElementById('playBtn');
  const start = () => {
    const name = nameInput.value.trim();
    if (name.length < 2) { document.getElementById('loginErr').textContent = 'Name must be at least 2 characters.'; return; }
    document.getElementById('loginErr').textContent = 'Connecting…';
    NET.myName = name;
    connect();
  };
  playBtn.onclick = start;
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = e.target.value.trim();
    if (v && NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify({ t: 'chat', msg: v }));
    e.target.value = '';
  });
}

function showLogin(err) {
  NET.welcomeReceived = false;
  document.getElementById('login').style.display = 'flex';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('loginErr').textContent = err || '';
  if (NET.ws) { try { NET.ws.close(); } catch {} NET.ws = null; }
}

/* -------------------------------- Keyboard ------------------------------- */
function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    switch (e.key.toLowerCase()) {
      case 'w': case 'arrowup': GS.keys.up = true; e.preventDefault(); break;
      case 's': case 'arrowdown': GS.keys.down = true; e.preventDefault(); break;
      case 'a': case 'arrowleft': GS.keys.left = true; e.preventDefault(); break;
      case 'd': case 'arrowright': GS.keys.right = true; e.preventDefault(); break;
      case ' ': tryAttackNearest(); e.preventDefault(); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
      case 'w': case 'arrowup': GS.keys.up = false; break;
      case 's': case 'arrowdown': GS.keys.down = false; break;
      case 'a': case 'arrowleft': GS.keys.left = false; break;
      case 'd': case 'arrowright': GS.keys.right = false; break;
    }
  });
}
