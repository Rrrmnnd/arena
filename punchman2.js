// Punch Man (New): a rebuild of the original around the problem that killed it — the fists
// were theoretically the roster's best sustained damage (5/sec) but only ever connected 11%
// of the time, so all its real output came from the ultimate.
//
// Two changes fix that. A lunge closes the gap on its own the moment a target strays within
// 200px, so being in punching range is something it can make happen instead of wait for. And
// every third punch is a heavy one: 10 damage that sends the target flying, which turns
// "stay glued to them" into a rhythm with a payoff rather than a flat trickle of 2s.
//
// The ultimate is deliberately not implemented yet — the slot is waiting on a design.

const PUNCHMAN2_MAX_HP = 150;
const PUNCHMAN2_SPEED  = 330;

const PUNCHMAN2_FIST_DAMAGE  = 2;   // punches 1 and 2 of every set, same as the original
const PUNCHMAN2_THIRD_DAMAGE = 5;   // the third lands harder...
const PUNCHMAN2_THIRD_KNOCKBACK = 950; // ...and blasts them away, scaled down against bigger targets
const PUNCHMAN2_PUNCHES_PER_SET = 3;
const PUNCHMAN2_RATE  = 5;  // punches per second
const PUNCHMAN2_RANGE = 40; // reach past its own radius

const PUNCHMAN2_DASH_RADIUS   = 150;  // a target inside this is close enough to lunge at
const PUNCHMAN2_DASH_SPEED    = 1000; // px/sec during the lunge itself
const PUNCHMAN2_DASH_DURATION = 0.2;  // hard cap, in case the target keeps running
const PUNCHMAN2_DASH_COOLDOWN = 3.0;
const PUNCHMAN2_DASH_GHOST_INTERVAL = 0.012; // how often the lunge drops an afterimage
const PUNCHMAN2_DASH_GHOST_LIFE = 0.32;
const PUNCHMAN2_DASH_WIND_LINES = 7;         // streaks in the wind cone dragged along behind
// The lunge only ever has ~50px of gap to close (it fires between 100 and 150px out and stops
// on arrival), so the movement itself is over in about a twentieth of a second. The wind is
// given its own timer so it stays on screen long enough to actually be seen.
const PUNCHMAN2_DASH_FX_TIME = 0.26;

// Ultimate — "Blitz": vanishes off the field entirely, then batters the target through six
// blows delivered faster than the eye can follow. Between blows it intercepts them further
// along the arc they were just launched down, so the target never touches the ground until
// the sixth blow drives them into a wall.
const PUNCHMAN2_ULT_CHARGE_TIME = 30.0;
const PUNCHMAN2_DAMAGE_CHARGE_BONUS = 0.1;  // seconds shaved off that charge per point of damage dealt
const PUNCHMAN2_ULT_STRIKES = 6;
// Each blow deals a flat amount PLUS a share of the target's MAX HP (not current), so it stays
// meaningful against anything — which is squarely aimed at the big-HP targets this character
// otherwise struggles to chew through — while the flat component keeps it from doing basically
// nothing against something with very little max HP to take a percentage of.
const PUNCHMAN2_ULT_DAMAGE_FLAT = 3;         // blows 1-5
const PUNCHMAN2_ULT_DAMAGE_PCT = 0.03;
const PUNCHMAN2_ULT_KNOCKBACK = 3200;
const PUNCHMAN2_ULT_FINAL_DAMAGE_FLAT = 7;   // the sixth
const PUNCHMAN2_ULT_FINAL_DAMAGE_PCT = 0.10;
const PUNCHMAN2_ULT_FINAL_KNOCKBACK = 5200;
const PUNCHMAN2_ULT_FINAL_STUN = 2.0;
const PUNCHMAN2_ULT_VANISH_LEAD = 0.35;     // beat of empty arena before the first blow lands
const PUNCHMAN2_ULT_STRIKE_INTERVAL = 0.62; // between blows — long, because this is the slow-mo beat
const PUNCHMAN2_ULT_OUTRO = 0.7;            // after the last blow, before it fades back in
const PUNCHMAN2_ULT_AFTERIMAGE_LIFE = 0.28; // how long each strike's silhouette lingers

// The target drifts at a fraction of its launch speed so the whole exchange reads in slow
// motion. Punch Man doesn't travel between blows at all — he is simply gone, then standing
// over them mid-swing, which hits harder than any amount of visible motion.
const PUNCHMAN2_ULT_SLOWMO = 0.26;
const PUNCHMAN2_ULT_WINDUP = 0.13; // seconds he stands cocked at the strike point beforehand

const PUNCHMAN2_JAB_REACH = 46;      // how far a jab extends past the rest position
const PUNCHMAN2_STRAIGHT_REACH = 82; // the straight goes much further
const PUNCHMAN2_JAB_LUNGE = 5;       // body shift on a jab
const PUNCHMAN2_STRAIGHT_LUNGE = 13; // and on the straight

const PUNCHMAN2_SHOCKWAVE_LIFE = 0.45;
const PUNCHMAN2_SHOCKWAVE_RADIUS = 175;       // blows 1-5
const PUNCHMAN2_SHOCKWAVE_FINAL_RADIUS = 420; // the sixth, by far the biggest

const PUNCHMAN2_ATTACK_SLOW_FACTOR = 0.35; // sticks to the target once in range
const PUNCHMAN2_PUNCH_ANIM_TIME = 0.12;
const PUNCHMAN2_HEAVY_ANIM_TIME = 0.22;    // the third punch's wind-up reads slower and heavier
// Victory: charges the camera and puts a fist through the screen. The glass stays cracked for
// the rest of the celebration.
const PUNCHMAN2_VICTORY_WINDUP_TIME = 1.0; // seconds coiled up before it launches
const PUNCHMAN2_VICTORY_RUSH_TIME = 0.8;  // seconds spent closing on the screen
const PUNCHMAN2_VICTORY_CRACKS = 12;      // main fracture lines radiating from the impact
const PUNCHMAN2_VICTORY_CRACK_REVEAL = 0.22; // how fast the fractures race outward

