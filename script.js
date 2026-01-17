// Simple Pong implementation with synthesized sound effects
// Player controls left paddle with mouse and Arrow Up/Down
// Right paddle is a simple AI

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// Paddles
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 100;
const PADDING = 12;

const player = {
  x: PADDING,
  y: (HEIGHT - PADDLE_HEIGHT) / 2,
  width: PADDLE_WIDTH,
  height: PADDLE_HEIGHT,
  dy: 0,
  speed: 6
};

const cpu = {
  x: WIDTH - PADDING - PADDLE_WIDTH,
  y: (HEIGHT - PADDLE_HEIGHT) / 2,
  width: PADDLE_WIDTH,
  height: PADDLE_HEIGHT,
  speed: 5
};

// Ball
const ball = {
  x: WIDTH / 2,
  y: HEIGHT / 2,
  r: 8,
  speed: 6,
  vx: 0,
  vy: 0
};

let score = { player: 0, cpu: 0 };
let lastTime = 0;
let paused = false;
let mouseActive = false;
let keyState = { ArrowUp: false, ArrowDown: false };

const MAX_BOUNCE_ANGLE = (5 * Math.PI) / 12; // ~75 degrees

// --- WebAudio-based sounds (synthesized) ---
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let audioUnlocked = false;

function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
}

function unlockAudio() {
  if (audioUnlocked) return;
  ensureAudio();
  if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
    audioCtx.resume();
  }
  audioUnlocked = true;
  window.removeEventListener('mousedown', unlockAudio);
  window.removeEventListener('touchstart', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
}

// Add listeners to unlock audio on first user gesture
window.addEventListener('mousedown', unlockAudio);
window.addEventListener('touchstart', unlockAudio, { passive: true });
window.addEventListener('keydown', unlockAudio);

