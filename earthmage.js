// Earth Mage — zone control by way of physical terrain.
//
// The one thing no other character in the cast does is CHANGE THE ARENA. Everything else paints
// effects onto it (the Fire Mage's lava, the Troll's floor cracks) or flies over it. This one
// puts solid objects in it: pillars are real collision bodies that both fighters have to walk
// around, and they persist until they are spent.
//
// The two halves of the kit only matter together:
//   - Sand bolt (the normal attack) does very little damage on its own. What it actually does is
//     PIN the target — held in place, but NOT stunned; it can still attack back the whole time
//     (see Character.applyPin, which exists for this).
//   - A pin is the trigger. Every pillar within EARTHMAGE_TOPPLE_RADIUS of a pinned target falls
//     on it, and that is where the real damage is.
// So a sand hit with no pillar nearby is nearly worthless, and a field full of pillars with no
// pin never does anything. Landing the bolt near its own architecture is the whole character.

const EARTHMAGE_MAX_HP = 100;                  // matched to the Fire Mage, as specified
const EARTHMAGE_SPEED  = 240;
const EARTHMAGE_SIZE   = CHAR_BASE_SIZE;

// The normal attack. The cloud PICKS UP as it flies: it spreads wider, hits harder and holds
// longer the further it has travelled, reaching full strength at EARTHMAGE_SAND_FULL_DISTANCE.
// That inverts the usual ranged-character instinct — this mage wants the target at arm's length
// from its pillars but as far as possible from ITSELF, so backing off is an attack, not a retreat.
const EARTHMAGE_SAND_COOLDOWN = 3.0;
const EARTHMAGE_SAND_SPEED    = 620;
const EARTHMAGE_SAND_LIFE     = 1.6;           // safety timeout; it normally leaves the arena first
const EARTHMAGE_SAND_FULL_DISTANCE = 300;      // flight distance at which everything below peaks
const EARTHMAGE_SAND_MIN_DAMAGE = 7;
const EARTHMAGE_SAND_MAX_DAMAGE = 12;
const EARTHMAGE_SAND_MIN_PIN    = 1.0;
const EARTHMAGE_SAND_MAX_PIN    = 2.0;
// Radius is used for BOTH the drawing and the hit test, so the cloud you see is always exactly
// the cloud that connects. The old flat 20 sits about where the mid-range value lands now.
const EARTHMAGE_SAND_MIN_RADIUS = 14;
const EARTHMAGE_SAND_MAX_RADIUS = 28;

// How far along its growth a bolt is, 0..1, and everything that follows from it. One place, so
// the damage, the hold and the drawn size can never disagree about how grown the cloud is.
function sandBoltStats(bolt) {
  const t = Math.max(0, Math.min(1, bolt.traveled / EARTHMAGE_SAND_FULL_DISTANCE));
  return {
    t,
    damage: EARTHMAGE_SAND_MIN_DAMAGE + (EARTHMAGE_SAND_MAX_DAMAGE - EARTHMAGE_SAND_MIN_DAMAGE) * t,
    pin:    EARTHMAGE_SAND_MIN_PIN    + (EARTHMAGE_SAND_MAX_PIN    - EARTHMAGE_SAND_MIN_PIN)    * t,
    radius: EARTHMAGE_SAND_MIN_RADIUS + (EARTHMAGE_SAND_MAX_RADIUS - EARTHMAGE_SAND_MIN_RADIUS) * t,
  };
}

// The ultimate: pillars. There is no activation and no duration — the bar simply fills over
// EARTHMAGE_PILLAR_INTERVAL and a pillar drops when it tops out, over and over for the whole
// round. Reading the bar as "time until the next pillar" is what makes a passive-shaped ultimate
// legible on the same HUD every other character uses.
const EARTHMAGE_PILLAR_INTERVAL = 3.5;
const EARTHMAGE_PILLAR_SIZE     = 46;          // collision diameter
// A column is exactly this long standing up and exactly this long lying down — it never changes
// length. An earlier version stretched the falling pillar out to reach whatever it was aimed at,
// which made distant targets reachable but looked wrong: the stone visibly grew as it went over.
const EARTHMAGE_PILLAR_HEIGHT   = 300;
// Never flush against the arena wall: a pillar wedged into the boundary is both ugly and a dead
// obstacle, since nothing can be pushed against it from the far side.
const EARTHMAGE_PILLAR_WALL_MARGIN = 95;
// Seconds spent grinding up out of the floor. Deliberately slow: at 0.35s the stone simply
// appeared, which threw away the one moment the ultimate is actually visible, and left no room
// for the rockslide it now plays over. The pillar does NOT block or count as a topple target for
// the whole of this (see StonePillar.solid), so this is a real window, not just an animation.
const EARTHMAGE_PILLAR_RISE     = 1.25;
// Dust is thrown out around the base at this interval for the whole climb, rather than one puff
// at the start that would be long finished before the stone stopped moving.
const EARTHMAGE_RISE_DUST_EVERY = 0.16;
// ---------------------------------------------------------------- victory: the throne
// Every other character's win is something it DOES — a spin, a charge, a roar, a punch through
// the lens. This one is something it BUILDS, which is the one verb only this character has, and
// the vertical axis nobody else in the roster uses at all.
// Budgeted against ROUND_END_GRACE (3.0s in main.js), which is all the time there is before the
// round is torn down: plant + rise comes to 1.95s, leaving a full second holding on the finished
// monument. At 0.55 + 1.9 the stone was still settling as the screen cut away.
const EARTHMAGE_VICTORY_PLANT   = 0.45;   // staff raised and driven into the floor before anything moves
const EARTHMAGE_THRONE_HEIGHT   = 380;    // taller than a combat column (300) so it reads as the summit
const EARTHMAGE_THRONE_RISE     = 1.5;    // and slower than a combat pillar: this one is carrying someone
// Wider than a combat column (46) for one specific reason: the shaft tapers to 74% at the cap, so
// at the ordinary width the top came out NARROWER than the mage standing on it and the figure
// visibly overhung its own column — a pole, not a pedestal. At 68 the cap is ~50px across,
// comfortably wider than the body.
const EARTHMAGE_THRONE_SIZE     = 68;
// A ring of shorter columns comes up around the base, staggered, so the silhouette is one
// monument with a plinth rather than a single stick with a figure balanced on it.
const EARTHMAGE_VICTORY_RING_COUNT   = 5;
const EARTHMAGE_VICTORY_RING_RADIUS  = 104;   // tucked in close, so the ring reads as one base
const EARTHMAGE_VICTORY_RING_STAGGER = 0.13;
// Kept well under a third of the throne. At 0.28/0.40 they competed with it and the shot read as
// a scattered forest of columns rather than a monument with a plinth.
const EARTHMAGE_VICTORY_RING_LOW  = 0.20;
const EARTHMAGE_VICTORY_RING_HIGH = 0.29;
// The camera gives ground back as the throne climbs, so the whole structure stays in frame.
const EARTHMAGE_VICTORY_ZOOM_END = 0.82;

