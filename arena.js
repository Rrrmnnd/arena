// Arena setup and rendering.
// Same layout ratio as the old test3/test5 prototypes: a portrait canvas with a
// centered square arena.

const ARENA_MARGIN = 60;
const ARENA_BORDER  = 14;

// Two canvas layouts. The battle modes use the 9:16 portrait frame with a centered square
// arena; the lab uses a 16:9 frame with a wide arena and a control panel down the right.
// WIDTH/HEIGHT/ARENA are read fresh on every use across the codebase, so swapping them here
// re-lays-out everything — the callers just need to resize the canvases (see applyLayout).
const ARENA_LAYOUTS = {
  portrait: { w: 720,  h: 1280, arena: { x: ARENA_MARGIN, y: 370, w: 600, h: 600 } },
  lab:      { w: 1280, h: 720,  arena: { x: 24, y: 92, w: 892, h: 604 } },
};

let WIDTH  = ARENA_LAYOUTS.portrait.w;
let HEIGHT = ARENA_LAYOUTS.portrait.h;
let ARENA  = { ...ARENA_LAYOUTS.portrait.arena };
let arenaLayout = "portrait";

function setArenaLayout(name) {
  const L = ARENA_LAYOUTS[name];
  if (!L || name === arenaLayout) return false;
  WIDTH = L.w;
  HEIGHT = L.h;
  ARENA = { ...L.arena };
  arenaLayout = name;
  return true;
}

// A slow cool-to-warm wash behind everything with the arena sitting in a pool of light, rather
// than one flat fill — gives the frame depth and keeps the eye pulled toward the centre.
function drawBackground(ctx) {
  ctx.fillStyle = "#07070f";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const cx = ARENA.x + ARENA.w / 2;
  const cy = ARENA.y + ARENA.h / 2;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(WIDTH, HEIGHT) * 0.72);
  glow.addColorStop(0, "rgba(52,52,104,0.5)");
  glow.addColorStop(0.45, "rgba(28,28,58,0.28)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawArena(ctx) {
  const t = performance.now() / 1000;

  // Floor: lit from the centre and falling off toward the walls
  const cx = ARENA.x + ARENA.w / 2;
  const cy = ARENA.y + ARENA.h / 2;
  const floor = ctx.createRadialGradient(cx, cy, 0, cx, cy, ARENA.w * 0.78);
  floor.addColorStop(0, "#22223d");
  floor.addColorStop(0.62, "#191930");
  floor.addColorStop(1, "#101020");
  ctx.fillStyle = floor;
  ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

  // A faint grid, so movement across an otherwise featureless floor has something to read
  // against — and the arena feels like a built stage rather than empty space.
  ctx.save();
  ctx.beginPath();
  ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
  ctx.clip();
  ctx.strokeStyle = "rgba(120,120,190,0.075)";
  ctx.lineWidth = 1;
  const step = 60;
  ctx.beginPath();
  for (let gx = ARENA.x + step; gx < ARENA.x + ARENA.w; gx += step) {
    ctx.moveTo(gx, ARENA.y); ctx.lineTo(gx, ARENA.y + ARENA.h);
  }
  for (let gy = ARENA.y + step; gy < ARENA.y + ARENA.h; gy += step) {
    ctx.moveTo(ARENA.x, gy); ctx.lineTo(ARENA.x + ARENA.w, gy);
  }
  ctx.stroke();
  ctx.restore();

  // Border: a solid base with a slow breathing glow riding on top, so the frame is never
  // completely static even in a lull between exchanges.
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
  const bx = ARENA.x + ARENA_BORDER / 2;
  const by = ARENA.y + ARENA_BORDER / 2;
  const bw = ARENA.w - ARENA_BORDER;
  const bh = ARENA.h - ARENA_BORDER;

  ctx.strokeStyle = "#5a5a96";
  ctx.lineWidth = ARENA_BORDER;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.16 + pulse * 0.16;
  ctx.strokeStyle = "#8f8fe8";
  ctx.lineWidth = 3;
  ctx.strokeRect(bx, by, bw, bh);
  // Inner lip, catching the floor light
  ctx.globalAlpha = 0.1 + pulse * 0.08;
  ctx.lineWidth = 2;
  ctx.strokeRect(ARENA.x + ARENA_BORDER, ARENA.y + ARENA_BORDER, ARENA.w - ARENA_BORDER * 2, ARENA.h - ARENA_BORDER * 2);
  ctx.restore();
}

function drawTitle(ctx, text = "Battle Arena") {
  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 40px Arial";
  ctx.textAlign = "center";
  ctx.fillText(text, WIDTH / 2, 100);
}
