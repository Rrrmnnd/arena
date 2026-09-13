// Poop Man — the slow specialist.
//
// The only character in the cast that debuffs movement rather than taking health or taking
// control (see Character.applySlow, which exists for this character and nothing else). Its whole
// identity is one idea at two scales: the ordinary attack drops a patch of muck that slows
// whatever walks through it, and the ultimate turns the entire floor into that patch.
//
// The ultimate is two beats, and the first one is the joke: he plants himself, swells up, goes
// red and then purple, shakes hard enough to rattle the camera and sweats visibly — completely
// helpless for 1.8 seconds — and then delivers a boulder-sized turd that rolls off across the
// arena, bouncing off the walls for eight seconds and flattening whatever it catches.
//
// It replaced a flood that spread a brown circle over the floor and did no damage at all. That
// version was mechanically fine and had no spectacle whatsoever: ten seconds of one colour
// filling in, with nothing to point at. The strain is the payoff and the boulder is the threat.

// 1.15x a regular character (CHAR_BASE_SIZE 60). Linear, so he is 15% wider and taller and
// covers about 32% more floor. Everything in drawBody is expressed in r = size/2, and the
// shot spawns at 0.34*size, so both follow this on their own; the muck constants below are
// deliberately NOT tied to it, since the splat and the flood are tuned to the arena.
const POOP_SIZE     = 69;
// The cast's baseline — Angel, Archer, Earth Mage, Fire Mage and Ninja all sit here too. He
// used to have 110.
const POOP_MAX_HP   = 100;
const POOP_SPEED    = 250;
const POOP_COLOR    = "#e8b98e";   // the body: skin

// The muck. One palette shared by the shots, the patches and the flood, so they read as the
// same substance at three sizes.
const POOP_BROWN_DARK = "#4a2c14";
const POOP_BROWN      = "#6b4220";
const POOP_BROWN_MID  = "#8a5a2c";
const POOP_BROWN_LIT  = "#a97440";
const POOP_SHEEN      = "#c79a63";

// ---- the ordinary attack: a lobbed shot that leaves a patch where it lands
const POOP_SHOT_COOLDOWN = 1.7;
// The shot is wound up before it exists, the same beat as the Bomber planting a bomb: it stops,
// the muck visibly swells out of it, and only then does anything leave. Before this the shot
// simply appeared out of a character that was still walking, so there was nothing to react to.
// Rooted for the wind-up, which (like the Bomber) also means no knockback lands on it for those
// frames — see the movable getter.
const POOP_FIRE_WINDUP   = 0.34;
// Flat. Every shot does this to anything it hits, full stop.
//
// There used to be a POOP_SLOWED_BONUS of 1.75 on top of it whenever the target was already
// slowed, which made the reload/slow-duration margin (1.7s against 2.0s) load-bearing: the whole
// point of the first shot was to set up the second. That is gone — a hit is a hit now, and the
// slow below is worth having for what it actually does to their movement rather than as a
// multiplier on his own next shot.
const POOP_SHOT_DAMAGE   = 8;
// Recoil. Firing something this size out of that end throws him the other way — the shot is a
// jet, so he is the thing it is jetting off. Applied through applyKnockback, so it rides the same
// decaying impulse layer as every other shove in the game (KNOCKBACK_DECAY_RATE) and is subject to
// the same walls; the distance it actually carries him is roughly strength / 2.5.
const POOP_SHOT_SELF_KB  = 300;    // ~120px of travel
const POOP_SHOT_SPEED    = 620;
const POOP_SHOT_RADIUS   = 15;
// A fraction of NORMAL pace, not of whatever pace they are already at: applySlow takes the
// harshest multiplier in force rather than multiplying them together (see character.js), so this
// cannot compound with the splats (0.7) or the flood (0.4) down toward zero — the strongest one
// simply wins for as long as it lasts.
const POOP_SHOT_SLOW     = 0.55;
const POOP_SHOT_SLOW_TIME = 2.0;

// ---- every third attack is not a shot at all: he lets go completely and hoses a cone down the
// line at whatever he is facing. Same slot in the rotation as an ordinary shot, same wind-up
// before it, so the tell is identical right up until nothing leaves and everything does.
const POOP_SPRAY_EVERY   = 3;            // 1, 2, SPRAY, 4, 5, SPRAY, ...
const POOP_SPRAY_TIME    = 3.0;
const POOP_SPRAY_TICK    = 0.25;         // how often being in the cone costs them
const POOP_SPRAY_DAMAGE  = 3;            // = 12/s while they stay in it, 36 for the full three
// Total, not half — inSprayCone and drawSpray both take half of this off either side of the
// facing angle. Written out of degrees rather than as a fraction of PI so the number in the
// source is the number you would say out loud.
const POOP_SPRAY_ARC     = (50 * Math.PI) / 180;
const POOP_SPRAY_RANGE   = 350;
// The cone keeps slowing, exactly like the shot it replaces — every other thing he puts on the
// floor or on a target does, and a spray of the same muck that did not would be the odd one out.
const POOP_SPRAY_SELF_KB = 110;          // per tick: it is a jet, so it keeps shoving him back

// ---- the trail. Anything currently wading drags the muck along behind it: while a target is
// slowed it leaves a smear every POOP_TRAIL_STEP world units it walks, so you can read where a
// hit target has been and how far the slow carried it.
//
// Cosmetic ONLY. It deliberately does not slow anything itself — a trail that re-slowed whoever
// walked over it would refresh its own condition every step and one hit would never wear off.
const POOP_TRAIL_STEP = 24;
const POOP_TRAIL_LIFE = 3.0;
const POOP_TRAIL_MAX  = 76;
// The splat it leaves behind. Slows anything standing in it, so a shot that misses still shapes
// where the opponent is willing to walk.
const POOP_SPLAT_RADIUS  = 62;
const POOP_SPLAT_LIFE    = 6.0;
const POOP_SPLAT_SLOW    = 0.7;
const POOP_SPLAT_SLOW_TIME = 0.35;  // refreshed every frame while standing in one
const POOP_SPLAT_MAX     = 6;

// ---- the victory: he turns his back on the camera and hoses the lens.
//
// Budgeted against ROUND_END_GRACE (3.0s in main.js), which is all the time there is before the
// round flips to "prompting" and update() stops being called: 0.85 + 0.20 leaves the splat about
// two full seconds on screen, which is what actually gets recorded.
const POOP_VICTORY_WINDUP = 0.85;   // rooted, reddening, aiming at the fourth wall
const POOP_VICTORY_FLIGHT = 0.20;   // the lump closing on the lens
const POOP_VICTORY_DRIP   = 1.10;   // how long the runs take to reach their full length

// ---- the ultimate: strain, then a boulder
const POOP_ULT_INTERVAL = 18.0;   // starts counting again only once the boulder is gone
const POOP_ULT_STRAIN   = 1.8;    // rooted, inflating, red then purple. He cannot answer anything.
const POOP_ULT_BIRTH    = 0.35;   // the pop itself
// Every point of ACTUAL damage he lands — shots and boulder contact alike, funnelled through
// dealDamage() below — shaves this much off the wait for the next one. "Actual" means the real
// HP loss (after bleed multipliers, capped by whatever the target had left), not the raw number
// passed in, so finishing off a target with 2 HP left only ever banks 2 damage worth of CDR.
const POOP_ULT_CDR_PER_DAMAGE = 0.05;

// The boulder's diameter, as a multiple of his own. Tied to his own size rather than the arena
// now — it used to be a fraction of the floor (so it stayed proportionate across the portrait and
// landscape layouts), but four of his own body is bigger than that ever was in either one, so the
// arena-relative version is moot: this always wins.
const POOP_BOULDER_SIZE_MULT = 4;
// A ceiling relative to the arena, purely defensive: nothing today ever reaches it (4x his own
// 69 is 276px across, comfortably under half of even the tighter 490px landscape height), but a
// future smaller arena should degrade to "as big as the floor allows" rather than to a boulder
// that cannot fit between the walls at all.
const POOP_BOULDER_MAX_R  = 0.42;   // of min(arena w, h)
// Also the speed anything it is leaning on gets pushed along at, so raising this makes the
// bulldozing firmer as well as the boulder itself quicker.
const POOP_BOULDER_SPEED  = 420;
// Was 5.0. Longer, so a swing this big is a fixture of the fight for a while rather than a quick
// in-and-out — see the tuning history for the earlier 8.0 -> 6.0 -> 5.0 walk-down, which was
// entirely about a boulder that hit far harder per second than this one does now.
const POOP_BOULDER_LIFE   = 8.0;
const POOP_BOULDER_SHRINK = 0.45;   // what it has worn down to by the end
// Per contact tick, so the real figure is this every POOP_BOULDER_HIT_CD for as long as a
// body stays under it. Walked 22 -> 14 -> 9 -> 6 as the contact model got stickier, then back up
// twice (+1, +1) once it stopped double-counting as a single knockback hit and started feeding
// the ultimate's own cooldown reduction instead (see POOP_ULT_CDR_PER_DAMAGE).
const POOP_BOULDER_DAMAGE = 12;
const POOP_BOULDER_SLOW   = 0.45;
const POOP_BOULDER_SLOW_TIME = 2.5;
// Per target. It is a solid now, so a target caught in front of it stays in contact for as long
// as it takes to get out of the way — this is how often that contact costs them, not how often
// they can be clipped in passing.
const POOP_BOULDER_HIT_CD = 0.4;
// The pop's own recoil, and the whole point of the joke: he is not gently nudged by delivering
// something four times his own size, he is fired across the arena by it. Deliberately well over
// KNOCKBACK_TURN_MIN (400) so the engine's "turn to head the way you were thrown" also engages
// and he ends up genuinely travelling, not just sliding sideways while still facing the enemy.
const POOP_ULT_SELF_KB   = 800;    // ~320px of travel, over half the portrait arena
// It shoves its owner too — he is not immune to his own boulder, he is just not damaged by it.
// Being bulldozed by the thing you just produced is most of the joke, and taking damage off
// himself every time it caught him would have made the ultimate a net loss to use.
//
// The push a body gets while it is in contact, on top of being placed out of the way: without it
// the target's own steering walks it straight back in every frame and the contact reads as a
// stutter instead of as being shoved along the floor.
//
// An ACCELERATION, not a target speed set outright. Snapping the along-axis component straight to
// its final value made contact look like a catapult: the body left at full speed on the first
// frame it was touched and kept it after the boulder had gone. At 2200 it takes about 0.15s to
// come up to the boulder's pace, which is what being leaned on looks like. Capped at the
// boulder's own speed, so nothing it touches ever ends up outrunning it.
const POOP_BOULDER_PUSH_ACCEL = 2200;
const POOP_BOULDER_ROAD_STEP = 30;  // world units between smears in the road it leaves
// How far past the silhouette the dark outline is laid down. It is the boulder's true edge on
// screen, so both drawBoulder and boulderClearance read it — if they ever disagree, bodies either
// sink into the ink or float off it.
const POOP_BOULDER_OUTLINE_SCALE = 1.06;

// Blends two #rrggbb strings. Only used by the strain, which walks the whole body from skin
// through red to purple as it builds — doing that by swapping in flat colours at thresholds made
// it snap between three characters instead of one going redder.
function poopMix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const m = (sh) => Math.round((((pa >> sh) & 255) * (1 - k)) + (((pb >> sh) & 255) * k));
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