// The payoff.
// Derived, not chosen: a pillar can only ever crush what its own length can reach, so the
// trigger range IS the pillar's length. Keeping these as two independent numbers is what let the
// old 250 quietly promise a reach the 58px stone never had.
const EARTHMAGE_TOPPLE_RADIUS = EARTHMAGE_PILLAR_HEIGHT;
// After it lands the fallen column lies there breaking apart before it goes. Without this the
// stone simply blinked out of existence the frame it hit the floor, which threw away the whole
// impact.
const EARTHMAGE_CRUMBLE_TIME  = 0.45;
// The fall is INTEGRATED, not tweened. A column pivoting about its base is a rigid rod under
// gravity, whose angular acceleration is proportional to sin(tilt-from-vertical): almost nothing
// happens while it is still near upright, and it whips through the last part. That is the whole
// character of a falling chimney, and no fixed easing curve reproduces it — the previous
// quadratic ease started at full acceleration and was over in 0.42s.
//
// theta runs 0 (standing) to PI/2 (flat). EARTHMAGE_TOPPLE_GRAVITY is tuned so a full fall takes
// about 0.85s — comfortably inside even the SHORTEST pin (1.0s), so a toppled column still always
// lands while its target is still held, however weak the bolt that pinned them was.
// Solved for, not guessed: at 13.5 the fall measured 1.033s, which OVERRAN the 1.0s shortest pin
// and would have let a close-range bolt's target walk clear the instant before the column landed.
// Raised until the fall lands at 0.85s. Deliberately raised the gravity rather than the nudge —
// a bigger initial lean gets there too, but it does so by skipping the near-vertical part, which
// is precisely the slow hang this whole approach exists to produce.
const EARTHMAGE_TOPPLE_GRAVITY = 20;           // rad/s^2 at 90 degrees over
const EARTHMAGE_TOPPLE_NUDGE   = 0.075;        // the initial lean that breaks it off vertical
// A hard ceiling on the integration, purely so a pathological dt can never leave a column
// hanging mid-air. Never reached in normal play.
const EARTHMAGE_TOPPLE_MAX_TIME = 2.0;
const EARTHMAGE_PILLAR_DAMAGE = 18;
const EARTHMAGE_PILLAR_STUN   = 2.0;

// The robe, brightened ~45% over the original set, which read as very dark against the arena's
// own dark floor. Scaled multiplicatively rather than blended toward white — blending washes the
// saturation out (#4a361c goes to a flat grey #847665) and the robe stops looking like earth.
const EARTH_ROBE_LIGHT  = "#ffc871";
const EARTH_ROBE_MID    = "#b58546";
const EARTH_ROBE_DARK   = "#6b4e29";
const EARTH_ROBE_HEM    = "#433017";
const EARTH_STONE_LIGHT = "#9c8a6e";
const EARTH_STONE_MID   = "#6f6047";
const EARTH_STONE_DARK  = "#413729";
// Lightens or darkens one of the stone colours by a factor, for per-course tone variation.
function shadeStone(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const EARTH_SAND        = ["#c9a86a", "#a8874c", "#e0c690", "#7d6436"];

// The climb curve. A smoothstep, so it is slow at BOTH ends: the stone strains against the floor
// before it gives, runs through the middle of the climb, then grinds to a halt at full height.
//
// A cubic ease-out was tried first and was wrong for this — it is fastest at the very start, so
// the column was already 78% of the way up half a second in, which is the "it just appeared"
// problem this was meant to fix, only stretched.
function easeOutRise(t) {
  return t * t * (3 - 2 * t);
}

// How far out of the floor a pillar currently stands, 0..1. The single place the rise curve is
// applied — the shaft, the socket and the victory lift all read it, so they cannot drift apart.
function pillarRise(p) {
  const raw = 1 - Math.max(0, p.riseTimer) / p.riseDuration;
  return easeOutRise(Math.max(0, Math.min(1, raw)));
}

// Shortest distance from a point to a line segment — how far a target is from a fallen column,
// measured against the whole stone rather than either of its ends.
function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
  let k = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  k = Math.max(0, Math.min(1, k));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

// Pushes `body` out of `pillar` and bounces it off, and does nothing else.
//
// Deliberately NOT resolveCollision. That function is built for two FIGHTERS touching: it fires
// both sides' onCollide hooks, arms hitCooldown, and plays the fighter-contact sound and sparks.
// A pillar is scenery, and every one of those is wrong for it — the Giant's onCollide in
// particular reaches straight for opponent.takeDamage(), which a pillar has no business having.
// (That is a real crash, not a hypothetical: it threw the moment a Giant charge met a pillar.)
//
// What is kept is exactly the geometry of resolveCollision's fixed-body branch: separate along
// the contact normal, then reflect the moving body's velocity about it.
function separateFromPillar(body, pillar) {
  if (!body.alive || body.phasesThroughCharacters) return;
  const dx = body.x - pillar.x;
  const dy = body.y - pillar.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const minDist = (body.size + pillar.size) / 2;
  if (dist >= minDist) return;
  const nx = dx / dist, ny = dy / dist;
  body.x += nx * (minDist - dist);
  body.y += ny * (minDist - dist);
  // A body that is fixed in place (absorbing, planted, stunned) gets separated but keeps its
  // velocity untouched — same rule resolveCollision applies to its own fixed bodies.
  // Anything that wants to react to hitting solid scenery — the Giant ends its charge here, the
  // same as ramming the arena wall. Fired before the bounce so a reaction that stops the mover
  // (and zeroes its velocity) is not immediately overwritten by a reflection.
  if (typeof body.onHitObstacle === "function") body.onHitObstacle(pillar);

  if (body.movable === false || body.knockbackImmune === true) return;
  const vDotN = body.vx * nx + body.vy * ny;
  if (vDotN < 0) {                     // only if it is actually heading INTO the pillar
    body.vx -= 2 * vDotN * nx;
    body.vy -= 2 * vDotN * ny;
  }
}

// A thrown handful of grit. Pure data — see EarthMage.updateBolts for the flight and the hit.
class SandBolt {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * EARTHMAGE_SAND_SPEED;
    this.vy = Math.sin(angle) * EARTHMAGE_SAND_SPEED;
    this.angle = angle;
    this.life = EARTHMAGE_SAND_LIFE;
    this.traveled = 0;         // drives sandBoltStats — see updateBolts
    // A few grains trailing behind the head, fixed per-bolt so the cloud does not boil.
    this.grains = Array.from({ length: 9 }, () => ({
      off: Math.random(),
      lat: (Math.random() * 2 - 1) * 0.9,
      size: 0.35 + Math.random() * 0.65,
      seed: Math.random() * Math.PI * 2,
    }));
  }
}

