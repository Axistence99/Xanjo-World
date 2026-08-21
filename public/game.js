/**
 * Xanjo-World — Stage 1
 * A circle-shaped character, moved with W A S D, on a blank canvas.
 * Engine: Phaser 3 (bundled locally).
 */

const W = 960;
const H = 600;
const RADIUS = 24;
const SPEED = 260; // pixels per second

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  width: W,
  height: H,
  backgroundColor: '#ffffff', // blank canvas
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: { create, update },
});

function create() {
  // --- the character: a circle with a pair of eyes ---
  const player = this.add.container(W / 2, H / 2);
  const body = this.add.circle(0, 0, RADIUS, 0x4f46e5).setStrokeStyle(4, 0x3730a3);
  const eyeL = this.add.circle(-8, -5, 4, 0xffffff);
  const eyeR = this.add.circle(8, -5, 4, 0xffffff);
  const pupilL = this.add.circle(-8, -5, 2, 0x111827);
  const pupilR = this.add.circle(8, -5, 2, 0x111827);
  player.add([body, eyeL, eyeR, pupilL, pupilR]);
  this.player = player;

  // --- input: W A S D (arrow keys also work) ---
  this.keys = this.input.keyboard.addKeys({
    up: Phaser.Input.Keyboard.KeyCodes.W,
    down: Phaser.Input.Keyboard.KeyCodes.S,
    left: Phaser.Input.Keyboard.KeyCodes.A,
    right: Phaser.Input.Keyboard.KeyCodes.D,
  });
  this.cursors = this.input.keyboard.createCursorKeys();
}

function update(time, delta) {
  const k = this.keys;
  const c = this.cursors;

  const dx = (k.right.isDown || c.right.isDown ? 1 : 0) -
             (k.left.isDown || c.left.isDown ? 1 : 0);
  const dy = (k.down.isDown || c.down.isDown ? 1 : 0) -
             (k.up.isDown || c.up.isDown ? 1 : 0);

  if (!dx && !dy) return;

  const len = Math.hypot(dx, dy);           // normalize diagonal movement
  const dt = Math.min(delta, 50) / 1000;    // cap big frame gaps

  this.player.x = Phaser.Math.Clamp(this.player.x + (dx / len) * SPEED * dt, RADIUS, W - RADIUS);
  this.player.y = Phaser.Math.Clamp(this.player.y + (dy / len) * SPEED * dt, RADIUS, H - RADIUS);
}