function poopEase(t) {
  return t * t * (3 - 2 * t);
}

class PoopShot {
  constructor(x, y, vx, vy) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.spin = Math.random() * Math.PI * 2;
    this.life = 2.2;
    this.wobble = Math.random() * Math.PI * 2;
  }
}

class PoopMan extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: POOP_SIZE,
      color: POOP_COLOR,
      maxHp: POOP_MAX_HP,
      name: "Poop Man",
      nameZh: "大便人",
      speed: POOP_SPEED,
    });

    this.shots = [];
    this.splats = [];            // [{ x, y, r, life, maxLife, blobs }]
    this.trail = [];             // smears dragged along by anything currently slowed
    this.trailAnchor = new WeakMap();   // target -> where it last dropped one
    this.shotTimer = POOP_SHOT_COOLDOWN;
    this.attackCount = 0;        // every POOP_SPRAY_EVERY-th one is the cone instead of a shot
    this.sprayTimer = 0;         // >0 while the cone is running
    this.sprayTick = 0;          // counts down to the next time the cone costs anything
    this.sprayWobble = 0;        // drives the sputter in the drawing
    this.clenchTimer = 0;        // >0 briefly after firing: the recoil
    this.fireWindup = 0;         // >0 while rooted, building the shot up before it launches

    this.ultTimer = POOP_ULT_INTERVAL;
    this.ultActive = false;
    this.ultPhase = null;        // "strain" | "birth"
    this.phaseTimer = 0;
    this.strainAmount = 0;       // 0..1, how far into the squeeze
    this.sweatTimer = 0;
    this.boulder = null;         // outlives ultActive, and outlives him
    // The last real opponent handed to update(). blocksRoundEnd is a property and has no
    // opponent of its own to look at, and it needs to know whether there is still anybody left
    // for the boulder to catch. Only ever overwritten with a non-null one, so a target that goes
    // momentarily untargetable (a Ninja in its own smoke, which main.js passes as null) does not
    // erase it — the reference is kept and its own `alive` is read directly.
    this.lastFoe = null;
    // Held so they can be cut short. The spray clip is long enough to outlive the thing it is
    // describing if that gets interrupted — a 3.29s voice over a spray a stun ended after half a
    // second would be the only thing left making noise. See silence().
    this.sprayVoice = null;
    this.ultVoice = null;
    this.rollVoice = null;      // the boulder's rolling loop — see playSfxLoop in sfx.js
    this.rollTune = 0;          // throttles how often the loop's level is re-ridden

    // main.js draws drawVictoryOverlay() over everything for anyone flagged celebratingVictory,
    // and stops calling update() at all once the round reaches "prompting" — see ROUND_END_GRACE.
    this.celebrating = false;
    this.celebratingVictory = false;
    this.victoryTimer = 0;
    this.victoryFired = false;
    this.victoryLanded = false;
    this.victorySweat = 0;
    this.victorySplat = null;
    this.sitAmount = 0;          // 0..1, how far down it has sat
    this.bodySeed = Math.random() * Math.PI * 2;
  }

  get palette() {
    return [POOP_BROWN, POOP_BROWN_MID, POOP_BROWN_LIT];
  }

  // Rooted for the strain and the pop, and for nothing after: once the boulder is out it rolls
  // under its own weight and he is free again. He is NOT knockback-immune while straining —
  // movable is left alone and only the velocity is held at zero — because the whole point of the
  // wind-up is that it is the window in which he can be punished.
  get movable() {
    if (this.fireWindup > 0) return false;
    return super.movable;
  }
  set movable(v) { super.movable = v; }

  // Fills while charging, then drains across the boulder's own life, so the bar reads as "the
  // boulder is still out there" rather than going blank the moment it leaves him.
  get ultimateRatio() {
    const clamp = (v) => Math.max(0, Math.min(1, v));
    if (this.ultActive) return clamp(this.phaseTimer / (POOP_ULT_STRAIN + POOP_ULT_BIRTH));
    if (this.boulder) return clamp(this.boulder.life / POOP_BOULDER_LIFE);
    return clamp(1 - this.ultTimer / POOP_ULT_INTERVAL);
  }

  get ultimateBarColor() {
    return POOP_BROWN_MID;
  }

  // The strain AND the rolling boulder both hold the round open: while the boulder is still out
  // there, nobody has won yet.
  //
  // This is what makes a posthumous kill possible. The boulder does not damage its owner and goes
  // on rolling after he dies (updateBoulder runs unconditionally, before update()'s alive check —
  // the same rule the Archer's arrows and the Earth Mage's falling pillars follow), so a Poop Man
  // who dies with one out can still have it run the other one down and turn a loss into a draw.
  //
  // It cannot hang the round: b.life is decremented at the top of updateBoulder every frame, dead
  // owner or not, and the boulder is dropped the moment it reaches zero — so this can hold the
  // round open for at most POOP_BOULDER_LIFE. That unconditional tick is exactly what the Earth
  // Mage's own comment warns about: its pillars once froze mid-fall on the caster's death with
  // `falling` still set, and blocksRoundEnd then held the round open forever.
  get blocksRoundEnd() {
    return super.blocksRoundEnd || this.ultActive || this.boulderCouldStillDecideIt;
  }

  // The rolling boulder only holds the round open while it could still CHANGE the result, which
  // is exactly one configuration: he is down and the other one is not. Then it may still run them
  // over and turn his loss into a draw, and that is worth waiting for.
  //
  // Every other configuration used to be held open too, and all of them were dead time:
  //   - he is the one left standing: the other one is already down and the boulder cannot hurt
  //     its own owner, so the round is his. It ends now instead of after up to eight more
  //     seconds of watching a boulder roll around an empty arena.
  //   - both down: already a draw, and nothing the boulder does can move it either way.
  get boulderCouldStillDecideIt() {
    return this.boulder !== null && !this.alive && this.lastFoe !== null && this.lastFoe.alive;
  }

  drawHud(ctx, x, y, w) {
    const ny = super.drawHud(ctx, x, y, w);
    if (this.ultActive) {
      this.drawHudNote(ctx, x, ny, L("STRAINING", "用力中"), "#e8604a");
      return ny + 16;
    }
    if (this.boulder) {
      this.drawHudNote(ctx, x, ny, L("BOULDER LOOSE", "巨石滾動中"), POOP_BROWN_LIT);
      return ny + 16;
    }
    if (this.sprayTimer > 0) {
      this.drawHudNote(ctx, x, ny, L("SPRAYING", "狂噴中"), POOP_SHEEN);
      return ny + 16;
    }
    return ny;
  }

  // Cuts one of the held voices off, if it is still going. Safe to call on a node that already
  // finished on its own, which is the normal case — an uninterrupted spray or strain outlives
  // nothing and this just no-ops.
  silence(node) {
    if (node) { try { node.stop(); } catch (e) { /* already ended */ } }
    return null;
  }

  // The same, for a playSfxLoop handle, which takes a fade rather than stopping dead.
  silenceLoop(handle, fade = 0.22) {
    if (handle) { try { handle.stop(fade); } catch (e) {} }
    return null;
  }

  // The teardown hook main.js and team5.js look for by name when this fighter is discarded
  // mid-round — without it a spray voice would carry on into the next round over a character
  // that no longer exists.
  stopAllPoopSounds() {
    this.sprayVoice = this.silence(this.sprayVoice);
    this.ultVoice = this.silence(this.ultVoice);
    this.rollVoice = this.silenceLoop(this.rollVoice, 0.06);
  }

  // ---------------------------------------------------------------- the ultimate
  beginStrain() {
    this.ultActive = true;
    this.ultPhase = "strain";
    this.phaseTimer = POOP_ULT_STRAIN;
    this.strainAmount = 0;
    this.sweatTimer = 0;
    triggerShake(3, 0.25);
  }

  // Nothing here resets ultTimer: the cooldown does not start until the boulder is gone (see
  // updateBoulder), so the cadence is strain + roll + 18s rather than 18s flat.
  endStrain() {
    this.ultActive = false;
    this.ultPhase = null;
    this.strainAmount = 0;
    this.sitAmount = 0;
    // He comes out of this still being carried by the pop's recoil. updateUlt held vx/vy at zero
    // for the whole phase, so he has no heading of his own left; point it down the impulse, or
    // the instant that decays he turns round and walks straight back at what he just fired.
    const kb = Math.hypot(this.knockbackVx, this.knockbackVy);
    const a = kb > 1 ? Math.atan2(this.knockbackVy, this.knockbackVx)
                     : Math.random() * Math.PI * 2;
    this.vx = Math.cos(a) * this.speed;
    this.vy = Math.sin(a) * this.speed;
  }

  updateUlt(dt, opponent) {
    if (!this.ultActive) {
      // Charging only once nothing of the last one is left on the floor.
      if (!this.boulder) this.ultTimer -= dt;
      this.sitAmount = Math.max(0, this.sitAmount - dt * 3);
      this.strainAmount = Math.max(0, this.strainAmount - dt * 4);
      if (this.ultTimer <= 0 && this.canAttack && !this.boulder) this.beginStrain();
      return;
    }

    this.phaseTimer -= dt;
    // Held still by hand rather than by movable, so a knockback can still throw him out of it —
    // the strain is meant to be the window where he is punishable.
    this.vx = 0;
    this.vy = 0;

    if (this.ultPhase === "strain") {
      this.strainAmount = Math.min(1, 1 - this.phaseTimer / POOP_ULT_STRAIN);
      this.sitAmount = this.strainAmount * 0.6;

      // Sweat, flicked off the rim. Rate climbs with the strain so the last half-second is a
      // shower rather than the same trickle as the first.
      this.sweatTimer -= dt;
      if (this.sweatTimer <= 0) {
        this.sweatTimer = 0.16 - this.strainAmount * 0.10;
        const a = Math.random() * Math.PI * 2;
        spawnImpactParticles(this.x + Math.cos(a) * this.size * 0.55,
                             this.y + Math.sin(a) * this.size * 0.55,
                             ["#dff0ff", "#b8dcff"], 2, 0.7, 260);
      }
      // The floor complaining, rising with him. Retriggered rather than held so it does not
      // stack into a permanent blur.
      if (Math.random() < dt * 8) triggerShake(1 + this.strainAmount * 6, 0.12);

      if (this.phaseTimer <= 0) {
        this.ultPhase = "birth";
        this.phaseTimer = POOP_ULT_BIRTH;
        this.spawnBoulder();
      }
    } else if (this.ultPhase === "birth") {
      this.strainAmount = Math.max(0, this.phaseTimer / POOP_ULT_BIRTH) * 0.5;
      this.sitAmount = this.strainAmount;
      if (this.phaseTimer <= 0) this.endStrain();
    }
  }

  boulderRadius(b) {
    return b.r0 * (POOP_BOULDER_SHRINK + (1 - POOP_BOULDER_SHRINK) * (b.life / POOP_BOULDER_LIFE));
  }

  spawnBoulder() {
    const a = this.hasFacedOpponent ? this.facingAngle : Math.random() * Math.PI * 2;
    const r0 = Math.min(this.size * POOP_BOULDER_SIZE_MULT / 2,
                        Math.min(ARENA.w, ARENA.h) * POOP_BOULDER_MAX_R);
    // Out of the back, clear of his own body, and clamped inside the walls so it cannot be born
    // already overlapping one and immediately bounce back through him. The offset is strictly
    // more than r0 + his own half-size (the *1.06 margin guarantees it for any r0), so the two
    // never touch at the moment of birth — at four times his own size the old fixed 0.9 factor
    // fell short of that by a visible margin instead of the sub-pixel amount it used to.
    const x = Math.max(ARENA.x + r0, Math.min(ARENA.x + ARENA.w - r0,
                       this.x + Math.cos(a) * (this.size * 0.5 + r0 * 1.06)));
    const y = Math.max(ARENA.y + r0, Math.min(ARENA.y + ARENA.h - r0,
                       this.y + Math.sin(a) * (this.size * 0.5 + r0 * 1.06)));
    this.boulder = {
      x, y,
      vx: Math.cos(a) * POOP_BOULDER_SPEED,
      vy: Math.sin(a) * POOP_BOULDER_SPEED,
      r0,
      life: POOP_BOULDER_LIFE,
      roll: 0,
      roadX: x, roadY: y,
      cd: new WeakMap(),
      // Fixed lumps, so the thing visibly ROTATES as it goes rather than boiling in place.
      lumps: Array.from({ length: 15 }, () => ({
        a: Math.random() * Math.PI * 2,
        d: 0.14 + Math.random() * 0.66,
        r: 0.20 + Math.random() * 0.22,
      })),
      // Fine grain on top of the lumps. At 276px across, a surface made only of twelve big bumps
      // is a very smooth 276px; this is what stops it reading as moulded plastic.
      speckle: Array.from({ length: 34 }, () => ({
        a: Math.random() * Math.PI * 2,
        d: Math.random() * 0.86,
        r: 0.012 + Math.random() * 0.03,
        dark: Math.random() < 0.62,
      })),
      // Two soft creases, to suggest something coiled rather than something quarried.
      creases: Array.from({ length: 2 }, (_, i) => ({
        a: Math.random() * Math.PI * 2,
        d: 0.10 + i * 0.34,
        w: 0.9 + Math.random() * 0.5,
      })),
      // The silhouette. Every radius here is a fraction of the collision radius and none of them
      // reaches 1, so the drawn shape is always strictly INSIDE the circle that does the
      // colliding — which is what makes "it never overlaps anybody" true on screen and not just
      // in the numbers. A shape that bulged past r would visibly bite into a body that the
      // physics had already placed clear of it.
      //
      // Two frequencies: a slow one for the big asymmetric mass, and a faster one for the
      // knobbles. One alone gave either an egg or a gear.
      outline: (() => {
        // Three harmonics with random phases, so no two boulders are the same shape: a lopsided
        // low frequency for the overall mass, a mid one for the big knobbles, and a fast one for
        // the surface. A single harmonic gave an egg; two gave a peanut.
        const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
        const raw = Array.from({ length: 30 }, (_, i) => {
          const a = (i / 30) * Math.PI * 2;
          return { a, k: 1 + 0.30 * Math.sin(a + p1) + 0.17 * Math.sin(a * 3 + p2)
                          + 0.085 * Math.sin(a * 6 + p3) + Math.random() * 0.05 };
        });
        // Normalised so the LARGEST radius, once the 1.06 outline underfill is applied, lands
        // exactly on the collision radius. That is what lets the silhouette be this lumpy and
        // still never cross into a body the physics has placed clear of the circle.
        const peak = Math.max(...raw.map((o) => o.k)) * POOP_BOULDER_OUTLINE_SCALE;
        for (const o of raw) o.k /= peak;
        return raw;
      })(),
    };
    // A last positional correction against its OWN owner, using the exact same solver that keeps
    // it clear of everyone for the rest of its life (see resolveSolids). dt=0 so it only moves the
    // position — no push, no cooldown tick, nothing else fires from it. Needed because the wall
    // clamp above chooses a legal centre for the boulder without knowing where he is standing; the
    // two constraints can disagree when he is deep enough in a corner or, at this size, simply
    // standing near the middle of the narrower portrait arena — the birth offset alone is not
    // always enough room to clear him before the wall says stop.
    this.resolveSolids(0, [this]);

    // The kick, and it is a big one. Straight back down the line the boulder just left along.
    // vx/vy are held at zero for the rest of the birth phase by updateUlt, but the knockback
    // layer is separate and moves him regardless — see endStrain for how the heading is picked
    // up again once the phase ends.
    this.applyKnockback(-Math.cos(a), -Math.sin(a), POOP_ULT_SELF_KB);
    spawnSmokePuff(this.x + Math.cos(a) * this.size * 0.6,
                   this.y + Math.sin(a) * this.size * 0.6, this.size * 1.5, 0.6);

    spawnImpactParticles(x, y, this.palette, 42, 2.0, 0);
    spawnSmokePuff(x, y, r0 * 1.8, 0.7);
    triggerShake(13, 0.45, true);
    // On the launch, not on the strain that led up to it: 1.65s of clip starting here covers the
    // 0.35s pop and rings on over the boulder's first second or so of rolling.
    this.ultVoice = playSfx("poopmanUlt", 0.85, 0.02);
    // Faded up rather than snapped on, so it arrives under the pop instead of beside it.
    this.rollVoice = this.silenceLoop(this.rollVoice);
    this.rollVoice = playSfxLoop("poopmanRoll", { volume: 0.5, fadeIn: 0.25 });
    this.rollTune = 0;
  }

  // Unconditional, like the shots and the splats: a boulder already rolling is a physical thing,
  // and killing the man who produced it does not take it back.
  updateBoulder(dt, opponent) {
    const b = this.boulder;
    if (!b) return;

    b.life -= dt;

    // Ridden rather than left flat: the boulder wears down to POOP_BOULDER_SHRINK of its size
    // across its life, so the roll thins out with it and is already most of the way down by the
    // time it goes. Re-scheduled a few times a second, not every frame — each call schedules an
    // automation event, and sixty a second is both pointless and expensive.
    if (this.rollVoice) {
      this.rollTune -= dt;
      if (this.rollTune <= 0) {
        this.rollTune = 0.14;
        const k = Math.max(0, Math.min(1, b.life / POOP_BOULDER_LIFE));
        this.rollVoice.setVolume(0.16 + 0.34 * k, 0.16);
        // A smaller boulder rumbles a little higher.
        this.rollVoice.setRate(1.16 - 0.16 * k, 0.16);
      }
    }

    if (b.life <= 0) {
      const r = this.boulderRadius(b);
      spawnImpactParticles(b.x, b.y, this.palette, 30, 1.6, 0);
      spawnSmokePuff(b.x, b.y, r * 1.6, 0.6);
      this.addSplat(b.x, b.y);
      this.rollVoice = this.silenceLoop(this.rollVoice, 0.3);
      this.boulder = null;
      // The cooldown starts here, not at the pop — but ultTimer is not simply SET to the fresh
      // interval. Damage the boulder landed during its own life banked negative onto ultTimer
      // (see dealDamage) while it was frozen and unable to tick down on its own; adding the
      // interval on top of that, rather than overwriting it, is what lets a boulder that did a
      // lot of contact damage shorten the wait for the next one. Clamped at 0 as a backstop —
      // reachable only if a single boulder ever banked more than a full 18s of reduction, which
      // takes ~360 damage of contact in one 5s life and is not something the current numbers get
      // close to.
      this.ultTimer = Math.max(0, this.ultTimer + POOP_ULT_INTERVAL);
      return;
    }

    const r = this.boulderRadius(b);
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Walls. Reflected rather than clamped, and the position is pushed back out of the wall in
    // the same frame, or a boulder that arrives at a corner fast enough sticks to it.
    //
    // Measured against the SILHOUETTE's reach toward each wall, not against the enclosing circle.
    // The circle is only touched by the single furthest point of a deliberately lumpy shape, so
    // bouncing on it meant every wall hit fired while there was still a visible gap — the amount
    // varying with whatever part of the shape happened to be facing the wall as it rolled. Each
    // extent is taken fresh because they turn with the boulder.
    const extL = this.boulderExtent(b, r, -1, 0);
    const extR = this.boulderExtent(b, r, 1, 0);
    const extU = this.boulderExtent(b, r, 0, -1);
    const extD = this.boulderExtent(b, r, 0, 1);
    if (b.x - extL < ARENA.x)             { b.x = ARENA.x + extL;            b.vx = Math.abs(b.vx); }
    if (b.x + extR > ARENA.x + ARENA.w)   { b.x = ARENA.x + ARENA.w - extR;  b.vx = -Math.abs(b.vx); }
    if (b.y - extU < ARENA.y)             { b.y = ARENA.y + extU;            b.vy = Math.abs(b.vy); }
    if (b.y + extD > ARENA.y + ARENA.h)   { b.y = ARENA.y + ARENA.h - extD;  b.vy = -Math.abs(b.vy); }

    // Rolling: turned by the ground it has covered over its own circumference, so the spin
    // always matches the speed instead of being a decorative constant.
    const step = Math.hypot(b.vx, b.vy) * dt;
    b.roll += step / Math.max(1, r);

    // The road. Spaced by distance, same rule as the drag trail, and laid into the same array so
    // it fades and is capped with everything else.
    if (Math.hypot(b.x - b.roadX, b.y - b.roadY) >= POOP_BOULDER_ROAD_STEP) {
      b.roadX = b.x; b.roadY = b.y;
      this.trail.push({
        x: b.x, y: b.y, r: r * (0.62 + Math.random() * 0.16),
        a: Math.random() * Math.PI * 2,
        life: POOP_TRAIL_LIFE,
        blobs: Array.from({ length: 3 }, () => ({
          a: Math.random() * Math.PI * 2, d: Math.random() * 0.6, r: 0.28 + Math.random() * 0.34,
        })),
      });
      while (this.trail.length > POOP_TRAIL_MAX) this.trail.shift();
    }

  }

  // How far the drawn silhouette actually reaches from the boulder's centre along (nx, ny) — the
  // support function of the shape, taken as the largest projection of any outline vertex.
  //
  // The curve is drawn as quadratic segments whose control points are these vertices, and a
  // quadratic Bezier never leaves the hull of its own three control points, so no part of the
  // drawn edge can project further along any direction than the furthest vertex does. Sound for
  // the walls, which are flat: the exact frame the ink touches the wall is the frame this reaches
  // it. Not usable for a round body — that is what boulderClearance is for.
  boulderExtent(b, r, nx, ny) {
    let best = 0;
    for (const o of b.outline) {
      const a = o.a + b.roll;
      const k = r * o.k * POOP_BOULDER_OUTLINE_SCALE;
      const proj = Math.cos(a) * k * nx + Math.sin(a) * k * ny;
      if (proj > best) best = proj;
    }
    return best;
  }

  // How far from the boulder's centre a body of radius q, sitting on the unit ray (nx, ny), has
  // to be for NO part of the drawn silhouette to be inside it.
  //
  // Every outline vertex P gives one constraint. With the body centre at b + n*D, the vertex is
  // clear when |P - b - n*D| >= q, i.e.  D^2 - 2(p.n)D + (|p|^2 - q^2) >= 0  for p = P - b. The
  // largest root of that quadratic is the smallest D that satisfies it; a vertex whose
  // discriminant is negative can never be inside the body on this ray and constrains nothing.
  // The answer is the largest root over all thirty vertices.
  //
  // Doing it against the real silhouette rather than against the enclosing circle is the whole
  // point: the circle is up to 40% larger than the shape in the dents, and separating on it left
  // bodies visibly floating away from a boulder they were supposed to be pressed against. The
  // outline is drawn as quadratic curves through these same vertices, and such a curve never
  // leaves the hull of its control points, so clearing the vertices clears the drawn edge.
  boulderClearance(b, r, nx, ny, q) {
    let D = q;   // never less than the body's own radius, for a body sitting on the centre
    for (const o of b.outline) {
      const a = o.a + b.roll;
      const k = r * o.k * POOP_BOULDER_OUTLINE_SCALE;
      const px = Math.cos(a) * k, py = Math.sin(a) * k;
      const pn = px * nx + py * ny;
      const disc = pn * pn - (px * px + py * py) + q * q;
      if (disc <= 0) continue;
      const d = pn + Math.sqrt(disc);
      if (d > D) D = d;
    }
    return D;
  }

  // Called once per frame from main.js, AFTER every body has moved and after the ordinary
  // character-vs-character separation has run. See the hook there for why it cannot live in
  // updateBoulder.
  //
  // The boulder is the immovable half of every pair it is in: nothing it touches ends the frame
  // overlapping it, and nothing it touches deflects it.
  //
  // Bodies are pushed out the SHORTEST way — straight out from the centre. The first version
  // solved along the direction of travel instead, to make it bulldoze, and that was the thing
  // that looked wrong: a body caught anywhere behind the widest point was teleported through the
  // boulder and out the front, so contact read as bodies snapping across it rather than being
  // leaned on. The forward shove is still there, but it is now carried entirely by the velocity
  // push below, where it belongs — position solves the overlap, velocity does the bulldozing.
  resolveSolids(dt, bodies) {
    const b = this.boulder;
    if (!b) return;
    const r = this.boulderRadius(b);
    const m = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / m, uy = b.vy / m;

    // Where a body of this size is allowed to stand: its own centre, inside the walls.
    const fits = (x, y, q) => x >= ARENA.x + q && x <= ARENA.x + ARENA.w - q
                           && y >= ARENA.y + q && y <= ARENA.y + ARENA.h - q;

    const separate = (t) => {
      const q = t.size / 2;
      let dx = t.x - b.x, dy = t.y - b.y;
      let dist = Math.hypot(dx, dy);
      // Dead centre: no shortest way out exists, so send it out the front.
      if (dist < 1e-4) { dx = ux; dy = uy; dist = 1; }
      const nx = dx / dist, ny = dy / dist;

      const need = this.boulderClearance(b, r, nx, ny, q);
      if (dist >= need) return false;

      let px = b.x + nx * need, py = b.y + ny * need;

      // Crushed against a wall: straight out would put it through the wall, and its own clamp
      // would drag it back inside the boulder next frame, which is where the jitter came from.
      // Walk round the boulder instead and take the nearest place it can actually stand.
      if (!fits(px, py, q)) {
        // Searched by ANGLE around the boulder, taking the first bearing that fits, rather than
        // by straight-line distance. Both get the body somewhere legal, but the nearest legal
        // POINT is often on the far side of the boulder, which reads as a body flicking across
        // it; the nearest legal BEARING is the near shoulder, so it slides round instead. 48
        // steps, alternating either side, so it walks off whichever way is closer.
        const base = Math.atan2(ny, nx);
        let best = null;
        for (let i = 1; i <= 48 && !best; i++) {
          const off = Math.ceil(i / 2) * (Math.PI * 2 / 48) * (i % 2 ? 1 : -1);
          const a = base + off;
          const cx = Math.cos(a), cy = Math.sin(a);
          const D = this.boulderClearance(b, r, cx, cy, q);
          const x = b.x + cx * D, y = b.y + cy * D;
          if (fits(x, y, q)) best = [x, y];
        }
        // The boulder is always fully inside the walls and the arena is far wider than it, so
        // some bearing always fits; the fallback is only here so a future smaller arena degrades
        // to "outside the floor for one frame" rather than to an overlap.
        if (best) { px = best[0]; py = best[1]; }
      }

      t.x = px; t.y = py;

      // ...and leaned on, up to the boulder's own pace and no further.
      const vAlong = t.vx * ux + t.vy * uy;
      if (vAlong < POOP_BOULDER_SPEED) {
        const add = Math.min(POOP_BOULDER_SPEED - vAlong, POOP_BOULDER_PUSH_ACCEL * dt);
        t.vx += ux * add;
        t.vy += uy * add;
      }
      return true;
    };

    for (const t of bodies) {
      if (!t || !t.alive) continue;
      const left = b.cd.get(t) || 0;
      if (left > 0) b.cd.set(t, left - dt);
      if (!separate(t)) continue;
      // Its owner is shoved by exactly the same rule but never hurt by it.
      if (t === this) continue;
      t.applySlow(POOP_BOULDER_SLOW, POOP_BOULDER_SLOW_TIME);
      if (left > 0) continue;   // still in contact, but not due to cost them again yet
      this.dealDamage(t, POOP_BOULDER_DAMAGE, POOP_BROWN_MID);
      b.cd.set(t, POOP_BOULDER_HIT_CD);
      spawnImpactParticles(t.x, t.y, this.palette, 20, 1.3, 0);
      triggerShake(7, 0.22);
      // Deliberately NOT on the spray's ticks as well: those land every 0.25s for three seconds
      // straight, which would be thirteen of these on top of the spray's own 3.29s voice.
      playSfx("poopmanUltHit", 0.6);
    }
  }

  drawBoulder(ctx) {
    const b = this.boulder;
    if (!b) return;
    const r = this.boulderRadius(b);

    ctx.save();

    // The pool of shadow under it, so a thing this big does not read as floating. A gradient
    // rather than a flat ellipse — a hard-edged black oval under a 276px object looked like a
    // second object.
    const pool = ctx.createRadialGradient(b.x, b.y + r * 0.34, r * 0.1,
                                          b.x, b.y + r * 0.34, r * 0.98);
    pool.addColorStop(0.0, "rgba(0,0,0,0.42)");
    pool.addColorStop(0.6, "rgba(0,0,0,0.20)");
    pool.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + r * 0.34, r * 0.98, r * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(b.x, b.y);

    // The silhouette turns with the boulder, so the lumpy edge is what reads as roll before you
    // even see the texture inside it.
    ctx.rotate(b.roll);

    // Laid down as a closed curve through the midpoints between the outline samples rather than
    // as straight segments: 30 line segments read as a cog, the same 30 as curve control points
    // read as something soft.
    const blobPath = (scale) => {
      const pts = b.outline.map((o) => [Math.cos(o.a) * r * o.k * scale,
                                        Math.sin(o.a) * r * o.k * scale]);
      ctx.beginPath();
      const mid = (i, j) => [(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2];
      const m0 = mid(pts.length - 1, 0);
      ctx.moveTo(m0[0], m0[1]);
      for (let i = 0; i < pts.length; i++) {
        const nxt = mid(i, (i + 1) % pts.length);
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], nxt[0], nxt[1]);
      }
      ctx.closePath();
    };

    // Outline as an underfill, the same trick the body uses. This is the outermost ink the
    // boulder puts on screen, so it is the scale the collision solver measures against —
    // POOP_BOULDER_OUTLINE_SCALE is shared by both and must not be inlined in either.
    ctx.fillStyle = POOP_BROWN_DARK;
    blobPath(POOP_BOULDER_OUTLINE_SCALE);
    ctx.fill();

    const g = ctx.createRadialGradient(-r * 0.34, -r * 0.40, r * 0.05, 0, 0, r);
    g.addColorStop(0.0, POOP_SHEEN);
    g.addColorStop(0.40, POOP_BROWN_LIT);
    g.addColorStop(0.75, POOP_BROWN_MID);
    g.addColorStop(1.0, POOP_BROWN);
    ctx.fillStyle = g;
    blobPath(1);
    ctx.fill();

    // Everything from here is clipped inside the silhouette, so no amount of surface detail can
    // put ink outside the shape the collision solver is measuring.
    ctx.save();
    blobPath(1);
    ctx.clip();

    // The lumps. Each one is lit from the same top-left the body is, and fades out at its own
    // rim instead of ending on a hard edge — as flat discs with a dark disc offset behind them
    // they read as circles drawn ON the boulder rather than as bumps OF it.
    for (const l of b.lumps) {
      const lx = Math.cos(l.a) * r * l.d, ly = Math.sin(l.a) * r * l.d;
      const lr = r * l.r;
      const lg = ctx.createRadialGradient(lx - lr * 0.38, ly - lr * 0.44, lr * 0.05, lx, ly, lr);
      lg.addColorStop(0.00, "rgba(199,154,99,0.50)");
      lg.addColorStop(0.40, "rgba(138,90,44,0.14)");
      lg.addColorStop(0.76, "rgba(74,44,20,0.30)");
      lg.addColorStop(1.00, "rgba(74,44,20,0)");
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Creases: broad, very soft valleys, drawn as a thick stroke in a colour that barely differs
    // from the surface. Anything crisper reads as a crack.
    ctx.save();
    ctx.lineCap = "round";
    for (const c of b.creases) {
      const cx = Math.cos(c.a) * r * c.d, cy = Math.sin(c.a) * r * c.d;
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = POOP_BROWN_DARK;
      ctx.lineWidth = r * 0.09 * c.w;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy - r * 0.18);
      ctx.quadraticCurveTo(cx, cy + r * 0.22, cx + r * 0.55, cy - r * 0.12);
      ctx.stroke();
    }
    ctx.restore();

    // Grain.
    for (const sp of b.speckle) {
      const sx = Math.cos(sp.a) * r * sp.d, sy = Math.sin(sp.a) * r * sp.d;
      ctx.globalAlpha = sp.dark ? 0.20 : 0.13;
      ctx.fillStyle = sp.dark ? POOP_BROWN_DARK : POOP_SHEEN;
      ctx.beginPath();
      ctx.arc(sx, sy, r * sp.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Occlusion into the bottom-right, away from the light.
    const ao = ctx.createRadialGradient(r * 0.30, r * 0.36, r * 0.15, r * 0.30, r * 0.36, r * 1.15);
    ao.addColorStop(0.0, "rgba(58,32,12,0.34)");
    ao.addColorStop(1.0, "rgba(58,32,12,0)");
    ctx.fillStyle = ao;
    ctx.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);

    // A rim light where the light wraps round the far edge. Stroked along the silhouette with a
    // gradient that is transparent on the lit side, and the clip keeps the inner half only — so
    // it hugs the edge instead of washing the whole lower half.
    const rim = ctx.createLinearGradient(-r * 0.75, -r * 0.75, r * 0.85, r * 0.85);
    rim.addColorStop(0.00, "rgba(214,176,124,0)");
    rim.addColorStop(0.52, "rgba(214,176,124,0)");
    rim.addColorStop(1.00, "rgba(222,186,138,0.38)");
    ctx.strokeStyle = rim;
    ctx.lineWidth = r * 0.10;
    blobPath(1);
    ctx.stroke();

    // The sheen. This replaces a hard-edged 50%-white ellipse that, at this size, read as a
    // white dot stuck to the boulder rather than as a wet surface catching the light — and which
    // was drawn outside the clip, so nothing was keeping it inside the shape either.
    //
    // Un-rotated so it stays put while the boulder turns: it is a reflection of a fixed light,
    // not a marking on the surface. The clip was taken in the rotated frame and survives this.
    ctx.rotate(-b.roll);
    const sheen = ctx.createRadialGradient(-r * 0.34, -r * 0.40, 0, -r * 0.34, -r * 0.40, r * 0.62);
    sheen.addColorStop(0.00, "rgba(255,246,232,0.30)");
    sheen.addColorStop(0.45, "rgba(255,246,232,0.10)");
    sheen.addColorStop(1.00, "rgba(255,246,232,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);

    ctx.restore();   // end of the silhouette clip
    ctx.restore();
  }


  // Every point of damage he lands funnels through here — the ordinary shot and the boulder's
  // contact both call it — so the ultimate's cooldown melts down in proportion regardless of
  // which one actually landed it. See POOP_ULT_CDR_PER_DAMAGE.
  //
  // Banked straight onto ultTimer rather than into a separate accumulator: while the timer is
  // actively ticking down (waiting for the next ult) this reduction is immediately felt, and
  // while it is frozen (rooted in the boulder's own life, where ultTimer does not tick — see
  // updateUlt) it just sits there banked negative until the boulder ends and that value is
  // folded into the fresh interval — see updateBoulder.
  dealDamage(target, dmg, colorOverride = null) {
    const before = target.hp;
    target.takeDamage(dmg, colorOverride);
    const actual = before - target.hp;
    if (actual > 0) this.ultTimer -= actual * POOP_ULT_CDR_PER_DAMAGE;
  }

  // ---------------------------------------------------------------- the ordinary attack
  //
  // Counts its own uses and hands every third one to the spray instead. The count is per round
  // (it is a fresh character each time, see reset in main.js), so the rotation always opens
  // shot, shot, spray.
  fireShot(opponent) {
    this.attackCount++;
    if (this.attackCount % POOP_SPRAY_EVERY === 0) { this.beginSpray(opponent); return; }

    const dx = opponent.x - this.x, dy = opponent.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    // From the rear, which is the end pointed at the target — the whole body turns to keep it
    // there (see drawBody). It used to spawn on the far side and fly through him, from back when
    // the sprite had a fixed orientation and the rear happened to face away.
    const bx = this.x + dx / d * this.size * 0.34;
    const by = this.y + dy / d * this.size * 0.34;
    this.shots.push(new PoopShot(bx, by, dx / d * POOP_SHOT_SPEED, dy / d * POOP_SHOT_SPEED));
    this.clenchTimer = 0.26;
    // A bigger burst and a short puff at the muzzle, so the release reads as a release and not
    // just as a projectile that has started existing. spawnImpactParticles' last argument is
    // gravity, not a direction — the spray is omnidirectional, as it is everywhere else.
    spawnImpactParticles(bx, by, this.palette, 14, 1.1, 0);
    spawnSmokePuff(bx - dx / d * this.size * 0.10, by - dy / d * this.size * 0.10,
                   this.size * 0.34, 0.42);
    playSfx("poopmanShot", 0.45);

    // ...and the kick. His own heading is set down the recoil FIRST: vx/vy were held at zero for
    // the whole wind-up, and applyKnockback only redirects a character that is already moving, so
    // without this the impulse would carry him one way while he still faced the other and he
    // would walk straight back the moment it decayed.
    this.vx = -dx / d * this.speed;
    this.vy = -dy / d * this.speed;
    this.applyKnockback(-dx / d, -dy / d, POOP_SHOT_SELF_KB);
    // A jet out of the muzzle, thrown along the recoil so the launch has something visibly
    // pushing it rather than the body just sliding.
    spawnSmokePuff(this.x + dx / d * this.size * 0.45, this.y + dy / d * this.size * 0.45,
                   this.size * 0.5, 0.35);
  }

  // ---------------------------------------------------------------- the victory
  onVictory() {
    this.celebrating = true;
    this.celebratingVictory = true;
    this.victoryTimer = 0;
    this.victoryFired = false;
    this.victoryLanded = false;
    this.victorySweat = 0;
    this.movable = false;
    this.vx = 0;
    this.vy = 0;
    // A spray still running would keep hosing the arena through the whole celebration, and its
    // 3.29s voice would talk over it. The boulder is deliberately left alone — if one is still
    // rolling when he wins, it goes on rolling behind the splat.
    this.sprayTimer = 0;
    this.sprayVoice = this.silence(this.sprayVoice);
    this.strainAmount = 0;
    // 1.07s, which covers the 0.85s squeeze and lands just as the lump reaches the lens.
    playSfx("poopmanWin", 0.85, 0.01);

    // Built once, here, so the splat is a different shape every win but holds still once it has
    // landed — regenerating it per frame would make it boil.
    const rnd = (a, b) => a + Math.random() * (b - a);
    this.victorySplat = {
      lobes: (() => {
        const p1 = rnd(0, 6.28), p2 = rnd(0, 6.28), p3 = rnd(0, 6.28);
        return Array.from({ length: 34 }, (_, i) => {
          const a = (i / 34) * Math.PI * 2;
          return { a, k: 0.82 + 0.15 * Math.sin(a + p1) + 0.09 * Math.sin(a * 2 + p2)
                          + 0.035 * Math.sin(a * 6 + p3) + rnd(0, 0.03) };
        });
      })(),
      gobs: Array.from({ length: 11 }, () => ({
        a: rnd(0, 6.28), d: rnd(0.92, 1.5), r: rnd(0.06, 0.17), delay: rnd(0, 0.18),
      })),
      drips: Array.from({ length: 8 }, () => ({
        x: rnd(-0.62, 0.62), w: rnd(0.030, 0.075), len: rnd(0.30, 1.0), delay: rnd(0, 0.45),
      })),
      gloss: Array.from({ length: 6 }, () => ({
        a: rnd(0, 6.28), d: rnd(0.05, 0.62), r: rnd(0.05, 0.13), s: rnd(0.5, 1.0),
      })),
    };
  }

  // Runs in place of the ordinary update once he has won — see update()'s celebrating branch.
  updateVictory(dt) {
    this.victoryTimer += dt;
    this.vx = 0;
    this.vy = 0;

    // Turning his back on the camera: facingAngle is where the REAR points (drawBody rotates by
    // facingAngle + PI/2), so PI/2 aims it straight down the screen, at the viewer. Eased rather
    // than snapped, so the turn is part of the performance.
    let d = Math.PI / 2 - this.facingAngle;
    d = Math.atan2(Math.sin(d), Math.cos(d));   // wrapped, so it turns the short way
    this.facingAngle += d * Math.min(1, dt * 7);

    const t = this.victoryTimer;

    if (t < POOP_VICTORY_WINDUP) {
      // The same squeeze the ultimate uses, so it is recognisably him doing the same thing.
      this.strainAmount = Math.min(1, t / POOP_VICTORY_WINDUP);
      this.sitAmount = this.strainAmount * 0.45;
      this.victorySweat -= dt;
      if (this.victorySweat <= 0) {
        this.victorySweat = 0.15 - this.strainAmount * 0.09;
        const a = Math.random() * Math.PI * 2;
        spawnImpactParticles(this.x + Math.cos(a) * this.size * 0.55,
                             this.y + Math.sin(a) * this.size * 0.55,
                             ["#dff0ff", "#b8dcff"], 2, 0.7, 260);
      }
      if (Math.random() < dt * 7) triggerShake(1 + this.strainAmount * 5, 0.12);
      return;
    }

    if (!this.victoryFired) {
      this.victoryFired = true;
      this.strainAmount = 0;
      this.sitAmount = 0;
      this.clenchTimer = 0.3;
      spawnImpactParticles(this.x, this.y + this.size * 0.4, this.palette, 26, 1.5, 0);
      spawnSmokePuff(this.x, this.y + this.size * 0.4, this.size * 0.7, 0.5);
      playSfx("poopmanShot", 0.6);
    }

    if (this.strainAmount > 0) this.strainAmount = Math.max(0, this.strainAmount - dt * 6);

    if (!this.victoryLanded && t >= POOP_VICTORY_WINDUP + POOP_VICTORY_FLIGHT) {
      this.victoryLanded = true;
      triggerShake(15, 0.45, true);
      playSfx("poopmanHit", 0.9);
    }
  }

  // Screen space. main.js calls this from inside drawFrame, which runs under the layout's zoom
  // transform, so WIDTH/HEIGHT are the right units here — the same ones PunchMan2's victory uses.
  drawVictoryOverlay(ctx) {
    const t = this.victoryTimer;
    if (t < POOP_VICTORY_WINDUP) return;   // still winding up; nothing on the lens yet

    const sp = this.victorySplat;
    if (!sp) return;
    const cx = WIDTH / 2, cy = HEIGHT * 0.46;
    const R = Math.max(WIDTH, HEIGHT) * 0.30;

    // ---- the flight: a lump closing on the lens, from him to the middle of the frame.
    if (t < POOP_VICTORY_WINDUP + POOP_VICTORY_FLIGHT) {
      const k = (t - POOP_VICTORY_WINDUP) / POOP_VICTORY_FLIGHT;
      const e = k * k;                       // hangs back, then arrives fast
      const x = this.x + (cx - this.x) * e;
      const y = (this.y + this.size * 0.4) + (cy - this.y - this.size * 0.4) * e;
      const rr = this.size * 0.34 + (R * 0.92 - this.size * 0.34) * e;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * e;
      const fg = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.05, x, y, rr);
      fg.addColorStop(0.0, POOP_SHEEN);
      fg.addColorStop(0.45, POOP_BROWN_MID);
      fg.addColorStop(1.0, POOP_BROWN_DARK);
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.ellipse(x, y, rr, rr * 0.92, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // ---- landed. Everything below is on the glass.
    const since = t - (POOP_VICTORY_WINDUP + POOP_VICTORY_FLIGHT);
    const spread = Math.min(1, since / 0.16);          // the mass flattening out on impact
    const run = Math.min(1, since / POOP_VICTORY_DRIP); // the runs crawling down

    ctx.save();

    const lobePath = (scale) => {
      ctx.beginPath();
      const pts = sp.lobes.map((o) => [cx + Math.cos(o.a) * R * o.k * scale,
                                       cy + Math.sin(o.a) * R * o.k * scale * 0.92]);
      const mid = (i, j) => [(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2];
      const m0 = mid(pts.length - 1, 0);
      ctx.moveTo(m0[0], m0[1]);
      for (let i = 0; i < pts.length; i++) {
        const nxt = mid(i, (i + 1) % pts.length);
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], nxt[0], nxt[1]);
      }
      ctx.closePath();
    };

    // The runs, first, so they read as coming out from UNDER the mass.
    for (const dp of sp.drips) {
      const g2 = Math.max(0, (run - dp.delay) / (1 - dp.delay));
      if (g2 <= 0) continue;
      const dx = cx + dp.x * R * 0.9;
      const top = cy + Math.sqrt(Math.max(0, 1 - dp.x * dp.x)) * R * 0.55;
      const len = dp.len * R * 1.15 * (g2 * (2 - g2));   // eases out as it slows
      const w = dp.w * R;
      const wb = w * 0.52;                 // narrower where it has stretched thin
      ctx.fillStyle = POOP_BROWN;
      ctx.beginPath();
      ctx.moveTo(dx - w / 2, top - w);
      ctx.quadraticCurveTo(dx - w * 0.60, top + len * 0.55, dx - wb / 2, top + len);
      ctx.lineTo(dx + wb / 2, top + len);
      ctx.quadraticCurveTo(dx + w * 0.60, top + len * 0.55, dx + w / 2, top - w);
      ctx.closePath();
      ctx.fill();
      // the bead gathering at the end of a run
      ctx.beginPath();
      ctx.arc(dx, top + len, wb * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }

    // Satellite gobs flung out past the main mass.
    for (const gb of sp.gobs) {
      const g2 = Math.max(0, Math.min(1, (spread - gb.delay) / Math.max(0.01, 1 - gb.delay)));
      if (g2 <= 0) continue;
      const gx = cx + Math.cos(gb.a) * R * gb.d * (0.75 + 0.25 * g2);
      const gy = cy + Math.sin(gb.a) * R * gb.d * 0.92 * (0.75 + 0.25 * g2);
      ctx.fillStyle = POOP_BROWN;
      ctx.beginPath();
      ctx.ellipse(gx, gy, R * gb.r * g2, R * gb.r * 0.86 * g2, gb.a, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = POOP_BROWN_MID;
      ctx.beginPath();
      ctx.ellipse(gx - R * gb.r * 0.2, gy - R * gb.r * 0.24, R * gb.r * 0.42 * g2,
                  R * gb.r * 0.34 * g2, gb.a, 0, Math.PI * 2);
      ctx.fill();
    }

    // The mass itself.
    ctx.fillStyle = POOP_BROWN_DARK;
    lobePath(1.03 * spread);
    ctx.fill();
    const mg = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.34, R * 0.05, cx, cy, R);
    mg.addColorStop(0.0, POOP_BROWN_LIT);
    mg.addColorStop(0.45, POOP_BROWN_MID);
    mg.addColorStop(1.0, POOP_BROWN);
    ctx.fillStyle = mg;
    lobePath(1 * spread);
    ctx.fill();

    // Wet highlights, so it reads as sitting on glass rather than as a hole in the picture.
    ctx.save();
    lobePath(1 * spread);
    ctx.clip();
    for (const gl of sp.gloss) {
      const gx = cx + Math.cos(gl.a) * R * gl.d, gy = cy + Math.sin(gl.a) * R * gl.d * 0.92;
      const sg = ctx.createRadialGradient(gx, gy, 0, gx, gy, R * gl.r * 1.6);
      sg.addColorStop(0.0, `rgba(255,246,232,${0.30 * gl.s})`);
      sg.addColorStop(1.0, "rgba(255,246,232,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(gx, gy, R * gl.r * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.restore();
  }

  // ---------------------------------------------------------------- the spray
  beginSpray(opponent) {
    this.sprayTimer = POOP_SPRAY_TIME;
    this.sprayTick = 0;          // first tick lands immediately, so it starts costing at once
    this.clenchTimer = 0.26;
    // 3.29s against a 3.0s spray — held so an interrupted spray can take its voice with it.
    this.sprayVoice = this.silence(this.sprayVoice);
    this.sprayVoice = playSfx("poopmanSpray", 0.6, 0.02);
    const dx = opponent.x - this.x, dy = opponent.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    // A heading down the recoil, same as a shot: vx/vy were held at zero through the wind-up.
    this.vx = -dx / d * this.speed;
    this.vy = -dy / d * this.speed;
    triggerShake(4, 0.25);
  }

  // The muzzle: the same point a shot leaves from, so both attacks visibly come out of the same
  // end of him.
  sprayOrigin() {
    return [this.x + Math.cos(this.facingAngle) * this.size * 0.34,
            this.y + Math.sin(this.facingAngle) * this.size * 0.34];
  }

  // Is this body inside the cone right now? Measured from his centre, and widened by the body's
  // own angular half-width so something clipping the edge of the cone counts as caught by it
  // rather than needing its centre point inside a mathematical wedge.
  inSprayCone(t) {
    const dx = t.x - this.x, dy = t.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d > POOP_SPRAY_RANGE + t.size / 2) return false;
    let da = Math.atan2(dy, dx) - this.facingAngle;
    da = Math.atan2(Math.sin(da), Math.cos(da));   // wrapped into [-PI, PI]
    const halfBody = Math.atan2(t.size / 2, Math.max(1, d));
    if (Math.abs(da) > POOP_SPRAY_ARC / 2 + halfBody) return false;
    // Blocked by a stone pillar the same way a shot is — sampled along the line rather than only
    // at the ends, or a pillar sitting squarely in the middle would be sprayed straight through.
    if (typeof obstacleBlocking === "function") {
      const steps = Math.max(2, Math.ceil(d / 24));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        if (obstacleBlocking(this.x + dx * k, this.y + dy * k, 4)) return false;
      }
    }
    return true;
  }

  updateSpray(dt, opponent) {
    if (this.sprayTimer <= 0) return;
    this.sprayTimer -= dt;
    this.sprayWobble += dt * 26;

    const [mx, my] = this.sprayOrigin();

    // The jet itself, every frame: a fan of muck thrown down the cone.
    for (let i = 0; i < 2; i++) {
      const a = this.facingAngle + (Math.random() - 0.5) * POOP_SPRAY_ARC;
      const reach = POOP_SPRAY_RANGE * (0.25 + Math.random() * 0.75);
      spawnImpactParticles(mx + Math.cos(a) * reach * 0.35,
                           my + Math.sin(a) * reach * 0.35, this.palette, 2, 1.0, 0);
    }

    this.sprayTick -= dt;
    if (this.sprayTick > 0) return;
    this.sprayTick += POOP_SPRAY_TICK;

    // ...and the jet pushes him back, over and over, for as long as it runs.
    this.applyKnockback(-Math.cos(this.facingAngle), -Math.sin(this.facingAngle), POOP_SPRAY_SELF_KB);
    spawnSmokePuff(mx, my, this.size * 0.55, 0.3);

    // A smear on the floor under the cone, into the same capped array the drag trail uses, so
    // the ground it has hosed reads as hosed without touching the six-splat budget.
    const ta = this.facingAngle + (Math.random() - 0.5) * POOP_SPRAY_ARC;
    const td = POOP_SPRAY_RANGE * (0.3 + Math.random() * 0.7);
    this.trail.push({
      x: mx + Math.cos(ta) * td, y: my + Math.sin(ta) * td,
      r: this.size * (0.16 + Math.random() * 0.12),
      a: Math.random() * Math.PI * 2,
      life: POOP_TRAIL_LIFE,
      blobs: Array.from({ length: 3 }, () => ({
        a: Math.random() * Math.PI * 2, d: Math.random() * 0.6, r: 0.28 + Math.random() * 0.34,
      })),
    });
    while (this.trail.length > POOP_TRAIL_MAX) this.trail.shift();

    if (!opponent || !opponent.alive) return;
    for (const t of [opponent, ...opponent.getExtraBodies()]) {
      if (!t.alive || !this.inSprayCone(t)) continue;
      this.dealDamage(t, POOP_SPRAY_DAMAGE, POOP_BROWN_MID);
      t.applySlow(POOP_SHOT_SLOW, POOP_SHOT_SLOW_TIME);
      spawnImpactParticles(t.x, t.y, this.palette, 8, 0.9, 0);
    }
  }

  drawSpray(ctx) {
    if (this.sprayTimer <= 0) return;
    const [mx, my] = this.sprayOrigin();
    // Sputters rather than pouring evenly — it is meant to look like it is barely under control.
    const sputter = 0.78 + Math.sin(this.sprayWobble) * 0.14 + Math.sin(this.sprayWobble * 2.7) * 0.08;
    const reach = POOP_SPRAY_RANGE * sputter;
    const a0 = this.facingAngle - POOP_SPRAY_ARC / 2;
    const a1 = this.facingAngle + POOP_SPRAY_ARC / 2;

    ctx.save();
    // Clipped to the floor: the cone is as long as the arena is wide and would otherwise paint
    // out over the background and up behind the HUD.
    ctx.beginPath();
    ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.clip();

    const wedge = (rr) => {
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.arc(mx, my, rr, a0, a1);
      ctx.closePath();
    };

    const g = ctx.createRadialGradient(mx, my, this.size * 0.2, mx, my, reach);
    g.addColorStop(0.0, "rgba(122,78,40,0.80)");
    g.addColorStop(0.45, "rgba(138,90,44,0.46)");
    g.addColorStop(1.0, "rgba(160,110,60,0)");
    ctx.fillStyle = g;
    wedge(reach);
    ctx.fill();

    // Streaks along the cone, so it reads as moving rather than as a static wedge of colour.
    ctx.save();
    wedge(reach);
    ctx.clip();
    ctx.strokeStyle = "rgba(199,154,99,0.5)";
    ctx.lineWidth = Math.max(2, this.size * 0.06);
    ctx.lineCap = "round";
    for (let i = 0; i < 9; i++) {
      const a = a0 + (POOP_SPRAY_ARC * (i + 0.5)) / 9;
      const phase = (this.sprayWobble * 0.5 + i * 0.7) % 1;
      const r0 = reach * (0.15 + phase * 0.7);
      const r1 = r0 + reach * 0.18;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(a) * r0, my + Math.sin(a) * r0);
      ctx.lineTo(mx + Math.cos(a) * r1, my + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  addSplat(x, y) {
    this.splats.push({
      x, y,
      r: POOP_SPLAT_RADIUS * (0.85 + Math.random() * 0.3),
      life: POOP_SPLAT_LIFE,
      maxLife: POOP_SPLAT_LIFE,
      blobs: Array.from({ length: 7 }, () => ({
        a: Math.random() * Math.PI * 2,
        d: Math.random() * 0.72,
        r: 0.2 + Math.random() * 0.3,
      })),
    });
    while (this.splats.length > POOP_SPLAT_MAX) this.splats.shift();
  }

  updateShots(dt, opponent) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const b = this.shots[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      b.spin += dt * 7;
      b.wobble += dt * 11;

      let gone = b.life <= 0;
      let landedX = b.x, landedY = b.y;

      if (!gone && (b.x < ARENA.x || b.x > ARENA.x + ARENA.w || b.y < ARENA.y || b.y > ARENA.y + ARENA.h)) {
        landedX = Math.max(ARENA.x, Math.min(ARENA.x + ARENA.w, b.x));
        landedY = Math.max(ARENA.y, Math.min(ARENA.y + ARENA.h, b.y));
        gone = true;
      }

      if (!gone && typeof obstacleBlocking === "function" && obstacleBlocking(b.x, b.y, POOP_SHOT_RADIUS * 0.5)) {
        gone = true;
      }

      if (!gone && opponent && opponent.alive) {
        const targets = [opponent, ...opponent.getExtraBodies()].filter((t) => t.alive);
        for (const t of targets) {
          if (Math.hypot(t.x - b.x, t.y - b.y) > t.size / 2 + POOP_SHOT_RADIUS) continue;
          this.dealDamage(t, POOP_SHOT_DAMAGE, POOP_BROWN_MID);
          t.applySlow(POOP_SHOT_SLOW, POOP_SHOT_SLOW_TIME);
          spawnImpactParticles(b.x, b.y, this.palette, 16, 1.2, 0);
          playSfx("poopmanHit", 0.55);
          landedX = b.x; landedY = b.y;
          gone = true;
          break;
        }
      }

      if (gone) {
        // Whether it hit or missed, it lands somewhere and stays there. A miss is not wasted —
        // it takes that piece of floor away from the opponent for six seconds.
        if (b.life > 0) this.addSplat(landedX, landedY);
        spawnImpactParticles(landedX, landedY, this.palette, 10, 0.9, 0);
        this.shots.splice(i, 1);
      }
    }
  }

  // One smear per POOP_TRAIL_STEP of ground covered, so it is spaced by DISTANCE walked and not
  // by time: a target crawling under the flood leaves a dense line, one flung across the arena by
  // a knockback leaves a sparse one, and a slowed target standing still leaves nothing at all.
  updateTrail(dt, opponent) {
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
    if (!opponent) return;
    for (const t of [opponent, ...opponent.getExtraBodies()]) {
      if (!t.alive || t.slowTimer <= 0) { this.trailAnchor.delete(t); continue; }
      const a = this.trailAnchor.get(t);
      // First frame of a slow only anchors — otherwise every fresh hit would stamp a mark under
      // the target whether it had moved since or not.
      if (!a) { this.trailAnchor.set(t, { x: t.x, y: t.y }); continue; }
      if (Math.hypot(t.x - a.x, t.y - a.y) < POOP_TRAIL_STEP) continue;
      this.addTrailMark(t);
      a.x = t.x; a.y = t.y;
    }
  }

  addTrailMark(t) {
    const r = t.size * (0.15 + Math.random() * 0.10);
    this.trail.push({
      x: t.x, y: t.y, r,
      a: Math.random() * Math.PI * 2,
      life: POOP_TRAIL_LIFE,
      blobs: Array.from({ length: 3 }, () => ({
        a: Math.random() * Math.PI * 2,
        d: Math.random() * 0.6,
        r: 0.28 + Math.random() * 0.34,
      })),
    });
    while (this.trail.length > POOP_TRAIL_MAX) this.trail.shift();
  }

  updateSplats(dt, opponent) {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const p = this.splats[i];
      p.life -= dt;
      if (p.life <= 0) { this.splats.splice(i, 1); continue; }
      const bodies = [];
      if (opponent && opponent.alive) bodies.push(opponent, ...opponent.getExtraBodies());
      for (const t of bodies) {
        if (!t.alive) continue;
        if (Math.hypot(t.x - p.x, t.y - p.y) <= p.r + t.size * 0.35) {
          t.applySlow(POOP_SPLAT_SLOW, POOP_SPLAT_SLOW_TIME);
        }
      }
    }
  }

  // ---------------------------------------------------------------- update
  update(dt, opponent) {
    if (opponent) this.lastFoe = opponent;

    // Unconditional and first, the same rule the Angel's bolts and the Earth Mage's pillars
    // follow: a shot already in the air and muck already on the floor are physical things, and
    // killing whoever produced them does not take them back.
    this.updateShots(dt, opponent);
    this.updateSplats(dt, opponent);
    this.updateTrail(dt, opponent);
    this.updateBoulder(dt, opponent);

    super.update(dt, opponent);
    if (!this.alive) {
      // A strain dies with him — he never gets the boulder out. One already rolling keeps going.
      this.ultActive = false; this.ultPhase = null; this.strainAmount = 0;
      this.fireWindup = 0;   // otherwise the corpse keeps a half-built shot bulging out of it
      this.sprayTimer = 0;   // ...and goes on hosing the arena after it stops moving
      // Only the spray. The launch voice is NOT cut here: the boulder itself deliberately goes
      // on rolling after he dies (see updateBoulder), and the clip describes that boulder leaving
      // him, not him being alive to hear it. stopAllPoopSounds still takes both, because that
      // runs when the character object is thrown away entirely.
      this.sprayVoice = this.silence(this.sprayVoice);
      return;
    }

    if (this.celebrating) { this.updateVictory(dt); return; }

    // Above the stun gate on purpose: a strain already under way is a body doing something it
    // cannot stop, so a stun does not abort it — it just leaves him standing there taking hits
    // for the rest of it, which is the risk the ultimate is priced at.
    this.updateUlt(dt, opponent);

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x, dy = opponent.y - this.y;
      if (Math.hypot(dx, dy) > 0.01) {
        this.facingAngle = Math.atan2(dy, dx);
        this.hasFacedOpponent = true;
      }
    }

    if (this.clenchTimer > 0) this.clenchTimer -= dt;
    this.updateSpray(dt, opponent);

    // A stun cancels a wind-up outright: the squeeze is interrupted and the shot is lost, with
    // the cooldown already spent. This clear has to happen HERE, above the gate — leaving the
    // wind-up entirely below it meant a stun landing mid-squeeze froze fireWindup at whatever it
    // held, and since the movable getter keys off that, he stayed rooted and never fired again
    // for the rest of the round. Measured: 57.2% -> 23.1% overall, and 3-7% against the cast's
    // stunners (Troll, Demon, Knight).
    if (this.stunTimer > 0) {
      this.fireWindup = 0;
      if (this.sprayTimer > 0) { this.sprayTimer = 0; this.sprayVoice = this.silence(this.sprayVoice); }
      return;
    }

    // Ticking the reload FIRST, so it runs during the wind-up rather than after it — the wind-up
    // is charged INSIDE the cooldown, not added on top of it, so the animation costs no rate at
    // all and shots leave exactly every POOP_SHOT_COOLDOWN.
    //
    // This used to matter far more than it does now: back when a shot did 1.75x against an
    // already-slowed target, pushing the cycle from 1.6s out to 1.94s put it past the 2.0s slow,
    // the bonus stopped applying to most shots, and he fell off a cliff — measured 56.1% -> 19.6%
    // from that alone. The damage is flat now, so the same mistake would only cost the rate.
    if (this.shotTimer > 0) this.shotTimer -= dt;

    // Winding one up: held in place until it goes. facingAngle is still being tracked above,
    // so it keeps turning to face the target through the whole squeeze and fires at wherever
    // the target has got to, not at where it was when the wind-up started.
    if (this.fireWindup > 0) {
      this.fireWindup -= dt;
      this.vx = 0;
      this.vy = 0;
      if (this.fireWindup <= 0) {
        this.fireWindup = 0;
        if (opponent && opponent.alive) {
          // fireShot sets his heading itself now — down the recoil, not at random.
          this.fireShot(opponent);
        } else {
          // Nothing was fired, so nothing threw him anywhere; vx/vy were zeroed to hold him
          // still for the wind-up and he still needs a heading to move at all again.
          const a = Math.random() * Math.PI * 2;
          this.vx = Math.cos(a) * this.speed;
          this.vy = Math.sin(a) * this.speed;
        }
      }
      return;
    }

    // The spray owns the attack slot for its whole three seconds, and the next cooldown only
    // starts once it stops — otherwise the 1.7s reload would come up mid-spray and start winding
    // a second attack while the first was still running.
    if (this.sprayTimer > 0) { this.shotTimer = POOP_SHOT_COOLDOWN; return; }

    if (this.shotTimer <= 0 && this.canAttack && opponent && opponent.alive && !this.ultActive) {
      this.shotTimer = POOP_SHOT_COOLDOWN;
      this.fireWindup = POOP_FIRE_WINDUP;
      this.vx = 0;
      this.vy = 0;
    }
  }

  // ---------------------------------------------------------------- drawing
  drawGroundEffects(ctx) {
    // Clipped to the arena floor. The tide is a circle big enough to reach the far corner from
    // wherever it started, so most of that circle is outside the walls — without this it pours
    // out over the background and up behind the HUD.
    ctx.save();
    ctx.beginPath();
    ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.clip();
    // Under the splats: a thrown splat is a thicker deposit than something merely tracked across
    // the floor, so it should sit on top where the two overlap.
    for (const m of this.trail) this.drawTrailMark(ctx, m);
    for (const p of this.splats) this.drawSplat(ctx, p);
    ctx.restore();
    super.drawGroundEffects(ctx);
  }

  drawTrailMark(ctx, m) {
    const fade = Math.min(1, m.life / 1.0);
    ctx.save();
    ctx.globalAlpha = 0.5 * fade;
    ctx.translate(m.x, m.y);
    ctx.rotate(m.a);
    ctx.fillStyle = POOP_BROWN;
    ctx.beginPath();
    ctx.ellipse(0, 0, m.r, m.r * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = POOP_BROWN_MID;
    for (const b of m.blobs) {
      ctx.beginPath();
      ctx.ellipse(Math.cos(b.a) * m.r * b.d, Math.sin(b.a) * m.r * 0.44 * b.d,
                  m.r * b.r, m.r * b.r * 0.44, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawSplat(ctx, p) {
    const fade = Math.min(1, p.life / 1.2);
    ctx.save();
    ctx.globalAlpha = 0.8 * fade;
    ctx.fillStyle = POOP_BROWN;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = POOP_BROWN_MID;
    for (const b of p.blobs) {
      ctx.beginPath();
      ctx.ellipse(p.x + Math.cos(b.a) * p.r * b.d, p.y + Math.sin(b.a) * p.r * 0.42 * b.d,
                  p.r * b.r, p.r * b.r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.16 * fade;
    ctx.fillStyle = POOP_SHEEN;
    ctx.beginPath();
    ctx.ellipse(p.x - p.r * 0.2, p.y - p.r * 0.1, p.r * 0.3, p.r * 0.12, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Over both fighters and every particle: the boulder is a solid object taller than anyone in
  // the arena, so nothing should ever be drawn in front of it.
  drawOverlayEffects(ctx) {
    for (const b of this.shots) this.drawShot(ctx, b);
    this.drawSpray(ctx);
    this.drawBoulder(ctx);
  }

  drawShot(ctx, b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin);
    const r = POOP_SHOT_RADIUS;
    // The classic three-tier coil, tumbling
    ctx.fillStyle = POOP_BROWN;
    for (let i = 0; i < 3; i++) {
      const k = 1 - i * 0.26;
      ctx.beginPath();
      ctx.ellipse(Math.sin(b.wobble + i) * r * 0.08, -i * r * 0.34, r * k, r * k * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = POOP_BROWN_MID;
    ctx.beginPath();
    ctx.ellipse(-r * 0.22, -r * 0.5, r * 0.28, r * 0.18, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The body: a backside, and nothing else. No head, no arm — those were there to give the
  // mooning pose a figure around it, but the rear now turns to track the target on its own, so
  // the pose reads without them, and dropping them lets the cheeks fill the whole 62px instead
  // of sharing it with a head that was a third of the width.
  //
  // Local frame: the backside is toward -Y and the legs toward +Y, so rotating by
  // facingAngle + PI/2 aims the backside straight down the line to the opponent.
  //
  // Shading, in the order it is laid down, all of it clipped inside the cheek so nothing can
  // spill past the outline:
  //   1. an oversized line-coloured underfill, which IS the outline (stroking each cheek drew
  //      their shared inner edges too, and that is what used to read as a stripe down the middle)
  //   2. a broad radial base, lit from the presented side
  //   3. a rim light along the outer edge
  //   4. occlusion under the fold, where it meets the legs
  //   5. a soft specular, and a small hot spot inside it
  // Light is fixed in the body frame rather than the world, so the sheen stays on the presented
  // face however far the character has swung round.
  drawBody(ctx) {
    const r = this.size / 2;
    const sit = this.sitAmount;
    const clench = this.clenchTimer > 0 ? Math.min(1, this.clenchTimer / 0.26) : 0;
    // 0 -> 1 across the wind-up. `squeeze` is what the cheeks and the opening react to, so a
    // shot being built and a shot just released both read as the same muscle doing the work.
    const wind = this.fireWindup > 0 ? 1 - this.fireWindup / POOP_FIRE_WINDUP : 0;
    const squeeze = Math.max(clench, wind * 0.85, this.strainAmount);
    const strain = this.strainAmount;
    const aim = this.facingAngle + Math.PI / 2;

    // Straining walks the whole skin from its own colour through red and on to purple, mixed
    // rather than swapped so it is visibly one body going redder and not three sprites cutting
    // between each other. The line and the shorts are left alone — they are the only fixed
    // reference left, and without them there is nothing to read the colour change against.
    const tint = poopMix("#ff2a18", "#9b30e0", Math.max(0, (strain - 0.70) / 0.30));
    const flush = (c) => (strain > 0 ? poopMix(c, tint, strain * 0.34) : c);
    const SKIN      = flush("#f2c9a0");
    const SKIN_LIT  = flush("#ffe6c8");
    const SKIN_MID  = flush("#e0ab7e");
    const SKIN_DEEP = flush("#b97f55");
    const LINE      = "#4a2816";
    const SHORTS    = "#eab92f";
    const SHORTS_SH = "#bd8f18";

    ctx.save();
    // Shaking, hard, and harder the closer it gets. Applied to the whole figure at the translate
    // so nothing inside has to know about it.
    const jit = strain * strain * 5.5;
    ctx.translate(this.x + (Math.random() * 2 - 1) * jit,
                  this.y + (Math.random() * 2 - 1) * jit);
    ctx.rotate(aim);
    // Inflating. The high-frequency term on top is the body straining against itself — a smooth
    // swell alone read as him being slowly scaled up by the engine rather than pushing.
    if (strain > 0) {
      const puff = 1 + strain * 0.34 + Math.sin(performance.now() / 1000 * 34) * strain * 0.025;
      ctx.scale(puff, puff);
    }
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Anticipation and recoil, both along the aim axis (local Y): it leans into the target as
    // the shot builds, then snaps back the other way as it goes.
    if (wind > 0) {
      const q = Math.sin(wind * Math.PI * 0.5);
      ctx.scale(1 - q * 0.09, 1 + q * 0.13);
    }
    if (clench > 0) ctx.scale(1 + clench * 0.11, 1 - clench * 0.09);

    // squashed down when it sits to flood
    ctx.save();
    ctx.scale(1 + sit * 0.20, 1 - sit * 0.16);

    const stroke = (w) => { ctx.strokeStyle = LINE; ctx.lineWidth = r * w; ctx.stroke(); };

    const shortsPath = () => {
      ctx.beginPath();
      ctx.moveTo(-r * 0.62, r * 0.60);
      ctx.quadraticCurveTo(-r * 0.72, r * 0.86, -r * 0.58, r * 0.98);
      ctx.lineTo(-r * 0.10, r * 0.92);
      ctx.lineTo(0, r * 0.99);
      ctx.lineTo(r * 0.10, r * 0.92);
      ctx.lineTo(r * 0.58, r * 0.98);
      ctx.quadraticCurveTo(r * 0.72, r * 0.86, r * 0.62, r * 0.60);
      ctx.quadraticCurveTo(0, r * 0.74, -r * 0.62, r * 0.60);
      ctx.closePath();
    };

    // legs, feet and shorts, as one group, kept narrow so the backside is what the eye lands on
    ctx.save();
    ctx.scale(0.80, 0.94);

    // legs and feet
    for (const sgn of [-1, 1]) {
      ctx.fillStyle = SKIN_MID;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(sgn * r * 0.34 - r * 0.13, r * 0.42, r * 0.26, r * 0.62, r * 0.12);
      else ctx.rect(sgn * r * 0.34 - r * 0.13, r * 0.42, r * 0.26, r * 0.62);
      ctx.fill(); stroke(0.075);
      ctx.fillStyle = SKIN;
      ctx.beginPath();
      ctx.ellipse(sgn * r * 0.38, r * 1.02, r * 0.20, r * 0.11, sgn * 0.25, 0, Math.PI * 2);
      ctx.fill(); stroke(0.06);
    }

    // the shorts, dropped round the ankles and gaping open
    ctx.fillStyle = SHORTS;
    shortsPath();
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = SHORTS_SH;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.64, r * 0.60, r * 0.10, 0, 0, Math.PI);
    ctx.fill();
    ctx.restore();
    shortsPath();
    stroke(0.075);
    ctx.restore();   // end of the legs/shorts group

    // ---- the backside
    const CX = (sgn) => sgn * r * (0.35 - squeeze * 0.045);
    const CY = -r * 0.22;
    const RX = r * 0.56, RY = r * 0.68;
    const TILT = 0.12;
    const cheek = (sgn, grow) => {
      ctx.beginPath();
      ctx.ellipse(CX(sgn), CY, RX + grow, RY + grow, sgn * TILT, 0, Math.PI * 2);
    };

    // 0. the shadow they cast down onto the shorts and the tops of the legs
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = "#3a1c0e";
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(CX(sgn), CY + r * 0.16, RX * 0.96, RY * 0.96, sgn * TILT, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 1. the outline, as an underfill
    ctx.fillStyle = LINE;
    for (const sgn of [-1, 1]) { cheek(sgn, r * 0.078); ctx.fill(); }

    for (const sgn of [-1, 1]) {
      ctx.save();
      cheek(sgn, 0);
      ctx.clip();

      // 2. base. Warm and light toward the presented top-outer, deepening away from it.
      const base = ctx.createRadialGradient(CX(sgn) + sgn * r * 0.16, CY - r * 0.30, r * 0.04,
                                            CX(sgn), CY + r * 0.06, r * 0.92);
      base.addColorStop(0.00, SKIN_LIT);
      base.addColorStop(0.34, SKIN);
      base.addColorStop(0.74, SKIN_MID);
      base.addColorStop(1.00, SKIN_DEEP);
      ctx.fillStyle = base;
      ctx.fillRect(CX(sgn) - RX * 1.2, CY - RY * 1.2, RX * 2.4, RY * 2.4);

      // 3. rim light down the outer edge, so the silhouette does not die into the outline
      const rim = ctx.createLinearGradient(CX(sgn) + sgn * RX * 0.30, 0, CX(sgn) + sgn * RX, 0);
      rim.addColorStop(0, "rgba(255,236,208,0)");
      rim.addColorStop(1, "rgba(255,240,214,0.85)");
      ctx.fillStyle = rim;
      ctx.fillRect(CX(sgn) - RX * 1.2, CY - RY * 1.2, RX * 2.4, RY * 2.4);

      // 4. occlusion under the fold
      const ao = ctx.createLinearGradient(0, CY + RY * 0.10, 0, CY + RY);
      ao.addColorStop(0, "rgba(150,92,56,0)");
      ao.addColorStop(1, "rgba(140,84,50,0.55)");
      ctx.fillStyle = ao;
      ctx.fillRect(CX(sgn) - RX * 1.2, CY - RY * 1.2, RX * 2.4, RY * 2.4);

      // 5. the sheen: a broad soft one, then a small hot spot inside it
      ctx.save();
      ctx.translate(CX(sgn) + sgn * r * 0.15, CY - r * 0.34);
      ctx.rotate(sgn * 0.55);
      const spec = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.30);
      spec.addColorStop(0.0, "rgba(255,255,255,0.55)");
      spec.addColorStop(0.5, "rgba(255,250,242,0.22)");
      spec.addColorStop(1.0, "rgba(255,250,242,0)");
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.30, r * 0.19, 0, 0, Math.PI * 2);
      ctx.fill();
      const hot = ctx.createRadialGradient(0, -r * 0.03, 0, 0, -r * 0.03, r * 0.12);
      hot.addColorStop(0, "rgba(255,255,255,0.80)");
      hot.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hot;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.03, r * 0.12, r * 0.072, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 6. the strain flush, over everything else and still inside the cheek clip. save/restore
      // puts the composite mode back, so nothing after this is multiplied.
      if (strain > 0) {
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = Math.min(0.88, strain * 0.95);
        ctx.fillStyle = tint;
        ctx.fillRect(CX(sgn) - RX * 1.3, CY - RY * 1.3, RX * 2.6, RY * 2.6);
      }

      ctx.restore();
    }

    // the crease: a soft valley, with no edge anywhere in it
    ctx.save();
    const v = ctx.createLinearGradient(-r * 0.28, 0, r * 0.28, 0);
    v.addColorStop(0.0, "rgba(150,98,64,0)");
    v.addColorStop(0.5, "rgba(146,92,58,0.46)");
    v.addColorStop(1.0, "rgba(150,98,64,0)");
    ctx.fillStyle = v;
    ctx.beginPath();
    ctx.ellipse(0, CY, r * 0.28, r * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ...and the business end, dead on the join. (0, CY) is exactly where the two cheek ellipses
    // meet and the middle of the crease gradient above, so it sits in the seam rather than 0.26r
    // down it, which had it sitting low against the shorts instead of at the junction.
    ctx.fillStyle = SKIN_DEEP;
    ctx.beginPath();
    ctx.ellipse(0, CY, r * (0.12 + squeeze * 0.05), r * (0.085 + squeeze * 0.045), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7a4e33";
    ctx.beginPath();
    ctx.ellipse(0, CY, r * (0.055 + squeeze * 0.035), r * (0.038 + squeeze * 0.028), 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- the shot itself, swelling out while the wind-up runs. Drawn last so it sits in front
    // of the opening, and eased so it is barely there for the first frames and then bulges.
    if (wind > 0) {
      const k = poopEase(wind);
      // Travels from the opening all the way out past the rear edge, finishing at roughly where
      // fireShot spawns the projectile (0.34 * size = 0.68r along the aim). Only moving it a
      // fraction of that left it swelling INSIDE the silhouette, where it read as a dark hole
      // rather than as something being pushed out.
      const oy = CY - k * r * 0.62;
      const rad = r * (0.05 + k * 0.34);
      ctx.save();
      ctx.fillStyle = POOP_BROWN_DARK;
      ctx.beginPath();
      ctx.ellipse(0, oy, rad * 1.10, rad * 1.00, 0, 0, Math.PI * 2);
      ctx.fill();
      const bg = ctx.createRadialGradient(-rad * 0.32, oy - rad * 0.42, rad * 0.04, 0, oy, rad);
      bg.addColorStop(0.0, POOP_SHEEN);
      bg.addColorStop(0.45, POOP_BROWN_MID);
      bg.addColorStop(1.0, POOP_BROWN);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(0, oy, rad * 0.94, rad * 0.86, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
    ctx.restore();
  }
}