// A standing stone. Collision is handled by separateFromPillar above, not by resolveCollision —
// see the note there. It is deliberately NOT an "extra body" of the mage either: those are
// targetable, and the opponent aiming its attacks at scenery would be nonsense.
class StonePillar {
  // height/riseDuration are per-pillar rather than read off the globals, because the victory
  // throne is a pillar in every other respect but is deliberately taller than a combat column
  // and takes longer to come up (it is carrying someone). Every ordinary summon just takes the
  // defaults and behaves exactly as before.
  constructor(x, y, height = EARTHMAGE_PILLAR_HEIGHT, riseDuration = EARTHMAGE_PILLAR_RISE,
              size = EARTHMAGE_PILLAR_SIZE) {
    this.x = x;
    this.y = y;
    this.height = height;
    this.riseDuration = riseDuration;
    this.size = size;
    this.alive = true;
    this.movable = false;      // scenery: never pushed, never knocked back
    this.knockbackImmune = true;
    this.vx = 0;
    this.vy = 0;
    this.hitCooldown = 0;
    this.phasesThroughCharacters = false;
    this.seed = Math.random() * Math.PI * 2;
    this.riseTimer = riseDuration;             // >0 while still erupting
    this.riseSound = null;                     // looped rockslide, stopped the moment it lands
    this.riseDustTimer = 0;
    this.falling = false;                      // true from the moment it is knocked over
    this.fallTheta = 0;                        // tilt from vertical, 0..PI/2 — integrated, see updatePillars
    this.fallOmega = 0;                        // angular velocity, rad/s
    this.fallElapsed = 0;                      // guards EARTHMAGE_TOPPLE_MAX_TIME
    this.toppleAngle = 0;                      // the direction it is falling
    this.toppleTarget = null;                  // who it was aimed at, damaged on landing
    this.crumbleTimer = 0;                     // >0 while the fallen stone breaks up on the floor
    this.spent = false;                        // true once it has finished crumbling
    // Fixed per-pillar surface detail, so the strata and the rubble around the base do not crawl
    // from frame to frame.
    this.chips = Array.from({ length: 7 }, (_, i) => ({
      a: Math.random() * Math.PI * 2,
      d: 0.55 + Math.random() * 0.5,
      w: 0.1 + Math.random() * 0.14,
      h: 0.05 + Math.random() * 0.08,
      rot: Math.random() * Math.PI,
    }));
    // Stacked courses of rock, TALLEST AT THE BOTTOM and shortening as they go up. Real strata
    // compact under the weight above them, so an even stack of identical bands read as a drawn-on
    // texture; graded ones read as a column that grew. The weight for course i is (n - i), so the
    // bottom course is n times the height of the top one before jitter.
    const courseCount = 7;
    const weights = Array.from({ length: courseCount },
                               (_, i) => (courseCount - i) + Math.random() * 0.8);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    this.courses = weights.map((wt) => {
      const frac = wt / weightSum;
      const c = {
        bottom: acc,
        top: acc + frac,
        jitter: (Math.random() * 2 - 1) * 0.055, // no two courses sit flush — natural stone
        tone: 0.82 + Math.random() * 0.36,       // per-course lightness, so the stack has variety
        tilt: (Math.random() * 2 - 1) * 0.05,
      };
      acc += frac;
      return c;
    });
    // Mineral speckle, fixed so it does not crawl
    this.flecks = Array.from({ length: 14 }, () => ({
      f: Math.random(),
      lat: (Math.random() * 2 - 1) * 0.72,
      r: 0.03 + Math.random() * 0.05,
      a: 0.1 + Math.random() * 0.22,
      light: Math.random() < 0.5,
    }));
    addWorldObstacle(this);
  }

  // Projectiles are stopped by a pillar only while it is genuinely standing there — not while it
  // is still erupting out of the floor, and not once it has started to go over.
  get blocksProjectiles() {
    return this.solid;
  }

  // Only a fully-risen, not-yet-falling pillar is solid. Mid-eruption it is still coming out of
  // the floor, and mid-fall it is no longer standing where its collision circle claims.
  get solid() {
    return this.alive && this.riseTimer <= 0 && !this.falling
        && this.crumbleTimer <= 0 && !this.spent;
  }

  get toppling() {
    return this.falling;
  }

  // 0 (upright) .. 1 (flat on the floor). What the drawing interpolates the column's screen-space
  // sweep by, so the picture follows the integration rather than a parallel clock of its own.
  get fallProgress() {
    return Math.max(0, Math.min(1, this.fallTheta / (Math.PI / 2)));
  }
}