function playTone(freq, type = 'sine', duration = 0.12, gainVal = 0.12) {
  try {
    ensureAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch (e) {
    // Audio unavailable - silently fail
  }
}

function playPaddleSound() {
  // short, bright square-ish hit
  playTone(880, 'square', 0.07, 0.14);
}

function playWallSound() {
  // softer, lower sine for wall bounce
  playTone(220, 'sine', 0.12, 0.08);
}

function playScoreSound() {
  // two-tone ascending short jingle
  playTone(520, 'sawtooth', 0.12, 0.12);
  setTimeout(() => playTone(780, 'sawtooth', 0.14, 0.12), 120);
}
// --- end audio ---

function resetBall(direction = null) {
  ball.x = WIDTH / 2;
  ball.y = HEIGHT / 2;
  ball.speed = 6;
  // Randomize angle but force to the right or left if direction specified
  const angle = (Math.random() * (Math.PI / 3)) - (Math.PI / 6); // -30 to 30 deg
  const dir = direction === 'left' ? -1 : direction === 'right' ? 1 : (Math.random() < 0.5 ? -1 : 1);
  ball.vx = dir * ball.speed * Math.cos(angle);
  ball.vy = ball.speed * Math.sin(angle);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function drawNet() {
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  const dash = 12;
  const gap = 8;
  let y = 8;
  const centerX = WIDTH / 2 - 1;
  while (y < HEIGHT - 8) {
    ctx.fillRect(centerX, y, 2, dash);
    y += dash + gap;
  }
}

function draw() {
  // Clear
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // Net
  drawNet();

  // Paddles
  ctx.fillStyle = '#e6eef8';
  roundRect(ctx, player.x, player.y, player.width, player.height, 4);
  roundRect(ctx, cpu.x, cpu.y, cpu.width, cpu.height, 4);

  // Ball
  ctx.beginPath();
  ctx.fillStyle = '#ffdd57';
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fill();

  // Scoreboard
  ctx.fillStyle = '#cfe7ff';
  ctx.font = '20px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`Player: ${score.player}`, WIDTH * 0.25, 30);
  ctx.fillText(`CPU: ${score.cpu}`, WIDTH * 0.75, 30);

  // Small help text
  ctx.fillStyle = 'rgba(207,231,255,0.45)';
  ctx.font = '12px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Move mouse or use Arrow Up / Arrow Down', WIDTH / 2, HEIGHT - 14);
}

// draw rounded rect helper
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function update(dt) {
  // Player keyboard movement
  if (keyState.ArrowUp) player.dy = -player.speed;
  else if (keyState.ArrowDown) player.dy = player.speed;
  else player.dy = 0;

  // Update player (keyboard)
  player.y += player.dy * dt;
  // If mouse active recently, mouse sets absolute position instead (handled by mousemove event)
  player.y = clamp(player.y, 0, HEIGHT - player.height);

  // CPU AI - follow ball with max speed and some smoothing
  let targetY;
  // If ball moving toward CPU, track more aggressively
  if (ball.vx > 0) {
    targetY = ball.y - cpu.height / 2;
  } else {
    // ball moving away - move gently toward center
    targetY = HEIGHT / 2 - cpu.height / 2;
  }
  const delta = targetY - cpu.y;
  const maxStep = cpu.speed * dt * 10; // scaled to dt
  cpu.y += clamp(delta, -maxStep, maxStep);
  cpu.y = clamp(cpu.y, 0, HEIGHT - cpu.height);

  // Move ball
  ball.x += ball.vx * dt * 10;
  ball.y += ball.vy * dt * 10;

  // Collide top/bottom
  if (ball.y - ball.r <= 0) {
    ball.y = ball.r;
    ball.vy = -ball.vy;
    if (audioUnlocked) playWallSound();
  } else if (ball.y + ball.r >= HEIGHT) {
    ball.y = HEIGHT - ball.r;
    ball.vy = -ball.vy;
    if (audioUnlocked) playWallSound();
  }

  // Paddle collisions
  // Left (player)
  if (ball.x - ball.r <= player.x + player.width &&
      ball.x - ball.r >= player.x && // ensure it's from left side
      ball.y + ball.r >= player.y &&
      ball.y - ball.r <= player.y + player.height) {
    // Compute bounce angle based on where it hit the paddle
    const relativeY = (ball.y - (player.y + player.height / 2)) / (player.height / 2);
    const bounceAngle = relativeY * MAX_BOUNCE_ANGLE;
    const speed = Math.hypot(ball.vx, ball.vy) + 0.2; // slightly increase speed
    ball.vx = Math.abs(Math.cos(bounceAngle) * speed);
    ball.vy = Math.sin(bounceAngle) * speed;
    // push the ball out to prevent sticking
    ball.x = player.x + player.width + ball.r + 0.5;
    if (audioUnlocked) playPaddleSound();
  }

  // Right (cpu)
  if (ball.x + ball.r >= cpu.x &&
      ball.x + ball.r <= cpu.x + cpu.width &&
      ball.y + ball.r >= cpu.y &&
      ball.y - ball.r <= cpu.y + cpu.height) {
    const relativeY = (ball.y - (cpu.y + cpu.height / 2)) / (cpu.height / 2);
    const bounceAngle = relativeY * MAX_BOUNCE_ANGLE;
    const speed = Math.hypot(ball.vx, ball.vy) + 0.2;
    ball.vx = -Math.abs(Math.cos(bounceAngle) * speed);
    ball.vy = Math.sin(bounceAngle) * speed;
    ball.x = cpu.x - ball.r - 0.5;
    if (audioUnlocked) playPaddleSound();
  }

  // Score conditions
  if (ball.x < -50) {
    // CPU scores
    score.cpu += 1;
    if (audioUnlocked) playScoreSound();
    // reset toward player (ball goes left)
    resetBall('right'); // send to right (toward cpu) after reset
    paused = true;
    setTimeout(() => { paused = false; }, 700);
  } else if (ball.x > WIDTH + 50) {
    // Player scores
    score.player += 1;
    if (audioUnlocked) playScoreSound();
    resetBall('left');
    paused = true;
    setTimeout(() => { paused = false; }, 700);
  }
}

function loop(ts) {
  if (!lastTime) lastTime = ts;
  const elapsed = (ts - lastTime) / 16.6667; // normalize to ~60fps steps
  lastTime = ts;

  if (!paused) update(elapsed);
  draw();
  requestAnimationFrame(loop);
}

// input handlers
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const y = e.clientY - rect.top;
  player.y = clamp(y - player.height / 2, 0, HEIGHT - player.height);
  mouseActive = true;
  // user interacted - unlock audio if needed
  unlockAudio();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    keyState[e.code] = true;
    e.preventDefault();
  }
  // any key interaction unlocks audio
  unlockAudio();
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    keyState[e.code] = false;
    e.preventDefault();
  }
});

// Allow clicking canvas to unpause / restart if paused, and unlock audio
canvas.addEventListener('click', () => {
  if (paused) paused = false;
  unlockAudio();
});

// initialize
resetBall();
requestAnimationFrame(loop);