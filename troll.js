// Troll: a slow, heavy brawler with a big HP pool. 200 HP — second only to the Giant — but it
// doesn't dash, doesn't throw anything, and doesn't have a burst window. It walks up and swings
// a club, once every couple of seconds, in a wide arc.
//
//   RAMPAGE (ultimate) — it plants itself and roars, then goes berserk: it drops the wide
//   sweep for a two-handed overhead smash, hunts the opponent down instead of wandering, moves
//   faster, and hits far harder on a much shorter cooldown. It is the only thing on the roster
//   that actively CHASES; everything else drifts and collides.
//
//   The roar itself is a real liability — it is rooted in place for the whole of it, in the open,
//   with no attack. That window is the price of the state that follows.
//
// The swing is an ARC, not a single-target poke or a circular blast — nothing else on the
// roster hits a cone. Beyond feeling like a club, that has a real mechanical payoff: it can
// catch a Ninja and its clone in the same swing.

// 240, not 200. The Troll's own damage output is almost flat across the whole roster (2.7-4.8
// DPS measured against every opponent); what decides a match is purely whether it survives long
// enough to finish the ~25s it always needs. So HP only ever helps the matchups it was losing,
// which is exactly what a spread this wide needs.
// 180, down from 200 — the ultimate's own vitality grant (see TROLL_RAGE_HP_GRANT below) is
// what makes up the difference and more while the rampage is actually up.
const TROLL_MAX_HP = 180;
// Slow, but not Giant-slow. The Giant gets away with 140 because it has an 800px/s charge to
// close with; the Troll has no gap-closer at all, and nothing in this game actively chases —
// characters wander and collide — so at 190 it simply never reached anyone above its own speed
// and sat at a 0% win rate against the entire ranged half of the roster. "Slow" is the ATTACK,
// which is what the design is actually about.
const TROLL_SPEED  = 240;
// How fast it can swing its body round, in radians per second. facingAngle used to be set
// straight to atan2 every frame, so a target crossing behind it flipped the sprite between the
// eight facings in a single frame. At this rate a full 180 takes about 0.45s and visibly sweeps
// through the poses in between.
//
// It has to stay comfortably above how fast a target can actually orbit: at the edge of the
// attack range (110px) an opponent moving at 400px/s sideways sweeps 3.6 rad/s, so 7 leaves
// headroom and the aim never falls behind during a windup.
const TROLL_TURN_RATE = 7.0;
// ...and the turn is EASED up to that rate rather than run flat out at it. A constant-rate step
// starts and stops dead, so the body snapped into the turn and snapped out of it, and the lean in
// drawBody — which is driven off turnRate — popped on and off with it. The gain is high enough
// that anything past about half a radian of error still saturates at the full rate, so only the
// last part of the turn eases out and the aim never falls behind a moving target.
const TROLL_TURN_EASE  = 14.0; // wanted rad/s per radian of error, clamped to TROLL_TURN_RATE
const TROLL_TURN_ACCEL = 12.0; // how fast the actual rate converges on the wanted one

const TROLL_ATTACK_SLOW_FACTOR = 0.35; // same idea as Punch Man's: sticks to the target in range
const TROLL_SIZE   = CHAR_BASE_SIZE * 1.6;

// The swing. Total cycle is windup -> strike -> recover, then the rest of the interval as idle.
// The windup is long and obvious on purpose: this is the one attack in the game you should be
// able to see coming and walk out of.
const TROLL_SWING_WINDUP  = 0.5;
const TROLL_SWING_STRIKE  = 0.18; // the club actually sweeping through the arc
const TROLL_SWING_RECOVER = 0.35;
const TROLL_SWING_DAMAGE  = 21;
const TROLL_SWING_REACH   = 77;   // past the body's own radius
const TROLL_SWING_ARC     = Math.PI / 3; // half-angle, so a 120-degree cone in front
// A real launch, not a stagger. The knockback layer decays at KNOCKBACK_DECAY_RATE (2.5/s), so
// total displacement is roughly strength * 0.4 — 420 throws a base-size target about 168px,
// well over a quarter of the 600px arena.
//
// This was 150 for a while, on the reasoning that a slow brawler can't re-close the gap it just
// made. Two things overturned that. The step-in (TROLL_SWING_ADVANCE) means it now walks the gap
// back down on its own. And at 150 a ranged opponent knocked back only 60px never actually left
// the swing arc — measured across the ranged half of the roster, they spent 38% of the round
// pinned inside the Troll's reach, being clubbed at point-blank instead of playing their own
// game. 420 cuts that to 28%; going further (550, 700) only reaches 27%/26% while costing the
// Troll most of its winning matchups, so this is where the curve flattens.
// 1500 puts it between the Fire Mage's explosion (1500) and PM2's third punch (950) — the
// knockback layer decays at KNOCKBACK_DECAY_RATE (2.5/s), so displacement is roughly strength
// * 0.4: a base-size target is thrown about 600px, which is most of the way across the 600px
// arena. Scaled down against bigger targets, as everything here is.
const TROLL_SWING_KNOCKBACK = 1500;

// It steps INTO the swing. Without this the Troll stood still (or kept wandering) for the whole
// 0.59s from windup to impact while the target walked off, and every single miss was a distance
// miss — 0% of them were the target leaving the cone, 100% were it leaving reach, by a median of
// 78px. This is a lean, not a dash: it covers roughly that gap over the windup and strike and
// then stops, so the gap-closing problem in the ranged matchups is still wide open.
//
// 130 rather than 170: both fix the whiffs (74-75% hit either way), but 170 also drags Knight
// from ~60% to ~95% and pushes the overall win rate past 60%. Gating the step to only run while
// the target is still far away was tried and does nothing measurable (44.8/48.2 vs 52.4 across
// two runs of the same config, i.e. inside the noise), so the step is unconditional.
const TROLL_SWING_ADVANCE = 95;

// The gap between the START of one swing and the next. The whole swing animation runs 1.03s, so
// this is what actually paces the normal attack — unlike the rampage, where the animation is
// LONGER than its interval and takes over as the limit.
//
// 2.6 rather than 3.5 is the one lever that measurably NARROWED the spread rather than just
// sliding the average: swept over HP and damage, every combination left the win rates 4%-92%,
// but shortening the interval lifted the floor to 25% while barely touching the ceiling. More
// swings only matter in the long grinding matchups the Troll was losing on a six-second margin
// (Giant: 56s to kill, 50s to die); the fights it already won were over before the extra swings
// mattered.
// Back to the 3.5 originally specified. It had been cut to 2.6 to compensate for a sweep that
// only reached 110px from the body centre; at 135 it connects often enough that the slow cadence
// the character is supposed to have is affordable again. Measured over 11 opponents: at the new
// reach, 2.6 is 68% and 3.5 is 56%.
const TROLL_ATTACK_INTERVAL = 3.5;

// ---------------------------------------------------------------- RAMPAGE, the ultimate
// The roar clip runs 4.96s, far too long to stand still for — that would be a free five seconds
// for anything ranged. The rooted part takes the front of it and the rest plays out over the
// start of the rampage, the same way the Archer's sundown outlives its own phase.
const TROLL_ROAR_RING_LIFE = 0.75;  // how long one expanding sound ring lives
// 24, not the 18 this was set to. HP is what lifts the losing matchups (it only ever helps a
// fight the Troll was going to lose the race in) and the rampage is what blows out the winning
// ones, so the two are the opposing halves of the spread. Raising HP alone took the average from
// 50% to 59%; stretching the cooldown pulls that back without giving the floor away — swept at
// 18 / 24 / 30 the averages were 56 / 49 / 34 while the spread stayed tight at 24 and collapsed
// the whole character at 30.
const TROLL_ULT_COOLDOWN = 24.0;
// The rooted part of the roar. The clip itself runs 4.96s and is deliberately NOT cut short —
// it plays on over the start of the rampage, the same way the Archer's sundown outlives its own
// phase. Rooting for the full clip was tried and cost too much: at 4.96s the Troll spent as much
// of the match standing still as it did attacking, and the overall win rate fell to 15%.
const TROLL_ULT_ROAR     = 2.0;
const TROLL_ULT_DURATION = 11.0;  // how long the rampage itself lasts
// And it pays for it afterwards: flat out, motionless, unable to swing.
const TROLL_ULT_SLEEP    = 4.0;
// Every point of damage it deals takes this much off the cooldown. Only counts while the
// cooldown is actually running — during the rampage the cooldown isn't ticking at all, and it
// is reset to full when the rampage ends, so damage dealt in that window would be thrown away.
// The rampage swells its body AND its constitution. Casting grants both max and current HP, so
// the bar gets longer and fills by the same amount at once; when the whole ultimate is over the
// max drops back but only part of the current HP is taken with it, so the Troll keeps
// TROLL_RAGE_HP_GRANT - TROLL_RAGE_HP_TAKE of it as a permanent reward for having survived.
//
// Worked example: at 130/180 it casts and becomes 175/225; if it is beaten down to 80/225 during
// the ultimate, it ends on 50/180.
const TROLL_RAGE_HP_GRANT = 45;  // 180 -> 225 while the ultimate is up
const TROLL_RAGE_HP_TAKE  = 30;  // leaves GRANT - TAKE = 15 behind as the permanent reward

const TROLL_ULT_CD_PER_DAMAGE = 0.03;