class PunchManNew extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: CHAR_BASE_SIZE,
      color: "#e0a030",
      maxHp: PUNCHMAN2_MAX_HP,
      // "(New)" is only there to disambiguate the two Punch Men on the setup/select screen
      // (see ROSTER's own separate label in main.js) — everywhere in-game that reads this
      // name directly (HUD, battle title, victory text) should just say "Punch Man".
      name: "Punch Man",
      speed: PUNCHMAN2_SPEED,
    });

    this.attackTimer = 0;
    this.punchesLanded = 0; // total; every third one is the heavy hit

    this.facingAngle = Math.random() * Math.PI * 2;
    this.punchAnimTimer = 0;
    this.punchAnimSide = 1;
    this.punchWasHeavy = false;   // drives the bigger animation on the third punch
    this.punchKind = "left";      // "left" | "right" | "straight"
    this.punchAnimDuration = PUNCHMAN2_PUNCH_ANIM_TIME;
    this.inRange = false;

    this.dashTimer = 0;    // >0 while mid-lunge
    this.dashCooldown = 0;
    this.dashGhosts = [];      // { x, y, life } — afterimages dropped along the lunge
    this.dashGhostTimer = 0;   // throttles how often they're dropped
    this.dashFxTimer = 0;      // >0 while the wind cone is still showing
    this.dashHeading = 0;      // direction it lunged, kept so the wind stays put once it stops

    this.skillState = "charging"; // charging | blitz
    this.chargeTime = 0;
    this.ultTimer = 0;        // counts down to the next blow (or to the end of the outro)
    this.ultStrikesDone = 0;
    this.ultDir = 0;          // heading the target is currently being launched along
    this.ultVel = { x: 0, y: 0 };
    this.ultSlammed = false;  // the final blow's wall impact only lands once
    this.afterimages = [];    // { x, y, angle, life, final } — motion trail as it crosses the arena
    this.shockwaves = [];     // { x, y, angle, life, radius, final } — one per blow landed
    this.ultNextPos = null;   // where it has to be standing for the next blow
    this.ultNextDir = 0;      // the heading that blow will send them off along
    this.ultMaterialized = false; // whether he has blinked in for the upcoming blow yet

    // The five non-final blows launch the target along the five edges of a pentagram, so the
    // path it gets knocked around traces a star before the sixth blow ends it.
    this.starVerts = [];
    this.starOrder = [0, 2, 4, 1, 3, 0]; // classic one-stroke pentagram order
    this.starPath = [];       // vertices already struck, for the drawn trail
    this.ultSetupFrom = null; // where the target started, before being placed on the first point
    this.ultTarget = null;    // held so draw() can trace the star behind them — draw() gets no opponent

    this.pushedByGiantTimer = 0; // >0 while being hauled along by the Giant's charge
    this.celebrating = false;

    // main.js draws drawVictoryOverlay() above everything for anyone flagged celebratingVictory
    this.celebratingVictory = false;
    this.victoryTimer = 0;
    this.victoryStartX = 0;
    this.victoryStartY = 0;
    this.victoryCracks = [];
    this.victorySmashed = false;
    this.victoryLaunched = false;
    this.victoryRumbleTimer = 0; // paces the rumble while it's coiled up
  }

  onVictory() {
    this.celebrating = true;
    this.celebratingVictory = true;
    this.victoryTimer = 0;
    this.victoryStartX = this.x;
    this.victoryStartY = this.y;
    this.victorySmashed = false;
    this.victoryLaunched = false;
    this.victoryRumbleTimer = 0;
    this.movable = false;
    this.vx = 0;
    this.vy = 0;
    this.startPunchAnim("straight");
    this.buildVictoryCracks();
  }

  // The fracture pattern is rolled once, up front, so it stays put once it's on screen
  // instead of crawling around as it's redrawn each frame.
  buildVictoryCracks() {
    this.victoryCracks = [];
    const reach = Math.hypot(WIDTH, HEIGHT);
    for (let i = 0; i < PUNCHMAN2_VICTORY_CRACKS; i++) {
      const base = (i / PUNCHMAN2_VICTORY_CRACKS) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const pts = [{ x: 0, y: 0 }];
      let ang = base, px = 0, py = 0, travelled = 0;
      const total = reach * (0.55 + Math.random() * 0.6);
      while (travelled < total) {
        const step = 45 + Math.random() * 95;
        ang = base + (Math.random() - 0.5) * 0.55;
        px += Math.cos(ang) * step;
        py += Math.sin(ang) * step;
        pts.push({ x: px, y: py });
        travelled += step;
      }
      this.victoryCracks.push(pts);
    }
  }

  get attackRange() {
    return this.size / 2 + PUNCHMAN2_RANGE;
  }

  // How many punches into the current set of three — 0, 1, or 2. At 2 the next one is heavy.
  get comboStep() {
    return this.punchesLanded % PUNCHMAN2_PUNCHES_PER_SET;
  }

  get nextPunchIsHeavy() {
    return this.comboStep === PUNCHMAN2_PUNCHES_PER_SET - 1;
  }

  get dashing() {
    return this.dashTimer > 0;
  }

  // While this is true it is not on the field at all — no body, no HP bar, no range rings.
  get blitzing() {
    return this.skillState === "blitz";
  }

  // Mid-blitz he only exists on screen for the blow itself: blinked in a beat beforehand,
  // gone again once the swing finishes. After the sixth he stays to watch them hit the wall.
  get ultVisible() {
    if (!this.blitzing) return true;
    if (this.ultStrikesDone >= PUNCHMAN2_ULT_STRIKES) return true;
    return this.ultMaterialized || this.punchAnimTimer > 0;
  }

  // ------------------------------------------------------------------ ultimate

  startBlitz(opponent) {
    this.skillState = "blitz";
    this.chargeTime = 0;
    this.ultStrikesDone = 0;
    this.ultSlammed = false;
    this.ultVel = { x: 0, y: 0 };
    this.ultTimer = PUNCHMAN2_ULT_VANISH_LEAD;
    this.shockwaves = [];
    this.vx = 0;
    this.vy = 0;
    // Vanishing off the field entirely (see blitzing/ultVisible above) means his own body
    // shouldn't take part in physics at all while it's out — main.js still calls
    // resolveCollision() against him every frame regardless of what update() is doing
    // internally, and update() never revisits his own vx/vy again until endBlitz() re-rolls
    // them. Left movable, an opponent (or one of Ninja's clones) that happened to bump into
    // his current (possibly teleporting-around) position would hit the "both movable" branch
    // in resolveCollision(), which SWAPS velocities rather than reflecting — handing them his
    // frozen (0,0) and leaving THEM standing motionless for good, since nothing in this game
    // ever gives an idle character a fresh push except onStunEnd()/a dash. Marking him fixed
    // here makes any such bump reflect off him instead, the same as bumping into the Giant
    // mid-absorb.
    this.movable = false;

    // The opening blow drives them off along the line it was already closing down.
    const dx = opponent.x - this.x;
    const dy = opponent.y - this.y;
    this.ultDir = Math.hypot(dx, dy) > 0.01 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;

    this.buildStar(opponent);
    this.ultSetupFrom = { x: opponent.x, y: opponent.y };
    this.ultTarget = opponent;

    // Freeze them from this instant, not from the first updateBlitz() next frame — otherwise
    // they get a free frame to act in after the arena has already gone empty.
    opponent.stunTimer = Math.max(opponent.stunTimer, 0.25);
    opponent.movable = false;
    opponent.vx = 0;
    opponent.vy = 0;

    playSfx("punchmanUltimate", 0.85);
    spawnFlash(this.x, this.y, "#ffffff", 120, 0.3);
    spawnImpactParticles(this.x, this.y, ["#ffd23c", "#ff7028", "#ffffff"], 34, 1.5, 0);
    triggerShake(7, 0.3);

    this.planNextStrike(opponent, PUNCHMAN2_ULT_VANISH_LEAD);
  }

  // Picks the heading for the next blow: the first one continues the approach, the last one
  // aims at whichever wall the target is closest to, and the ones between reverse the current
  // arc with a kink so it reads as a scramble rather than a straight rally.
  blitzStrikeDirection(opponent, isFinal) {
    if (isFinal) {
      const left = opponent.x - ARENA.x;
      const right = ARENA.x + ARENA.w - opponent.x;
      const top = opponent.y - ARENA.y;
      const bottom = ARENA.y + ARENA.h - opponent.y;
      const nearest = Math.min(left, right, top, bottom);
      if (nearest === left) return Math.PI;
      if (nearest === right) return 0;
      return nearest === top ? -Math.PI / 2 : Math.PI / 2;
    }
    if (this.ultStrikesDone === 0) return this.ultDir;
    return this.ultDir + Math.PI + (Math.random() * 1.2 - 0.6);
  }

  // Lays out the pentagram the target is about to be knocked around: centred on the arena,
  // as large as fits, and rotated so its first point is the one nearest wherever the target
  // happens to be standing — so the star starts from their side of the field.
  buildStar(opponent) {
    const cx = ARENA.x + ARENA.w / 2;
    const cy = ARENA.y + ARENA.h / 2;
    const radius = Math.min(ARENA.w, ARENA.h) / 2 - ARENA_BORDER - opponent.size / 2 - 16;
    const rot = Math.atan2(opponent.y - cy, opponent.x - cx);

    this.starVerts = [];
    for (let i = 0; i < 5; i++) {
      const a = rot + (i * Math.PI * 2) / 5;
      this.starVerts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
    }
    this.starPath = [];
  }

  // Where the target has to be for the next blow, and which way that blow sends them. For
  // the five star blows both come straight off the pentagram; only the finisher is free.
  planNextStrike(opponent, leadTime) {
    const i = this.ultStrikesDone;
    const isFinal = i === PUNCHMAN2_ULT_STRIKES - 1;

    let atX, atY, dir;
    if (isFinal) {
      atX = opponent.x + this.ultVel.x * PUNCHMAN2_ULT_SLOWMO * leadTime;
      atY = opponent.y + this.ultVel.y * PUNCHMAN2_ULT_SLOWMO * leadTime;
      dir = this.blitzStrikeDirection({ x: atX, y: atY }, true);
    } else {
      const from = this.starVerts[this.starOrder[i]];
      const to = this.starVerts[this.starOrder[i + 1]];
      atX = from.x;
      atY = from.y;
      dir = Math.atan2(to.y - from.y, to.x - from.x);
    }

    const standDist = (this.size + opponent.size) / 2 + 6;
    this.ultNextDir = dir;
    this.ultNextPos = {
      x: atX - Math.cos(dir) * standDist,
      y: atY - Math.sin(dir) * standDist,
    };
    this.ultMaterialized = false; // gone again until the windup for this blow
  }

  blitzStrike(opponent) {
    const i = this.ultStrikesDone;
    const isFinal = i === PUNCHMAN2_ULT_STRIKES - 1;
    const dir = this.ultNextDir;

    // Pin the target exactly on its star point before swinging. Snapping keeps drift from
    // accumulating over five blows and smearing the shape out of recognition.
    let kb;
    if (isFinal) {
      const closing = this.starVerts[this.starOrder[PUNCHMAN2_ULT_STRIKES - 1]];
      opponent.x = closing.x;
      opponent.y = closing.y;
      this.starPath.push({ x: closing.x, y: closing.y });
      kb = PUNCHMAN2_ULT_FINAL_KNOCKBACK;
    } else {
      const from = this.starVerts[this.starOrder[i]];
      const to = this.starVerts[this.starOrder[i + 1]];
      opponent.x = from.x;
      opponent.y = from.y;
      this.starPath.push({ x: from.x, y: from.y });
      // Exactly enough force to land on the next point as the next blow comes due
      kb = Math.hypot(to.x - from.x, to.y - from.y) /
           (PUNCHMAN2_ULT_SLOWMO * PUNCHMAN2_ULT_STRIKE_INTERVAL);
    }

    // Snap onto the planned interception point — close enough to punch but never overlapping,
    // since an overlap would hand the pair to resolveCollision mid-combo.
    const standDist = (this.size + opponent.size) / 2 + 6;
    this.x = opponent.x - Math.cos(dir) * standDist;
    this.y = opponent.y - Math.sin(dir) * standDist;
    this.facingAngle = dir;
    this.clampToArena();

    // Flat + a share of max HP (not current), so every blow of the combo lands for the same
    // amount instead of tapering as the target drops. Always at least 1, however small the target.
    const flat = isFinal ? PUNCHMAN2_ULT_FINAL_DAMAGE_FLAT : PUNCHMAN2_ULT_DAMAGE_FLAT;
    const pct = isFinal ? PUNCHMAN2_ULT_FINAL_DAMAGE_PCT : PUNCHMAN2_ULT_DAMAGE_PCT;
    const dmg = Math.max(1, Math.round(flat + opponent.maxHp * pct));
    opponent.takeDamage(dmg);

    this.ultDir = dir;
    this.ultVel = { x: Math.cos(dir) * kb, y: Math.sin(dir) * kb };

    // Every blow of the ultimate is a full committed straight, so it reads the same as the
    // heavy third punch rather than as a flurry of jabs.
    this.startPunchAnim("straight");

    const ix = opponent.x - Math.cos(dir) * (opponent.size / 2);
    const iy = opponent.y - Math.sin(dir) * (opponent.size / 2);

    this.shockwaves.push({
      x: ix, y: iy, angle: dir, life: PUNCHMAN2_SHOCKWAVE_LIFE,
      radius: isFinal ? PUNCHMAN2_SHOCKWAVE_FINAL_RADIUS : PUNCHMAN2_SHOCKWAVE_RADIUS,
      final: isFinal,
    });
    this.afterimages.push({ x: this.x, y: this.y, angle: dir, life: PUNCHMAN2_ULT_AFTERIMAGE_LIFE, final: isFinal });

    if (isFinal) {
      playSfx("pm2UltFinal", 0.95);
      spawnImpactParticles(ix, iy, ["#ffffff", "#ffd23c", "#ff7028"], 60, 2.5, 0);
      spawnFlash(ix, iy, "#ffe0a0", 185, 0.5);
      triggerShake(17, 0.5);
    } else {
      playSfx("pm2Blitz", 0.7);
      spawnImpactParticles(ix, iy, ["#ffd23c", "#ff7028", "#ffffff"], 32, 1.7, 0);
      spawnFlash(ix, iy, "#ffb060", 88, 0.28);
      triggerShake(9, 0.24);
    }
  }

  clampToArena() {
    const half = this.size / 2;
    this.x = Math.max(ARENA.x + ARENA_BORDER + half, Math.min(ARENA.x + ARENA.w - ARENA_BORDER - half, this.x));
    this.y = Math.max(ARENA.y + ARENA_BORDER + half, Math.min(ARENA.y + ARENA.h - ARENA_BORDER - half, this.y));
  }

  // Deliberately ignores whatever opponent reference update() was called with this frame —
  // against multiple enemies (VS BOSS mode), that's whoever's currently nearest, which can
  // change frame to frame as everyone moves. Once a blitz locks onto a target (startBlitz), it
  // has to keep manipulating that exact one for the whole sequence — the choreography (star
  // layout, launch arc, wall slam) is all built around their position at lock-in — or a
  // retarget mid-swing would abandon whoever was actually being juggled mid-air and start
  // yanking some other, unrelated fighter around instead.
  updateBlitz(dt) {
    const target = this.ultTarget;
    if (!target || !target.alive) {
      this.endBlitz(target);
      return;
    }

    // Held helpless for the whole sequence: topped up every frame so their own update() keeps
    // bailing out early instead of acting or moving under their own power.
    target.stunTimer = Math.max(target.stunTimer, 0.25);
    target.movable = false;

    // Carried along the launch arc between blows — this is the only thing moving them, since
    // the stun stops their normal movement entirely. Blows 1-5 drift in slow motion; once the
    // sixth has landed the brakes come off and they hit the wall at full speed.
    const allStruck = this.ultStrikesDone >= PUNCHMAN2_ULT_STRIKES;
    const slow = allStruck ? 1 : PUNCHMAN2_ULT_SLOWMO;
    const half = target.size / 2;
    const left = ARENA.x + ARENA_BORDER + half;
    const right = ARENA.x + ARENA.w - ARENA_BORDER - half;
    const top = ARENA.y + ARENA_BORDER + half;
    const bottom = ARENA.y + ARENA.h - ARENA_BORDER - half;

    if (this.ultStrikesDone === 0 && this.ultSetupFrom && this.starVerts.length) {
      // Opening beat: slid onto the star's first point before the shape starts being drawn.
      const k = Math.min(1, 1 - this.ultTimer / PUNCHMAN2_ULT_VANISH_LEAD);
      const v = this.starVerts[this.starOrder[0]];
      target.x = this.ultSetupFrom.x + (v.x - this.ultSetupFrom.x) * k;
      target.y = this.ultSetupFrom.y + (v.y - this.ultSetupFrom.y) * k;
    } else {
      target.x += this.ultVel.x * slow * dt;
      target.y += this.ultVel.y * slow * dt;
    }
    const hitWall =
      target.x <= left || target.x >= right || target.y <= top || target.y >= bottom;
    target.x = Math.max(left, Math.min(right, target.x));
    target.y = Math.max(top, Math.min(bottom, target.y));

    // The sixth blow is supposed to end with them embedded in a wall
    if (hitWall && allStruck && !this.ultSlammed) {
      this.ultSlammed = true;
      this.ultVel = { x: 0, y: 0 };
      playSfx("wallSlam", 0.85);
      spawnWallCrack(target.x, target.y);
      spawnImpactParticles(target.x, target.y, ["#ffffff", "#cfe0ff", "#a0c0ff"], 55, 2.2, 0);
      this.shockwaves.push({
        x: target.x, y: target.y, angle: this.ultDir,
        life: PUNCHMAN2_SHOCKWAVE_LIFE, radius: PUNCHMAN2_SHOCKWAVE_FINAL_RADIUS, final: true,
      });
      triggerShake(18, 0.55);
    }

    // No crossing, no trail: he is absent right up until the last moment, then simply there,
    // already standing over them with the fist cocked.
    if (this.ultNextPos && !allStruck && !this.ultMaterialized && this.ultTimer <= PUNCHMAN2_ULT_WINDUP) {
      this.ultMaterialized = true;
      this.x = this.ultNextPos.x;
      this.y = this.ultNextPos.y;
      this.facingAngle = this.ultNextDir;
      this.clampToArena();
      playSfx("pm2Teleport", 0.9);
      spawnFlash(this.x, this.y, "#ffd9a0", 54, 0.16);
    }

    this.ultTimer -= dt;
    if (this.ultTimer > 0) return;

    if (this.ultStrikesDone < PUNCHMAN2_ULT_STRIKES) {
      this.blitzStrike(target);
      this.ultStrikesDone++;
      if (this.ultStrikesDone < PUNCHMAN2_ULT_STRIKES) {
        this.ultTimer = PUNCHMAN2_ULT_STRIKE_INTERVAL;
        this.planNextStrike(target, PUNCHMAN2_ULT_STRIKE_INTERVAL);
      } else {
        this.ultTimer = PUNCHMAN2_ULT_OUTRO;
        this.ultNextPos = null;
      }
    } else {
      this.endBlitz(target);
    }
  }

  endBlitz(opponent) {
    this.skillState = "charging";
    this.chargeTime = 0;
    this.ultStrikesDone = 0;
    this.ultVel = { x: 0, y: 0 };
    this.ultSlammed = false;
    this.ultTarget = null;
    this.starPath = [];
    this.punchesLanded = 0; // fresh combo after the ultimate

    if (opponent && opponent.alive) {
      opponent.movable = true;
      opponent.applyStun(PUNCHMAN2_ULT_FINAL_STUN);
    }

    this.movable = true; // back on the field — collidable again
    const a = Math.random() * Math.PI * 2;
    this.vx = Math.cos(a) * this.speed;
    this.vy = Math.sin(a) * this.speed;
  }

  // Mid-lunge it moves at full dash speed; in range it slows to stay glued to the target;
  // while the Giant is hauling it, its own movement stays out of the way entirely.
  moveAndBounce(dt) {
    if (this.pushedByGiantTimer > 0) return super.moveAndBounce(dt);
    if (this.dashing) return super.moveAndBounce(dt);
    return super.moveAndBounce(dt * (this.inRange ? PUNCHMAN2_ATTACK_SLOW_FACTOR : 1));
  }

  startDash(dx, dy, dist) {
    this.dashTimer = PUNCHMAN2_DASH_DURATION;
    this.dashCooldown = PUNCHMAN2_DASH_COOLDOWN;
    this.dashGhostTimer = 0;
    this.dashFxTimer = PUNCHMAN2_DASH_FX_TIME;
    this.dashHeading = Math.atan2(dy, dx);
    this.vx = (dx / dist) * PUNCHMAN2_DASH_SPEED;
    this.vy = (dy / dist) * PUNCHMAN2_DASH_SPEED;
    playSfx("pm2Teleport", 0.75); // same blink-move sound as the ultimate, a touch quieter
    // A puff of displaced air kicked off the spot it launched from, thrown backwards
    spawnImpactParticles(this.x - (dx / dist) * 14, this.y - (dy / dist) * 14,
                         ["#ffffff", "#e8dcc8", "#ffcf6b"], 16, 1.1, 0);
  }

  // Drops back to normal walking pace in whatever direction it ended up going.
  endDash() {
    this.dashTimer = 0;
    const mag = Math.hypot(this.vx, this.vy);
    if (mag > 0.01) {
      const s = this.speed / mag;
      this.vx *= s;
      this.vy *= s;
    }
  }

  // Kicks off one of the three punch animations. "left"/"right" are quick diagonal jabs off
  // that shoulder; "straight" converges onto the centre line, reaches much further, and
  // chambers the other fist back — so all three read differently at a glance.
  startPunchAnim(kind) {
    this.punchKind = kind;
    this.punchWasHeavy = kind === "straight";
    this.punchAnimDuration = kind === "straight" ? PUNCHMAN2_HEAVY_ANIM_TIME : PUNCHMAN2_PUNCH_ANIM_TIME;
    this.punchAnimTimer = this.punchAnimDuration;
    this.punchAnimSide = kind === "right" ? 1 : -1; // the straight is thrown off the left lead
  }

  landPunch(opponent) {
    const heavy = this.nextPunchIsHeavy;
    const dmg = heavy ? PUNCHMAN2_THIRD_DAMAGE : PUNCHMAN2_FIST_DAMAGE;
    opponent.takeDamage(dmg);
    this.punchesLanded++;
    // Every point landed brings the ultimate forward — landPunch only runs while charging,
    // since the blitz takes over update() entirely.
    this.chargeTime += dmg * PUNCHMAN2_DAMAGE_CHARGE_BONUS;

    this.attackTimer += 1 / PUNCHMAN2_RATE;
    // Punch 1 is a left jab, punch 2 a right jab, punch 3 the committed straight down the
    // centre line. The heavy flag and the combo step already agree, so the kind follows.
    this.startPunchAnim(heavy ? "straight" : (this.punchesLanded % 3 === 1 ? "left" : "right"));

    const impactX = opponent.x - Math.cos(this.facingAngle) * (opponent.size / 2);
    const impactY = opponent.y - Math.sin(this.facingAngle) * (opponent.size / 2);

    if (heavy) {
      // Blasts them straight back along the punch. Scaled against target size the same way
      // the Bomber's and Demon's knockback is, so the Giant doesn't get launched like a ball.
      const kb = PUNCHMAN2_THIRD_KNOCKBACK * (CHAR_BASE_SIZE / opponent.size);
      opponent.applyKnockback(Math.cos(this.facingAngle), Math.sin(this.facingAngle), kb);
      playSfx("pm2ThirdPunch", 0.75);
      spawnImpactParticles(impactX, impactY, ["#ffd23c", "#ff7028", "#ffffff"], 30, 1.5, 0);
      spawnFlash(impactX, impactY, "#ffb060", 70, 0.3);
      triggerShake(7, 0.25);
    } else {
      playSfx("punch", 0.35);
      spawnImpactParticles(impactX, impactY, ["#ffcf6b", "#ffe066", "#ff8c30"], 14, 1, 0);
    }
  }

  update(dt, opponent) {
    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt;
    if (!this.alive) return;

    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].life -= dt;
      if (this.afterimages[i].life <= 0) this.afterimages.splice(i, 1);
    }
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      this.shockwaves[i].life -= dt;
      if (this.shockwaves[i].life <= 0) this.shockwaves.splice(i, 1);
    }
    // Keeps fading after the lunge ends, so the trail trails off instead of vanishing on arrival
    for (let i = this.dashGhosts.length - 1; i >= 0; i--) {
      this.dashGhosts[i].life -= dt;
      if (this.dashGhosts[i].life <= 0) this.dashGhosts.splice(i, 1);
    }
    if (this.dashFxTimer > 0) this.dashFxTimer -= dt;
    if (this.dashing) {
      this.dashGhostTimer -= dt;
      if (this.dashGhostTimer <= 0) {
        this.dashGhostTimer = PUNCHMAN2_DASH_GHOST_INTERVAL;
        this.dashGhosts.push({ x: this.x, y: this.y, life: PUNCHMAN2_DASH_GHOST_LIFE });
      }
    }

    // The blitz takes over completely: no walking, no normal punching, no collisions.
    if (this.blitzing) {
      if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
      if (this.punchAnimTimer > 0) this.punchAnimTimer -= dt; // the blow has to animate through
      this.updateBlitz(dt);
      return;
    }

    // Victory: stops fighting entirely and rushes the camera. The field body isn't drawn any
    // more — drawVictoryOverlay takes over the whole screen (see draw()).
    if (this.celebrating) {
      this.victoryTimer += dt;

      // Coiled up: a rumble that tightens as it loads, then the launch itself
      if (this.victoryTimer < PUNCHMAN2_VICTORY_WINDUP_TIME) {
        const k = this.victoryTimer / PUNCHMAN2_VICTORY_WINDUP_TIME;
        this.victoryRumbleTimer -= dt;
        if (this.victoryRumbleTimer <= 0) {
          this.victoryRumbleTimer = 0.16 - k * 0.09;
          triggerShake(1.5 + k * 6, 0.12);
        }
      } else if (!this.victoryLaunched) {
        this.victoryLaunched = true;
        playSfx("pm2Jump", 0.9);
        triggerShake(9, 0.25);
        spawnImpactParticles(this.victoryStartX, this.victoryStartY,
                             ["#ffffff", "#ffd88c", "#c0392b"], 34, 1.8, 0);
      }

      if (!this.victorySmashed &&
          this.victoryTimer >= PUNCHMAN2_VICTORY_WINDUP_TIME + PUNCHMAN2_VICTORY_RUSH_TIME) {
        this.victorySmashed = true;
        playSfx("pm2UltFinal", 1.0);
        playSfx("pm2GlassBreak", 0.9);
        triggerShake(22, 0.6);
      }
      return;
    }

    let dist = Infinity;
    let dx = 0, dy = 0;
    if (opponent && opponent.alive) {
      dx = opponent.x - this.x;
      dy = opponent.y - this.y;
      dist = Math.hypot(dx, dy);
      if (dist > 0.01) this.facingAngle = Math.atan2(dy, dx);
      this.inRange = dist <= this.attackRange + opponent.size / 2;
    } else {
      this.inRange = false;
    }

    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      // Arriving is the point of the lunge, so getting in range ends it early.
      if (this.dashTimer <= 0 || this.inRange) this.endDash();
    }

    super.update(dt, opponent);
    if (this.pushedByGiantTimer > 0) this.pushedByGiantTimer -= dt;
    if (this.stunTimer > 0) return;

    // Close the gap the moment something wanders into lunge range but stays out of reach.
    if (
      opponent && opponent.alive && this.canAttack &&
      !this.dashing && this.dashCooldown <= 0 &&
      !this.inRange && dist <= PUNCHMAN2_DASH_RADIUS && dist > 0.01 &&
      this.pushedByGiantTimer <= 0
    ) {
      this.startDash(dx, dy, dist);
    }

    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.punchAnimTimer > 0) this.punchAnimTimer -= dt;

    if (opponent && opponent.alive && this.attackTimer <= 0 && this.inRange && this.canAttack) {
      this.landPunch(opponent);
    }

    // Charge only counts up while there's someone to unload it on, and it fires the moment
    // it's full — there's no reason to bank it.
    this.chargeTime += dt;
    if (this.chargeTime >= PUNCHMAN2_ULT_CHARGE_TIME && opponent && opponent.alive && this.canAttack) {
      this.startBlitz(opponent);
    }
  }

  // Where one fist sits this frame. Rest is a diagonal guard off that shoulder; a jab shoots
  // that fist out along its own diagonal; the straight swings the throwing fist onto the
  // centre line and drives it much further while the other chambers back against the body.
  fistPose(side, restDist) {
    const restOffset = side * (Math.PI / 4);
    if (this.punchAnimTimer <= 0) return { offset: restOffset, dist: restDist, punchT: 0 };

    const t = 1 - this.punchAnimTimer / this.punchAnimDuration; // 0 -> 1
    const punchT = Math.sin(t * Math.PI);                       // out and back
    const throwing = side === this.punchAnimSide;

    if (this.punchKind === "straight") {
      if (throwing) {
        return {
          offset: restOffset * (1 - punchT),                 // converges onto dead centre
          dist: restDist + punchT * PUNCHMAN2_STRAIGHT_REACH,
          punchT,
        };
      }
      return { offset: restOffset * (1 + punchT * 0.55), dist: restDist - punchT * 15, punchT: 0 };
    }

    if (throwing) {
      return {
        offset: restOffset * (1 - punchT * 0.5),
        dist: restDist + punchT * PUNCHMAN2_JAB_REACH,
        punchT,
      };
    }
    return { offset: restOffset, dist: restDist - punchT * 6, punchT: 0 };
  }

  // A fighter's headband: a band worn across the brow with two tails streaming out behind.
  // The tails flutter on their own and lash harder mid-punch, which gives the silhouette some
  // life — every other character has something (horns, a helmet, a crest) and this had nothing.
  drawHeadband(ctx, bx, by, r) {
    const t = performance.now() / 1000;
    const punching = this.punchAnimTimer > 0
      ? Math.sin((1 - this.punchAnimTimer / this.punchAnimDuration) * Math.PI)
      : 0;

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(this.facingAngle);

    // Tails first, so the band itself sits on top of where they attach
    for (const side of [-1, 1]) {
      const rootX = -r * 0.78;
      const rootY = side * r * 0.2;
      const len = 34 + punching * 18;
      const halfW = 3.2;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const f = i / 6;
        const qx = rootX - len * f;
        const qy = rootY + Math.sin(t * 7 + f * 4.5 + side * 1.6) * (4 + punching * 5) * f + side * f * 2.5;
        ctx.lineTo(qx, qy - halfW * (1 - f * 0.6));
      }
      for (let i = 6; i >= 0; i--) {
        const f = i / 6;
        const qx = rootX - len * f;
        const qy = rootY + Math.sin(t * 7 + f * 4.5 + side * 1.6) * (4 + punching * 5) * f + side * f * 2.5;
        ctx.lineTo(qx, qy + halfW * (1 - f * 0.6));
      }
      ctx.closePath();
      ctx.fillStyle = side < 0 ? "#c0392b" : "#9c2b21";
      ctx.fill();
    }

    // The band itself, clipped so it hugs the head instead of overhanging it. Sits behind the
    // eyes so it reads as worn across the brow rather than as a stripe down the middle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(-r * 0.42, -r, r * 0.2, r * 2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(-r * 0.42, r * 0.24, r * 0.2, r * 0.76);
    ctx.restore();

    ctx.restore();
  }

  drawBody(ctx) {
    const r = this.size / 2;
    const heavyReady = this.nextPunchIsHeavy;

    // The whole body leans into a punch — a small shove on a jab, a real lunge on the straight
    let lunge = 0;
    if (this.punchAnimTimer > 0) {
      const t = 1 - this.punchAnimTimer / this.punchAnimDuration;
      const amt = this.punchKind === "straight" ? PUNCHMAN2_STRAIGHT_LUNGE : PUNCHMAN2_JAB_LUNGE;
      lunge = Math.sin(t * Math.PI) * amt;
    }
    const bx = this.x + Math.cos(this.facingAngle) * lunge;
    const by = this.y + Math.sin(this.facingAngle) * lunge;

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Soft highlight, so the body isn't a completely flat disc
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.arc(bx - r * 0.28, by - r * 0.3, r * 0.34, 0, Math.PI * 2);
    ctx.fill();

    this.drawHeadband(ctx, bx, by, r);

    const restDist = r + 16;
    const fistR = heavyReady ? 15 : 12;

    [-1, 1].forEach((side) => {
      const pose = this.fistPose(side, restDist);
      const a = this.facingAngle + pose.offset;
      const fx = bx + Math.cos(a) * pose.dist;
      const fy = by + Math.sin(a) * pose.dist;

      // Charge-up glow while the heavy punch is loaded
      if (heavyReady) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 90);
        const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, fistR + 12);
        grad.addColorStop(0, `rgba(255,110,80,${0.55 * pulse})`);
        grad.addColorStop(1, "rgba(220,48,32,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(fx, fy, fistR + 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.fillStyle = heavyReady ? "#d84030" : "#c88840";
      ctx.beginPath();
      ctx.arc(fx, fy, fistR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  // Streaked silhouettes at each strike point — the only thing fast enough to leave a mark
  drawAfterimages(ctx) {
    for (const a of this.afterimages) {
      const t = a.life / PUNCHMAN2_ULT_AFTERIMAGE_LIFE; // 1 -> 0
      ctx.save();
      ctx.globalAlpha = t * 0.55;
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(a.x, a.y);
      ctx.rotate(a.angle);
      ctx.fillStyle = a.final ? "#ffe0a0" : "#ff9a5a";
      ctx.beginPath();
      ctx.ellipse(0, 0, this.size * 0.62, this.size * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = t * 0.8;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-this.size * 0.8, 0);
      ctx.lineTo(this.size * 0.8, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  // A directional pressure wave off the knuckles: a bright leading arc plus a wide ring,
  // both expanding and fading. The sixth blow's is far larger than the rest.
  drawShockwaves(ctx) {
    for (const s of this.shockwaves) {
      const t = 1 - s.life / PUNCHMAN2_SHOCKWAVE_LIFE; // 0 -> 1 as it expands
      const fade = 1 - t;
      const r = s.radius * (0.18 + 0.82 * t);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);

      ctx.globalAlpha = fade * 0.75;
      ctx.strokeStyle = s.final ? "#ffffff" : "#ffd9a0";
      ctx.lineWidth = (s.final ? 9 : 5) * fade + 1;
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();

      ctx.globalAlpha = fade * 0.4;
      ctx.strokeStyle = s.final ? "#ffd23c" : "#ff8c30";
      ctx.lineWidth = (s.final ? 5 : 3) * fade + 1;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.66, -Math.PI * 0.55, Math.PI * 0.55);
      ctx.stroke();

      ctx.globalAlpha = fade * 0.22;
      ctx.strokeStyle = s.final ? "#ffffff" : "#ffb060";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // The star being drawn: every edge already struck, plus the one currently in flight,
  // traced live behind the target.
  drawStarTrail(ctx, opponent) {
    if (!this.blitzing || this.starPath.length === 0) return;

    const pts = this.starPath.slice();
    if (opponent && opponent.alive && this.ultStrikesDone < PUNCHMAN2_ULT_STRIKES) {
      pts.push({ x: opponent.x, y: opponent.y });
    }
    if (pts.length < 2) return;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = "#ff8c30";
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#ffe9a8";
    ctx.lineWidth = 3;
    ctx.stroke();

    for (const p of this.starPath) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // The lunge's sense of speed: a string of fading bodies left along the path, plus a cone of
  // wind streaks dragged out behind while it's actually moving.
  drawDashEffect(ctx) {
    for (const g of this.dashGhosts) {
      const t = g.life / PUNCHMAN2_DASH_GHOST_LIFE; // 1 -> 0
      ctx.save();
      ctx.globalAlpha = t * 0.42;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(g.x, g.y, (this.size / 2) * (0.5 + 0.5 * t), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (this.dashFxTimer <= 0) return;

    const heading = this.dashHeading;
    const back = heading + Math.PI;
    const perp = heading + Math.PI / 2;
    const strength = this.dashFxTimer / PUNCHMAN2_DASH_FX_TIME;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < PUNCHMAN2_DASH_WIND_LINES; i++) {
      const f = (i / (PUNCHMAN2_DASH_WIND_LINES - 1)) * 2 - 1; // -1 .. 1 across the body
      const spread = Math.abs(f);
      const ox = Math.cos(perp) * f * (this.size * 0.44);
      const oy = Math.sin(perp) * f * (this.size * 0.44);
      const start = this.size * 0.3 + spread * 10;
      const len = 30 + (1 - spread) * 46;
      const x0 = this.x + ox + Math.cos(back) * start;
      const y0 = this.y + oy + Math.sin(back) * start;

      ctx.globalAlpha = strength * (0.5 - spread * 0.26);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.6 - spread * 1.2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(back) * len, y0 + Math.sin(back) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  draw(ctx) {
    if (!this.alive && this.deathFadeTimer <= 0) return;
    // Once it's won it isn't on the field any more — drawVictoryOverlay owns the whole frame.
    if (this.celebratingVictory) return;

    // Mid-ultimate it is very much on the field — the punches are the whole show. It just
    // arrives streaked in afterimages and leaves a pressure wave behind every blow.
    if (this.blitzing) {
      this.drawStarTrail(ctx, this.ultTarget);
      this.drawAfterimages(ctx);
      if (this.ultVisible) {
        ctx.save();
        this.drawBody(ctx);
        ctx.restore();
      }
      this.drawShockwaves(ctx);
      return;
    }
    this.drawAfterimages(ctx);
    this.drawShockwaves(ctx);
    this.drawDashEffect(ctx); // under the body, so the ghosts read as trailing behind it

    super.draw(ctx);
  }

  // The coil before the leap: squashed down along the line it's about to launch on, shaking
  // harder and harder, with energy dragged inward and the ground cracking under it.
  drawVictoryWindup(ctx, k) {
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    const launch = Math.atan2(cy - this.victoryStartY, cx - this.victoryStartX);
    const r = this.size / 2;

    // vibration builds over the second — deterministic wobble rather than per-frame noise
    const t = performance.now() / 1000;
    const shakeAmt = k * k * 5;
    const x = this.victoryStartX + Math.sin(t * 61) * shakeAmt;
    const y = this.victoryStartY + Math.cos(t * 73) * shakeAmt;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(launch);

    // Energy being pulled in: rings tightening onto it, one after another
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const phase = ((t * 1.6 + i / 3) % 1);
      const rr = r * (3.4 - phase * 2.6);
      ctx.globalAlpha = phase * 0.45 * k;
      ctx.strokeStyle = "#ffd88c";
      ctx.lineWidth = 2 + k * 2;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // and a glow pooling underneath
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
    glow.addColorStop(0, `rgba(255,190,90,${0.4 * k})`);
    glow.addColorStop(1, "rgba(192,57,43,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Crouched: compressed along the launch axis, bulging out sideways, like a loaded spring
    const along = 1 - 0.32 * k;
    const across = 1 + 0.26 * k;
    ctx.save();
    ctx.scale(along, across);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.3, r * 0.34, 0, Math.PI * 2);
    ctx.fill();

    // headband, whipping harder the more it loads
    for (const side of [-1, 1]) {
      const rootY = side * r * 0.2;
      const len = 34 + k * 26;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const f = i / 6;
        ctx.lineTo(-r * 0.78 - len * f, rootY + Math.sin(t * (7 + k * 9) + f * 4.5 + side * 1.6) * (4 + k * 9) * f + side * f * 2.5 - 3.2 * (1 - f * 0.6));
      }
      for (let i = 6; i >= 0; i--) {
        const f = i / 6;
        ctx.lineTo(-r * 0.78 - len * f, rootY + Math.sin(t * (7 + k * 9) + f * 4.5 + side * 1.6) * (4 + k * 9) * f + side * f * 2.5 + 3.2 * (1 - f * 0.6));
      }
      ctx.closePath();
      ctx.fillStyle = side < 0 ? "#c0392b" : "#9c2b21";
      ctx.fill();
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(-r * 0.42, -r, r * 0.2, r * 2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(-r * 0.42, r * 0.24, r * 0.2, r * 0.76);
    ctx.restore();
    ctx.restore();

    ctx.restore();
  }

  // Victory sequence, drawn over the whole frame by main.js: it charges the camera, then puts
  // a straight through the screen and leaves the glass fractured.
  drawVictoryOverlay(ctx) {
    if (this.victoryTimer < PUNCHMAN2_VICTORY_WINDUP_TIME) {
      this.drawVictoryWindup(ctx, this.victoryTimer / PUNCHMAN2_VICTORY_WINDUP_TIME);
      return;
    }

    const rush = Math.min(1, (this.victoryTimer - PUNCHMAN2_VICTORY_WINDUP_TIME) / PUNCHMAN2_VICTORY_RUSH_TIME);
    const eased = rush * rush; // hangs back, then closes fast
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;

    const bodyTarget = Math.max(WIDTH, HEIGHT) * 0.62;
    const size = this.baseSize + (bodyTarget - this.baseSize) * eased;
    const x = this.victoryStartX + (cx - this.victoryStartX) * eased;
    const y = this.victoryStartY + (cy - this.victoryStartY) * eased;
    const r = size / 2;

    ctx.save();

    // body
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3 + 6 * eased;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.arc(x - r * 0.28, y - r * 0.3, r * 0.34, 0, Math.PI * 2);
    ctx.fill();

    // headband, drawn straight at the viewer
    ctx.save();
    ctx.translate(x, y);
    const t = performance.now() / 1000;
    for (const side of [-1, 1]) {
      const rootY = side * r * 0.2;
      const len = r * 0.95;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const f = i / 6;
        ctx.lineTo(-r * 0.78 - len * f, rootY + Math.sin(t * 7 + f * 4.5 + side * 1.6) * r * 0.12 * f + side * f * r * 0.1);
      }
      for (let i = 6; i >= 0; i--) {
        const f = i / 6;
        ctx.lineTo(-r * 0.78 - len * f, rootY + Math.sin(t * 7 + f * 4.5 + side * 1.6) * r * 0.12 * f + side * f * r * 0.1 + r * 0.11 * (1 - f * 0.6));
      }
      ctx.closePath();
      ctx.fillStyle = side < 0 ? "#c0392b" : "#9c2b21";
      ctx.fill();
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#c0392b";
    ctx.fillRect(-r * 0.42, -r, r * 0.2, r * 2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(-r * 0.42, r * 0.24, r * 0.2, r * 0.76);
    ctx.restore();
    ctx.restore();

    // The fist rushes the camera faster than the body does, so it arrives first
    // Offset toward the near side rather than dead centre, so the headband stays visible
    // behind it — otherwise the fist swallows the whole character.
    const fistR = r * (0.26 + 0.34 * eased);
    const fistX = x + (cx - x) * 0.6 + r * 0.3;
    const fistY = y + (cy - y) * 0.6 + r * 0.12;
    ctx.fillStyle = this.victorySmashed ? "#d84030" : "#c88840";
    ctx.beginPath();
    ctx.arc(fistX, fistY, fistR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.arc(fistX - fistR * 0.3, fistY - fistR * 0.32, fistR * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    if (this.victorySmashed) this.drawShatteredGlass(ctx, cx, cy);
  }

  drawShatteredGlass(ctx, cx, cy) {
    const since = this.victoryTimer - PUNCHMAN2_VICTORY_RUSH_TIME;
    const reveal = Math.min(1, since / PUNCHMAN2_VICTORY_CRACK_REVEAL);

    ctx.save();
    ctx.translate(cx, cy);

    // A brief white blowout at the moment of impact
    if (since < 0.18) {
      ctx.globalAlpha = (1 - since / 0.18) * 0.75;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-WIDTH, -HEIGHT, WIDTH * 2, HEIGHT * 2);
      ctx.globalAlpha = 1;
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const pts of this.victoryCracks) {
      const shown = Math.max(2, Math.floor(pts.length * reveal));
      // dark fracture with a bright edge, so it reads as broken glass on any background
      for (const [color, width, alpha] of [["#05050a", 9, 0.9], ["#ffffff", 3, 0.85]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < shown; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    }

    // concentric webbing tying the radial fractures together
    for (const ring of [0.22, 0.45, 0.72]) {
      const rr = Math.hypot(WIDTH, HEIGHT) * 0.5 * ring * reveal;
      ctx.strokeStyle = "#ffffff";
      ctx.globalAlpha = 0.5 * reveal;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < this.victoryCracks.length; i++) {
        const a = (i / this.victoryCracks.length) * Math.PI * 2;
        const jitter = 0.86 + ((i * 37) % 17) / 60;
        const px = Math.cos(a) * rr * jitter;
        const py = Math.sin(a) * rr * jitter;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // punched-out hole at the point of impact
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#05050a";
    ctx.beginPath();
    ctx.arc(0, 0, 34 * reveal, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;
    ctx.stroke();

    ctx.restore();
  }

  // Mid-blitz there's no charge progress left to show, so the bar just holds full/gold —
  // same trick every other ultimate-bar override in the roster uses.
  get ultimateRatio() {
    if (this.blitzing) return 1;
    return Math.min(1, this.chargeTime / PUNCHMAN2_ULT_CHARGE_TIME);
  }

  get ultimateBarColor() {
    return this.blitzing || this.chargeTime >= PUNCHMAN2_ULT_CHARGE_TIME ? "#ffd23c" : "#d0483c";
  }

  drawHud(ctx, x, y, w) {
    let ny = super.drawHud(ctx, x, y, w);
    ctx.textAlign = "left";

    if (this.celebrating) {
      ctx.fillStyle = "#ffd23c";
      ctx.font = "bold 14px Arial";
      ctx.fillText("Victory!", x, ny);
      return;
    }

    if (this.blitzing) {
      ctx.fillStyle = "#ffd23c";
      ctx.font = "bold 15px Arial";
      ctx.fillText(`BLITZ  ${Math.min(this.ultStrikesDone, PUNCHMAN2_ULT_STRIKES)}/${PUNCHMAN2_ULT_STRIKES}`, x, ny);
      return;
    }

    if (this.stunTimer > 0) {
      ctx.fillStyle = "#999999";
      ctx.font = "14px Arial";
      ctx.fillText(`Stunned: ${this.stunTimer.toFixed(1)}s`, x, ny);
      return;
    }

    // Three pips: the filled ones are punches already landed in this set, and the third
    // lights up gold when the heavy hit is loaded.
    const pipR = 7;
    const gap = 22;
    for (let i = 0; i < PUNCHMAN2_PUNCHES_PER_SET; i++) {
      const cx = x + pipR + i * gap;
      const cy = ny - 5;
      const filled = i < this.comboStep;
      const isHeavySlot = i === PUNCHMAN2_PUNCHES_PER_SET - 1;
      ctx.beginPath();
      ctx.arc(cx, cy, pipR, 0, Math.PI * 2);
      ctx.fillStyle = filled ? (isHeavySlot ? "#ffb03c" : "#d0483c") : "rgba(255,255,255,0.12)";
      ctx.fill();
      ctx.strokeStyle = isHeavySlot && this.nextPunchIsHeavy ? "#ffd23c" : "rgba(255,255,255,0.4)";
      ctx.lineWidth = isHeavySlot && this.nextPunchIsHeavy ? 2.5 : 1.5;
      ctx.stroke();
    }

    ctx.font = "13px Arial";
    ctx.fillStyle = this.nextPunchIsHeavy ? "#ffd23c" : "rgba(255,255,255,0.7)";
    ctx.fillText(this.nextPunchIsHeavy ? "HEAVY ready" : "Building combo", x + gap * 3 + 4, ny);

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "13px Arial";
    ctx.fillText(
      this.dashing ? "Dashing!" : this.dashCooldown > 0 ? `Dash: ${this.dashCooldown.toFixed(1)}s` : "Dash ready",
      x, ny + 20
    );
  }
}
