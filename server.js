/**
 * ============================================================================
 *  Xanjo-World — authoritative game server
 *  ----------------------------------------------------------------------------
 *  Stack: Node.js + ws (WebSockets). No engine, no database (JSON persistence).
 *
 *  Responsibilities:
 *    - Serve the Phaser client from ./public over HTTP
 *    - Accept WebSocket connections at /ws
 *    - Run a FIXED 20 Hz simulation tick (the "source of truth")
 *    - Validate all player input (anti-cheat: clients only send INTENTS)
 *    - Simulate monsters (aggro / chase / attack)
 *    - Area-of-interest: each client only receives nearby entities
 *    - Persist level/xp/kills to players.json
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

/* ------------------------------ Config ---------------------------------- */
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';                       // must bind all interfaces for the live preview
const TICK_MS = 50;                           // 20 ticks / second
const WORLD_W = 2200;
const WORLD_H = 2200;
const PLAYER_SPEED = 170;                     // px per second
const PLAYER_R = 12;                          // collision radius
const AOI_RADIUS = 750;                       // area-of-interest radius
const SPAWN = { x: 460, y: 460 };
const PLAYER_ATK_COOLDOWN = 500;              // ms between player attacks
const PLAYER_ATK_RANGE = 90;
const DEATH_RESPAWN_MS = 2500;

/* --------------------------- Persistence (JSON) -------------------------- */
const DB_FILE = path.join(__dirname, 'players.json');
let accounts = {};                            // name -> { level, xp, kills, lastSeen }

function loadDb() {
  try { accounts = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { accounts = {}; }
}
function saveDb() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(accounts, null, 2)); }
  catch (e) { console.error('saveDb failed:', e.message); }
}

/* ----------------------- Deterministic world layout ---------------------- */
// A seeded RNG keeps the obstacle layout identical every boot.
let seed = 1337;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

const obstacles = [];                          // { x, y, r, type }
for (let i = 0; i < 90; i++) {
  const x = 60 + rnd() * (WORLD_W - 120);
  const y = 60 + rnd() * (WORLD_H - 120);
  const r = 14 + rnd() * 14;                   // collision radius
  const type = rnd() < 0.6 ? 'tree' : 'rock';
  if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 170) continue; // keep spawn clear
  obstacles.push({ x, y, r, type });
}

/* ------------------------------ Monster kinds ---------------------------- */
const MONSTER_KINDS = {
  slime: { hp: 60, dmg: [5, 10], speed: 95,  aggroRange: 260, atkRange: 46, cooldown: 900,  xp: 25 },
  bat:   { hp: 40, dmg: [4, 8],  speed: 150, aggroRange: 300, atkRange: 40, cooldown: 700,  xp: 30 },
};

let nextId = 1;
const monsters = [];
for (let i = 0; i < 20; i++) {
  const kind = rnd() < 0.6 ? 'slime' : 'bat';
  const m = MONSTER_KINDS[kind];
  const x = 100 + rnd() * (WORLD_W - 200);
  const y = 100 + rnd() * (WORLD_H - 200);
  if (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 220) continue;
  monsters.push({
    id: 'm' + nextId++, kind,
    spawnX: x, spawnY: y, x, y,
    hp: m.hp, maxHp: m.hp,
    targetId: null, cooldown: 0, respawnAt: 0, dir: 1,
  });
}

/* ------------------------------- Players --------------------------------- */
const players = new Map();                     // id -> player object

function newPlayer(id, name) {
  const acc = accounts[name] || { level: 1, xp: 0, kills: 0 };
  accounts[name] = acc;
  return {
    id, name,
    x: SPAWN.x + (rnd() * 40 - 20), y: SPAWN.y + (rnd() * 40 - 20),
    dir: 1,
    hp: 100, maxHp: 100,
    level: acc.level, xp: acc.xp, kills: acc.kills,
    input: { dx: 0, dy: 0 },                  // latest INTENT from the client
    lastAtk: 0, deadAt: 0,
    color: randomColor(name),
  };
}

function randomColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