// While rampaging it stops wandering and steers straight at the target. Nothing else in this
// game chases, so this alone changes the matchup completely — the ranged half of the roster
// relies on the Troll drifting past them.
const TROLL_RAGE_SPEED    = 280;  // up from 240
const TROLL_RAGE_INTERVAL = 1.5;  // floor only — the 1.65s animation is longer, see below
// 21/28, against 200 HP: a little less damage bought with a little more staying power than the
// 24/30 at 190 that came before it.
const TROLL_RAGE_DAMAGE   = 28;   // against 21 for the sweep
// The smash lands in the club's own footprint: a long rectangle straight ahead, as wide as the
// weapon is with its thorns and reaching exactly as far as the sweep does. Not a circle — an
// overhead brought down in line leaves a bar-shaped print, not a blast.
const TROLL_RAGE_REACH      = 140; // past the body's own radius, against 62 for the sweep
// The rampage only commits to a smash once the gap between the two bodies is down to this. The
// overhead is planted — it cannot walk while swinging — and the whole animation is 1.65s, which
// is LONGER than the interval that is meant to pace it. Without a commit range the Troll was in
// a swing 95% of the rampage and therefore rooted for 95% of it: it covered 38px/s against a
// nominal 320, so the chase never actually happened and most smashes hit empty ground.
const TROLL_RAGE_COMMIT_GAP = 25;
// It swells while it roars and stays big for the rampage. Everything that reads `size` follows
// automatically: the collision radius, the attack reach, the drawn body, and the club (which is
// measured in units of r). Eased rather than popped, so the growth belongs to the roar.
const TROLL_RAGE_SIZE_SCALE = 1.18;
const TROLL_SIZE_EASE       = 3.2;   // per second, toward the target scale
const TROLL_RAGE_HALF_WIDTH = 44;  // the club is ~19px from its axis to a thorn tip; a little over
const TROLL_RAGE_NEAR       = 14;  // the strike starts just clear of the body
const TROLL_RAGE_WINDUP   = 0.65; // club up over the head
const TROLL_RAGE_STRIKE   = 0.12; // and down
// ...and then it is stuck. The club buries itself in the ground on the follow-through and has to
// be hauled back out, which is dead time: `planted` covers every swing phase, so the Troll cannot
// move or swing for the whole of this.
const TROLL_RAGE_STUCK    = 0.75;
const TROLL_RAGE_RECOVER  = 0.28; // the wrench that frees it
// The cadence this produces: windup + strike + stuck + recover is 1.80s against a 1.5s interval,
// so the animation is what paces the rampage — the interval never gets a chance to bind. The
// Troll is planted for all 1.80s of it, which is the whole cost of the overhead.

// The club. Sized so its head still reaches this.attackRange from the body centre.
// Measured, not guessed: resolveSwing fires at swingTimer == STRIKE * 0.5, and at that instant
// the tip sits 110.4px from the body centre against a 110px attack radius — so the club covers
// exactly the arc the sweep trail draws and the damage actually tests, in all eight facings.
const TROLL_CLUB_LEN = 1.59;   // in units of r, measured from the fist
// How far the fist sits from the body centre, and how much further it is thrown on the swing.
const TROLL_GRIP_ORBIT  = 0.62;
// The rampage's overhead brings the fist from close to the chest out to arm's length as the club
// falls. Named because clubLength has to solve against the SAME numbers to keep the club's reach
// equal to the strike's — and it has to use the position at the instant the damage resolves, not
// at the end of the animation.
const TROLL_RAGE_GRIP_NEAR = 0.2;
const TROLL_RAGE_GRIP_SPAN = 0.42;
const TROLL_GRIP_EXTEND = 0.16;

// Mossy swamp green. The roster's other green (Soldier's #4a6741) is a much darker olive on a
// character a third this size, and everything else is red/orange/purple/grey.
const TROLL_SKIN       = "#6f8a4e";
const TROLL_SKIN_LIGHT = "#a3bc79";
const TROLL_SKIN_DARK  = "#3b4c28";
const TROLL_BELLY      = "#a6b07a"; // pale underside
const TROLL_WOOD       = "#8a5f33";
const TROLL_WOOD_DARK  = "#3d2814";
const TROLL_WOOD_LIGHT = "#b58652";
const TROLL_NAIL       = "#ded4b4"; // tusks, and the pale tips of the club's thorns
// Debris thrown up by the rampage's overhead. These are the ARENA FLOOR's own tones
// (#22223d..#101020 plus a pale chip), not earth — what the club breaks is the floor of the
// arena, so brown dust read as a different material lying on top of it.
// The damage a rampage smash leaves in the floor: held at full strength, then faded out. It is a
// world-space decal with its own lifetime rather than something drawn off the club, so it stays
// where it was struck after the Troll has pulled the club out and walked away.
const TROLL_CRACK_HOLD = 3.0;
const TROLL_CRACK_FADE = 1.5;
const TROLL_CRACK_MAX  = 12;   // a rampage lands ~6 of these; the cap is just a safety rail

const TROLL_RUBBLE = ["#2a2a4c", "#191930", "#3a3a62", "#0f0f1c"];
const TROLL_OUTLINE    = "rgba(0,0,0,0.6)";