class EarthMage extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: EARTHMAGE_SIZE,
      color: "#a8874c",
      maxHp: EARTHMAGE_MAX_HP,
      name: "Earth Mage",
      nameZh: "土法師",
      speed: EARTHMAGE_SPEED,
    });

    this.facingAngle = Math.random() * Math.PI * 2;
    this.hasFacedOpponent = false;
    this.boltTimer = EARTHMAGE_SAND_COOLDOWN;  // opens on cooldown rather than firing at the bell
    this.bolts = [];
    this.pillars = [];
    this.pillarTimer = EARTHMAGE_PILLAR_INTERVAL;
    this.castPhase = null;                     // null | "windup" | "throw" | "recover"
    this.castTimer = 0;
    this.bodySeed = Math.random() * Math.PI * 2;
    // Victory: see onVictory / updateVictory. celebrating gates the whole AI off.
    this.celebrating = false;
    this.victoryTimer = 0;
    this.victoryPhase = null;   // null | "plant" | "raise"
    this.throne = null;         // the column that carries it up — a StonePillar like any other
    this.throneSound = null;
    this.victoryRingLeft = 0;   // ring columns still to be planted
    this.victoryRingTimer = 0;
    this.victoryDustTimer = 0;
    this.victoryStartX = 0;
    this.victoryStartY = 0;
    // A new mage means a new round. Anything still registered belongs to the last one — same
    // reasoning as stopFiremageLavaLoop() in the Fire Mage's constructor.
    clearWorldObstacles();
    this.dust = Array.from({ length: 5 }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 0.35 + Math.random() * 0.4,
      seed: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.5,
      size: 0.04 + Math.random() * 0.04,
    }));
  }

  // Pillars are scenery, not extra fighters — see the note on StonePillar.
  getExtraBodies() {
    return [];
  }

  // Holds the round open while any of its own pillars is still mid-fall, so a topple that is
  // visibly about to land (and could still change who is standing) can finish before the round is
  // called — same committed-in-flight reasoning as the Archer's Sun Shot. A pillar that has
  // already landed and is only crumbling does not count; that part is cosmetic.
  get blocksRoundEnd() {
    return super.blocksRoundEnd || this.pillars.some((p) => p.falling);
  }

  // Plants the staff, then rides its own architecture up above the arena. Deliberately does NOT
  // touch this.pillars — whatever it built during the fight stays standing exactly where it is,
  // so the closing shot is the arena it actually shaped, not a cleared stage.
  onVictory() {
    if (this.celebrating) return;
    this.celebrating = true;
    this.victoryPhase = "plant";
    this.victoryTimer = 0;
    this.victoryStartX = this.x;
    this.victoryStartY = this.y;
    this.victoryRingLeft = EARTHMAGE_VICTORY_RING_COUNT;
    this.victoryRingTimer = 0;
    this.movable = false;
    this.vx = 0;
    this.vy = 0;
    this.castPhase = null;      // the victory drives the staff itself from here (see castAmount)
    this.castTimer = 0;
    this.bolts.length = 0;      // nothing left to hit; a bolt still in the air would outlive the round
  }

  updateVictory(dt) {
    this.victoryTimer += dt;

    if (this.victoryPhase === "plant") {
      // Turn to face the camera on the way down into the plant, so it finishes the sequence
      // squared up to the viewer like a monument rather than still facing a corpse.
      let d = Math.PI / 2 - this.facingAngle;
      d = Math.atan2(Math.sin(d), Math.cos(d));       // the short way round
      this.facingAngle += d * Math.min(1, dt * 7);

      if (this.victoryTimer >= EARTHMAGE_VICTORY_PLANT) {
        // The staff lands. Everything else is a consequence of this one beat.
        this.victoryPhase = "raise";
        this.victoryTimer = 0;
        this.throne = new StonePillar(this.x, this.y, EARTHMAGE_THRONE_HEIGHT,
                                      EARTHMAGE_THRONE_RISE, EARTHMAGE_THRONE_SIZE);
        this.throneSound = playSfx("earthmageRise", 0.75, 0.04, 0, true);
        playSfx("wallSlam", 0.55);
        spawnImpactParticles(this.x, this.y, EARTH_SAND, 30, 1.7, 200);
        spawnFlash(this.x, this.y, "#d8b878", this.size * 1.6, 0.2);
        triggerShake(8, 0.35, true);   // sustained: this is ground moving, not a hit — no hit-stop
      }
      return;
    }

    if (this.victoryPhase !== "raise" || !this.throne) return;

    // The throne is not in this.pillars (it must never be a topple target, and nothing should
    // ever collide with it), so its clock is ticked here rather than by updatePillars.
    if (this.throne.riseTimer > 0) {
      this.throne.riseTimer -= dt;
      if (this.throne.riseTimer <= 0 && this.throneSound) {
        try { this.throneSound.stop(); } catch (e) {}
        this.throneSound = null;
        playSfx("wallSlam", 0.4);        // locking into place at the top
        triggerShake(5, 0.3, true);
      }
    }

    // The plinth: shorter columns, one at a time, around the base. Real pillars in this.pillars,
    // so the existing rise dust and rise clock drive them for free.
    if (this.victoryRingLeft > 0) {
      this.victoryRingTimer -= dt;
      if (this.victoryRingTimer <= 0) {
        this.victoryRingTimer = EARTHMAGE_VICTORY_RING_STAGGER;
        const i = EARTHMAGE_VICTORY_RING_COUNT - this.victoryRingLeft;
        // Started from straight down (toward the camera) and stepped around, so the front of the
        // ring lands first — the plinth builds toward the viewer.
        const a = Math.PI / 2 + (i / EARTHMAGE_VICTORY_RING_COUNT) * Math.PI * 2;
        const h = EARTHMAGE_THRONE_HEIGHT
                * (EARTHMAGE_VICTORY_RING_LOW
                   + (i % 2) * (EARTHMAGE_VICTORY_RING_HIGH - EARTHMAGE_VICTORY_RING_LOW));
        this.pillars.push(new StonePillar(this.x + Math.cos(a) * EARTHMAGE_VICTORY_RING_RADIUS,
                                          this.y + Math.sin(a) * EARTHMAGE_VICTORY_RING_RADIUS,
                                          h, 1.0));
        this.victoryRingLeft--;
      }
    }

    // Grit drifting off the stone for as long as the shot holds, so the freeze-frame never goes
    // completely still.
    this.victoryDustTimer -= dt;
    if (this.victoryDustTimer <= 0) {
      this.victoryDustTimer = 0.22;
      const lift = this.victoryLift;
      spawnImpactParticles(this.x + (Math.random() - 0.5) * this.size,
                           this.y - lift * (0.15 + Math.random() * 0.8),
                           [EARTH_STONE_MID, EARTH_STONE_DARK], 2, 0.7, 150);
    }
  }

  // How far off the floor the throne is currently holding it. Read straight off the same rise
  // curve the stone is drawn with, so the figure can never float above its own column or sink
  // into it — see pillarRise.
  get victoryLift() {
    return this.throne ? this.throne.height * pillarRise(this.throne) : 0;
  }

  // A real camera move, not just drawing itself bigger: the anchor stays nailed to the floor
  // where the throne came out of the ground while the pan drifts up and the scale eases back, so
  // the figure visibly CLIMBS the frame while the arena stays put underneath it. Pinning the
  // camera to the figure instead would have held it dead center and thrown the height away.
  get victoryCameraZoom() {
    if (!this.celebrating) return null;
    const total = EARTHMAGE_VICTORY_PLANT + EARTHMAGE_THRONE_RISE;
    const elapsed = this.victoryPhase === "plant"
      ? this.victoryTimer
      : EARTHMAGE_VICTORY_PLANT + this.victoryTimer;
    const t = Math.min(1, elapsed / total);
    const eased = t * t * (3 - 2 * t);
    return {
      panX: this.victoryStartX + (WIDTH / 2 - this.victoryStartX) * eased,
      panY: this.victoryStartY + (HEIGHT * 0.62 - this.victoryStartY) * eased,
      anchorX: this.victoryStartX,
      anchorY: this.victoryStartY,
      scale: 1 + (EARTHMAGE_VICTORY_ZOOM_END - 1) * eased,
    };
  }

  // The whole figure rides the throne up. Applied around super.draw rather than inside drawBody
  // so the staff, the hit flash and the field HP bar all travel with it as one piece — the same
  // trick Character.draw already uses for the transfix lean.
  draw(ctx) {
    const lift = this.victoryLift;
    if (lift <= 0) { super.draw(ctx); return; }
    ctx.save();
    ctx.translate(0, -lift);
    super.draw(ctx);
    ctx.restore();
  }

  // "Time until the next pillar", which is what the standard second bar under the HP bar ends up
  // meaning for this character.
  get ultimateRatio() {
    return Math.max(0, Math.min(1, 1 - this.pillarTimer / EARTHMAGE_PILLAR_INTERVAL));
  }

  get ultimateBarColor() {
    return "#b08a4e";
  }

  drawHud(ctx, x, y, w) {
    const ny = super.drawHud(ctx, x, y, w);
    const standing = this.pillars.filter((p) => p.solid).length;
    if (standing > 0) {
      this.drawHudNote(ctx, x, ny, L(`${standing} pillars`, `場上 ${standing} 根石柱`), "#c9a86a");
      return ny + 18;
    }
    return ny;
  }

  // Somewhere in the arena that is not hugging a wall and is not already occupied — by a pillar,
  // by the mage, or by its opponent. Falls back to the last candidate rather than failing
  // outright, since a crowded arena should not silently skip the ultimate entirely.
  pickPillarSpot(opponent) {
    const minX = ARENA.x + EARTHMAGE_PILLAR_WALL_MARGIN;
    const maxX = ARENA.x + ARENA.w - EARTHMAGE_PILLAR_WALL_MARGIN;
    // The top edge needs the column's own height, not just the wall margin: a pillar is drawn
    // upward from its base, so at 170 tall a base only 95 below the top wall put most of the
    // stone outside the arena.
    const minY = ARENA.y + Math.max(EARTHMAGE_PILLAR_WALL_MARGIN, EARTHMAGE_PILLAR_HEIGHT + 12);
    const maxY = ARENA.y + ARENA.h - EARTHMAGE_PILLAR_WALL_MARGIN;
    let best = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const px = minX + Math.random() * (maxX - minX);
      const py = minY + Math.random() * (maxY - minY);
      best = { x: px, y: py };
      const bodies = [this, ...(opponent && opponent.alive ? [opponent] : []),
                      ...this.pillars.filter((p) => !p.spent)];
      let clear = true;
      for (const b of bodies) {
        const need = (EARTHMAGE_PILLAR_SIZE + b.size) / 2 + 14;
        if (Math.hypot(px - b.x, py - b.y) < need) { clear = false; break; }
      }
      if (clear) return best;
    }
    return best;
  }

  summonPillar(opponent) {
    const spot = this.pickPillarSpot(opponent);
    if (!spot) return;
    // No cap: pillars accumulate for the whole round now, so a long fight against this
    // character genuinely fills the arena with them rather than the oldest one quietly
    // vanishing to make room for the next.
    this.pillars.push(new StonePillar(spot.x, spot.y));
    spawnImpactParticles(spot.x, spot.y, [EARTH_STONE_MID, EARTH_STONE_LIGHT, "#5a4a30"], 22, 1.6, -90);
    triggerShake(5, 0.22, true);   // sustained: scenery arriving is not an impact, no hit-stop
    // Looped rather than a one-shot so it fills the rise exactly however long that is, and stopped
    // by hand the instant the stone lands (see updatePillars/stopRiseSound). Same pattern the
    // Demon's recalled tridents use for their woosh.
    const fresh = this.pillars[this.pillars.length - 1];
    if (fresh) fresh.riseSound = playSfx("earthmageRise", 0.6, 0.04, 0, true);
  }

  // Cuts a pillar's rockslide loop, wherever the rise ends — landing normally, being evicted by
  // the cap mid-climb, or the round being torn down underneath it.
  stopRiseSound(p) {
    if (!p || !p.riseSound) return;
    try { p.riseSound.stop(); } catch (e) {}
    p.riseSound = null;
  }

  // Called by reset() in main.js: a round ending mid-rise would otherwise leave the loop running
  // with nothing left alive that could ever stop it.
  stopAllPillarSounds() {
    for (const p of this.pillars) this.stopRiseSound(p);
    if (this.throneSound) {
      try { this.throneSound.stop(); } catch (e) {}
      this.throneSound = null;
    }
  }

  throwSand(opponent) {
    const gp = this.staffTipPoint();
    const angle = Math.atan2(opponent.y - gp.y, opponent.x - gp.x);
    this.bolts.push(new SandBolt(gp.x, gp.y, angle));
    spawnDirectionalBurst(gp.x, gp.y, angle, 0.35, EARTH_SAND, 12, 1.0);
    playSfx("earthmageSand", 0.5);
  }

  // Every pillar standing within EARTHMAGE_TOPPLE_RADIUS of a freshly pinned target comes down on
  // it — all of them, not just the nearest, which is what makes fighting next to the mage's own
  // architecture genuinely dangerous rather than a flat 18 every time.
  topplePillarsOnto(target) {
    let toppled = 0;
    for (const p of this.pillars) {
      if (!p.solid) continue;
      if (Math.hypot(target.x - p.x, target.y - p.y) > EARTHMAGE_TOPPLE_RADIUS) continue;
      p.falling = true;
      p.fallTheta = EARTHMAGE_TOPPLE_NUDGE;   // knocked just off balance; gravity does the rest
      p.fallOmega = 0;
      p.fallElapsed = 0;
      p.toppleAngle = Math.atan2(target.y - p.y, target.x - p.x);
      p.toppleTarget = target;
      toppled++;
    }
    if (toppled) {
      playSfx("wallSlam", 0.5);
      triggerShake(6, 0.25, true);
    }
    return toppled;
  }

  resolveToppledPillar(p) {
    p.crumbleTimer = EARTHMAGE_CRUMBLE_TIME;
    // Stops blocking the moment it is down, well before it finishes breaking up.
    removeWorldObstacle(p);
    // It pivots about its base, so the fallen stone lies along the segment from the base out to
    // one pillar-length in the direction it fell.
    const hx = p.x + Math.cos(p.toppleAngle) * p.height;
    const hy = p.y + Math.sin(p.toppleAngle) * p.height;
    const t = p.toppleTarget;
    // Tested against the WHOLE fallen column, not just its head. A column crushes everything it
    // lands across, and with a fixed length the head alone would sail straight over anything
    // standing closer than that length and score a miss on a target it visibly flattened.
    //
    // Re-tested at the moment of landing rather than assumed from when it started falling: the
    // target can still be knocked clear mid-fall by something else, and a pillar that visibly
    // misses must not deal damage.
    if (t && t.alive && pointToSegmentDistance(t.x, t.y, p.x, p.y, hx, hy)
                        <= EARTHMAGE_PILLAR_SIZE / 2 + t.size / 2) {
      t.takeDamage(EARTHMAGE_PILLAR_DAMAGE);
      t.applyStun(EARTHMAGE_PILLAR_STUN);
      spawnImpactParticles(t.x, t.y, [EARTH_STONE_LIGHT, EARTH_STONE_MID, "#ffffff"], 26, 2.0, 120);
      spawnFlash(t.x, t.y, "#d8c69a", t.size * 1.2, 0.22);
      triggerShake(11, 0.3);
    }
    spawnImpactParticles(hx, hy, [EARTH_STONE_MID, EARTH_STONE_DARK, EARTH_STONE_LIGHT], 24, 1.9, 200);
    spawnWallCrack(hx, hy);
    playSfx("earthmageCollapse", 0.7);
  }

  updatePillars(dt, opponent) {
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const p = this.pillars[i];
      if (p.riseTimer > 0) {
        p.riseTimer -= dt;
        // Grit shaken loose all the way up, so the climb reads as the stone forcing itself
        // through the floor rather than sliding out of a slot.
        p.riseDustTimer -= dt;
        if (p.riseDustTimer <= 0) {
          p.riseDustTimer = EARTHMAGE_RISE_DUST_EVERY;
          spawnImpactParticles(p.x, p.y, [EARTH_STONE_MID, EARTH_STONE_DARK, "#5a4a30"], 6, 1.1, 160);
          triggerShake(2.5, 0.2, true);   // sustained: a continuous grind must not arm hit-stop
        }
        if (p.riseTimer <= 0) this.stopRiseSound(p);
      }
      if (p.falling) {
        // Semi-implicit Euler on theta'' = g * sin(theta). Velocity is advanced first so the step
        // stays stable at the high angular speeds this reaches just before it lands.
        p.fallElapsed += dt;
        p.fallOmega += EARTHMAGE_TOPPLE_GRAVITY * Math.sin(p.fallTheta) * dt;
        p.fallTheta += p.fallOmega * dt;
        // Grit shaken off the stone the whole way down, thickening as it accelerates
        if (Math.random() < p.fallProgress * 0.7) {
          const along = p.height * (0.35 + Math.random() * 0.6) * p.fallProgress;
          spawnImpactParticles(p.x + Math.cos(p.toppleAngle) * along,
                               p.y + Math.sin(p.toppleAngle) * along,
                               [EARTH_STONE_MID, EARTH_STONE_DARK], 2, 0.9, 190);
        }
        if (p.fallTheta >= Math.PI / 2 || p.fallElapsed >= EARTHMAGE_TOPPLE_MAX_TIME) {
          p.fallTheta = Math.PI / 2;
          p.falling = false;
          if (p.crumbleTimer <= 0 && !p.spent) this.resolveToppledPillar(p);
        }
      } else if (p.crumbleTimer > 0) {
        p.crumbleTimer -= dt;
        if (p.crumbleTimer <= 0) p.spent = true;
      }
      if (p.spent) {
        this.stopRiseSound(p);   // defensive: nothing should be spent mid-rise, but never leak a loop
        removeWorldObstacle(p);
        this.pillars.splice(i, 1);
      }
    }
    // Solid pillars physically block both fighters. Run against the mage itself too — its own
    // architecture is in its way exactly as much as it is in anyone else's.
    //
    // Skipped entirely once the round is won: separateFromPillar pushes a body clear BEFORE it
    // checks movable (immovable bodies still get positionally separated, by design), so the
    // victory ring coming up around the throne would shove the mage off its own base.
    if (this.celebrating) return;
    for (const p of this.pillars) {
      if (!p.solid) continue;
      separateFromPillar(this, p);
      if (opponent && opponent.alive) separateFromPillar(opponent, p);
    }
  }

  updateBolts(dt, opponent) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.traveled += EARTHMAGE_SAND_SPEED * dt;
      b.life -= dt;
      let gone = b.life <= 0 || b.x < ARENA.x || b.x > ARENA.x + ARENA.w
                             || b.y < ARENA.y || b.y > ARENA.y + ARENA.h;
      if (!gone && opponent && opponent.alive) {
        const st = sandBoltStats(b);
        const targets = [opponent, ...opponent.getExtraBodies()].filter((t) => t.alive);
        for (const t of targets) {
          if (Math.hypot(t.x - b.x, t.y - b.y) > t.size / 2 + st.radius) continue;
          t.takeDamage(st.damage);
          t.applyPin(st.pin);
          this.topplePillarsOnto(t);
          // Scaled by how far the handful travelled, the same as its damage and its pin: a bolt
          // caught point-blank is a light spatter, one that crossed the arena lands hard. Every
          // other ranged character pairs a throw sound with a separate landing one (archerBow /
          // archerBowHit, firemageThrow / firemageExplode); this was the only attack in the game
          // that went out with a sound and arrived in silence.
          playSfx("earthmageHit", 0.45 + 0.35 * st.t);
          spawnImpactParticles(b.x, b.y, EARTH_SAND, Math.round(14 + 14 * st.t), 1.2 + 0.6 * st.t, 90);
          spawnFlash(b.x, b.y, "#d8b878", t.size * (0.7 + 0.4 * st.t), 0.16);
          gone = true;
          break;
        }
      }
      if (gone) {
        if (b.life > 0) spawnImpactParticles(b.x, b.y, EARTH_SAND, 8, 1.0, 120);
        this.bolts.splice(i, 1);
      }
    }
  }

  update(dt, opponent) {
    // Unconditional and first, the same reason the Archer's updateArrows() runs before its own
    // alive check: a pillar already committed to falling is a physical object now, independent of
    // the mage that conjured it. Without this, updatePillars() never ran again the instant the
    // Earth Mage died — a pillar mid-fall froze exactly where it was, `falling` never cleared, and
    // blocksRoundEnd (which holds the round open for precisely this) held it open forever.
    this.updatePillars(dt, opponent);

    super.update(dt, opponent);
    if (!this.alive) return;

    // Won: the sequence owns this character outright from here — no aiming, no casting, and in
    // particular no more pillar summons on the ordinary clock, which would otherwise keep
    // erupting at random around the monument for the whole closing shot.
    if (this.celebrating) {
      this.updateVictory(dt);
      return;
    }

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x, dy = opponent.y - this.y;
      if (Math.hypot(dx, dy) > 0.01) {
        this.facingAngle = Math.atan2(dy, dx);
        this.hasFacedOpponent = true;
      }
    }

    this.updateBolts(dt, opponent);

    if (this.stunTimer > 0) return;

    // The pillar clock runs on its own regardless of what else is happening, which is what makes
    // it read as a passive ultimate rather than something cast.
    this.pillarTimer -= dt;
    if (this.pillarTimer <= 0) {
      this.pillarTimer = EARTHMAGE_PILLAR_INTERVAL;
      this.summonPillar(opponent);
    }

    if (this.castPhase) {
      this.castTimer -= dt;
      if (this.castPhase === "windup" && this.castTimer <= 0) {
        this.castPhase = "throw";
        this.castTimer = 0.12;
        if (opponent && opponent.alive) this.throwSand(opponent);
      } else if (this.castPhase === "throw" && this.castTimer <= 0) {
        this.castPhase = "recover";
        this.castTimer = 0.22;
      } else if (this.castPhase === "recover" && this.castTimer <= 0) {
        this.castPhase = null;
      }
      return;
    }

    if (this.boltTimer > 0) this.boltTimer -= dt;
    if (this.boltTimer <= 0 && this.canAttack && opponent && opponent.alive) {
      this.boltTimer = EARTHMAGE_SAND_COOLDOWN;
      this.castPhase = "windup";
      this.castTimer = 0.25;
    }
  }

  // 0 at rest, negative wound back, up to 1 at full extension — drives the staff in drawStaff.
  get castAmount() {
    // The victory plant borrows the ordinary cast animation: wound all the way back over the
    // first half, driven down hard over the second, then held at rest for the climb.
    if (this.celebrating) {
      if (this.victoryPhase !== "plant") return 0;
      const t = Math.min(1, this.victoryTimer / EARTHMAGE_VICTORY_PLANT);
      return t < 0.6 ? -(t / 0.6) : -1 + ((t - 0.6) / 0.4) * 1.9;
    }
    if (this.castPhase === "windup") return -(1 - this.castTimer / 0.25);
    if (this.castPhase === "throw") return 1 - (this.castTimer / 0.12) * 0.3;
    if (this.castPhase === "recover") return (this.castTimer / 0.22) * 0.7;
    return 0;
  }

  staffTipPoint() {
    const r = this.size / 2;
    const reach = r * (1.25 + this.castAmount * 0.35);
    return { x: this.x + Math.cos(this.facingAngle) * reach,
             y: this.y + Math.sin(this.facingAngle) * reach - r * 0.25 };
  }

  // Depth ordering. This is a top-down-ish view, so what is LOWER on screen is nearer the
  // camera: a pillar is sorted by the y of its BASE (where it meets the floor), never by its
  // drawn top, which is 250px further up and would sort every column as if it stood far away.
  pillarsByDepth() {
    return this.pillars.slice().sort((a, b) => a.y - b.y);
  }

  // Only the FLOOR damage goes in the under-everything pass — the sockets and the cracks are
  // painted on the ground, so they belong beneath every fighter unconditionally.
  drawGroundEffects(ctx) {
    for (const p of this.pillarsByDepth()) this.drawPillarSocket(ctx, p);
    if (this.throne) this.drawPillarSocket(ctx, this.throne);
  }

  // The columns themselves join the single sorted pass with the fighters, so a character can pass
  // either in front of or behind a pillar depending on where it actually is — see
  // Character.getDepthItems and collectDepthItems in main.js.
  getDepthItems() {
    const items = this.pillars.map((p) => ({
      // A standing column sorts where it meets the floor. A FALLING one sorts by whichever end is
      // lowest on screen: as it comes down toward the camera its head sweeps forward, and it has
      // to come forward in the stack with it, or a column visibly landing on someone would be
      // drawn behind them.
      depthY: p.toppling || p.crumbleTimer > 0
        ? Math.max(p.y, p.y + Math.sin(p.toppleAngle) * p.height)
        : p.y,
      draw: (ctx) => this.drawPillar(ctx, p),
    }));
    // Sorted a hair in front of the mage's own base so the figure always draws over the cap it
    // is standing on — they share a y, and a tie would otherwise resolve arbitrarily.
    if (this.throne) {
      items.push({ depthY: this.y - 0.5, draw: (ctx) => this.drawPillar(ctx, this.throne) });
    }
    return items;
  }

  // Sand is in the air, not on the floor — it passes over everything.
  drawOverlayEffects(ctx) {
    for (const b of this.bolts) this.drawBolt(ctx, b);
  }

  // What the pillar does to the FLOOR. This is what sells the stone as part of the terrain rather
  // than a sprite resting on it: the ground is visibly broken open where the column comes through,
  // and there is no free-floating drop shadow — the old version had a soft ellipse offset BELOW
  // the base, which is exactly the cue something hovering gives.
  drawPillarSocket(ctx, p) {
    const rise = pillarRise(p);
    const R = p.size * 0.5;
    ctx.save();
    ctx.translate(p.x, p.y);

    // Cracks torn through the floor, radiating from where it broke through
    ctx.globalAlpha = 0.75 * rise;
    ctx.strokeStyle = "rgba(11,11,20,0.85)";
    ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const a = p.seed * 1.7 + i * (Math.PI * 2 / 9) + Math.sin(p.seed + i) * 0.3;
      const len = R * (1.35 + 1.25 * ((i * 5) % 7) / 7);
      ctx.lineWidth = 2.6 - (i % 3) * 0.6;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.385);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len * 0.55);
      ctx.stroke();
    }

    // The socket: upheaved floor around the hole, then the dark opening itself. Both flattened
    // in y, so they read as lying ON the ground plane rather than standing up off it.
    ctx.globalAlpha = rise;
    ctx.fillStyle = "#2a2a48";
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.24, R * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0d0d1a";
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.98, R * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();

    // Slabs levered up around the rim, seated flat on the floor
    ctx.fillStyle = "#20203c";
    ctx.strokeStyle = "rgba(8,8,14,0.85)";
    ctx.lineWidth = 1.4;
    for (const c of p.chips) {
      ctx.save();
      ctx.translate(Math.cos(c.a) * R * c.d * 1.25, Math.sin(c.a) * R * c.d * 0.62);
      ctx.rotate(c.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, R * c.w, R * c.h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawPillar(ctx, p) {
    // Eased rather than linear: it heaves up fast at first and then grinds to a halt, which is
    // what a heavy thing forcing its way out of the ground does. A straight ramp over 1.25s reads
    // as the stone being winched up at a constant speed.
    const rise = pillarRise(p);
    const w = p.size * 0.5;
    const h = p.height * rise;
    // Landed and breaking apart. It holds the fully-fallen angle and comes to pieces in place,
    // rather than blinking out of existence the instant it hits the floor.
    const crumble = p.crumbleTimer > 0 ? 1 - p.crumbleTimer / EARTHMAGE_CRUMBLE_TIME : 0;

    ctx.save();
    ctx.translate(p.x, p.y);

    if (p.toppling || crumble > 0) {
      // Pivots about its base toward whatever it was aimed at, accelerating as it goes over.
      //
      // Worked in terms of the column's WORLD direction rather than by composing rotations. The
      // shaft is drawn along local -y, so a canvas rotation of phi points it at
      // atan2(-cos phi, sin phi) — which means the rotation that leaves it pointing along
      // `columnAngle` is exactly columnAngle + PI/2. Standing is columnAngle == -PI/2 (straight
      // up), landed is columnAngle == toppleAngle, and the fall interpolates between them.
      //
      // Composing rotate(toppleAngle - PI/2) then rotate(-fall) looked equivalent and was not:
      // it started the column pointing opposite its target and finished 90 degrees off it.
      // Straight off the integrated tilt — no separate easing curve, so what is drawn is exactly
      // where the physics says the column is.
      const ease = p.falling ? p.fallProgress : 1;
      let delta = p.toppleAngle + Math.PI / 2;              // from straight up round to the target
      delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // the short way round
      ctx.rotate(-Math.PI / 2 + delta * ease + Math.PI / 2);
    }

    if (crumble > 0) {
      // Breaks into bands down its length, which slump apart and fade — masonry coming to pieces
      // rather than one shape dissolving. The far end lets go first, as it would.
      ctx.globalAlpha = 1 - crumble;
      // Breaks along its OWN courses, so the pieces are the blocks it was visibly built from.
      const list = this.courseList(p);
      for (let i = 0; i < list.length; i++) {
        const f0 = list[i].bottom, f1 = list[i].top;
        ctx.save();
        // Deliberately small offsets: the blocks settle and part slightly, they do not scatter.
        // At larger values this stopped reading as one column coming apart and turned into a
        // handful of unrelated slabs lying around.
        ctx.translate(Math.sin(p.seed + i * 2.3) * crumble * w * 0.45,
                      h * crumble * (0.06 + f0 * 0.16));
        ctx.rotate(Math.sin(p.seed * 2 + i) * crumble * 0.18);
        const g = ctx.createLinearGradient(-w, 0, w, 0);
        g.addColorStop(0, EARTH_STONE_LIGHT);
        g.addColorStop(0.45, EARTH_STONE_MID);
        g.addColorStop(1, EARTH_STONE_DARK);
        ctx.fillStyle = g;
        ctx.strokeStyle = "rgba(16,12,8,0.7)";
        ctx.lineWidth = 1.6;
        const wTop = w * (1 - 0.26 * f1), wBot = w * (1 - 0.26 * f0);
        ctx.beginPath();
        ctx.moveTo(-wBot, -h * f0);
        ctx.lineTo(-wTop, -h * f1);
        ctx.lineTo(wTop, -h * f1);
        ctx.lineTo(wBot, -h * f0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      return;
    }

    // The shaft, drawn course by course from the base up. Each one is its own quad with its own
    // tone and a lit top lip, so the column has real stacked geometry instead of a flat body with
    // horizontal lines painted across it.
    const widthAt = (f) => w * (1 - 0.26 * f);      // taper toward the cap

    for (const c of this.courseList(p)) {
      const yb = -h * c.bottom, yt = -h * c.top;
      const wb = widthAt(c.bottom), wt = widthAt(c.top);
      const jb = w * c.jitter, jt = w * c.jitter * 0.5;

      const g = ctx.createLinearGradient(-wb, 0, wb, 0);
      g.addColorStop(0, shadeStone(EARTH_STONE_LIGHT, c.tone));
      g.addColorStop(0.38, shadeStone(EARTH_STONE_MID, c.tone));
      g.addColorStop(0.8, shadeStone(EARTH_STONE_DARK, c.tone));
      g.addColorStop(1, shadeStone("#2b241a", c.tone));
      ctx.fillStyle = g;
      ctx.strokeStyle = "rgba(14,10,6,0.55)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-wb + jb, yb + w * c.tilt);
      ctx.lineTo(-wt + jt, yt);
      ctx.lineTo(wt + jt, yt);
      ctx.lineTo(wb + jb, yb - w * c.tilt);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // The lit lip along the top of each course — the single strongest cue that these are
      // separate blocks resting on each other rather than one continuous surface.
      ctx.strokeStyle = "rgba(226,210,178,0.32)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-wt + jt, yt + 1);
      ctx.lineTo(wt + jt, yt + 1);
      ctx.stroke();
      // and a deep seam under it
      ctx.strokeStyle = "rgba(10,7,4,0.5)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-wt + jt, yt + 3);
      ctx.lineTo(wt + jt, yt + 3);
      ctx.stroke();
    }

    // Detail painted over the stack, clipped to the silhouette
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-w, p.size * 0.16);
    ctx.lineTo(-widthAt(1), -h);
    ctx.lineTo(widthAt(1), -h);
    ctx.lineTo(w, p.size * 0.16);
    ctx.closePath();
    ctx.clip();

    // Mineral flecks
    for (const fl of p.flecks) {
      ctx.globalAlpha = fl.a;
      ctx.fillStyle = fl.light ? "#d8cdb4" : "#2a2116";
      ctx.beginPath();
      ctx.arc(fl.lat * widthAt(fl.f), -h * fl.f, w * fl.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // A vertical fissure running part-way down the face
    ctx.strokeStyle = "rgba(12,8,5,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w * 0.18, -h * 0.94);
    ctx.quadraticCurveTo(w * 0.06, -h * 0.6, -w * 0.1, -h * 0.24);
    ctx.stroke();

    // A dark wash at the very foot, so the stone SINKS into its socket instead of stopping dead
    // against the floor — the other half of not looking like it is hovering.
    const foot = ctx.createLinearGradient(0, p.size * 0.16, 0, -p.size * 0.6);
    foot.addColorStop(0, "rgba(6,6,12,0.82)");
    foot.addColorStop(1, "rgba(6,6,12,0)");
    ctx.fillStyle = foot;
    ctx.fillRect(-w, -p.size * 0.6, w * 2, p.size * 0.8);
    ctx.restore();

    // Cap: rim, then a darker inner face, so the top is a surface with depth
    const capW = widthAt(1);
    ctx.fillStyle = "#b9a68a";
    ctx.strokeStyle = "rgba(16,12,8,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -h, capW, capW * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(58,48,34,0.45)";
    ctx.beginPath();
    ctx.ellipse(capW * 0.12, -h + capW * 0.06, capW * 0.66, capW * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // The courses for a pillar, falling back to a plain single block for anything constructed
  // before this existed (nothing does, but drawPillar should never be the thing that throws).
  courseList(p) {
    return p.courses && p.courses.length
      ? p.courses
      : [{ bottom: 0, top: 1, jitter: 0, tone: 1, tilt: 0 }];
  }

  // A churning cloud rather than a ball with dots on it: layered translucent puffs that rotate
  // against each other, a darker leading edge where it packs up against the air, and wisps
  // trailing off the back. Everything scales off sandBoltStats().radius, which is also the hit
  // radius — so the cloud drawn is always exactly the cloud that connects.
  drawBolt(ctx, b) {
    const now = performance.now() / 1000;
    const st = sandBoltStats(b);
    const R = st.radius;
    ctx.save();
    ctx.translate(b.x, b.y);

    // Trailing wisps, in world space behind the direction of travel
    ctx.save();
    ctx.rotate(b.angle);
    for (let i = 0; i < 5; i++) {
      const back = R * (0.7 + i * 0.62);
      const sway = Math.sin(now * 9 - i * 0.9 + b.grains[i].seed) * R * 0.3;
      ctx.globalAlpha = 0.3 * (1 - i / 5);
      ctx.fillStyle = "#a8874c";
      ctx.beginPath();
      ctx.ellipse(-back, sway, R * (0.5 - i * 0.07), R * (0.32 - i * 0.045), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Body: three overlapping puffs turning at different rates, which is what makes it churn
    for (let i = 0; i < 3; i++) {
      const spin = now * (1.6 + i * 0.9) + b.grains[i].seed;
      const off = R * 0.2;
      ctx.save();
      ctx.rotate(spin * (i % 2 ? -1 : 1));
      const g = ctx.createRadialGradient(-off * 0.4, -off * 0.4, 0, 0, 0, R * (0.95 - i * 0.14));
      g.addColorStop(0, i === 0 ? "rgba(232,206,150,0.75)" : "rgba(201,168,106,0.5)");
      g.addColorStop(0.65, "rgba(168,135,76,0.34)");
      g.addColorStop(1, "rgba(140,110,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(Math.cos(i * 2.1) * off, Math.sin(i * 2.1) * off,
                  R * (0.95 - i * 0.14), R * (0.8 - i * 0.12), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Grains tumbling through it
    ctx.save();
    ctx.rotate(b.angle);
    for (const gr of b.grains) {
      const back = -gr.off * R * 1.5;
      const lat = gr.lat * R * 0.5 * Math.sin(now * 13 + gr.seed);
      ctx.globalAlpha = 0.45 + 0.45 * (1 - gr.off);
      ctx.fillStyle = EARTH_SAND[Math.floor(gr.seed * 4) % EARTH_SAND.length];
      ctx.beginPath();
      ctx.arc(back, lat, R * 0.13 * gr.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // The packed leading edge — a bright crescent on the side it is travelling toward
    ctx.globalAlpha = 0.85;
    ctx.save();
    ctx.rotate(b.angle);
    const lead = ctx.createRadialGradient(R * 0.34, 0, 0, R * 0.34, 0, R * 0.6);
    lead.addColorStop(0, "rgba(244,226,180,0.9)");
    lead.addColorStop(1, "rgba(216,188,132,0)");
    ctx.fillStyle = lead;
    ctx.beginPath();
    ctx.arc(R * 0.34, 0, R * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawBody(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const breathe = 1 + Math.sin(t * 1.3 + this.bodySeed) * 0.02;
    const side = Math.cos(this.facingAngle) >= 0 ? 1 : -1;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(breathe, breathe);

    // Contact shadow, so it sits in the arena rather than floating over it
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(r * 0.1, r * 0.93, r * 0.72, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Robe — the body circle, lit from the upper left and deepening to near-black at the hem.
    const robe = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.06, 0, 0, r);
    robe.addColorStop(0, EARTH_ROBE_LIGHT);
    robe.addColorStop(0.45, EARTH_ROBE_MID);
    robe.addColorStop(0.8, EARTH_ROBE_DARK);
    robe.addColorStop(1, EARTH_ROBE_HEM);
    ctx.fillStyle = robe;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Everything painted onto the robe is clipped to it, so no detail spills past the silhouette
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.995, 0, Math.PI * 2);
    ctx.clip();

    // Robe folds
    ctx.strokeStyle = "rgba(40,28,14,0.32)";
    ctx.lineCap = "round";
    for (let i = -2; i <= 2; i++) {
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.moveTo(i * r * 0.24, r * 0.18);
      ctx.quadraticCurveTo(i * r * 0.3, r * 0.6, i * r * 0.36, r * 1.05);
      ctx.stroke();
    }

    // Hem band, set with dull stones instead of the Fire Mage's burning runes
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(30,22,10,0.6)";
    ctx.lineWidth = r * 0.19;
    ctx.stroke();
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.16 + (i / 6) * Math.PI * 0.68;
      ctx.fillStyle = i % 2 ? EARTH_STONE_LIGHT : EARTH_STONE_MID;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hood: a heavy cowl with a dark opening and two steady eyes
    ctx.fillStyle = EARTH_ROBE_DARK;
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, -r * 0.1);
    ctx.quadraticCurveTo(-r * 0.6, -r * 1.0, 0, -r * 0.95);
    ctx.quadraticCurveTo(r * 0.6, -r * 1.0, r * 0.72, -r * 0.1);
    ctx.quadraticCurveTo(0, -r * 0.34, -r * 0.72, -r * 0.1);
    ctx.closePath();
    ctx.fill();
    // The peak of the hood trails opposite the way it faces
    ctx.beginPath();
    ctx.moveTo(-side * r * 0.1, -r * 0.92);
    ctx.quadraticCurveTo(-side * r * 0.62, -r * 1.16, -side * r * 0.84, -r * 0.76);
    ctx.quadraticCurveTo(-side * r * 0.5, -r * 0.82, -side * r * 0.06, -r * 0.72);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#2a1d0d";   // hood interior, lifted with the rest of the robe
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.5, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8d49a";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * 0.16 + side * r * 0.05, -r * 0.5, r * 0.07, r * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();   // end robe clip

    ctx.restore();   // end body transform

    // Motes of dust drifting around it, the earth equivalent of the Fire Mage's rising embers.
    // Outside the clip so they can leave the silhouette.
    ctx.save();
    for (const d of this.dust) {
      const a = d.angle + t * d.speed * 0.5;
      const dist = r * (d.dist + Math.sin(t * d.speed + d.seed) * 0.08);
      ctx.globalAlpha = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.6 + d.seed));
      ctx.fillStyle = "#c9a86a";
      ctx.beginPath();
      ctx.arc(this.x + Math.cos(a) * dist, this.y + Math.sin(a) * dist * 0.7 + r * 0.2,
              r * d.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    this.drawStaff(ctx, r, t);
  }

  drawStaff(ctx, r, t) {
    const swing = this.castAmount;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.facingAngle + swing * 0.5);

    const len = r * 1.5;
    ctx.strokeStyle = "#5a4326";
    ctx.lineWidth = r * 0.13;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 0.25, r * 0.25);
    ctx.lineTo(len, -r * 0.3);
    ctx.stroke();

    // Head of the staff: a rough stone lashed to the shaft, glowing as the next bolt charges
    const charge = 1 - Math.max(0, this.boltTimer) / EARTHMAGE_SAND_COOLDOWN;
    ctx.fillStyle = EARTH_STONE_MID;
    ctx.strokeStyle = "rgba(16,12,8,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(len - r * 0.16, -r * 0.2);
    ctx.lineTo(len + r * 0.02, -r * 0.46);
    ctx.lineTo(len + r * 0.2, -r * 0.26);
    ctx.lineTo(len + r * 0.1, -r * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (charge > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = charge * 0.55;
      const g = ctx.createRadialGradient(len, -r * 0.26, 0, len, -r * 0.26, r * 0.4);
      g.addColorStop(0, "#e8c07a");
      g.addColorStop(1, "rgba(232,192,122,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(len, -r * 0.26, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