/* ---------------------------- Small helpers ------------------------------ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function moveEntity(e, dx, dy, speed, dt) {
  const len = Math.hypot(dx, dy) || 1;
  const nx = e.x + (dx / len) * speed * dt;
  const ny = e.y + (dy / len) * speed * dt;
  e.x = clamp(nx, PLAYER_R + 4, WORLD_W - PLAYER_R - 4);
  e.y = clamp(ny, PLAYER_R + 4, WORLD_H - PLAYER_R - 4);
  // slide along obstacles (circle vs circle)
  for (const o of obstacles) {
    const d = Math.hypot(e.x - o.x, e.y - o.y);
    const min = o.r + PLAYER_R;
    if (d < min) {
      const ang = Math.atan2(e.y - o.y, e.x - o.x);
      e.x = o.x + Math.cos(ang) * min;
      e.y = o.y + Math.sin(ang) * min;
    }
  }
}

function gainXp(p, amount) {
  p.xp += amount;
  const need = p.level * 100;
  if (p.xp >= need) {
    p.xp -= need;
    p.level += 1;
    p.hp = p.maxHp = 100;                       // heal on level up
    broadcastFx(p.x, p.y, 'levelup', { name: p.name, level: p.level });
    broadcastSystem(`✨ ${p.name} reached level ${p.level}!`);
  }
  accounts[p.name] = { level: p.level, xp: p.xp, kills: p.kills, lastSeen: Date.now() };
}

/* ----------------------------- FX broadcast ------------------------------ */
function broadcastFx(x, y, kind, data = {}) {
  const msg = JSON.stringify({ t: 'fx', kind, x, y, ...data });
  for (const p of players.values()) {
    if (Math.hypot(p.x - x, p.y - y) <= AOI_RADIUS) p.socket.send(msg);
  }
}
function broadcastSystem(text) {
  broadcastChat({ name: '', msg: text, system: true });
}
function broadcastChat({ name, msg, system = false }) {
  const m = JSON.stringify({ t: 'chat', name, msg, system });
  for (const p of players.values()) p.socket.send(m);
}

/* --------------------------- Combat (server-side) ------------------------ */
function playerAttack(attacker, targetId) {
  const now = Date.now();
  if (now - attacker.lastAtk < PLAYER_ATK_COOLDOWN) return;
  const m = monsters.find(x => x.id === targetId && x.respawnAt <= now);
  if (!m) return;
  if (Math.hypot(m.x - attacker.x, m.y - attacker.y) > PLAYER_ATK_RANGE + 10) return;

  attacker.lastAtk = now;
  attacker.dir = m.x >= attacker.x ? 1 : -1;
  const dmg = 12 + Math.floor(rnd() * 7);
  m.hp -= dmg;
  m.targetId = attacker.id;                     // hitting it makes it mad
  broadcastFx(m.x, m.y - 20, 'hit', { dmg, targetId: m.id });

  if (m.hp <= 0) {
    m.respawnAt = now + 6000;
    m.hp = 0;
    broadcastFx(m.x, m.y, 'death', { targetId: m.id, kind: m.kind });
    attacker.kills += 1;
    gainXp(attacker, MONSTER_KINDS[m.kind].xp);
    // respawn at full hp later
    setTimeout(() => {
      m.hp = m.maxHp;
      m.respawnAt = 0;
      m.x = m.spawnX; m.y = m.spawnY;
      m.targetId = null;
    }, 6000);
  }
}

function monsterAttackMonster(m) {
  const kind = MONSTER_KINDS[m.kind];
  const target = players.get(m.targetId);
  if (!target || target.deadAt) { m.targetId = null; return; }
  const now = Date.now();
  const dist = Math.hypot(target.x - m.x, target.y - m.y);

  if (dist > kind.aggroRange) { m.targetId = null; return; }

  if (dist > kind.atkRange) {
    // chase
    moveEntity(m, target.x - m.x, target.y - m.y, kind.speed, TICK_MS / 1000);
    m.dir = target.x >= m.x ? 1 : -1;
  } else if (now - m.cooldown >= kind.cooldown) {
    // bite
    m.cooldown = now;
    const dmg = kind.dmg[0] + Math.floor(rnd() * (kind.dmg[1] - kind.dmg[0] + 1));
    target.hp -= dmg;
    m.dir = target.x >= m.x ? 1 : -1;
    broadcastFx(target.x, target.y - 20, 'hit', { dmg, targetId: target.id, onPlayer: true });
    if (target.hp <= 0) {
      target.hp = 0;
      target.deadAt = now;
      target.socket.send(JSON.stringify({ t: 'youDied' }));
      broadcastFx(target.x, target.y, 'death', { targetId: target.id, isPlayer: true });
      broadcastSystem(`💀 ${target.name} was slain by a ${m.kind}.`);
      setTimeout(() => {
        target.hp = target.maxHp = 100;
        target.x = SPAWN.x; target.y = SPAWN.y;
        target.deadAt = 0;
        target.socket.send(JSON.stringify({ t: 'respawned', x: target.x, y: target.y }));
      }, DEATH_RESPAWN_MS);
    }
  }
}

function findMonsterTarget(m) {
  const kind = MONSTER_KINDS[m.kind];
  let best = null, bestD = Infinity;
  for (const p of players.values()) {
    if (p.deadAt) continue;
    const d = Math.hypot(p.x - m.x, p.y - m.y);
    if (d < kind.aggroRange && d < bestD) { best = p; bestD = d; }
  }
  m.targetId = best ? best.id : null;
}