class Troll extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: TROLL_SIZE,
      color: TROLL_SKIN,
      maxHp: TROLL_MAX_HP,
      name: "Troll",
      speed: TROLL_SPEED,
    });

    // Overwritten the instant it has a real opponent to look at (see update()) — this only
    // matters for the handful of frames before that, and for whichever facing the arm/club draw
    // in an empty lab/preview with no opponent at all.
    this.facingAngle = Math.random() * Math.PI * 2;
    this.hasFacedOpponent = false;
    // First attack lands at 0.75s into the round rather than waiting out a full interval or the
    // shared ATTACK_GRACE_DURATION (1.5s) — both would otherwise bind, since the base class
    // seeds attackGraceTimer to 1.5s and canAttack requires it to have run out. Overriding it here
    // is per-instance, so every other character keeps the normal 1.5s grace; only the Troll opens
    // early.
    this.attackGraceTimer = 0.75;
    this.attackTimer = 0.75;
    this.swingPhase = null; // null | "windup" | "strike" | "stuck" (rampage only) | "recover"
    this.swingTimer = 0;
    this.swingAngle = 0;    // tracks the target through the windup, then commits at the strike
    this.hasHitThisSwing = false;
    this.inRange = false;   // drives moveAndBounce's slow-down — see there
    this.turnVel = 0;       // rad/s, eased — see turnToward

    this.ultPhase = null;      // null | "roar" | "rage"
    this.ultTimer = 0;
    this.ultCooldown = TROLL_ULT_COOLDOWN;   // a full cooldown before the first one, so the bar starts empty
    this.roarRings = [];       // expanding sound rings, see updateUltimate
    this.roarPulse = 0;
    this.sizeScale = 1;        // eased toward TROLL_RAGE_SIZE_SCALE while the ultimate is up
    this.snoreNode = null;     // the looped snore's audio node while asleep, so it can be stopped
    this.rageHpGranted = false; // guards the grant/withdraw pair so neither can fire twice
    this.celebrating = false;   // won the round: plants and roars at the sky, see onVictory
    this.celebrateTimer = 0;
    this.floorCracks = [];     // { x, y, angle, seed, life } — see spawnFloorCrack / drawGroundEffects
    this.bodySeed = Math.random() * Math.PI * 2;
    this.turnRate = 0;   // rad/sec it is currently rotating at — drives the lean, see drawBody
    this._grad = {};           // cached CanvasGradients — see gradient()
  }

  get attackInterval() {
    return this.raging ? TROLL_RAGE_INTERVAL : TROLL_ATTACK_INTERVAL;
  }

  get raging() {
    return this.ultPhase === "rage";
  }

  // The base class assigns `size` once in its constructor; this getter owns it from then on so
  // the whole body — collision, reach, drawing, club length — scales together.
  get size() {
    return this._baseSize * (this.sizeScale || 1);
  }
  set size(v) { this._baseSize = v; }

  get speed() {
    return this.raging ? TROLL_RAGE_SPEED : TROLL_SPEED;
  }
  set speed(v) { /* the base class assigns this in its constructor; the getter above owns it */ }

  // Planted, unable to move or swing: the whole roar, and the whole sleep afterwards.
  get rooted() {
    return this.ultPhase === "roar" || this.ultPhase === "sleep";
  }

  get sleeping() {
    return this.ultPhase === "sleep";
  }

  // True while a rampage smash has it braced in place.
  get planted() {
    return this.raging && !!this.swingPhase;
  }

  // A planted Troll has to be a FIXED body, not a movable one that happens to have zero velocity.
  //
  // resolveCollision SWAPS the two velocities when both bodies are movable. Zeroing vx/vy every
  // frame of the smash therefore turned the Troll into a bottomless momentum sink: each
  // overlapping frame handed the opponent the Troll's zero and handed the Troll the opponent's
  // speed, which stepIntoSwing then threw away. Measured in the real game loop, the opponent's
  // own velocity collapsed from ~295 to 15 for the whole windup — it looked frozen, and nothing
  // to do with hit-stop or stuns, which were both at 0%.
  //
  // The fixed-body branch reflects the other character off it and leaves its speed intact, which
  // is what "it braces and you bounce off it" should do. Written as a getter over the base
  // class's plain property so applyStun/onStunEnd keep working untouched.
  get movable() {
    // `pinnedTimer` is the base class's own veto (see Character.applyPin) — this override would
    // otherwise shadow it entirely and make the Troll the one character immune to being pinned.
    if (this.pinnedTimer > 0) return false;
    // `rooted` (roar or sleep) belongs here for the same reason `planted` does: moveAndBounce
    // already refuses to move a rooted Troll (dt forced to 0), but nothing stopped resolveCollision
    // from still treating it as a MOVABLE body with zero velocity — which is the exact momentum
    // sink the `planted` fix exists to prevent, just triggered by sleeping into an opponent
    // instead of by a rampage swing. An opponent that walked into a sleeping Troll had its own
    // velocity swapped for the Troll's ~0 and came away crawling.
    return this._movable !== false && !this.planted && !this.rooted;
  }
  set movable(v) { this._movable = v; }

  // Cast: the bar gets longer and fills by the same amount, so the fraction it is on is
  // unchanged and it reads as raw extra vitality rather than a heal.
  grantRageVitality() {
    if (this.rageHpGranted) return;
    this.rageHpGranted = true;
    this.maxHp += TROLL_RAGE_HP_GRANT;
    this.hp += TROLL_RAGE_HP_GRANT;
  }

  // ...and the whole ultimate ending takes the max back, along with only PART of the current HP.
  // Clamped at both ends: never above the new (lower) max, and never to zero — a buff wearing off
  // must not be able to finish the Troll on its own, which it otherwise would any time it came
  // out of a rampage below TROLL_RAGE_HP_TAKE.
  withdrawRageVitality() {
    if (!this.rageHpGranted) return;
    this.rageHpGranted = false;
    this.maxHp -= TROLL_RAGE_HP_GRANT;
    this.hp = Math.max(1, Math.min(this.maxHp, this.hp - TROLL_RAGE_HP_TAKE));
  }

  // Won the round: plants where it stands and bellows at the sky. Deliberately reuses the
  // ultimate's own roar clip and sound rings — it is the same animal making the same noise, and
  // the rings already read as "this is loud" from the rampage.
  onVictory() {
    if (this.celebrating) return;
    this.celebrating = true;
    this.celebrateTimer = 0;
    this.roarPulse = 0;
    this.roarRings.length = 0;
    this.swingPhase = null;
    this.stopSnoring();          // it may have won mid-sleep; the snore has to stop either way
    this.vx = 0;
    this.vy = 0;
    this.movable = false;
    playSfx("trollRoar", 1.0, 0.02);
  }

  // The victory bellow's own clock: rings leaving the body on the same cadence the ultimate's
  // roar uses. Runs from update() and needs no opponent.
  updateCelebration(dt) {
    this.celebrateTimer += dt;
    // Turn to face the camera so the open mouth is actually visible — roaring with the back of
    // its head to the viewer shows nothing. Eased through turnToward like any other turn.
    this.turnToward(Math.PI / 2, dt);
    this.roarPulse -= dt;
    if (this.roarPulse <= 0) {
      this.roarPulse = 0.3;
      this.roarRings.push({ life: TROLL_ROAR_RING_LIFE });
      triggerShake(6, 0.25, true);   // sustained: a held roar must not arm hit-stop every pulse
      // Well clear of the head: spawned any lower, the burst sits right on top of the face and
      // hides the open mouth this whole animation exists to show.
      spawnImpactParticles(this.x, this.y - this.size * 0.95,
                           ["#ffd08a", "#ff7a2a", TROLL_SKIN_LIGHT], 7, 1.3, -150);
    }
    for (const ring of this.roarRings) ring.life -= dt;
    while (this.roarRings.length && this.roarRings[0].life <= 0) this.roarRings.shift();
  }

  stopSnoring() {
    if (!this.snoreNode) return;
    try { this.snoreNode.stop(); } catch (e) {}
    this.snoreNode = null;
  }

  // The base onDeath handles the fade/burst/shake; this only needs to make sure a Troll that
  // gets finished off mid-sleep (extra bodies, DOT, whatever) doesn't leave its snore looping
  // forever with no character left to stop it.
  onDeath() {
    this.stopSnoring();
    super.onDeath();
  }

  // Damage dealt buys the cooldown down. Measured on the target's actual HP loss rather than on
  // the number passed to takeDamage, so anything the target filters out upstream (a shield, an
  // overkill clamp) can't be cashed in for cooldown it didn't earn.
  creditDamage(dealt) {
    if (dealt <= 0 || this.ultPhase) return;
    this.ultCooldown = Math.max(0, this.ultCooldown - dealt * TROLL_ULT_CD_PER_DAMAGE);
  }

  // The HUD's second bar: cooldown filling, then full for as long as the rampage runs.
  get ultimateRatio() {
    if (this.ultPhase) return 1;
    return 1 - this.ultCooldown / TROLL_ULT_COOLDOWN;
  }

  get ultimateBarColor() {
    if (this.sleeping) return "#4a6f8a";
    return this.ultPhase ? "#ff4a2a" : "#c8642a";
  }

  // The rampage reaches further than the sweep does — it is a lunging overhead, not a swing
  // around the body — and the club is drawn longer to match, so the bar you see is still exactly
  // the bar resolveSmash tests.
  get attackRange() {
    return this.size / 2 + (this.raging ? TROLL_RAGE_REACH : TROLL_SWING_REACH);
  }

  // Club length in units of r. While rampaging it is DERIVED from the reach rather than being a
  // fixed multiple: attackRange is `r + a constant`, so once the body started scaling with the
  // ultimate the two drifted apart — the club overshot its own strike by 26px. Solving for the
  // length keeps "what you see is what you hit" true at any size.
  //
  // The grip sits TROLL_GRIP_ORBIT out from the centre along the aim at the moment of impact, so
  // the club has to cover the rest.
  // Derived from the reach rather than authored, for BOTH attacks, so the club you see always
  // covers exactly the arc the damage tests — change a reach constant and the weapon follows.
  // (The sweep's length used to be the flat TROLL_CLUB_LEN, tuned by hand against a 62 reach; the
  // moment that reach moved, the drawn club stopped matching the hitbox.)
  get clubLength() {
    const r = this.size / 2;
    // Where the fist is at the instant the damage resolves: swingAmount is +0.5 there, which for
    // the rampage is t == 0.75 through the fall and for the sweep is 0.5 through the extension.
    const gripAtImpact = this.raging
      ? TROLL_RAGE_GRIP_NEAR + 0.75 * TROLL_RAGE_GRIP_SPAN
      : TROLL_GRIP_ORBIT + 0.5 * TROLL_GRIP_EXTEND;
    return Math.max(TROLL_CLUB_LEN, this.attackRange / r - gripAtImpact);
  }

  // Drops to a crawl once the target is in reach, so contact turns into an actual exchange
  // instead of the two of them drifting straight past each other. Exactly the trick Punch Man
  // and PM2 use — without it a melee character in this game only ever lands glancing hits,
  // because nothing here steers toward anything.
  // True while the club is actually committed — the windup and the sweep, but not the recovery,
  // which is a follow-through rather than a chase.
  get isAdvancing() {
    return this.swingPhase === "windup" || this.swingPhase === "strike";
  }

  // The lean into a sweep runs at TROLL_SWING_ADVANCE, which is deliberately well below walking
  // pace — restoring it would turn the step-in into a lunge. (The rampage's own chase already
  // moves at exactly this.speed, so that case needs nothing.)
  get restoreSpeed() {
    return this.isAdvancing && !this.raging ? null : super.restoreSpeed;
  }

  moveAndBounce(dt) {
    if (this.rooted) return super.moveAndBounce(0);   // planted for the whole roar
    // The in-range crawl is what keeps a melee character in contact at all in a game where
    // nothing steers. It must not apply mid-swing, though, or it throttles the step-in to a
    // third of its speed and the advance stops covering the gap it exists to cover.
    if (this.isAdvancing) return super.moveAndBounce(dt);
    // And it must not apply during the rampage either. The crawl exists to stop a character that
    // only drifts in a straight line from sliding past its target; a rampaging Troll steers at the
    // target every frame, so it has nothing to correct for. Worse, the trigger is `inRange`, which
    // is measured against attackRange — 196.6px during a rampage against 110 for the sweep — so it
    // was crawling from nearly a third of the arena away. Measured chasing dead-on (velocity 0
    // degrees off its facing): 242px/s beyond that radius, 86px/s inside it.
    if (this.raging) return super.moveAndBounce(dt);
    // And only while it actually has a swing ready. The crawl is there to hold contact until it
    // can land one — sitting in the target's face at a third speed through a 3.5s cooldown it
    // cannot use is just being slow. With the cooldown running it walks at full pace instead.
    const crawl = this.inRange && this.swingReady;
    return super.moveAndBounce(dt * (crawl ? TROLL_ATTACK_SLOW_FACTOR : 1));
  }

  // Whether an ordinary sweep is actually available right now — the cooldown has run out and the
  // round-start grace has passed. Distinct from `inRange`, which only asks whether the target is
  // close enough.
  get swingReady() {
    return this.attackTimer <= 0 && this.canAttack;
  }

  // While rampaging it steers at the target instead of drifting. Written as vx/vy because this
  // is the Troll's own movement, not an external shove — moveAndBounce then handles the arena
  // clamp and the wall bounce for free.
  chase(opponent) {
    if (!opponent || !opponent.alive) return;
    const dx = opponent.x - this.x, dy = opponent.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    this.vx = (dx / d) * this.speed;
    this.vy = (dy / d) * this.speed;
  }

  update(dt, opponent) {
    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt;
    // Ticked before the alive check: a crack in the floor should keep fading on its own schedule
    // even if the Troll that made it has since been killed.
    for (let i = this.floorCracks.length - 1; i >= 0; i--) {
      this.floorCracks[i].life -= dt;
      if (this.floorCracks[i].life <= 0) this.floorCracks.splice(i, 1);
    }
    if (!this.alive) return;

    // Celebrating replaces the whole fighting brain — no ultimate clock, no swings, no chasing.
    if (this.celebrating) {
      this.updateCelebration(dt);
      return;
    }

    // The ultimate clock keeps running while stunned; being dazed shouldn't also pause it.
    this.updateUltimate(dt, opponent);

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x, dy = opponent.y - this.y;
      const dist = Math.hypot(dx, dy);
      this.inRange = dist <= this.attackRange + opponent.size / 2;
      // The very first time it has an opponent at all, snap straight to facing it instead of
      // easing in from whatever direction the spawn RNG happened to pick — facingAngle starts
      // completely unrelated to where the opponent spawns, so every round used to open with a
      // visible turn-to-face, sometimes most of the way round, before the fight had even begun.
      if (!this.hasFacedOpponent && dist > 0.01) {
        this.facingAngle = Math.atan2(dy, dx);
        this.hasFacedOpponent = true;
      }
      // Not while the club is in the ground either: the club is committed to swingAngle, so
      // turning the body would twist it out from under itself.
      if (dist > 0.01 && this.swingPhase !== "strike" && this.swingPhase !== "stuck") {
        this.turnToward(Math.atan2(dy, dx), dt);
      }
      // Hunts the target down between smashes; the smash itself is planted, so the chase
      // stops the moment it commits.
      if (this.raging && !this.isAdvancing) this.chase(opponent);
    } else {
      this.inRange = false;
    }

    super.update(dt, opponent);
    if (this.stunTimer > 0) return;

    if (this.attackTimer > 0) this.attackTimer -= dt;

    if (this.swingPhase) {
      this.updateSwing(dt, opponent);
    } else if (opponent && opponent.alive && this.attackTimer <= 0 && this.canAttack && !this.rooted) {
      // Rampaging it closes the gap first and only plants when the target is genuinely within
      // arm's length; the ordinary sweep still swings from anywhere inside its reach, because it
      // steps into that one and can chase the swing home.
      const gap = Math.hypot(opponent.x - this.x, opponent.y - this.y)
                  - this.size / 2 - opponent.size / 2;
      const ready = this.raging ? gap <= TROLL_RAGE_COMMIT_GAP : this.inRange;
      if (ready) {
        this.swingPhase = "windup";
        this.swingTimer = this.raging ? TROLL_RAGE_WINDUP : TROLL_SWING_WINDUP;
        // stepIntoSwing runs after super.update(), so without this the first frame of a planted
        // smash still coasts on whatever velocity the chase had built up.
        if (this.raging) { this.vx = 0; this.vy = 0; }
        this.swingAngle = this.facingAngle; // keeps tracking through the windup — see updateSwing
        this.hasHitThisSwing = false;
        this.attackTimer = this.attackInterval;
      }
    }
  }

  // Rotates facingAngle toward `target` by at most TROLL_TURN_RATE * dt, taking the short way
  // round. turnRate is recorded so the drawing can lean into the turn.
  turnToward(target, dt) {
    let diff = target - this.facingAngle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));   // shortest signed angle
    const want = Math.max(-TROLL_TURN_RATE,
                          Math.min(TROLL_TURN_RATE, diff * TROLL_TURN_EASE));
    this.turnVel += (want - this.turnVel) * Math.min(1, dt * TROLL_TURN_ACCEL);
    let step = this.turnVel * dt;
    // Never overshoot the target — without this the eased velocity sails past and oscillates.
    if (Math.abs(step) > Math.abs(diff)) {
      step = diff;
      this.turnVel = dt > 0 ? diff / dt : 0;
    }
    this.facingAngle += step;
    // Normalised so it can't drift off to huge values over a long round
    this.facingAngle = Math.atan2(Math.sin(this.facingAngle), Math.cos(this.facingAngle));
    this.turnRate = dt > 0 ? step / dt : 0;
  }

  // The ultimate's own clock. Fires on cooldown as soon as there is something to fight — there
  // is no charge condition beyond that, so the rampage is a rhythm rather than a reward.
  updateUltimate(dt, opponent) {
    if (this.ultPhase === "roar") {
      this.ultTimer -= dt;
      // Rings keep leaving the body for the whole roar, not just on the first frame
      this.roarPulse -= dt;
      if (this.roarPulse <= 0) {
        this.roarPulse = 0.26;
        this.roarRings.push({ life: TROLL_ROAR_RING_LIFE });
        triggerShake(7, 0.2, true);   // sustained: a held roar must not arm hit-stop every pulse
        spawnImpactParticles(this.x, this.y - this.size * 0.2,
                             ["#ffd08a", "#ff7a2a", TROLL_SKIN_LIGHT], 12, 1.5, -120);
      }
      if (this.ultTimer <= 0) {
        this.ultPhase = "rage";
        this.ultTimer = TROLL_ULT_DURATION;
        this.attackTimer = 0;         // first smash comes straight out of the roar
        triggerShake(16, 0.4);
        spawnFlash(this.x, this.y, "#ff6a2a", this.size * 1.6, 0.4);
      }
    } else if (this.ultPhase === "rage") {
      this.ultTimer -= dt;
      if (this.ultTimer <= 0) {
        this.ultPhase = "sleep";
        this.ultTimer = TROLL_ULT_SLEEP;
        this.swingPhase = null;       // whatever it was mid-way through, it drops
        // Looped rather than a one-shot, since TROLL_ULT_SLEEP (4s) can easily outlast a single
        // snore clip. Stopped wherever sleep ends — see below and onDeath.
        this.snoreNode = playSfx("trollSnore", 0.45, 0.05, 0, true);
      }
    } else if (this.ultPhase === "sleep") {
      this.ultTimer -= dt;
      if (this.ultTimer <= 0) {
        this.ultPhase = null;
        this.ultCooldown = TROLL_ULT_COOLDOWN;
        this.stopSnoring();
        this.withdrawRageVitality();
        // vx/vy is whatever it happened to be the INSTANT the rampage got cut off to start
        // sleeping — while raging, stepIntoSwing pins it to exactly 0 for the whole of a swing,
        // and nothing touches it again for the entire 4s sleep (moveAndBounce/restoreOwnSpeed
        // are both gated on `movable`, which `rooted` forces false the whole time asleep). If the
        // rampage happened to end mid-swing rather than mid-chase, it woke up with a real,
        // literal 0 and then just... stayed there — nothing else was ever going to give it a new
        // heading. Waking up is exactly the moment it needs one, so give it one: walk off in
        // whatever direction it's currently facing (which has kept tracking the opponent the
        // whole time asleep, turnToward isn't gated on rooted — see update()).
        this.vx = Math.cos(this.facingAngle) * this.speed;
        this.vy = Math.sin(this.facingAngle) * this.speed;
      }
    } else {
      if (this.ultCooldown > 0) this.ultCooldown -= dt;
      if (this.ultCooldown <= 0 && opponent && opponent.alive && this.canAttack && !this.swingPhase) {
        this.ultPhase = "roar";
        this.ultTimer = TROLL_ULT_ROAR;
        this.roarPulse = 0;
        this.roarRings.length = 0;
        this.grantRageVitality();
        playSfx("trollRoar", 1.0, 0.04);
        // Everything in front of it gets its ears blown out for the whole roar — extra bodies (a
        // Ninja's clones) included, since a roar is not aimed at anything in particular. Applied
        // once here rather than re-armed every pulse: applyDeafen takes the max of the current
        // and new timers, so re-arming to TROLL_ULT_ROAR every ~0.26s would be a no-op anyway,
        // but doing it once keeps this in one place instead of scattered across the pulse loop.
        for (const target of [opponent, ...opponent.getExtraBodies()]) {
          if (target && target.alive) target.applyDeafen(TROLL_ULT_ROAR);
        }
      }
    }

    // Swells through the roar, holds through the rampage, and shrinks back over the sleep.
    const target = this.ultPhase && this.ultPhase !== "sleep" ? TROLL_RAGE_SIZE_SCALE : 1;
    this.sizeScale += (target - this.sizeScale) * Math.min(1, dt * TROLL_SIZE_EASE);

    for (const ring of this.roarRings) ring.life -= dt;
    while (this.roarRings.length && this.roarRings[0].life <= 0) this.roarRings.shift();
  }

  updateSwing(dt, opponent) {
    this.swingTimer -= dt;

    if (this.swingPhase === "windup") {
      // The arc follows the target right up until the club starts moving, and is only committed
      // at the strike. Freezing it at the START of the windup instead was the original design —
      // the idea being that a target could step out of a telegraphed swing — but nothing in an
      // auto-battle is choosing to dodge, so in practice every opponent above the Troll's own
      // speed simply wandered out of the cone during those 0.5s and the hit rate sat at 9-25%.
      // The windup is still a fully visible tell; it just aims where they are when it lands.
      if (opponent && opponent.alive) {
        this.turnToward(Math.atan2(opponent.y - this.y, opponent.x - this.x), dt);
        this.swingAngle = this.facingAngle;
      }
      this.stepIntoSwing();
      if (this.swingTimer <= 0) {
        this.swingPhase = "strike";
        this.swingTimer = this.raging ? TROLL_RAGE_STRIKE : TROLL_SWING_STRIKE;
        playSfx("trollWave", this.raging ? 0.5 : 0.35);
      }
      return;
    }

    if (this.swingPhase === "strike") {
      this.stepIntoSwing();
      // Resolved once per swing, partway through the sweep rather than at either end, so the
      // damage lands when the club is actually across the front of the body.
      const strikeLen = this.raging ? TROLL_RAGE_STRIKE : TROLL_SWING_STRIKE;
      if (!this.hasHitThisSwing && this.swingTimer <= strikeLen * 0.5) {
        this.hasHitThisSwing = true;
        this.resolveSwing(opponent);
      }
      if (this.swingTimer <= 0) {
        if (this.raging) {
          this.swingPhase = "stuck";
          this.swingTimer = TROLL_RAGE_STUCK;
        } else {
          this.swingPhase = "recover";
          this.swingTimer = TROLL_SWING_RECOVER;
        }
      }
      return;
    }

    if (this.swingPhase === "stuck") {
      this.stepIntoSwing();          // still planted, just heaving at the shaft
      if (this.swingTimer <= 0) {
        this.swingPhase = "recover";
        this.swingTimer = TROLL_RAGE_RECOVER;
        this.wrenchClubFree();
      }
      return;
    }

    if (this.swingTimer <= 0) this.swingPhase = null;
  }

  // Where the club head meets the floor on a rampage smash. One definition, used by the crack
  // decal, the debris and the pull-out burst alike, so they can't drift apart from each other.
  clubHeadGroundPoint() {
    const d = TROLL_RAGE_NEAR + (this.attackRange - TROLL_RAGE_NEAR) * 0.82;
    return { x: this.x + Math.cos(this.swingAngle) * d, y: this.y + Math.sin(this.swingAngle) * d };
  }

  spawnFloorCrack(x, y) {
    this.floorCracks.push({
      x, y,
      angle: this.swingAngle,
      seed: Math.random() * Math.PI * 2,
      // Frozen at the size the club had when it struck. Read from this.clubLength at draw time
      // instead, the mark would shrink along with the Troll as sizeScale eases back down at the
      // end of the rampage — a hole in the floor doesn't get smaller.
      len: this.clubLength * (this.size / 2),
      life: TROLL_CRACK_HOLD + TROLL_CRACK_FADE,
    });
    while (this.floorCracks.length > TROLL_CRACK_MAX) this.floorCracks.shift();
  }

  // The heave that finally gets it out: earth thrown off the club head, back along the shaft,
  // and a shove of a shake. Marked sustained — this is the Troll straining, not an impact, so it
  // must not arm hit-stop and freeze the match.
  wrenchClubFree() {
    const { x: hx, y: hy } = this.clubHeadGroundPoint();
    spawnImpactParticles(hx, hy, TROLL_RUBBLE, 18, 1.5, -40);
    spawnDirectionalBurst(hx, hy, this.swingAngle - Math.PI * 0.5, 1.2, TROLL_RUBBLE, 10, 1.1);
    playSfx("trollPullout", 0.7);
    triggerShake(5, 0.18, true);
  }

  // Replaces the wander with a deliberate walk along the committed swing direction. Written as
  // vx/vy rather than through applyKnockback because this IS the Troll's own movement, not an
  // external shove — moveAndBounce then handles the arena clamping and wall bounce for free.
  // The lean into a normal sweep.
  //
  // A rampage smash is planted for the WHOLE of it — windup and blow alike. That is only viable
  // because of TROLL_RAGE_COMMIT_GAP: the Troll runs the target down first and plants only once
  // it is already at arm's length. Without that gate it committed from anywhere in reach, stood
  // still for the full 1.65s animation, and the target simply walked out of the strike.
  stepIntoSwing() {
    if (this.raging) { this.vx = 0; this.vy = 0; return; }
    this.vx = Math.cos(this.swingAngle) * TROLL_SWING_ADVANCE;
    this.vy = Math.sin(this.swingAngle) * TROLL_SWING_ADVANCE;
  }

  // Everything inside the cone gets hit, not just the nearest thing — that's the whole point of
  // a sweep. Extra bodies (a Ninja's clones) count as separate targets, so one swing can catch
  // several at once.
  resolveSwing(opponent) {
    if (this.raging) return this.resolveSmash(opponent);
    if (!opponent || !opponent.alive) return;
    const targets = [opponent, ...opponent.getExtraBodies()].filter((t) => t.alive);
    let landed = 0;

    for (const t of targets) {
      const dx = t.x - this.x, dy = t.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > this.attackRange + t.size / 2) continue;
      // Angle to the target measured against the direction the swing was committed to
      let off = Math.atan2(dy, dx) - this.swingAngle;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) > TROLL_SWING_ARC) continue;

      const beforeHp = t.hp;
      t.takeDamage(TROLL_SWING_DAMAGE);
      this.creditDamage(beforeHp - t.hp);
      const kb = TROLL_SWING_KNOCKBACK * (CHAR_BASE_SIZE / t.size);
      t.applyKnockback(Math.cos(this.swingAngle), Math.sin(this.swingAngle), kb);
      spawnImpactParticles(t.x, t.y, ["#ffffff", TROLL_WOOD, "#c8b070"], 14, 1.5, 0);
      // Thrown along the launch direction, and scaled by how far this particular target is
      // actually going — a Giant barely shifts, so it shouldn't spray debris like a Ninja does.
      const launch = kb / TROLL_SWING_KNOCKBACK;
      spawnDirectionalBurst(t.x, t.y, this.swingAngle, 0.5,
        ["#ffffff", "#ffe6a8", TROLL_NAIL], Math.round(10 + 12 * launch), 1.1 + 0.5 * launch);
      spawnFlash(t.x, t.y, "#fff0c0", t.size * 0.9, 0.16);
      // A real spray, not a spatter — this is a spiked club, not a fist.
      spawnBloodSpurt(t.x, t.y, this.swingAngle, 32, 1.4 + 0.4 * launch);
      landed++;
    }

    if (landed) {
      // trollWave already fired when the club started moving, 0.09s earlier — this is the
      // separate connect sound, not a repeat of it.
      playSfx("trollHit", 0.45);
      triggerShake(12, 0.26);
    }
  }

  // The rampage's attack: a two-handed overhead brought straight down. Not a cone — the club
  // comes from above, so what it covers is a small circle centred just in front of the body,
  // and it does not launch the target the way the sweep does. There is nowhere to be thrown to
  // when the blow lands from directly overhead.
  // Distance along the aim line, and distance to either side of it. Everything about the
  // rectangular smash — the test and the telegraph — is expressed in this frame.
  aimFrame(px, py) {
    const c = Math.cos(this.swingAngle), sn = Math.sin(this.swingAngle);
    const dx = px - this.x, dy = py - this.y;
    return { along: dx * c + dy * sn, lat: -dx * sn + dy * c };
  }

  resolveSmash(opponent) {
    if (!opponent || !opponent.alive) return;
    const far = this.attackRange;
    const cx = this.x + Math.cos(this.swingAngle) * (TROLL_RAGE_NEAR + far) / 2;
    const cy = this.y + Math.sin(this.swingAngle) * (TROLL_RAGE_NEAR + far) / 2;
    const targets = [opponent, ...opponent.getExtraBodies()].filter((t) => t.alive);
    let landed = 0;

    for (const t of targets) {
      const f = this.aimFrame(t.x, t.y);
      const pad = t.size / 2;
      if (f.along < TROLL_RAGE_NEAR - pad || f.along > far + pad) continue;
      if (Math.abs(f.lat) > TROLL_RAGE_HALF_WIDTH + pad) continue;
      const beforeHp = t.hp;
      t.takeDamage(TROLL_RAGE_DAMAGE);
      this.creditDamage(beforeHp - t.hp);
      // A short shove straight down the swing line rather than the sweep's launch: a smash
      // drives the target into the floor, it doesn't throw it across the arena.
      t.applyKnockback(Math.cos(this.swingAngle), Math.sin(this.swingAngle),
                       TROLL_SWING_KNOCKBACK * 0.3 * (CHAR_BASE_SIZE / t.size));
      spawnImpactParticles(t.x, t.y, ["#ffffff", "#ffd08a", TROLL_WOOD], 22, 2.0, 0);
      spawnFlash(t.x, t.y, "#fff0c0", t.size * 1.2, 0.2);
      // The heavier of the two hits, so the spray is bigger — driven straight down the swing
      // line same as the shove above, not scattered every direction.
      spawnBloodSpurt(t.x, t.y, this.swingAngle, 40, 1.8);
      landed++;
    }

    // Dust along the whole length of the strike, whether or not it connected — an overhead that
    // hits the ground should still hit the ground, and it hits it in a line.
    const c = Math.cos(this.swingAngle), sn = Math.sin(this.swingAngle);
    for (let k = 0; k <= 3; k++) {
      const d = TROLL_RAGE_NEAR + (this.attackRange - TROLL_RAGE_NEAR) * (k / 3);
      spawnImpactParticles(this.x + c * d, this.y + sn * d,
                           TROLL_RUBBLE, 6, 1.4, 220);
    }
    spawnFlash(cx, cy, "#ffe0a0", TROLL_RAGE_HALF_WIDTH * 2.2, 0.22);
    // The floor takes it whether or not anything else did.
    const head = this.clubHeadGroundPoint();
    this.spawnFloorCrack(head.x, head.y);
    // The overhead drives into the ground on every smash, hit or miss — that's what buries the
    // head and starts the "stuck" phase — so this plays regardless of `landed`.
    playSfx("trollUltHit", landed ? 0.9 : 0.5);
    // Marked sustained, so it shakes the screen without arming hit-stop. A rampage lands one of
    // these every 1.65s for eleven seconds; at magnitude 15 each one froze the entire simulation
    // for 0.065s, and together with the Troll being planted for the swing the whole exchange read
    // as both fighters seizing up. The single sweep still freezes — that one is a real impact.
    triggerShake(landed ? 15 : 8, 0.3, true);
  }

  // Which of eight facings this is, and the two numbers the drawing needs to adapt.
  //
  // Only three looks are authored — face, three-quarter face, back of the head — because the four
  // left-facing directions are mirrors of the right-facing ones.
  //
  //   mirror  -1 for the four left-facing sectors, so everything below is drawn facing right
  //   turn    0 = looking straight at the camera, 1 = full profile. Slides the features across
  //           the face and narrows the gap between the eyes.
  //   cam     +1 facing the camera, 0 side-on, -1 facing away. Facing away there is no face at
  //           all, which is the clearest possible read of "its back is turned".
  viewParams() {
    let a = this.facingAngle % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    const dir = Math.round(a / (Math.PI / 4)) % 8;   // 0 = right, 2 = down, 4 = left, 6 = up
    const mirror = dir >= 3 && dir <= 5 ? -1 : 1;
    const shape = [0, 1, 2, 1, 0, 3, 4, 3][dir];     // 0 side, 1 front34, 2 front, 3 back34, 4 back
    // `turn` (how side-on the head is) used to be read off that same snapped table, so the face
    // jumped between three fixed poses as the facing crossed a boundary. Taken from the angle
    // itself it sweeps continuously: cos^2 is 1 side-on, 0 head-on or dead away, and 0.5 at the
    // diagonals — which is where the authored table had 0.45, so the look is unchanged at the
    // eight cardinals and only the travel between them is new.
    //
    // `cam` stays snapped on purpose: which side of the body the arm is drawn on is a real
    // occlusion decision, not something to blend.
    const turn = Math.cos(a) ** 2;
    return { dir, mirror, shape, turn, cam: [0, 1, 1, -1, -1][shape] };
  }

  // The attack direction in BODY space, i.e. after the mirror. The club is drawn in that space,
  // so without this its screen angle would depend only on how far through the swing it was —
  // facing up, it would still sweep off to the left while the damage cone went upward.
  bodyAimAngle() {
    const aim = this.swingPhase ? this.swingAngle : this.facingAngle;
    const a = this.viewParams().mirror > 0 ? aim : Math.PI - aim;
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  // 0 at rest; -1 fully wound back; +1 at the end of the follow-through.
  get swingAmount() {
    if (!this.swingPhase) return 0;
    const rage = this.raging;
    if (this.swingPhase === "windup") {
      const p = 1 - this.swingTimer / (rage ? TROLL_RAGE_WINDUP : TROLL_SWING_WINDUP);
      return -(p * p * (3 - 2 * p));
    }
    if (this.swingPhase === "strike") {
      const p = 1 - this.swingTimer / (rage ? TROLL_RAGE_STRIKE : TROLL_SWING_STRIKE);
      return -1 + 2 * (1 - (1 - p) * (1 - p));
    }
    if (this.swingPhase === "stuck") {
      // Buried at +1, rocking the shaft to work it loose: three heaves across the 0.75s, each
      // dragging the club a little way up and losing it again, and each one harder than the last.
      const p = 1 - this.swingTimer / TROLL_RAGE_STUCK;
      return 1 - 0.15 * Math.abs(Math.sin(p * Math.PI * 3)) * (0.35 + 0.65 * p);
    }
    const p = 1 - this.swingTimer / (rage ? TROLL_RAGE_RECOVER : TROLL_SWING_RECOVER);
    return 1 - p * p * (3 - 2 * p);
  }

  // Where the club is held and at what angle. swingAmount is +0.5 at the instant resolveSwing
  // fires, so subtracting it makes the club line up exactly with the aim as the damage lands.
  clubGrip(r) {
    const swing = this.swingAmount;
    const aim = this.bodyAimAngle();
    if (this.raging) {
      // Overhead: the club goes UP behind the head and comes straight down the aim line, rather
      // than around the body. swingAmount runs -1 (fully raised) to +1 (buried in the ground).
      const t = (swing + 1) / 2;                       // 0 raised, 1 planted
      const lift = (1 - t) * 0.9;
      return {
        rot: aim - Math.PI * 0.5 * (1 - t) - 0.1,      // vertical when raised, on the aim when down
        x: Math.cos(aim) * (TROLL_RAGE_GRIP_NEAR + t * TROLL_RAGE_GRIP_SPAN) * r,
        y: Math.sin(aim) * (TROLL_RAGE_GRIP_NEAR + t * TROLL_RAGE_GRIP_SPAN) * r - lift * r * 0.55,
      };
    }
    const a = aim - 0.55 + swing * 1.2;
    const orbit = TROLL_GRIP_ORBIT + Math.max(0, swing) * TROLL_GRIP_EXTEND;
    return {
      rot: aim + (swing - 0.5) * 2.2,
      x: Math.cos(a) * orbit * r,
      y: Math.sin(a) * orbit * r,
    };
  }

  draw(ctx) {
    if (!this.alive && this.deathFadeTimer <= 0) return;
    super.draw(ctx);
    if (this.alive && this.sleeping) this.drawSleepZzz(ctx);
  }

  // The body is painted from the TROLL_* palette, never from this.color, so the inherited flash
  // would redraw the same green Troll over itself at 75% alpha — which looks like it is turning
  // transparent, not like it is being hit. This paints the silhouette white instead, off the same
  // transform stack drawBody uses, so it lands on the body however it is leaning, breathing or
  // facing.
  drawHitFlash(ctx, strength) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const v = this.viewParams();
    const roaring = this.celebrating || this.ultPhase === "roar";
    const rate = this.sleeping ? 0.55 : roaring ? 7.5 : this.ultPhase ? 4.2 : 1.1;
    const amp = this.sleeping ? 0.05 : roaring ? 0.075 : this.ultPhase ? 0.055 : 0.025;
    const breathe = 1 + Math.sin(t * rate + this.bodySeed) * amp;

    ctx.save();
    ctx.globalAlpha = strength;
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.max(-1, Math.min(1, this.turnRate / TROLL_TURN_RATE)) * v.mirror * 0.16);
    ctx.scale(v.mirror * breathe, breathe);
    ctx.scale(1.06, 0.94);
    ctx.fillStyle = this.hitFlashColor || "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Asleep after a rampage: Zs drifting up off its head, on a loop. Purple, to match the stun
  // spiral — the two are the game's only "this character is not in control right now" states.
  drawSleepZzz(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    ctx.save();
    // Off to the side rather than straight up: the floating HP bar sits directly above the head,
    // and the Zs rose right through it.
    ctx.translate(this.x + r * 1.02, this.y - r * 0.52);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#c060ff";
    ctx.shadowBlur = 8;
    for (let i = 0; i < 4; i++) {
      const p = (t * 0.5 + i / 4) % 1;              // 0 just off the head, 1 fully risen
      const size = r * (0.26 + p * 0.4);
      ctx.globalAlpha = Math.sin(p * Math.PI) * 0.95;
      ctx.font = `bold ${size}px "Trebuchet MS", sans-serif`;
      ctx.fillStyle = "#c88cff";
      ctx.strokeStyle = "rgba(46,0,80,0.75)";
      ctx.lineWidth = Math.max(2, size * 0.16);
      const x = Math.sin(p * Math.PI * 1.4) * r * 0.34;
      const y = -p * r * 1.35;
      ctx.strokeText("Z", x, y);
      ctx.fillText("Z", x, y);
    }
    ctx.restore();
  }

  drawBody(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const v = this.viewParams();
    const rate = this.sleeping ? 0.55 : this.ultPhase ? 4.2 : 1.1;
    const amp = this.sleeping ? 0.05 : this.ultPhase ? 0.055 : 0.025;
    const breathe = 1 + Math.sin(t * rate + this.bodySeed) * amp;

    ctx.save();
    ctx.translate(this.x, this.y);

    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.94, r * 0.78, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Lean into the turn. Small, and it decays with the turn rate, but it is the difference
    // between the sprite changing pose and the creature actually swinging its weight round.
    const lean = Math.max(-1, Math.min(1, this.turnRate / TROLL_TURN_RATE)) * v.mirror * 0.16;
    ctx.rotate(lean);
    // Bellowing at the sky: the whole body rocks back off its feet. Rotated about a pivot below
    // the body rather than its centre, so it tips rather than spins, and eased in over the first
    // moments of the cry so it swings back rather than snapping there.
    if (this.celebrating) {
      const tip = -0.26 * Math.min(1, this.celebrateTimer / 0.3);
      ctx.translate(0, r * 0.9);
      ctx.rotate(tip);
      ctx.translate(0, -r * 0.9);
    }
    ctx.scale(v.mirror * breathe, breathe);

    // Facing away the club is on the far side of the body, so the arm goes behind it and only
    // the part of the weapon that clears the silhouette shows.
    if (v.cam < 0) this.drawArmAndClub(ctx, r);
    this.drawBall(ctx, r, t, v);
    if (v.cam >= 0) this.drawArmAndClub(ctx, r);

    ctx.restore();
  }

  // The body: one squat ellipse, wider than tall. Everything else is drawn onto it.
  drawBall(ctx, r, t, v) {
    ctx.save();
    ctx.scale(1.06, 0.94);

    ctx.fillStyle = this.gradient(ctx, "body", () => {
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.34, r * 0.1, 0, 0, r * 1.02);
      g.addColorStop(0, TROLL_SKIN_LIGHT);
      g.addColorStop(0.55, TROLL_SKIN);
      g.addColorStop(1, TROLL_SKIN_DARK);
      return g;
    });
    ctx.strokeStyle = TROLL_OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    // Pale underside, and a few fixed warts so the surface isn't blank
    ctx.fillStyle = TROLL_BELLY;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(r * 0.06, r * 0.62, r * 0.7, r * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = TROLL_SKIN_DARK;
    ctx.globalAlpha = 0.5;
    for (const [wx, wy, wr] of [[-0.52, -0.3, 0.09], [-0.3, 0.12, 0.06], [0.44, -0.5, 0.07],
                                [-0.62, 0.2, 0.055]]) {
      ctx.beginPath();
      ctx.arc(r * wx, r * wy, r * wr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (v.cam < 0) this.drawBackOfHead(ctx, r, v);
    else this.drawFace(ctx, r, t, v);

    ctx.restore(); // end body clip

    // Tusks last and OUTSIDE the clip, so they break the silhouette — that is what stops this
    // reading as a green ball with a face painted on it. On a full profile only the near one
    // clears the edge; square-on they sit symmetrically either side of the mouth.
    if (v.cam >= 0) {
      const shift = v.turn * 0.2;
      ctx.fillStyle = TROLL_NAIL;
      ctx.strokeStyle = TROLL_OUTLINE;
      ctx.lineWidth = 2;
      for (const s of [1, -1]) {
        const bx = shift + s * 0.19, by = 0.4;
        const tx = shift + s * (0.3 + v.turn * 0.22), ty = 0.42 - 0.4;
        // The far tusk goes behind the snout as it turns side-on. Faded across 0.7-0.95 rather
        // than cut at a threshold — now that `turn` is continuous, a hard cut is the one place
        // left where the head still pops.
        const farFade = s < 0 ? 1 - Math.min(1, Math.max(0, (v.turn - 0.7) / 0.25)) : 1;
        if (farFade <= 0.01) continue;
        ctx.globalAlpha = farFade;
        ctx.beginPath();
        ctx.moveTo(r * bx, r * by);
        ctx.quadraticCurveTo(r * (bx + (tx - bx) * 1.1), r * (by + (ty - by) * 0.45), r * tx, r * ty);
        ctx.quadraticCurveTo(r * (bx + (tx - bx) * 0.3), r * (by + (ty - by) * 0.4),
                             r * (bx - s * 0.1), r * (by + 0.05));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore(); // end squash
  }

  // How wide the jaw is open, 0..1. One value for both places the Troll roars — the ultimate's
  // opening bellow and the victory cry — so the head only has to be drawn one way.
  get mouthOpen() {
    if (this.celebrating) return Math.min(1, this.celebrateTimer / 0.25); // snaps open, stays open
    if (this.ultPhase !== "roar") return 0;
    // Eases open over the first fifth of the roar and holds for the rest of it.
    const into = TROLL_ULT_ROAR - this.ultTimer;
    return Math.max(0, Math.min(1, into / (TROLL_ULT_ROAR * 0.2)));
  }

  // Brow, eyes and mouth, slid across the face by `turn`.
  drawFace(ctx, r, t, v) {
    const shift = v.turn * 0.2;
    const enraged = !!this.ultPhase && !this.sleeping;

    // Heavy brow, angled down toward the front — the angle is most of the anger
    ctx.strokeStyle = TROLL_SKIN_DARK;
    ctx.lineWidth = r * 0.13;
    ctx.lineCap = "round";
    const spread = 0.19 - v.turn * 0.02;
    for (const s of [1, -1]) {
      const ex = shift + s * spread;
      ctx.beginPath();
      ctx.moveTo(r * (ex - s * 0.15), -r * (0.38 - s * 0.03));
      ctx.lineTo(r * (ex + s * 0.13), -r * (0.26 - s * 0.03));
      ctx.stroke();
    }

    // Eyes. Bright, because at 96px they are only a few pixels across.
    const iris = enraged ? "#ff3a20" : "#f0d24a";
    // Asleep the eyes are simply shut — two closed lids, no iris at all.
    if (this.sleeping) {
      ctx.strokeStyle = TROLL_SKIN_DARK;
      ctx.lineWidth = r * 0.05;
      ctx.lineCap = "round";
      for (const s of [1, -1]) {
        const ex = shift + s * spread;
        ctx.beginPath();
        ctx.moveTo(r * (ex - 0.09), -r * 0.13);
        ctx.quadraticCurveTo(r * ex, -r * 0.07, r * (ex + 0.09), -r * 0.13);
        ctx.stroke();
      }
      return;
    }
    const blink = Math.sin(t * 0.8 + this.bodySeed) > 0.99 ? 0.15 : 1;
    for (const s of [1, -1]) {
      const ex = shift + s * spread;
      ctx.save();
      ctx.translate(r * ex, -r * 0.14);
      ctx.rotate(s * 0.3);
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.11, r * 0.085 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#12140c";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.035, r * 0.07 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (enraged) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const s of [1, -1]) {
        const ex = shift + s * spread;
        const g = ctx.createRadialGradient(r * ex, -r * 0.14, 0, r * ex, -r * 0.14, r * 0.28);
        g.addColorStop(0, "rgba(255,60,20,0.6)");
        g.addColorStop(1, "rgba(255,60,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(r * ex, -r * 0.14, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Nostrils and a snarl
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.ellipse(r * (shift + s * 0.09), r * 0.14, r * 0.045, r * 0.032, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    const open = this.mouthOpen;
    if (open <= 0.01) {
      // Closed: the ordinary snarl, a single heavy line.
      ctx.strokeStyle = "#15130c";
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      ctx.moveTo(r * (shift - 0.22), r * 0.36);
      ctx.quadraticCurveTo(r * shift, r * 0.5, r * (shift + 0.22), r * 0.36);
      ctx.stroke();
      return;
    }
    this.drawOpenJaw(ctx, r, shift, open);
  }

  // A bellowing mouth: the maw itself, a throat darker than it, a tongue, and the lower fangs
  // riding down with the jaw. Widths are scaled by `open` so it genuinely hinges rather than
  // popping between two drawings.
  drawOpenJaw(ctx, r, shift, open) {
    const cx = r * shift;
    const top = r * 0.3;
    const drop = r * (0.16 + 0.42 * open);   // how far the jaw has swung down
    const halfW = r * (0.17 + 0.11 * open);

    ctx.save();
    // The maw
    ctx.fillStyle = "#1b0d0a";
    ctx.strokeStyle = "#0c0705";
    ctx.lineWidth = r * 0.035;
    ctx.beginPath();
    ctx.moveTo(cx - halfW, top);
    ctx.quadraticCurveTo(cx, top - r * 0.04, cx + halfW, top);
    ctx.quadraticCurveTo(cx + halfW * 0.92, top + drop, cx, top + drop);
    ctx.quadraticCurveTo(cx - halfW * 0.92, top + drop, cx - halfW, top);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Throat, set back inside it
    ctx.fillStyle = "#0a0403";
    ctx.beginPath();
    ctx.ellipse(cx, top + drop * 0.52, halfW * 0.5, drop * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tongue, low in the jaw
    ctx.fillStyle = "#8e2f38";
    ctx.beginPath();
    ctx.ellipse(cx, top + drop * 0.76, halfW * 0.56, drop * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Lower fangs, hanging from the jawline
    ctx.fillStyle = TROLL_NAIL;
    ctx.strokeStyle = TROLL_OUTLINE;
    ctx.lineWidth = 1.2;
    for (const sgn of [-1, 1]) {
      const fx = cx + sgn * halfW * 0.52;
      const fy = top + drop * 0.9;
      ctx.beginPath();
      ctx.moveTo(fx - r * 0.035, fy);
      ctx.lineTo(fx, fy - r * 0.13 * open);
      ctx.lineTo(fx + r * 0.035, fy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // ...and the upper pair biting down into it
    for (const sgn of [-1, 1]) {
      const fx = cx + sgn * halfW * 0.62;
      ctx.beginPath();
      ctx.moveTo(fx - r * 0.035, top);
      ctx.lineTo(fx, top + r * 0.14 * open);
      ctx.lineTo(fx + r * 0.035, top);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Facing away: no face, just the crown of the head and a pair of ears seen from behind.
  drawBackOfHead(ctx, r, v) {
    const shift = v.turn * 0.2;
    // A darker crown and a shallow nape crease. Deliberately soft shapes — the earlier version
    // used a straight spine line crossed by a neck line, which read as a seam down a beach ball.
    ctx.fillStyle = TROLL_SKIN_DARK;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.ellipse(r * shift, -r * 0.42, r * 0.62, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.ellipse(r * shift, r * 0.3, r * 0.4, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Ears, from behind: pointed, high, and out at the edge of the skull. As soft ovals at eye
    // height they read as a pair of dark EYES, which is exactly the thing this view exists to
    // avoid — a back that looks like a face is worse than no detail at all.
    for (const s of [1, -1]) {
      const farFade = s < 0 ? 1 - Math.min(1, Math.max(0, (v.turn - 0.7) / 0.25)) : 1;
      if (farFade <= 0.01) continue;
      ctx.globalAlpha = farFade;
      ctx.fillStyle = TROLL_SKIN_DARK;
      ctx.strokeStyle = TROLL_OUTLINE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(r * (shift + s * 0.4), -r * 0.42);
      ctx.lineTo(r * (shift + s * 0.72), -r * 0.6);
      ctx.lineTo(r * (shift + s * 0.66), -r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // One short arm and the club. Deliberately simple: a tapered limb and a round fist, no elbow,
  // no fingers — at 96px none of that survives, and it was the detail that kept reading wrong.
  drawArmAndClub(ctx, r) {
    const g = this.clubGrip(r);
    const shX = 0.4 * r, shY = 0.1 * r;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = TROLL_OUTLINE;
    ctx.lineWidth = r * 0.3;
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(g.x, g.y);
    ctx.stroke();
    ctx.strokeStyle = TROLL_SKIN;
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(g.x, g.y);
    ctx.stroke();

    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot);
    this.drawClub(ctx, r);
    ctx.restore();

    ctx.fillStyle = TROLL_SKIN;
    ctx.strokeStyle = TROLL_OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(g.x, g.y, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // A gnarled length of timber with iron-hard thorns driven through it. Everything is a fraction
  // of `len`, so the spikes stay in proportion if the length is retuned.
  //
  // The length is set from the one instant that matters: resolveSwing fires at
  // swingTimer == STRIKE * 0.5, and at that moment the tip has to sit on the attack radius, so
  // the club you see covers exactly the arc the damage tests.
  // The near lip of the hole, drawn in the club's own frame and only while the club is actually
  // in the floor — it has to sit OVER the timber to hide where it enters, which is the one part
  // of the ground damage that can't be a decal underneath everything.
  //
  // The cracks, the pit and the chips used to be drawn here too. They now live in floorCracks as
  // a world-space decal (see spawnFloorCrack / drawFloorCracks) so they survive the club being
  // pulled back out, instead of vanishing with it.
  drawBuriedGround(ctx, len) {
    const cx = 0.9 * len, rx = 0.26 * len, ry = 0.115 * len;
    ctx.save();
    for (const [off, sc, tilt] of [[-0.72, 0.66, 0.42], [0.06, 0.9, -0.3], [0.78, 0.6, 0.26]]) {
      ctx.save();
      ctx.translate(cx + off * rx * 1.35, ry * 0.5);
      ctx.rotate(tilt);
      ctx.fillStyle = "#20203c";
      ctx.strokeStyle = "rgba(8,8,14,0.9)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.5 * sc, ry * 0.2 * sc);
      ctx.lineTo(-rx * 0.32 * sc, -ry * 1.0 * sc);
      ctx.lineTo(rx * 0.44 * sc, -ry * 0.82 * sc);
      ctx.lineTo(rx * 0.52 * sc, ry * 0.25 * sc);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // A lit top edge, so the slab has a thickness and reads as tipped up
      ctx.strokeStyle = "rgba(150,150,220,0.38)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.32 * sc, -ry * 1.0 * sc);
      ctx.lineTo(rx * 0.44 * sc, -ry * 0.82 * sc);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // The lasting damage: cracks torn through the floor, the pit itself, and the chips knocked
  // clear. World space and on its own clock, so it stays where it was struck.
  //
  // Everything is the ARENA's palette rather than earth — the floor is #22223d..#101020, so the
  // pit is near-black and the cracks match the wall-crack colour used elsewhere. An earlier pass
  // heaped brown soil here and against a dark navy floor it read as a rock lying in front of the
  // club, not as broken ground.
  drawFloorCracks(ctx) {
    for (const k of this.floorCracks) {
      // Full strength for TROLL_CRACK_HOLD, then out over TROLL_CRACK_FADE
      const a = Math.min(1, k.life / TROLL_CRACK_FADE);
      if (a <= 0) continue;
      const len = k.len;
      // Smaller than the lip drawn around the club: that one is half-covered by the timber, this
      // one stands on its own and at the club's full width read as a black lozenge lying on the
      // floor rather than as a hole in it.
      const rx = 0.17 * len, ry = 0.08 * len;

      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(k.angle);
      ctx.globalAlpha = a;

      ctx.strokeStyle = "rgba(11,11,20,0.85)";
      ctx.lineCap = "round";
      for (let i = 0; i < 9; i++) {
        const ang = k.seed * 1.7 + i * (Math.PI * 2 / 9) + Math.sin(k.seed + i) * 0.24;
        const l = rx * (1.7 + 1.6 * ((i * 5) % 7) / 7);
        ctx.lineWidth = 3 - (i % 3) * 0.7;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * l, Math.sin(ang) * l * 0.55);
        ctx.stroke();
      }

      // The pit: smashed through, so the outline is jagged rather than a neat oval. A lit rim
      // around it stops it reading as a flat black shape and makes it a depression.
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const w = 1 + Math.sin(k.seed * 3 + i * 2.1) * 0.24;
        const px = Math.cos(ang) * rx * w, py = Math.sin(ang) * ry * w;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "#0d0d1a";
      ctx.fill();
      ctx.strokeStyle = "rgba(140,140,205,0.3)";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.fillStyle = "#2a2a4c";
      for (let i = 0; i < 4; i++) {
        const ang = k.seed + i * 2.7;
        const d = rx * (1.5 + 0.5 * ((i * 3) % 4) / 4);
        ctx.beginPath();
        ctx.ellipse(Math.cos(ang) * d, Math.sin(ang) * ry * 1.7,
                    len * 0.02, len * 0.013, ang, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawClub(ctx, r) {
    const len = this.clubLength * r;
    const butt = -0.3 * len;
    const W = 0.06 * len;
    const H = 0.125 * len;
    const buried = this.swingPhase === "stuck";

    // Spikes first, so the trunk covers their roots. The shape points UP by default, so `a` is a
    // rotation away from vertical, not a direction.
    const spikes = [
      [0.36, -0.4, 0.17], [0.56, -0.12, 0.21], [0.76, -0.44, 0.24], [0.93, 0.5, 0.2],
      [0.46, Math.PI + 0.32, 0.18], [0.66, Math.PI - 0.1, 0.22], [0.86, Math.PI + 0.26, 0.24],
    ];
    for (const [f, a, ln] of spikes) {
      ctx.save();
      ctx.translate(f * len, 0);
      ctx.rotate(a);
      ctx.fillStyle = TROLL_NAIL;
      ctx.strokeStyle = TROLL_OUTLINE;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-0.034 * len, 0.015 * len);
      ctx.lineTo(0, -ln * len);
      ctx.lineTo(0.034 * len, 0.015 * len);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.beginPath();
      ctx.moveTo(0.006 * len, 0.008 * len);
      ctx.lineTo(0, -ln * len);
      ctx.lineTo(0.034 * len, 0.015 * len);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = this.gradient(ctx, "club", () => {
      const g = ctx.createLinearGradient(0, -H, 0, H);
      g.addColorStop(0, TROLL_WOOD_LIGHT);
      g.addColorStop(0.42, TROLL_WOOD);
      g.addColorStop(1, TROLL_WOOD_DARK);
      return g;
    });
    ctx.strokeStyle = TROLL_OUTLINE;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(butt, -W);
    ctx.quadraticCurveTo(0.4 * len, -W * 1.3, 0.72 * len, -H * 0.86);
    ctx.quadraticCurveTo(len + 0.03 * len, -H * 0.5, len + 0.04 * len, 0.06 * len);
    ctx.quadraticCurveTo(len + 0.015 * len, H * 0.86, 0.9 * len, H);
    ctx.quadraticCurveTo(0.5 * len, W * 1.4, butt, W * 1.15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = TROLL_WOOD_DARK;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1.1;
    for (const gy of [-0.4, 0.1, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(butt, gy * H);
      ctx.quadraticCurveTo(0.55 * len, (gy - 0.15) * H, len, (gy + 0.1) * H);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = TROLL_WOOD_DARK;
    ctx.beginPath();
    ctx.ellipse(0.42 * len, 0, 0.03 * len, 0.024 * len, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "rgb(72,24,16)";
    ctx.beginPath();
    ctx.ellipse(0.9 * len, 0.2 * H, 0.1 * len, H * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (buried) this.drawBuriedGround(ctx, len);

    // Deliberately no knob on the butt: as a rounded dark blob sitting a few pixels from the
    // fist it read as a second hand gripping below the first. The haft simply ends.
  }

  // Builds a gradient once and reuses it. They are all defined in local body space in units of r,
  // and r never changes for an instance, so there is nothing to rebuild per frame.
  gradient(ctx, key, make) {
    let g = this._grad[key];
    if (!g) { g = make(); this._grad[key] = g; }
    return g;
  }

  // The sweep, over everything: a wedge of motion blur from where the club started to where it is
  // now, out at the full attack radius — exactly the cone resolveSwing tests.
  drawOverlayEffects(ctx) {
    if (!this.alive) return;
    this.drawRoarRings(ctx);
    // The sweep trail belongs to the sweep. The rampage's attack comes straight down, so there
    // is no arc to blur.
    if (this.swingPhase !== "strike" || this.raging) return;
    const p = 1 - this.swingTimer / TROLL_SWING_STRIKE;
    const eased = 1 - (1 - p) * (1 - p);
    const from = this.swingAngle - TROLL_SWING_ARC;
    const to = from + TROLL_SWING_ARC * 2 * eased;
    const outer = this.attackRange;
    const inner = this.size * 0.34;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(this.x, this.y, inner, this.x, this.y, outer);
    g.addColorStop(0, "rgba(255,190,110,0)");
    g.addColorStop(0.55, `rgba(255,190,110,${0.1 * (1 - p)})`);
    g.addColorStop(1, `rgba(255,236,190,${0.3 * (1 - p * 0.6)})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, outer, from, to);
    ctx.arc(this.x, this.y, inner, to, from, true);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(255,245,215,${0.75 * (1 - p * 0.5)})`;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.x + Math.cos(to) * inner, this.y + Math.sin(to) * inner);
    ctx.lineTo(this.x + Math.cos(to) * outer, this.y + Math.sin(to) * outer);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255,220,160,${0.5 * (1 - p * 0.7)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, outer, from, to);
    ctx.stroke();
    ctx.restore();
  }

  // Where the overhead is about to land: a closing circle rather than the sweep's cone, because
  // that is the shape resolveSmash actually tests.
  drawSmashTelegraph(ctx) {
    const f = 1 - this.swingTimer / TROLL_RAGE_WINDUP;
    const near = TROLL_RAGE_NEAR, far = this.attackRange, hw = TROLL_RAGE_HALF_WIDTH;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.swingAngle);   // work in the aim frame: +x is straight ahead

    // The bar the club is about to flatten — exactly the rectangle resolveSmash tests
    ctx.fillStyle = `rgba(255,80,30,${0.1 + f * 0.18})`;
    ctx.fillRect(near, -hw, far - near, hw * 2);
    ctx.strokeStyle = `rgba(255,150,70,${0.45 + f * 0.5})`;
    ctx.lineWidth = 2 + f * 2;
    ctx.strokeRect(near, -hw, far - near, hw * 2);

    // A bright line sweeping down the length of it as the club falls — the countdown to impact
    const head = near + (far - near) * f;
    ctx.strokeStyle = `rgba(255,235,190,${0.4 + f * 0.55})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(head, -hw);
    ctx.lineTo(head, hw);
    ctx.stroke();
    ctx.restore();
  }

  // Rings of sound leaving the body while it roars. Each one starts tight and races outward,
  // fading as it goes — several in flight at once is what reads as a sustained bellow rather
  // than a single thump.
  drawRoarRings(ctx) {
    if (!this.roarRings.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const ring of this.roarRings) {
      const k = 1 - ring.life / TROLL_ROAR_RING_LIFE;      // 0 at birth, 1 as it dies
      const rad = this.size * (0.5 + k * 2.6);
      const a = (1 - k) * (1 - k) * 0.55;
      ctx.strokeStyle = `rgba(255,190,110,${a})`;
      ctx.lineWidth = 2 + (1 - k) * 6;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, rad, rad * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,120,50,${a * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, rad * 0.86, rad * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // The arc it is about to sweep, shown during the windup only — the telegraph that makes a 0.5s
  // tell fair rather than just slow.
  drawGroundEffects(ctx) {
    // Drawn first and unconditionally: the floor damage outlives both the swing that made it and
    // the Troll itself, so it can't sit behind either of the guards below.
    this.drawFloorCracks(ctx);
    if (this.swingPhase !== "windup" || !this.alive) return;
    if (this.raging) return this.drawSmashTelegraph(ctx);
    const f = 1 - this.swingTimer / TROLL_SWING_WINDUP;
    const reach = this.attackRange;
    const a0 = this.swingAngle - TROLL_SWING_ARC;
    const a1 = this.swingAngle + TROLL_SWING_ARC;

    ctx.save();
    const g = ctx.createRadialGradient(this.x, this.y, reach * 0.3, this.x, this.y, reach);
    g.addColorStop(0, "rgba(255,106,42,0)");
    g.addColorStop(1, `rgba(255,106,42,${0.14 + f * 0.22})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.arc(this.x, this.y, reach, a0, a1);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.45 + f * 0.55;
    ctx.strokeStyle = "#ff9a4a";
    ctx.lineWidth = 2 + f * 2.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, reach, a0, a1);
    ctx.stroke();

    ctx.globalAlpha = 0.28 + f * 0.34;
    ctx.lineWidth = 2;
    for (const a of [a0, a1]) {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + Math.cos(a) * reach, this.y + Math.sin(a) * reach);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHud(ctx, x, y, w) {
    const ny = super.drawHud(ctx, x, y, w);
    if (this.ultPhase === "roar") {
      this.drawHudNote(ctx, x, ny, "ROAR", "#ffb03c");
    } else if (this.ultPhase === "rage") {
      this.drawHudNote(ctx, x, ny, `RAMPAGE ${this.ultTimer.toFixed(1)}s`, "#ff5a2a");
    } else if (this.ultPhase === "sleep") {
      this.drawHudNote(ctx, x, ny, `ASLEEP ${this.ultTimer.toFixed(1)}s`, "#6aa8d8");
    }
  }
}
