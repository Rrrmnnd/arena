// Collision handling between characters: when two characters touch, they just bounce off
// each other — no HP is lost from the bump itself, only from actual abilities. A character
// can implement onCollide(opponent), fired every overlapping frame (not just on a fresh
// touch) for continuous effects like the Giant pinning its target's velocity while charging.
// A character is treated as a fixed object that can't be shoved or deflected if
// movable === false (e.g. the Giant mid-absorb) or knockbackImmune is true (e.g. the Giant
// mid-charge — it plows straight through, only the other side moves).

const HIT_COOLDOWN = 0.4; // seconds, prevents one overlap from re-triggering the impact fx every frame

// Solid things in the arena that are NOT fighters — currently only the Earth Mage's stone
// pillars. Kept as a shared registry rather than reached for through whichever character happens
// to own them, so a projectile can ask "is anything solid in my way?" without every projectile in
// the game having to know what an Earth Mage is.
//
// Anything registered here needs { x, y, size, blocksProjectiles }. `blocksProjectiles` is read
// live, so an obstacle can stop blocking (a pillar going over) without deregistering.
const worldObstacles = [];

function addWorldObstacle(o) {
  if (!worldObstacles.includes(o)) worldObstacles.push(o);
}

function removeWorldObstacle(o) {
  const i = worldObstacles.indexOf(o);
  if (i >= 0) worldObstacles.splice(i, 1);
}

// Cleared at the start of every round (see reset() in main.js). Without that, pillars left
// standing when a round ends would stay registered into the next one and silently eat projectiles
// with nothing on screen to explain it.
function clearWorldObstacles() {
  worldObstacles.length = 0;
}

// The obstacle a projectile of radius `r` centred at (x, y) is currently inside, or null.
function obstacleBlocking(x, y, r = 0) {
  for (const o of worldObstacles) {
    if (!o.blocksProjectiles) continue;
    if (Math.hypot(x - o.x, y - o.y) <= o.size / 2 + r) return o;
  }
  return null;
}

function resolveCollision(a, b) {
  if (!a.alive || !b.alive) return;
  // A character mid-liquid-swim (or similar non-solid state) has nothing physical to bump into
  // right now — see Character.phasesThroughCharacters. Walls still apply; that's handled
  // separately, per-character, wherever it actually moves itself.
  if (a.phasesThroughCharacters || b.phasesThroughCharacters) return;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const minDist = (a.size + b.size) / 2;

  if (dist >= minDist) return;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;

  const aFixed = a.movable === false || a.knockbackImmune === true;
  const bFixed = b.movable === false || b.knockbackImmune === true;

  if (aFixed && bFixed) {
    // both fixed in place, nothing to separate or bounce
  } else if (aFixed) {
    b.x += nx * overlap;
    b.y += ny * overlap;
    const vDotN = b.vx * nx + b.vy * ny;
    b.vx -= 2 * vDotN * nx;
    b.vy -= 2 * vDotN * ny;
  } else if (bFixed) {
    a.x -= nx * overlap;
    a.y -= ny * overlap;
    const vDotN = a.vx * nx + a.vy * ny;
    a.vx -= 2 * vDotN * nx;
    a.vy -= 2 * vDotN * ny;
  } else {
    const half = overlap / 2;
    a.x -= nx * half; a.y -= ny * half;
    b.x += nx * half; b.y += ny * half;

    const avx = a.vx, avy = a.vy;
    a.vx = b.vx; a.vy = b.vy;
    b.vx = avx;  b.vy = avy;
  }

  // Continuous per-frame contact hook (e.g. the Giant pinning its target's velocity to
  // its own while charging) — runs every overlapping frame, not gated by hit freshness.
  if (typeof a.onCollide === "function") a.onCollide(b);
  if (typeof b.onCollide === "function") b.onCollide(a);

  const aFresh = a.hitCooldown <= 0;
  const bFresh = b.hitCooldown <= 0;

  if (aFresh) a.hitCooldown = HIT_COOLDOWN;
  if (bFresh) b.hitCooldown = HIT_COOLDOWN;

  // Only play the impact sound / spawn sparks on a fresh touch, so a lingering overlap
  // doesn't spam them every frame.
  if (aFresh || bFresh) {
    playSfx("collision", 0.45);
    spawnImpactParticles((a.x + b.x) / 2, (a.y + b.y) / 2, ["#ffffff", "#cfe0ff", "#a0c0ff"], 14);
  }
}