/* ---------------------------- Simulation tick ---------------------------- */
function tick() {
  const dt = TICK_MS / 1000;
  const now = Date.now();

  // 1) move players according to their latest intent
  for (const p of players.values()) {
    if (p.deadAt) continue;
    const { dx, dy } = p.input;
    if (dx || dy) {
      moveEntity(p, dx, dy, PLAYER_SPEED, dt);
      p.dir = dx !== 0 ? Math.sign(dx) : p.dir;
    }
  }

  // 2) monster AI
  for (const m of monsters) {
    if (m.respawnAt > now) continue;
    if (m.targetId && !players.get(m.targetId)) m.targetId = null;
    if (!m.targetId) findMonsterTarget(m);
    if (m.targetId) monsterAttackMonster(m);
  }

  // 3) personalized snapshot (area-of-interest) for every client
  for (const p of players.values()) {
    const snap = {
      t: 'state', tick: now,
      online: players.size,
      players: [], monsters: [],
    };
    for (const o of players.values()) {
      if (o.deadAt) continue;
      if (Math.hypot(o.x - p.x, o.y - p.y) > AOI_RADIUS) continue;
      snap.players.push({
        id: o.id, name: o.name, x: Math.round(o.x), y: Math.round(o.y),
        hp: Math.max(0, o.hp), maxHp: o.maxHp, level: o.level,
        xp: o.xp, kills: o.kills,
        dir: o.dir, color: o.color,
      });
    }
    for (const m of monsters) {
      if (m.respawnAt > now) continue;
      if (Math.hypot(m.x - p.x, m.y - p.y) > AOI_RADIUS) continue;
      snap.monsters.push({
        id: m.id, kind: m.kind, x: Math.round(m.x), y: Math.round(m.y),
        hp: m.hp, maxHp: m.maxHp, dir: m.dir, aggro: !!m.targetId,
      });
    }
    p.socket.send(JSON.stringify(snap));
  }
}

/* ------------------------------ HTTP server ------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, 'public', path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

/* ---------------------------- WebSocket layer ---------------------------- */
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => (socket.isAlive = true));

  let player = null;

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'join' && !player) {
      const name = String(msg.name || '').trim().slice(0, 16);
      if (name.length < 2) { socket.send(JSON.stringify({ t: 'rejected', reason: 'Name too short' })); return; }
      player = newPlayer('p' + nextId++, name);
      player.socket = socket;
      players.set(player.id, player);

      socket.send(JSON.stringify({
        t: 'welcome',
        id: player.id, name, x: player.x, y: player.y,
        level: player.level, xp: player.xp, hp: player.hp, maxHp: player.maxHp, kills: player.kills,
        world: { w: WORLD_W, h: WORLD_H },
        obstacles, spawn: { x: SPAWN.x, y: SPAWN.y },
        tick: TICK_MS,
      }));
      broadcastSystem(`👋 ${name} joined the world.`);
      console.log(`[+] ${name} (${player.id}) — ${players.size} online`);
      return;
    }

    if (!player) return;

    switch (msg.t) {
      case 'input':                             // client sends INTENT, not position
        if (player.deadAt) break;
        player.input = {
          dx: clamp(Number(msg.dir[0]) || 0, -1, 1),
          dy: clamp(Number(msg.dir[1]) || 0, -1, 1),
        };
        break;
      case 'attack':
        if (!player.deadAt) playerAttack(player, msg.targetId);
        break;
      case 'chat': {
        const text = String(msg.msg || '').trim().slice(0, 200);
        if (text) broadcastChat({ name: player.name, msg: text });
        break;
      }
    }
  });

  socket.on('close', () => {
    if (player) {
      players.delete(player.id);
      saveDb();
      broadcastSystem(`👋 ${player.name} left.`);
      console.log(`[-] ${player.name} — ${players.size} online`);
    }
  });
  socket.on('error', () => {});
});

// heartbeat to reap dead connections
setInterval(() => {
  wss.clients.forEach((s) => {
    if (!s.isAlive) return s.terminate();
    s.isAlive = false;
    s.ping();
  });
}, 30000);

/* -------------------------------- Boot ----------------------------------- */
loadDb();
setInterval(tick, TICK_MS);
setInterval(saveDb, 15000);

server.listen(PORT, HOST, () => {
  console.log(`🎮 Xanjo-World server listening on http://${HOST}:${PORT}`);
  console.log(`   world ${WORLD_W}x${WORLD_H}, ${monsters.length} monsters, ${obstacles.length} obstacles`);
});
