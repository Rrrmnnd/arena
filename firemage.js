// Fire Mage: the first of a planned trio of elemental casters (Fire/Ice/Earth), each its own
// separate character rather than one character with a switchable element. Fire Mage's identity
// is ground control, not direct burst — its only attack right now is a lobbed fireball that
// leaves a patch of lava wherever it actually ends up (on the opponent's own position if it hit
// them, or wherever it struck a wall otherwise), which then burns the opponent (not Fire Mage
// itself — immune to its own lava) for a long while. No ultimate yet — that's still being
// designed; ultimateRatio simply isn't overridden, so no ultimate bar shows in its HUD yet.
//
// Deliberately excluded from the Twitch integration's random-battle roster for now (see
// ROSTER_TWITCH in main.js) — it's still new/untested and the request was explicit about that.

const FIREMAGE_MAX_HP = 100;  // no melee of its own at all right now, purely zone control
const FIREMAGE_SPEED   = 240;
const FIREMAGE_SIZE    = CHAR_BASE_SIZE; // same as Punch Man/Giant/Soldier

const FIREMAGE_FIREBALL_COOLDOWN = 4.0;
const FIREMAGE_FIREBALL_SPEED    = 480;
const FIREMAGE_FIREBALL_LIFE     = 2.5; // safety timeout in case it somehow never reaches a wall
// The launched fireball's radius — deliberately a touch wider than the mage itself (33 -> 66px
// across vs. the body's 60), since the whole cooldown is spent visibly charging it up to this
// size at the staff head. Note this also IS its hitbox (see updateFireballs), so a fully-charged
// shot is much harder to slip past than the small bolt this used to fire.
const FIREMAGE_FIREBALL_RADIUS   = 33;

// The fireball detonates wherever it ends up — on a body or against a wall alike — and the blast
// is the ONLY thing that deals damage; there's no separate impact hit stacked on top of it (see
// updateFireballs). A direct hit detonates centred on the target, so it lands in the innermost
// band and takes exactly FIREMAGE_BLAST_INNER_DAMAGE.
//
// Three concentric damage bands, plus a very heavy shove across the whole radius, scaled
// inversely with the target's size the same way Bomber's and Demon's blasts are — so a near-miss
// bursting on the wall beside someone still chips them and throws them clear across the arena.
const FIREMAGE_BLAST_INNER_RADIUS = 65;
const FIREMAGE_BLAST_INNER_DAMAGE = 15;
const FIREMAGE_BLAST_MID_RADIUS   = 115;
const FIREMAGE_BLAST_MID_DAMAGE   = 8;
const FIREMAGE_EXPLOSION_RADIUS   = 165; // also the outermost damage band
const FIREMAGE_BLAST_OUTER_DAMAGE = 4;
const FIREMAGE_EXPLOSION_KNOCKBACK = 1500; // vs Bomber's 700 — deliberately one of the hardest shoves in the game
const FIREMAGE_SHOCKWAVE_TIME      = 0.5;  // seconds an expanding blast ring stays on screen

// Victory: the mage hurls ONE big fireball up the screen and it breaks into a firework.
//
// The whole display is scripted off its own sound clip's transients rather than being timed by
// feel. sfx_firemage_fireworks.mp3 was measured window-by-window (RMS for level, zero-crossing
// rate to tell the hissy launch whistle apart from the low booms), and it goes:
//   0.00-1.30s  rising launch whistle, loudest at 0.30s     (ZCR 5000-11600, high = hiss)
//   1.75s       ONE big detonation, the clip's loudest point (ZCR ~1200-2600, low = boom)
//   2.15-3.45s  a run of secondary cracks, biggest at 2.80 and 3.45
//   3.6-6.02s   silence, the clip's own tail
// So: the throw lands the shell at burst height exactly on 1.75s, and every later crack in the
// audio is a sub-shell thrown out by that burst, popping on its own scripted beat.
const FIREMAGE_FIREWORKS_TIME     = 6.02; // the clip's full length
const FIREMAGE_FIREWORKS_BURST_AT = 1.75; // the big detonation
// How far above the arena's top edge the shell detonates. Expressed as an offset rather than an
// absolute y because ARENA moves between layouts — and picked to land in the gap between the HUD
// text and the arena wall, so the flare doesn't sit centred on the HP bars.
const FIREMAGE_FIREWORKS_BURST_ABOVE_ARENA = 70;
// [time, scale] for each secondary break, read straight off the boom transients above.
const FIREMAGE_FIREWORKS_BREAKS = [
  [2.15, 0.50], [2.30, 0.50], [2.40, 0.50],
  [2.80, 0.90], [2.95, 0.62], [3.10, 0.66], [3.20, 0.60], [3.45, 1.00],
];
const FIREMAGE_FIREWORKS_GRAVITY  = 190;  // px/s^2, applied to shells and sparks alike
const FIREMAGE_FIREWORK_COLORS = [
  ["#fff0b0", "#ffc247", "#ff7a1a"], // gold
  ["#ffd9f2", "#ff6ec7", "#c2185b"], // pink
  ["#d8f0ff", "#6ec9ff", "#1565c0"], // blue
  ["#e6ffd8", "#8ee86a", "#2e7d32"], // green
  ["#ffe8d8", "#ff9a5c", "#c2410c"], // ember, matching the mage's own palette
];

// Casting is a three-beat swing rather than an instant spawn: the staff winds back, whips
// forward to point straight at the target — and the fireball is released at exactly that peak,
// not when the cast started, so the shot visibly comes off the end of the swing — then eases
// back to its resting position. See castSwingAmount/castFlash and update()'s cast state machine.
// The three together are well under FIREMAGE_FIREBALL_COOLDOWN, so a cast always finishes its
// animation long before the next one is allowed to begin.
const FIREMAGE_CAST_WINDUP  = 0.20;
const FIREMAGE_CAST_SWING   = 0.12;
const FIREMAGE_CAST_RECOVER = 0.38;

// The actual point of the character: wherever a fireball ends up — the opponent's own current
// position if it hit them, or the wall it struck otherwise — a patch of ground catches fire.
// Opponent-only (Fire Mage itself is immune to its own lava), ticked in small frequent steps
// (1 dmg every 0.2s = 5/sec) so standing in it a moment doesn't feel all-or-nothing.
//
// Lava has NO lifetime of its own — it burns until a tentacle that erupted from it goes away
// again, and only then fades out (see updateTentacles). That makes the whole character a loop:
// build up patches with fireballs, cast Eruption to turn every one of them into a tentacle, and
// the ground only clears once those have run their course. It also means destroying a tentacle
// takes its lava with it, so the opponent clearing them out is doing double duty.
const FIREMAGE_LAVA_TICK_DAMAGE   = 1;
const FIREMAGE_LAVA_TICK_INTERVAL = 0.2;
const FIREMAGE_LAVA_RADIUS        = 50; // roughly a full body-width bigger than a character, so standing near the middle reliably counts
const FIREMAGE_LAVA_GROW_TIME     = 0.35; // seconds to grow in from nothing when it first lands
const FIREMAGE_LAVA_FADE_TIME     = 1.5;  // seconds spent cooling away once its tentacle has gone
// Scalding orange-red. Used for BOTH the floating number and the body flash on a lava tick, so a
// burn is instantly distinguishable from a white-flashing ordinary hit — see Character.takeDamage.
const FIREMAGE_LAVA_DAMAGE_COLOR  = "#ff5a18"; // floating damage-number tint for a lava tick, same idea as Virus's purple Infection numbers

// Ultimate — Eruption: every lava patch currently burning on the field sprouts a tentacle, rooted
// at that patch and unable to move. They can't be killed or bumped into (see TentacleArm) — the
// only counterplay is to leave their reach, or to outlast them. A tentacle still dies with its
// own patch when that burns out, and with the mage itself (see onDeath), so they can never
// outlive what summoned them.
//
// The eruption also stays "open" for as long as its tentacles live: any NEW lava the mage lands
// during that window erupts immediately too, so the window rewards keeping up the fireball
// pressure rather than being a single fixed snapshot of the field taken at cast time.
//
// Casting does nothing at all with no lava down, so the ultimate deliberately holds rather than
// firing into an empty field — it only goes off once there's something to erupt out of.
const FIREMAGE_ULTIMATE_COOLDOWN = 17.0;
// No HP constant: a tentacle is indestructible (TentacleArm.takeDamage is a no-op) and passes
// through both fighters, so it has neither a health pool nor a hitbox. It is purely a timed
// damage source. maxHp is left at a nominal 1 only because Character requires one.
const FIREMAGE_TENTACLE_SIZE   = 34;
// Detection range and physical reach are deliberately the SAME number: anything close enough to
// provoke a strike has to be close enough for the strike to actually land on it, otherwise a
// target sitting between the two distances gets attacked at forever and never actually hit.
const FIREMAGE_TENTACLE_RANGE  = 300;
const FIREMAGE_TENTACLE_DAMAGE = 8;
// One strike is windup (rears back) -> strike (reaches out, THEN slams down; the damage lands on
// the slam, not on the reach) -> recover, then a pause before it can go again.
const FIREMAGE_TENTACLE_WINDUP  = 0.35;
const FIREMAGE_TENTACLE_STRIKE  = 0.24;
const FIREMAGE_TENTACLE_RECOVER = 0.45;
// Time from the start of one strike to the start of the next — so this is a genuine "one hit
// every 3 seconds", not 3 seconds of waiting bolted onto the end of a 1-second animation. The
// idle pause between strikes is whatever's left over after the animation itself.
const FIREMAGE_TENTACLE_ATTACK_INTERVAL = 3.0;
const FIREMAGE_TENTACLE_ANIM_TIME =
  FIREMAGE_TENTACLE_WINDUP + FIREMAGE_TENTACLE_STRIKE + FIREMAGE_TENTACLE_RECOVER;
const FIREMAGE_TENTACLE_IDLE_WAIT =
  Math.max(0, FIREMAGE_TENTACLE_ATTACK_INTERVAL - FIREMAGE_TENTACLE_ANIM_TIME);

const FIREMAGE_TENTACLE_LIFETIME = 10.0;  // then it sinks back into the lava — see the retract state
const FIREMAGE_TENTACLE_EMERGE   = 0.45; // seconds spent rising up out of the lava when first summoned
const FIREMAGE_TENTACLE_RETRACT  = 0.55; // seconds spent sinking back down again at the end
const FIREMAGE_TENTACLE_IDLE_HEIGHT = 100; // how far the tip stands above its root while just waiting
// Fraction of the strike spent reaching out before the slam begins — the "拉伸出去再拍打" split.
const FIREMAGE_TENTACLE_REACH_FRACTION = 0.6;

// A single lobbed fireball, aimed at the opponent's position the instant it's released (no
// The burning-ground ambience, looped for exactly as long as any lava is on the field.
//
// Deliberately ONE shared loop rather than one per patch: lava now has no lifetime of its own,
// so half a dozen patches can sit burning at once and that many copies of the same clip stacked
// on top of each other is just noise at six times the volume. Module-level rather than a field
// on the mage for the same reason it's shared — and so it can be killed from outside when a
// round is torn down (see stopFiremageLavaLoop's callers), since a looping audio node on a
// discarded character would otherwise play forever with nothing left to stop it.
//
// Only one Fire Mage can ever be on the field at a time (both roster pickers reject duplicate
// picks), so a single global loop can't be fought over by two owners.
let firemageLavaLoopSource = null;

function startFiremageLavaLoop() {
  if (firemageLavaLoopSource) return;
  // pitchVariance 0: the usual random detune would make a sustained loop wander off-pitch.
  firemageLavaLoopSource = playSfx("firemageLava", 0.85, 0, 0, true);
}

function stopFiremageLavaLoop() {
  if (!firemageLavaLoopSource) return;
  try { firemageLavaLoopSource.stop(); } catch (e) { /* already stopped/ended on its own */ }
  firemageLavaLoopSource = null;
}

// homing after that) — same "might just miss" logic as every other ranged poke in this roster.
class Fireball {
  constructor(x, y, angle, speed) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.angle = angle;
    this.life = FIREMAGE_FIREBALL_LIFE;
    this.seed = Math.random() * Math.PI * 2; // per-instance flicker phase so a volley doesn't pulse in lockstep
  }
}

// A patch of burning ground. Pure data + a lifetime — see FireMage.updateLavaPatches for the
// actual damage tick, and drawGroundEffects for how it's rendered (grown/faded, not a hard pop
// in and out).
class LavaPatch {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    // No lifetime of its own: `age` only drives the grow-in, and it burns indefinitely until a
    // tentacle that rose from it is gone, at which point `fading` starts the cool-down to `dead`.
    this.age = 0;
    this.fading = false;
    this.fadeTimer = FIREMAGE_LAVA_FADE_TIME;
    this.dead = false;
    this.tickTimer = FIREMAGE_LAVA_TICK_INTERVAL;
    this.seed = Math.random() * Math.PI * 2;

    // Slabs of cooled crust floating on the molten surface, and the bubbles welling up between
    // them. Both are rolled once per patch and then only animated, so the surface churns
    // without the whole layout reshuffling itself every frame.
    this.crust = Array.from({ length: 5 }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 0.16 + Math.random() * 0.46,
      size: 0.2 + Math.random() * 0.2,
      squash: 0.55 + Math.random() * 0.35,
      rot: Math.random() * Math.PI,
      drift: (Math.random() - 0.5) * 0.5,
      seed: Math.random() * Math.PI * 2,
    }));
    this.bubbles = Array.from({ length: 4 }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 0.1 + Math.random() * 0.5,
      size: 0.07 + Math.random() * 0.07,
      seed: Math.random() * Math.PI * 2,
      speed: 0.45 + Math.random() * 0.5,
    }));
  }
}

// One tentacle of Fire Mage's ultimate, rooted in the lava patch it erupted from.
//
// Deliberately a real Character subclass rather than a hand-rolled duck-typed object: main.js
// hands extra bodies to the opponent as ordinary targets and straight into resolveCollision, and
// attackers across the cast variously read/write vx, stunTimer, movable and call takeDamage,
// applyKnockback and applyStun on whatever they're fighting. Inheriting gets every one of those
// for free instead of leaving a landmine for whichever character happens to touch it first.
//
// It is rooted: movable stays false so nothing can shove it off its patch, and onStunEnd is
// overridden because the base one hands out a fresh random velocity, which would otherwise set a
// stunned-then-recovered tentacle wandering off across the arena.
class TentacleArm extends Character {
  constructor(x, y, patch) {
    super({
      x, y,
      size: FIREMAGE_TENTACLE_SIZE,
      color: "#c2410c",
      maxHp: 1, // nominal — see the comment on FIREMAGE_TENTACLE_SIZE; it can never be damaged
      name: "Tentacle",
      speed: 0,
    });
    this.vx = 0;
    this.vy = 0;
    this.movable = false;
    this.attackGraceTimer = 0; // summoned mid-fight; it doesn't get the round-start grace period
    this.patch = patch;        // dies when this burns out — see FireMage.updateTentacles

    this.emergeTimer = FIREMAGE_TENTACLE_EMERGE;
    this.lifeTimer = FIREMAGE_TENTACLE_LIFETIME;
    this.retractTimer = 0;     // >0 once it's sinking back into the lava; hitting 0 ends it
    this.phase = null;         // null | "windup" | "strike" | "recover"
    this.phaseTimer = 0;
    this.attackCooldown = FIREMAGE_TENTACLE_IDLE_WAIT * 0.5; // staggered so a wave doesn't slam in unison
    this.aimAngle = Math.random() * Math.PI * 2;
    // How far this particular strike reaches. Locked in when the strike starts to the target's
    // actual distance (capped at FIREMAGE_TENTACLE_RANGE) rather than always extending fully —
    // a fixed reach overshoots anything standing closer than that and the slam lands harmlessly
    // behind them.
    this.strikeDist = FIREMAGE_TENTACLE_RANGE;
    this.hasSlammed = false;   // guards the damage to exactly once per strike
    this.seed = Math.random() * Math.PI * 2;
  }

  // Rooted — never regains movement, unlike the base implementation
  onStunEnd() {
    this.movable = false;
    this.vx = 0;
    this.vy = 0;
  }

  // Indestructible. There is no wearing one of these down any more: the only things that end a
  // tentacle are its own lifetime running out, its patch going with it, or the mage dying. Made a
  // hard no-op rather than a large HP pool so that nothing — chip damage, damage-over-time, a
  // Bomber blast — can shave it, and so `hp` can never reach 0 and trip onDeath behind our backs.
  takeDamage() {}

  // Nothing to show: with no HP there's no bar. Kept as an explicit override so the base class's
  // bar (positioned from a body's centre, which would sit buried inside the arm anyway) can't
  // reappear.
  drawFieldHpBar() {}

  // Passes straight through both fighters — checked by resolveCollision in combat.js. A rooted,
  // unkillable, 34px-wide obstacle that people bounced off would be a wall the mage gets to plant
  // wherever it likes, which is a much bigger deal than the attack it's actually there for.
  get phasesThroughCharacters() {
    return true;
  }

  onDeath() {
    spawnImpactParticles(this.x, this.y, ["#ff7a1a", "#ffcf40", "#5c1400"], 22, 1.2, 0);
  }

  // Begins the sink-back-into-the-lava exit. Safe to call repeatedly — whichever reason gets
  // there first (its own lifetime running out, its patch burning out, or the mage dying) wins,
  // and later calls don't restart the animation.
  beginRetract() {
    if (this.retractTimer > 0 || !this.alive) return;
    this.retractTimer = FIREMAGE_TENTACLE_RETRACT;
    this.phase = null;
    spawnImpactParticles(this.x, this.y, ["#ff7a1a", "#ffcf40"], 12, 0.9, 0);
  }

  get isRetracting() {
    return this.retractTimer > 0;
  }

  // How much of the arm is currently out of the ground: 0 -> 1 while erupting, 1 -> 0 while
  // sinking back. Everything that draws or positions the arm scales off this single number, so
  // the emerge and retract animations are the same code running in opposite directions.
  get presence() {
    if (!this.alive) return 0; // fully gone — without this a finished retract reads as 1 again
    if (this.retractTimer > 0) return Math.max(0, this.retractTimer) / FIREMAGE_TENTACLE_RETRACT;
    return 1 - Math.max(0, this.emergeTimer) / FIREMAGE_TENTACLE_EMERGE;
  }

  // How far the tip is thrown out along aimAngle: slightly negative while winding back, 1 at
  // full extension. drawBody builds the whole pose off this plus slamAmount.
  get reachAmount() {
    if (!this.phase) return 0;
    if (this.phase === "windup") {
      const p = 1 - this.phaseTimer / FIREMAGE_TENTACLE_WINDUP;
      return -0.28 * (p * p * (3 - 2 * p));
    }
    if (this.phase === "strike") {
      const p = 1 - this.phaseTimer / FIREMAGE_TENTACLE_STRIKE;
      const reachP = Math.min(1, p / FIREMAGE_TENTACLE_REACH_FRACTION);
      return -0.28 + 1.28 * (1 - (1 - reachP) * (1 - reachP)); // snaps out, then holds while it slams
    }
    const p = 1 - this.phaseTimer / FIREMAGE_TENTACLE_RECOVER;
    return 1 - (p * p * (3 - 2 * p));
  }

  // 0 while it's still reaching out, 1 once the tip has come all the way down — the "拍打" half
  // of the strike. Stays at 1 briefly into the recovery so the slam visibly lands before the
  // tentacle peels back up.
  get slamAmount() {
    if (this.phase === "strike") {
      const p = 1 - this.phaseTimer / FIREMAGE_TENTACLE_STRIKE;
      const s = Math.max(0, (p - FIREMAGE_TENTACLE_REACH_FRACTION) / (1 - FIREMAGE_TENTACLE_REACH_FRACTION));
      return s * s; // accelerates downward, like it's being driven into the ground
    }
    if (this.phase === "recover") {
      const p = 1 - this.phaseTimer / FIREMAGE_TENTACLE_RECOVER;
      return Math.max(0, 1 - p * 2.2); // holds down for a beat, then lifts
    }
    return 0;
  }

  update(dt, opponent) {
    super.update(dt, opponent); // timers only — movable is false, so no wandering
    if (!this.alive) return;
    if (this.emergeTimer > 0) this.emergeTimer -= dt;

    // Sinking back down: no attacking, no aiming, just the animation running out. Reaching the
    // end is an ordinary end-of-life, not a kill, so it goes quietly without the death burst.
    if (this.retractTimer > 0) {
      this.retractTimer -= dt;
      if (this.retractTimer <= 0) {
        this.alive = false;
        this.deathFadeTimer = 0;
      }
      return;
    }

    this.lifeTimer -= dt;
    if (this.lifeTimer <= 0) { this.beginRetract(); return; }

    if (this.stunTimer > 0) return;

    // Locked on: it keeps tracking the target right through the strike itself, not just up to
    // the point of committing, so the tip curves to follow them and comes down exactly where
    // they now are. Sidestepping can't shake it — the only way out is to leave its reach
    // entirely (landSlam still checks range at the moment of impact).
    if (opponent && opponent.alive && this.phase !== "recover") {
      this.aimAngle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
      if (this.phase === "strike") {
        this.strikeDist = Math.min(
          FIREMAGE_TENTACLE_RANGE,
          Math.hypot(opponent.x - this.x, opponent.y - this.y)
        );
      }
    }

    if (this.phase) {
      this.phaseTimer -= dt;

      // The damage lands the instant the tip finishes coming down, not when the strike began
      if (this.phase === "strike" && !this.hasSlammed && this.slamAmount >= 1) {
        this.hasSlammed = true;
        this.landSlam(opponent);
      }

      if (this.phaseTimer <= 0) {
        if (this.phase === "windup") {
          this.phase = "strike";
          this.phaseTimer = FIREMAGE_TENTACLE_STRIKE;
          this.hasSlammed = false;
          this.strikeDist = opponent && opponent.alive
            ? Math.min(FIREMAGE_TENTACLE_RANGE, Math.hypot(opponent.x - this.x, opponent.y - this.y))
            : FIREMAGE_TENTACLE_RANGE;
        } else if (this.phase === "strike") {
          // Safety net: if the frame step skipped straight past slamAmount hitting 1, the hit
          // still resolves here rather than being silently dropped.
          if (!this.hasSlammed) { this.hasSlammed = true; this.landSlam(opponent); }
          this.phase = "recover";
          this.phaseTimer = FIREMAGE_TENTACLE_RECOVER;
        } else {
          this.phase = null;
          this.attackCooldown = FIREMAGE_TENTACLE_IDLE_WAIT;
        }
      }
      return;
    }

    if (this.emergeTimer > 0) return; // still hauling itself out of the lava
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.attackCooldown <= 0 && opponent && opponent.alive) {
      const dist = Math.hypot(opponent.x - this.x, opponent.y - this.y);
      if (dist <= FIREMAGE_TENTACLE_RANGE) {
        this.phase = "windup";
        this.phaseTimer = FIREMAGE_TENTACLE_WINDUP;
      }
    }
  }

  // Where the tip currently is in world space — the slam's impact point, and what drawBody
  // curves the arm toward.
  tipPosition() {
    const reach = this.reachAmount;
    const slam = this.slamAmount;
    const grow = this.presence;
    const dist = this.strikeDist * reach * grow;
    // Stands tall while idle, rears a little higher still as it coils, then drops to the floor
    // as it slams
    const lift = (FIREMAGE_TENTACLE_IDLE_HEIGHT + 34 * Math.max(0, -reach / 0.28)) * (1 - slam) * grow;
    return {
      x: this.x + Math.cos(this.aimAngle) * dist,
      y: this.y + Math.sin(this.aimAngle) * dist - lift,
    };
  }

  landSlam(opponent) {
    const tip = this.tipPosition();
    spawnImpactParticles(tip.x, tip.y, ["#ffcf40", "#ff6a20", "#8a2a00"], 26, 1.3, 0);
    triggerShake(7, 0.18);
    playSfx("firemageWhip", 0.6);
    if (!opponent || !opponent.alive) return;
    // Locked on, so there's deliberately no proximity check against where the tip happened to
    // land: the arm tracked the target all the way down (see update), and the only thing that
    // can save them is being out of its reach entirely at the moment of impact.
    const dist = Math.hypot(opponent.x - this.x, opponent.y - this.y);
    if (dist > FIREMAGE_TENTACLE_RANGE) return;
    opponent.takeDamage(FIREMAGE_TENTACLE_DAMAGE, FIREMAGE_LAVA_DAMAGE_COLOR);
  }

  drawBody(ctx) {
    const t = performance.now() / 1000;
    const grow = this.presence;
    if (grow <= 0.01) return;

    const tip = this.tipPosition();
    const baseX = this.x, baseY = this.y;

    // An idle sway so a waiting tentacle still looks alive, damped right down once it commits
    // to a strike (a whipping arm shouldn't also be drifting).
    const idle = this.phase ? 0.25 : 1;
    const swayX = Math.sin(t * 1.6 + this.seed) * 13 * idle * grow;
    const swayY = Math.cos(t * 1.9 + this.seed) * 7 * idle * grow;

    // Control point set well above the midpoint, which is what gives the arm its arc — during a
    // slam it's driven past the tip so the whole limb hooks over and comes down on top of it.
    const slam = this.slamAmount;
    const midX = (baseX + tip.x) / 2 + swayX;
    const midY = (baseY + tip.y) / 2 - (70 - slam * 30) * grow + swayY;

    // Sample the curve into a spine, then walk it as a tapered ribbon
    const SEG = 14;
    const spine = [];
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      const mu = 1 - u;
      spine.push({
        x: mu * mu * baseX + 2 * mu * u * midX + u * u * tip.x,
        y: mu * mu * baseY + 2 * mu * u * midY + u * u * tip.y,
        u,
      });
    }

    const baseHalf = 11 * grow;
    const left = [], right = [];
    for (let i = 0; i <= SEG; i++) {
      const p = spine[i];
      const prev = spine[Math.max(0, i - 1)], next = spine[Math.min(SEG, i + 1)];
      const dx = next.x - prev.x, dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      // Tapers to a point, with a slight bulge near the base so it reads as a limb rather than a cone
      const w = baseHalf * (1 - p.u * 0.9) * (1 + Math.sin(p.u * Math.PI) * 0.22);
      left.push({ x: p.x + nx * w, y: p.y + ny * w });
      right.push({ x: p.x - nx * w, y: p.y - ny * w });
    }

    ctx.save();

    // Silhouette
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i <= SEG; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = SEG; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();

    const skin = ctx.createLinearGradient(baseX, baseY, tip.x, tip.y);
    skin.addColorStop(0, "#8a2a06");
    skin.addColorStop(0.45, "#59200a");
    skin.addColorStop(1, "#2c0f05");
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.strokeStyle = "rgba(20,6,2,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Molten seams between the segments, brightest at the base where it's still connected to
    // the lava, plus a flare down the whole limb at the moment of impact
    ctx.save();
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    const heat = 0.5 + Math.sin(t * 3 + this.seed) * 0.2 + slam * 0.5;
    for (let i = 1; i < SEG; i += 2) {
      const p = spine[i];
      const prev = spine[i - 1], next = spine[i + 1];
      const dx = next.x - prev.x, dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const w = baseHalf * (1 - p.u * 0.9) * 1.2;
      ctx.globalAlpha = Math.max(0, heat * (1 - p.u * 0.55));
      ctx.strokeStyle = "#ff8a1e";
      ctx.lineWidth = 3.2 * grow;
      ctx.beginPath();
      ctx.moveTo(p.x + nx * w, p.y + ny * w);
      ctx.lineTo(p.x - nx * w, p.y - ny * w);
      ctx.stroke();
    }
    ctx.restore();

    // Suckers down the underside, fading out toward the tip
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#e8913f";
    for (let i = 2; i < SEG - 1; i += 2) {
      const p = spine[i];
      const prev = spine[i - 1], next = spine[i + 1];
      const dx = next.x - prev.x, dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const w = baseHalf * (1 - p.u * 0.9) * 0.4;
      ctx.beginPath();
      ctx.arc(p.x - nx * w, p.y - ny * w, Math.max(0.8, 2.6 * (1 - p.u) * grow), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Glowing root where it erupts out of the patch, and a flash under the tip as it lands
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const rootGlow = ctx.createRadialGradient(baseX, baseY, 0, baseX, baseY, 26 * grow);
    rootGlow.addColorStop(0, "rgba(255,170,60,0.65)");
    rootGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rootGlow;
    ctx.beginPath();
    ctx.arc(baseX, baseY, 26 * grow, 0, Math.PI * 2);
    ctx.fill();

    if (slam > 0.35) {
      ctx.globalAlpha = (slam - 0.35) / 0.65;
      const hitGlow = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 34);
      hitGlow.addColorStop(0, "rgba(255,220,140,0.8)");
      hitGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hitGlow;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 34, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.restore();
  }
}

class FireMage extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: FIREMAGE_SIZE,
      color: "#ff5a1f",
      maxHp: FIREMAGE_MAX_HP,
      name: "Fire Mage",
      speed: FIREMAGE_SPEED,
    });

    this.facingAngle = Math.random() * Math.PI * 2;
    // Starts on full cooldown rather than 0, so the round opens with an empty staff that charges
    // up from nothing (see chargeRatio) instead of already holding a fully-grown fireball.
    this.fireballTimer = FIREMAGE_FIREBALL_COOLDOWN;
    this.fireballs = [];
    this.lavaPatches = [];
    this.castPhase = null; // null | "windup" | "swing" | "recover" — see update()
    this.castTimer = 0;
    this.ultimateCooldown = FIREMAGE_ULTIMATE_COOLDOWN;
    this.tentacles = []; // see summonTentacles/updateTentacles and the TentacleArm class
    this.eruptionTimer = 0; // >0 while an eruption is open and new lava erupts on arrival
    this.shockwaves = []; // { x, y, timer, seed } — expanding blast rings, see explodeFireball

    // Victory fireworks — see onVictory/updateFireworks/drawVictoryOverlay
    this.celebratingVictory = false;
    this.fireworksTimer = 0;
    this.throwStarted = false; // the display's single skyward throw
    this.mainShell = null;     // the big shell climbing the screen, null once it has broken open
    this.shells = [];          // sub-shells thrown out by that break, one per scripted crack
    this.sparks = [];
    this.blooms = [];
    this.lastFireworkTickMs = 0;
    // A previous round's loop could still be running if that round ended without this character
    // ever being told to stop (see stopFiremageLavaLoop) — constructing a new mage means a new
    // round, so clear it here as well.
    stopFiremageLavaLoop();

    // Fixed per-instance layout so the trim runes and rising embers don't reroll (and visibly
    // crawl) every single frame.
    this.bodySeed = Math.random() * Math.PI * 2;
    this.embers = Array.from({ length: 6 }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 0.3 + Math.random() * 0.45,
      seed: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.5,
      size: 0.05 + Math.random() * 0.05,
    }));
  }

  // Deliberately empty, even though the mage does have tentacles out.
  //
  // getExtraBodies() is what main.js builds the opponent's target list from — the opponent aims
  // at, faces, and walks toward whichever entry in that list is nearest. Tentacles are meant to
  // read as part of the scenery rather than as enemies: they can't be hurt and can't be bumped
  // into, so an opponent that turned to face one would be stood there swinging at something it
  // could never affect while the mage lobbed fireballs at its back. Keeping them out of here is
  // what guarantees the opponent is always looking at the mage itself.
  //
  // The tentacles are still fully updated and drawn — see updateTentacles/draw; they're just
  // invisible to the targeting system. This also means isFighterDown() calls the mage out the
  // instant it dies, which is correct: onDeath takes the tentacles down with it anyway.
  getExtraBodies() {
    return [];
  }

  // Killing the mage sends its tentacles back down with it, rather than leaving them rooted and
  // still swinging on their own.
  onDeath() {
    for (const t of this.tentacles) t.beginRetract();
  }

  get ultimateRatio() {
    return Math.max(0, 1 - this.ultimateCooldown / FIREMAGE_ULTIMATE_COOLDOWN);
  }

  get ultimateBarColor() {
    return "#ff7a1a";
  }

  // One tentacle per burning patch that hasn't already got one — so the ultimate's payoff scales
  // with how much ground has actually been set alight beforehand. Nothing has to be done to the
  // patch itself to keep it around: lava has no lifetime of its own, and it's the tentacle
  // leaving that eventually clears it rather than the other way round.
  summonTentacles() {
    let summoned = 0;
    for (const lp of this.lavaPatches) {
      if (this.eruptTentacleOn(lp, FIREMAGE_TENTACLE_LIFETIME)) summoned++;
    }
    if (summoned) {
      // Opens the eruption window. For the next FIREMAGE_TENTACLE_LIFETIME seconds any lava the
      // mage lands erupts the moment it hits (see spawnLava), instead of the ultimate being a
      // single snapshot of the field taken at cast time.
      this.eruptionTimer = FIREMAGE_TENTACLE_LIFETIME;
      triggerShake(9, 0.3);
      // Once for the eruption as a whole, not once per arm — several firing together would just
      // stack into a single louder, muddier version of the same clip.
      playSfx("firemageTentacle", 0.7);
    }
    return summoned;
  }

  // Raises one arm out of `patch`, unless that patch already has one. `lifetime` is passed in
  // rather than always being the constant so that arms joining an eruption late expire WITH it
  // rather than each restarting the clock — otherwise a mage landing a fireball every 3.5s would
  // keep handing itself a fresh 15s arm forever and the ultimate would simply never end.
  eruptTentacleOn(patch, lifetime) {
    if (this.tentacles.some((t) => t.alive && t.patch === patch)) return false;
    // A patch that's already cooling can't host anything. Without this the cast right after an
    // eruption ends raises arms out of the previous wave's dying lava, and updateTentacles kills
    // them again on the very next frame — burning the whole ultimate cooldown on nothing.
    if (patch.fading || patch.dead) return false;
    const arm = new TentacleArm(patch.x, patch.y, patch);
    arm.lifeTimer = lifetime;
    this.tentacles.push(arm);
    spawnImpactParticles(patch.x, patch.y, ["#ffcf40", "#ff6a20", "#8a2a00"], 24, 1.3, 0);
    return true;
  }

  updateTentacles(dt, opponent) {
    for (let i = this.tentacles.length - 1; i >= 0; i--) {
      const tn = this.tentacles[i];
      // Safety net only, now that lava outlives its tentacle by design — a patch should never
      // vanish out from under a live tentacle, but if one somehow did the arm goes with it.
      if (tn.alive && (!tn.patch || tn.patch.dead)) tn.beginRetract();

      tn.update(dt, opponent);

      // The tentacle is gone — sunk back down, or destroyed by the opponent — so the lava it
      // rose out of starts cooling. Checked on state rather than on the transition, so it fires
      // no matter which of those paths killed it or when.
      if (!tn.alive && tn.patch && !tn.patch.fading) tn.patch.fading = true;

      if (!tn.alive && tn.deathFadeTimer <= 0) this.tentacles.splice(i, 1);
    }
  }

  // 0 at rest, negative while wound back, up to 1 at the peak of the forward swing. drawStaff
  // reads this to blend the staff between "held upright at the mage's side" and "thrust out
  // pointing straight at the target", so the whole motion falls out of this single number.
  get castSwingAmount() {
    if (!this.castPhase) return 0;
    if (this.castPhase === "windup") {
      const p = 1 - this.castTimer / FIREMAGE_CAST_WINDUP;
      return -0.32 * (p * p * (3 - 2 * p)); // smoothstep back
    }
    if (this.castPhase === "swing") {
      const p = 1 - this.castTimer / FIREMAGE_CAST_SWING;
      return -0.32 + 1.32 * (1 - (1 - p) * (1 - p)); // ease-out: fastest at the start of the whip
    }
    const p = 1 - this.castTimer / FIREMAGE_CAST_RECOVER;
    return 1 - (p * p * (3 - 2 * p)); // smoothstep back to rest
  }

  // Staff-head brightness: builds through the forward swing, peaks exactly at release, decays
  // over the recovery.
  get castFlash() {
    if (this.castPhase === "swing") return 1 - this.castTimer / FIREMAGE_CAST_SWING;
    if (this.castPhase === "recover") return Math.max(0, this.castTimer / FIREMAGE_CAST_RECOVER);
    return 0;
  }

  // 0..1 — how far along the next shot is from being ready, which drawStaff renders as an orb
  // physically growing at the staff head over the whole cooldown, so the wait reads as visibly
  // gathering power rather than as dead time.
  //
  // Held pinned at 1 through the windup and the swing itself: fireballTimer is reset the instant
  // a cast BEGINS, so without this the fully-charged orb would snap back to nothing at the very
  // moment the mage starts winding up to throw it. It's only once the shot has actually left
  // (recover onward) that the charge legitimately reads as spent and starts over.
  get chargeRatio() {
    if (this.castPhase === "windup" || this.castPhase === "swing") return 1;
    return Math.max(0, Math.min(1, 1 - this.fireballTimer / FIREMAGE_FIREBALL_COOLDOWN));
  }

  // Called at the peak of the swing (not when the cast began) — see update(). The opponent can
  // die or vanish mid-animation, in which case the swing still plays out, it just produces
  // nothing.
  releaseFireball(opponent) {
    if (!opponent || !opponent.alive) return;
    const angle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
    // Clear of the mage's own body, so a ball this size doesn't spawn half-buried in it
    const spawnDist = this.size / 2 + FIREMAGE_FIREBALL_RADIUS * 0.85;
    this.fireballs.push(new Fireball(
      this.x + Math.cos(angle) * spawnDist, this.y + Math.sin(angle) * spawnDist,
      angle, FIREMAGE_FIREBALL_SPEED
    ));
    spawnImpactParticles(
      this.x + Math.cos(angle) * spawnDist, this.y + Math.sin(angle) * spawnDist,
      ["#ffcf40", "#ff6a20"], 14, 1.1, 0
    );
    playSfx("firemageThrow", 0.6);
  }

  // A fireball reaching the end of its flight — on a body or against a wall — detonates. This is
  // where ALL of a fireball's damage comes from (three concentric bands, see the constants), plus
  // a very heavy shove across the whole radius, so even a shot that misses and bursts on the wall
  // alongside someone still chips them and throws them clear.
  explodeFireball(x, y, opponent) {
    this.shockwaves.push({ x, y, timer: FIREMAGE_SHOCKWAVE_TIME, seed: Math.random() * Math.PI * 2 });

    // Two passes: a filled disc so the whole blast radius lights up at once (the same helper
    // Bomber's explosions use), plus a fast outward spray for the leading edge.
    spawnRadiusFillParticles(
      x, y, FIREMAGE_EXPLOSION_RADIUS * 0.85,
      ["#fff6d0", "#ffcf40", "#ff7a1a", "#c22e02"], 64
    );
    spawnImpactParticles(x, y, ["#fff6d0", "#ffcf40", "#ff6a20"], 34, 2.1, 0);
    spawnFlash(x, y, "#ffb85c", FIREMAGE_EXPLOSION_RADIUS * 1.1, 0.32);
    triggerShake(13, 0.34);
    playSfx("firemageExplode", 0.7);

    if (!opponent || !opponent.alive) return;
    const dx = opponent.x - x, dy = opponent.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist > FIREMAGE_EXPLOSION_RADIUS) return;

    const dmg = dist <= FIREMAGE_BLAST_INNER_RADIUS ? FIREMAGE_BLAST_INNER_DAMAGE
      : dist <= FIREMAGE_BLAST_MID_RADIUS ? FIREMAGE_BLAST_MID_DAMAGE
      : FIREMAGE_BLAST_OUTER_DAMAGE;
    opponent.takeDamage(dmg, FIREMAGE_LAVA_DAMAGE_COLOR);

    // Only tails off to half strength at the very edge — the point of this is that getting
    // caught anywhere in the blast hurts your positioning, not just a dead-centre hit.
    const falloff = 1 - (dist / FIREMAGE_EXPLOSION_RADIUS) * 0.5;
    const hasDir = dist > 0.01;
    const angle = hasDir ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
    // Scaled inversely with the target's size, matching Bomber's and Demon's blasts, so a Giant
    // isn't flung exactly as far as something a third its mass.
    const kb = FIREMAGE_EXPLOSION_KNOCKBACK * falloff * (CHAR_BASE_SIZE / opponent.size);
    opponent.applyKnockback(Math.cos(angle), Math.sin(angle), kb);
  }

  updateShockwaves(dt) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      this.shockwaves[i].timer -= dt;
      if (this.shockwaves[i].timer <= 0) this.shockwaves.splice(i, 1);
    }
  }

  spawnLava(x, y) {
    const patch = new LavaPatch(x, y);
    this.lavaPatches.push(patch);
    spawnImpactParticles(x, y, ["#ff6a20", "#ffcf40", "#8a2a00"], 20, 1.2, 0);
    triggerShake(6, 0.15);

    // Lava landing inside an open eruption window erupts on arrival. The new arm gets only what's
    // LEFT of the window, so the whole eruption still ends as one event at cast + 15s. Skipped
    // near the end of the window, where an arm would spend its entire life rising and sinking
    // without ever getting a strike out.
    if (this.eruptionTimer > FIREMAGE_TENTACLE_EMERGE + FIREMAGE_TENTACLE_RETRACT) {
      if (this.eruptTentacleOn(patch, this.eruptionTimer)) playSfx("firemageTentacle", 0.55);
    }
  }

  // A fireball always leaves lava wherever it actually ends up — on the opponent's own current
  // position if it hit them (not the exact pixel of impact — under their feet, i.e. wherever
  // they are right now), or wherever it struck a wall otherwise. The life-timeout branch is
  // purely a safety net (a straight line in a bounded arena always reaches a wall well before
  // FIREMAGE_FIREBALL_LIFE runs out) but still leaves lava too, for consistency.
  updateFireballs(dt, opponent) {
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.life -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;

      let landX = f.x, landY = f.y;
      let gone = false;

      if (opponent && opponent.alive) {
        const dist = Math.hypot(opponent.x - f.x, opponent.y - f.y);
        // Matched to the ball's actual drawn size, so what looks like a hit is a hit. No damage
        // is applied here: the blast is the only thing that deals any (see explodeFireball), and
        // since a direct hit detonates centred on the target it lands in the innermost band
        // anyway — so a direct hit does exactly FIREMAGE_BLAST_INNER_DAMAGE, rather than that
        // plus a separate impact hit on top.
        if (dist <= opponent.size / 2 + FIREMAGE_FIREBALL_RADIUS) {
          landX = opponent.x;
          landY = opponent.y;
          gone = true;
        }
      }

      if (!gone) {
        // Stops against the wall's INNER FACE with its own radius accounted for, rather than
        // waiting for its centre to leave the arena entirely: at 480px/sec it covers ~8px a
        // frame, so the centre-only test let it visibly punch a good chunk of the way through
        // the border (head radius + up to a frame of travel) before winking out. Clamping the
        // landing point to the same face also keeps the lava hugging the wall instead of
        // straddling it.
        const left   = ARENA.x + ARENA_BORDER + FIREMAGE_FIREBALL_RADIUS;
        const right  = ARENA.x + ARENA.w - ARENA_BORDER - FIREMAGE_FIREBALL_RADIUS;
        const top    = ARENA.y + ARENA_BORDER + FIREMAGE_FIREBALL_RADIUS;
        const bottom = ARENA.y + ARENA.h - ARENA_BORDER - FIREMAGE_FIREBALL_RADIUS;
        if (f.x < left || f.x > right || f.y < top || f.y > bottom) {
          landX = Math.min(right, Math.max(left, f.x));
          landY = Math.min(bottom, Math.max(top, f.y));
          f.x = landX;
          f.y = landY;
          gone = true;
        } else if (f.life <= 0) {
          gone = true;
        }
      }

      if (gone) {
        this.spawnLava(landX, landY);
        this.explodeFireball(landX, landY, opponent);
        this.fireballs.splice(i, 1);
      }
    }
  }

  // Runs independent of Fire Mage's own alive/stun state — same reasoning as Virus's Infection:
  // the fire is already burning on the ground and doesn't need any further action to keep going.
  // Checks BOTH fighters, not just the opponent — standing in your own lava burns just as much.
  updateLavaPatches(dt, opponent) {
    for (let i = this.lavaPatches.length - 1; i >= 0; i--) {
      const lp = this.lavaPatches[i];
      lp.age += dt;
      // Only ever starts counting down once its tentacle has gone — see updateTentacles
      if (lp.fading) {
        lp.fadeTimer -= dt;
        if (lp.fadeTimer <= 0) { lp.dead = true; this.lavaPatches.splice(i, 1); continue; }
      }

      lp.tickTimer -= dt;
      if (lp.tickTimer <= 0) {
        lp.tickTimer += FIREMAGE_LAVA_TICK_INTERVAL;
        // Opponent only — Fire Mage is immune to its own lava.
        if (opponent && opponent.alive) {
          const dist = Math.hypot(opponent.x - lp.x, opponent.y - lp.y);
          if (dist <= FIREMAGE_LAVA_RADIUS + opponent.size / 2) {
            opponent.takeDamage(FIREMAGE_LAVA_TICK_DAMAGE, FIREMAGE_LAVA_DAMAGE_COLOR);
            // One sizzle per point of damage, i.e. 5x/sec while they stand in it. The clip is
            // 0.18s against a 0.2s tick, so each one finishes just before the next starts and
            // they never pile up on each other.
            playSfx("firemageOnLava", 0.4);
            spawnImpactParticles(opponent.x, opponent.y - opponent.size * 0.2, ["#ff7a1a", "#ffcf40"], 6, 0.6, 0);
          }
        }
      }
    }
  }

  update(dt, opponent) {
    this.updateLavaPatches(dt, opponent);
    // Runs the ambience for exactly as long as lava is on the field. Gated on `alive` too, so a
    // dead mage can't leave it droning on with nothing updating it any more — and on the victory
    // display, which cuts the ambience in onVictory() and would otherwise have it switched
    // straight back on here on the very next frame of the round-end grace.
    if (this.alive && this.lavaPatches.length && !this.celebratingVictory) startFiremageLavaLoop();
    else stopFiremageLavaLoop();
    this.updateShockwaves(dt);
    // Runs even once the mage is down, so tentacles killed alongside it still play out their
    // death fade instead of vanishing the instant it dies.
    this.updateTentacles(dt, opponent);

    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt;
    if (!this.alive) {
      this.updateFireballs(dt, opponent);
      return;
    }

    // Once the victory display begins it owns this character outright — it drives the staff's
    // cast animation, the aim, and the mage's position itself, stepped from drawVictoryOverlay
    // (see there for why it can't be stepped from here). Letting the combat logic below keep
    // running alongside it during the round-end grace meant BOTH decremented castTimer in the
    // same frame, so the victory throw played at double speed: the shell left the staff at 0.20s
    // instead of 0.32s, out of step with the launch whistle it is timed against.
    if (this.celebratingVictory) {
      this.updateFireballs(dt, opponent);
      return;
    }

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x, dy = opponent.y - this.y;
      if (Math.hypot(dx, dy) > 0.01) this.facingAngle = Math.atan2(dy, dx);
    }

    super.update(dt, opponent);
    this.updateFireballs(dt, opponent);

    // Cast animation runs to completion on its own once started — deliberately NOT gated on
    // stunTimer below, so getting hit mid-swing doesn't strand the staff frozen halfway out.
    if (this.castPhase) {
      this.castTimer -= dt;
      if (this.castTimer <= 0) {
        if (this.castPhase === "windup") {
          this.castPhase = "swing";
          this.castTimer = FIREMAGE_CAST_SWING;
        } else if (this.castPhase === "swing") {
          this.releaseFireball(opponent); // the shot leaves the staff at the peak of the swing
          this.castPhase = "recover";
          this.castTimer = FIREMAGE_CAST_RECOVER;
        } else {
          this.castPhase = null;
        }
      }
    }

    if (this.stunTimer > 0) return;

    if (this.fireballTimer > 0) this.fireballTimer -= dt;
    if (opponent && opponent.alive && this.fireballTimer <= 0 && this.canAttack && !this.castPhase) {
      this.fireballTimer += FIREMAGE_FIREBALL_COOLDOWN;
      this.castPhase = "windup";
      this.castTimer = FIREMAGE_CAST_WINDUP;
    }

    // Ultimate. The cooldown only resets on a cast that actually produced something, so with no
    // lava down it simply stays ready and erupts the moment the next patch lands, rather than
    // being silently burned on an empty field.
    if (this.eruptionTimer > 0) this.eruptionTimer -= dt;
    if (this.ultimateCooldown > 0) this.ultimateCooldown -= dt;
    if (this.ultimateCooldown <= 0 && this.canAttack && opponent && opponent.alive && this.lavaPatches.length) {
      if (this.summonTentacles() > 0) this.ultimateCooldown = FIREMAGE_ULTIMATE_COOLDOWN;
    }
  }

  // Ground-level burning patches — drawn under BOTH fighters (see Character.drawGroundEffects
  // and main.js's drawFrame), so whoever's standing in one visibly stands on top of it. Grows in
  // from nothing when it lands, holds, then fades out over its last stretch rather than just
  // popping out of existence.
  drawGroundEffects(ctx) {
    if (!this.lavaPatches.length) return;
    const t = performance.now() / 1000;

    // A patch that lands against a wall would otherwise paint straight over the arena border
    // (its radius is far bigger than the fireball's), so the whole layer is clipped to the
    // playable interior — pooling flat against the wall instead of spilling through it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      ARENA.x + ARENA_BORDER, ARENA.y + ARENA_BORDER,
      ARENA.w - ARENA_BORDER * 2, ARENA.h - ARENA_BORDER * 2
    );
    ctx.clip();

    for (const lp of this.lavaPatches) {
      const growT = Math.min(1, lp.age / FIREMAGE_LAVA_GROW_TIME);
      const fadeT = lp.fading ? Math.max(0, lp.fadeTimer / FIREMAGE_LAVA_FADE_TIME) : 1;
      const alpha = Math.min(growT, fadeT);
      if (alpha <= 0) continue;
      const scale = 0.6 + 0.4 * growT;
      const r = FIREMAGE_LAVA_RADIUS * scale;

      ctx.save();
      ctx.translate(lp.x, lp.y);
      ctx.globalAlpha = alpha;

      // 1) Heat the pool throws onto the floor around itself, so it lights its surroundings
      //    rather than sitting on the arena as a flat sticker.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const spill = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r * 1.5);
      spill.addColorStop(0, "rgba(255,110,20,0.32)");
      spill.addColorStop(0.55, "rgba(220,60,5,0.14)");
      spill.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = spill;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 2) The pool outline — irregular and slowly churning, built once here and reused as the
      //    clip for everything painted on the surface, so nothing can bleed past the edge.
      const poolPath = new Path2D();
      const pts = 18;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wob = 1
          + Math.sin(a * 3 + lp.seed) * 0.1
          + Math.sin(t * 1.3 + a * 5 + lp.seed) * 0.05
          + Math.sin(t * 0.7 - a * 2 + lp.seed * 1.7) * 0.04;
        const px = Math.cos(a) * r * wob, py = Math.sin(a) * r * wob;
        if (i === 0) poolPath.moveTo(px, py); else poolPath.lineTo(px, py);
      }
      poolPath.closePath();

      const grad = ctx.createRadialGradient(-r * 0.15, -r * 0.15, r * 0.06, 0, 0, r);
      grad.addColorStop(0, "#fff0a8");
      grad.addColorStop(0.28, "#ffb01c");
      grad.addColorStop(0.62, "#ef4f08");
      grad.addColorStop(1, "#8f2202");
      ctx.fillStyle = grad;
      ctx.fill(poolPath);

      ctx.save();
      ctx.clip(poolPath);

      // 3) Slabs of cooled crust drifting on the surface, each with a hot underside rim so the
      //    molten layer clearly reads as being UNDER them.
      for (const c of lp.crust) {
        const a = c.angle + Math.sin(t * 0.25 * c.drift + c.seed) * 0.35;
        const d = c.dist + Math.sin(t * 0.5 + c.seed) * 0.03;
        const cx = Math.cos(a) * r * d, cy = Math.sin(a) * r * d;
        const cr = r * c.size;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(c.rot + Math.sin(t * 0.3 + c.seed) * 0.2);
        // Hot rim peeking out from under the slab
        ctx.globalAlpha = alpha * 0.75;
        ctx.fillStyle = "#ffd66a";
        ctx.beginPath();
        ctx.ellipse(0, cr * 0.12, cr * 1.1, cr * c.squash * 1.15, 0, 0, Math.PI * 2);
        ctx.fill();
        // The slab itself
        ctx.globalAlpha = alpha;
        const crustGrad = ctx.createLinearGradient(0, -cr, 0, cr);
        crustGrad.addColorStop(0, "#5e2a12");
        crustGrad.addColorStop(1, "#251006");
        ctx.fillStyle = crustGrad;
        ctx.beginPath();
        const cpts = 9;
        for (let i = 0; i <= cpts; i++) {
          const ca = (i / cpts) * Math.PI * 2;
          const cw = 1 + Math.sin(ca * 3 + c.seed) * 0.16;
          const px = Math.cos(ca) * cr * cw, py = Math.sin(ca) * cr * c.squash * cw;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // 4) Bubbles welling up and bursting — each rises, swells, then pops and restarts
      ctx.globalCompositeOperation = "lighter";
      for (const b of lp.bubbles) {
        const cycle = ((t * b.speed + b.seed) % 1);
        const bx = Math.cos(b.angle) * r * b.dist;
        const by = Math.sin(b.angle) * r * b.dist - cycle * r * 0.12;
        // Swells for most of the cycle, then flashes bright and vanishes as it bursts
        const swell = cycle < 0.75 ? cycle / 0.75 : 1;
        const burst = cycle < 0.75 ? 0 : (cycle - 0.75) / 0.25;
        const br = r * b.size * (0.35 + 0.65 * swell) * (1 + burst * 1.3);
        ctx.globalAlpha = alpha * (burst > 0 ? (1 - burst) * 0.9 : 0.55 + swell * 0.35);
        ctx.fillStyle = burst > 0 ? "#fff4c8" : "#ffdd7a";
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = alpha;

      ctx.restore(); // end pool clip

      // NOTE: no outline is stroked around the pool. A dark crusted rim was tried here and read as
      //    a drawn-on border sitting on top of the floor rather than as molten rock; the pool's own
      //    fill already fades out at its edge, which is what makes it look like it belongs there.

      // 6) Embers lifting off the pool and dying out above it
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const cyc = ((t * (0.4 + i * 0.09) + lp.seed + i * 0.6) % 1);
        const ea = lp.seed + i * 2.3;
        const ex = Math.cos(ea) * r * 0.5 + Math.sin(t * 1.7 + i) * r * 0.1;
        const ey = Math.sin(ea) * r * 0.35 - cyc * r * 1.1;
        ctx.globalAlpha = alpha * Math.max(0, Math.sin(cyc * Math.PI)) * 0.8;
        ctx.fillStyle = cyc > 0.5 ? "#ff6a18" : "#ffcf6b";
        ctx.beginPath();
        ctx.arc(ex, ey, r * 0.055 * (1 - cyc * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.restore();
    }

    ctx.restore(); // end arena clip
  }

  // The launched ball. Big enough now (see FIREMAGE_FIREBALL_RADIUS) that a single flat blob
  // would look cheap, so it's built in layers: an outer glow, a churning flame silhouette whose
  // rim wobbles on several out-of-phase waves, a white-hot core, and a trail of shed embers
  // streaming out behind it.
  drawFireballsInFlight(ctx) {
    const t = performance.now() / 1000;
    const R = FIREMAGE_FIREBALL_RADIUS;
    for (const f of this.fireballs) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);

      // Outer heat glow
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.7);
      glow.addColorStop(0, "rgba(255,150,40,0.55)");
      glow.addColorStop(0.5, "rgba(255,90,10,0.22)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // A tapering wake of flame dragged out behind it, its two edges rippling on separate
      // waves so the trail writhes instead of being a clean cone
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const wake = R * 2.4;
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.82);
      for (let i = 1; i <= 8; i++) {
        const u = i / 8;
        const x = -wake * u;
        const y = -R * 0.82 * (1 - u) + Math.sin(t * 11 - u * 6 + f.seed) * R * 0.16 * u;
        ctx.lineTo(x, y);
      }
      for (let i = 8; i >= 1; i--) {
        const u = i / 8;
        const x = -wake * u;
        const y = R * 0.82 * (1 - u) + Math.sin(t * 11 - u * 6 + f.seed + 2.6) * R * 0.16 * u;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      const wakeGrad = ctx.createLinearGradient(0, 0, -wake, 0);
      wakeGrad.addColorStop(0, "rgba(255,190,70,0.5)");
      wakeGrad.addColorStop(0.4, "rgba(255,110,20,0.26)");
      wakeGrad.addColorStop(1, "rgba(180,40,0,0)");
      ctx.fillStyle = wakeGrad;
      ctx.fill();
      ctx.restore();

      // Trailing embers shed behind the ball
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 5; i++) {
        const p = ((t * 2.2 + f.seed + i * 0.37) % 1);
        const tx = -R * (0.7 + p * 1.9);
        const ty = Math.sin(t * 7 + i * 2.1 + f.seed) * R * 0.4 * p;
        ctx.globalAlpha = (1 - p) * 0.7;
        ctx.fillStyle = p > 0.5 ? "#ff6a18" : "#ffcf5c";
        ctx.beginPath();
        ctx.arc(tx, ty, R * 0.2 * (1 - p * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Churning flame body — a ring of points each riding its own wave, so the outline boils
      // rather than staying a clean circle
      ctx.beginPath();
      const pts = 20;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wob = 1
          + Math.sin(a * 3 + t * 9 + f.seed) * 0.11
          + Math.sin(a * 5 - t * 13 + f.seed * 1.7) * 0.07;
        // Stretched slightly along the direction of travel, squashed across it
        const rad = R * wob;
        const px = Math.cos(a) * rad * 1.1, py = Math.sin(a) * rad * 0.92;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const grad = ctx.createRadialGradient(R * 0.22, -R * 0.12, R * 0.06, 0, 0, R * 1.15);
      grad.addColorStop(0, "#fffbe0");
      grad.addColorStop(0.28, "#ffdc5c");
      grad.addColorStop(0.6, "#ff8a14");
      grad.addColorStop(1, "#c22e02");
      ctx.fillStyle = grad;
      ctx.fill();

      // Internal churn — blobs orbiting inside the ball at different radii and speeds, some
      // hot, some dark soot. Clipped to the flame body so they roll around inside it rather
      // than sticking out, which is what makes the fire look like it's turning over on itself
      // instead of being one static gradient.
      ctx.save();
      ctx.clip();
      for (let i = 0; i < 6; i++) {
        const orbit = 0.2 + (i % 3) * 0.22;
        const spin = t * (1.6 + (i % 3) * 0.9) * (i % 2 ? -1 : 1) + f.seed + i * 1.4;
        const bx = Math.cos(spin) * R * orbit;
        const by = Math.sin(spin) * R * orbit * 0.85;
        const br = R * (0.16 + (i % 2) * 0.1);
        const dark = i % 3 === 2;
        ctx.globalCompositeOperation = dark ? "source-over" : "lighter";
        ctx.globalAlpha = dark ? 0.28 : 0.4;
        ctx.fillStyle = dark ? "#8a2f04" : "#ffd873";
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Flame licking off the leading edge. Deliberately broad-based and short rather than long
      // and narrow — thin ones read as spikes stuck to a ball, not as fire — and drawn with a
      // gradient that dissolves toward the tip so they blend into the air instead of ending on a
      // hard point.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const base = -0.8 + i * 0.53; // fanned across the front
        const a = base + Math.sin(t * 6 + i * 1.9 + f.seed) * 0.2;
        const len = R * (0.26 + Math.abs(Math.sin(t * 7.5 + i * 2.3 + f.seed)) * 0.3);
        const tipX = Math.cos(a) * (R + len), tipY = Math.sin(a) * (R + len);
        const lick = ctx.createRadialGradient(
          Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7, R * 0.05,
          tipX, tipY, R * 0.85
        );
        lick.addColorStop(0, "rgba(255,214,120,0.5)");
        lick.addColorStop(1, "rgba(255,140,30,0)");
        ctx.fillStyle = lick;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.46) * R * 0.86, Math.sin(a - 0.46) * R * 0.86);
        ctx.quadraticCurveTo(tipX, tipY, Math.cos(a + 0.46) * R * 0.86, Math.sin(a + 0.46) * R * 0.86);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // White-hot core
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.65 + Math.sin(t * 14 + f.seed) * 0.2;
      const core = ctx.createRadialGradient(R * 0.18, -R * 0.1, 0, R * 0.18, -R * 0.1, R * 0.55);
      core.addColorStop(0, "#ffffff");
      core.addColorStop(0.5, "rgba(255,214,120,0.5)");
      core.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(R * 0.18, -R * 0.1, R * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();
    }
  }

  // The staff. Its whole motion comes off castSwingAmount: at rest (0) it's held upright at the
  // mage's side, at the peak of a cast (1) it's thrust out pointing straight along facingAngle,
  // and a small negative value winds it back the other way first. Interpolating the ROTATION
  // between those two poses (rather than, say, sliding it around) is what gives the swing its
  // arc. Drawn after the body so it passes in front while swinging across.
  // World position of the staff's burning gem, mirroring the exact transform drawStaff renders
  // under (translate to the body, scale by `breathe`, offset to the grip, rotate to `rot`, then
  // r*1.57 up the shaft to the gem). Kept in step with drawStaff by hand — if the staff geometry
  // there moves, this has to move with it. Used by the victory display so thrown fireworks
  // genuinely leave the staff head rather than merely appearing near it.
  staffTipPosition() {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const breathe = 1 + Math.sin(t * 1.4 + this.bodySeed) * 0.02;
    const swing = this.castSwingAmount;
    const side = Math.cos(this.facingAngle) >= 0 ? 1 : -1;

    const restRot = -Math.PI / 2 + side * 0.18;
    let delta = this.facingAngle - restRot;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const rot = restRot + delta * swing;

    const gripX = side * r * 0.5 + Math.cos(this.facingAngle) * r * 0.35 * Math.max(0, swing);
    const gripY = r * 0.2 + Math.sin(this.facingAngle) * r * 0.35 * Math.max(0, swing)
      + Math.sin(t * 1.7 + this.bodySeed) * r * 0.04;

    const gemDist = r * 1.57; // -topY (1.35) + the gem's 0.22 clearance above the prongs
    return {
      x: this.x + breathe * (gripX + Math.cos(rot) * gemDist),
      y: this.y + breathe * (gripY + Math.sin(rot) * gemDist),
    };
  }

  drawStaff(ctx, r, t) {
    const swing = this.castSwingAmount;
    const flash = this.castFlash;
    const side = Math.cos(this.facingAngle) >= 0 ? 1 : -1;

    // Rest pose: near-vertical, leaning slightly toward the target. Aim pose: straight along
    // facingAngle. The difference is normalised into [-PI, PI] so the blend always takes the
    // short way round instead of occasionally whipping the long way about.
    const restRot = -Math.PI / 2 + side * 0.18;
    let delta = this.facingAngle - restRot;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const rot = restRot + delta * swing;

    // The grip sits at the mage's side and pushes a little way toward the target through the
    // swing, so the thrust reads as coming from the body rather than the staff merely spinning.
    const gripX = side * r * 0.5 + Math.cos(this.facingAngle) * r * 0.35 * Math.max(0, swing);
    const gripY = r * 0.2 + Math.sin(this.facingAngle) * r * 0.35 * Math.max(0, swing)
      + Math.sin(t * 1.7 + this.bodySeed) * r * 0.04;

    ctx.save();
    ctx.translate(gripX, gripY);
    ctx.rotate(rot + Math.PI / 2); // +90° so the shaft's local -Y (its length) lies along `rot`

    const topY = -r * 1.35;
    const botY = r * 0.5;

    // Shaft — tapered, with a lit edge down one side so it reads as a round pole not a flat stick
    const shaftW = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(-shaftW * 0.75, topY);
    ctx.lineTo(shaftW * 0.75, topY);
    ctx.lineTo(shaftW, botY);
    ctx.lineTo(-shaftW, botY);
    ctx.closePath();
    const shaftGrad = ctx.createLinearGradient(-shaftW, 0, shaftW, 0);
    shaftGrad.addColorStop(0, "#2a1810");
    shaftGrad.addColorStop(0.38, "#8a552f");
    shaftGrad.addColorStop(0.62, "#5e361c");
    shaftGrad.addColorStop(1, "#20120a");
    ctx.fillStyle = shaftGrad;
    ctx.fill();

    // Metal bindings
    for (const by of [topY + r * 0.26, botY - r * 0.2]) {
      const bandW = shaftW * 1.5;
      const bandGrad = ctx.createLinearGradient(-bandW, 0, bandW, 0);
      bandGrad.addColorStop(0, "#3a3128");
      bandGrad.addColorStop(0.4, "#b9a578");
      bandGrad.addColorStop(1, "#2a231c");
      ctx.fillStyle = bandGrad;
      ctx.fillRect(-bandW, by, bandW * 2, r * 0.1);
    }

    // Prongs cradling the gem
    ctx.strokeStyle = "#5c4830";
    ctx.lineWidth = r * 0.062;
    ctx.lineCap = "round";
    for (const px of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px * shaftW * 0.7, topY + r * 0.05);
      ctx.quadraticCurveTo(px * r * 0.3, topY - r * 0.04, px * r * 0.17, topY - r * 0.3);
      ctx.stroke();
    }

    // Burning gem at the head — flickers constantly, flares hard at the moment of release
    const gemR = r * 0.24 * (1 + Math.sin(t * 9 + this.bodySeed) * 0.06 + flash * 0.4);
    const gemY = topY - r * 0.22;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const haloR = gemR * (3.0 + flash * 2.6);
    const halo = ctx.createRadialGradient(0, gemY, 0, 0, gemY, haloR);
    halo.addColorStop(0, `rgba(255,196,100,${(0.55 + flash * 0.4).toFixed(3)})`);
    halo.addColorStop(0.45, `rgba(255,110,20,${(0.2 + flash * 0.3).toFixed(3)})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, gemY, haloR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const gemGrad = ctx.createRadialGradient(-gemR * 0.3, gemY - gemR * 0.3, gemR * 0.08, 0, gemY, gemR);
    gemGrad.addColorStop(0, "#fffbe8");
    gemGrad.addColorStop(0.35, "#ffc247");
    gemGrad.addColorStop(0.7, "#f2600c");
    gemGrad.addColorStop(1, "#8a1f02");
    ctx.fillStyle = gemGrad;
    ctx.beginPath();
    ctx.arc(0, gemY, gemR, 0, Math.PI * 2);
    ctx.fill();

    // The gathering shot, growing at the gem across the whole cooldown up to the exact size it
    // will launch at. Ramped rather than linear so it spends a while as a small ember and then
    // visibly balloons over the last stretch — that acceleration is what reads as "charging"
    // instead of just "a circle slowly scaling". Drawn in the staff's local frame, so it swings
    // along with the head.
    const charge = this.chargeRatio;
    if (charge > 0.02) {
      const ramp = 0.1 + 0.9 * Math.pow(charge, 1.5);
      const ballR = FIREMAGE_FIREBALL_RADIUS * ramp;
      // Only really shakes once it's nearly full — an almost-ready shot straining to be let go
      const strain = Math.pow(charge, 4);
      const jitterX = Math.sin(t * 34 + this.bodySeed) * ballR * 0.05 * strain;
      const jitterY = Math.cos(t * 41 + this.bodySeed) * ballR * 0.05 * strain;
      const cx = jitterX, cy = gemY - ballR * 0.35 + jitterY;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const cGlow = ctx.createRadialGradient(cx, cy, ballR * 0.1, cx, cy, ballR * 1.8);
      cGlow.addColorStop(0, `rgba(255,170,60,${(0.35 + 0.3 * charge).toFixed(3)})`);
      cGlow.addColorStop(0.5, `rgba(255,90,10,${(0.12 + 0.15 * charge).toFixed(3)})`);
      cGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, ballR * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      const pts = 18;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const wob = 1
          + Math.sin(a * 3 + t * 8 + this.bodySeed) * 0.1
          + Math.sin(a * 5 - t * 11) * 0.06;
        const px = cx + Math.cos(a) * ballR * wob, py = cy + Math.sin(a) * ballR * wob;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const cGrad = ctx.createRadialGradient(cx + ballR * 0.2, cy - ballR * 0.2, ballR * 0.05, cx, cy, ballR * 1.1);
      cGrad.addColorStop(0, "#fffbe0");
      cGrad.addColorStop(0.3, "#ffd85a");
      cGrad.addColorStop(0.62, "#ff8614");
      cGrad.addColorStop(1, "#bd2c02");
      ctx.fillStyle = cGrad;
      ctx.globalAlpha = 0.55 + 0.45 * charge; // faint while it's still gathering, solid once full
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // A round hooded caster: the circular body IS the robe, with a peaked hood over the top, a
  // shadowed face cavity holding two ember eyes, a shoulder mantle, a gold clasp and a band of
  // glowing runes around the hem. The circle keeps it consistent with the rest of the cast while
  // the hood/eyes/mantle are what make it read as a person rather than a ball, and the whole
  // palette (ember gradient, glowing runes, drifting sparks) carries the fire element.
  drawBody(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const breathe = 1 + Math.sin(t * 1.4 + this.bodySeed) * 0.02;
    const flash = this.castFlash;
    const side = Math.cos(this.facingAngle) >= 0 ? 1 : -1; // which way it's facing; the hood tip trails the opposite way

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

    // Robe — the body circle. Lit from the upper left, deepening to near-black at the hem.
    const robeGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.06, 0, 0, r);
    robeGrad.addColorStop(0, "#f5813f");
    robeGrad.addColorStop(0.45, "#c4501f");
    robeGrad.addColorStop(0.8, "#832d0f");
    robeGrad.addColorStop(1, "#521806");
    ctx.fillStyle = robeGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Everything painted onto the robe is clipped to it, so no detail spills past the silhouette
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.995, 0, Math.PI * 2);
    ctx.clip();

    // Robe folds — a few soft vertical creases fanning out from under the mantle
    ctx.strokeStyle = "rgba(70,20,5,0.3)";
    ctx.lineCap = "round";
    for (let i = -2; i <= 2; i++) {
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.moveTo(i * r * 0.24, r * 0.18);
      ctx.quadraticCurveTo(i * r * 0.3, r * 0.6, i * r * 0.36, r * 1.05);
      ctx.stroke();
    }

    // Hem band with glowing runes — the "professional mage" trim
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(64,20,6,0.55)";
    ctx.lineWidth = r * 0.19;
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.16 + (i / 6) * Math.PI * 0.68; // spread across the lower arc only
      const pulse = 0.45 + Math.sin(t * 2.4 + i * 1.1 + this.bodySeed) * 0.35 + flash * 0.4;
      ctx.globalAlpha = Math.max(0, Math.min(1, pulse));
      ctx.fillStyle = "#ffb23c";
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.035, r * 0.075, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Shoulder mantle draped over the upper body
    ctx.beginPath();
    ctx.moveTo(-r * 0.99, -r * 0.05);
    ctx.quadraticCurveTo(-r * 0.6, r * 0.42, 0, r * 0.36);
    ctx.quadraticCurveTo(r * 0.6, r * 0.42, r * 0.99, -r * 0.05);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.52, 0, -r * 0.5);
    ctx.quadraticCurveTo(-r * 0.5, -r * 0.52, -r * 0.99, -r * 0.05);
    ctx.closePath();
    const mantleGrad = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.4);
    mantleGrad.addColorStop(0, "#d15f2b");
    mantleGrad.addColorStop(1, "#7d290e99");
    ctx.fillStyle = mantleGrad;
    ctx.fill();

    ctx.restore(); // end robe clip

    // Hood — a proper pointed wizard's cowl rather than a dome, its tip drawn up and tilted back
    // away from whichever way the mage is facing. Kept under ~1.25r tall so the peak still clears
    // the floating HP bar that sits at size/2 + 22 above the character.
    const back = -side * r * 0.3; // tip trails behind the facing direction
    ctx.beginPath();
    ctx.moveTo(-r * 0.74, -r * 0.18);
    ctx.quadraticCurveTo(-r * 0.86, -r * 0.82, back - r * 0.12, -r * 1.03);
    ctx.quadraticCurveTo(back + r * 0.02, -r * 1.28, back + r * 0.2, -r * 1.24); // the tip itself
    ctx.quadraticCurveTo(r * 0.3, -r * 1.0, r * 0.68, -r * 0.66);
    ctx.quadraticCurveTo(r * 0.84, -r * 0.42, r * 0.74, -r * 0.18);
    ctx.quadraticCurveTo(0, -r * 0.02, -r * 0.74, -r * 0.18);
    ctx.closePath();
    const hoodGrad = ctx.createLinearGradient(-r * 0.5, -r * 1.1, r * 0.5, -r * 0.1);
    hoodGrad.addColorStop(0, "#ef7233");
    hoodGrad.addColorStop(0.55, "#a83e1c");
    hoodGrad.addColorStop(1, "#54190a");
    ctx.fillStyle = hoodGrad;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Face cavity — deep shadow under the hood, narrower than the hood itself so a clear rim of
    // cowl reads all the way around the opening
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.44, r * 0.42, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#100309";
    ctx.fill();

    // Ember eyes — the single strongest "this is a person" cue on the whole design
    const eyePulse = 0.75 + Math.sin(t * 3.1 + this.bodySeed) * 0.25 + flash * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.max(0, Math.min(1, eyePulse));
    for (const ex of [-r * 0.19, r * 0.19]) {
      const eyeGlow = ctx.createRadialGradient(ex, -r * 0.44, 0, ex, -r * 0.44, r * 0.2);
      eyeGlow.addColorStop(0, "#fff0c0");
      eyeGlow.addColorStop(0.35, "#ffa023");
      eyeGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = eyeGlow;
      ctx.beginPath();
      ctx.arc(ex, -r * 0.44, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff6dc";
      ctx.beginPath();
      ctx.ellipse(ex, -r * 0.44, r * 0.055, r * 0.085, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Gold clasp holding the mantle at the throat
    const claspY = -r * 0.03;
    const claspGrad = ctx.createLinearGradient(0, claspY - r * 0.1, 0, claspY + r * 0.1);
    claspGrad.addColorStop(0, "#ffdf9a");
    claspGrad.addColorStop(1, "#8a6216");
    ctx.fillStyle = claspGrad;
    ctx.beginPath();
    ctx.ellipse(0, claspY, r * 0.13, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5 + Math.sin(t * 2.8) * 0.2;
    ctx.fillStyle = "#ff8c2a";
    ctx.beginPath();
    ctx.arc(0, claspY, r * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Outline, tying the hood and robe together as one silhouette
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Embers drifting up off the robe, looping back down as they fade
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const e of this.embers) {
      const cycle = ((t * e.speed + e.seed) % 2) / 2; // 0..1
      const ex = Math.cos(e.angle) * r * e.dist + Math.sin(t * 2 + e.seed) * r * 0.1;
      const ey = r * 0.6 - cycle * r * 2.0;
      ctx.globalAlpha = Math.max(0, Math.sin(cycle * Math.PI)) * 0.8;
      ctx.fillStyle = cycle > 0.55 ? "#ff7a20" : "#ffcf6b";
      ctx.beginPath();
      ctx.arc(ex, ey, r * e.size * (1 - cycle * 0.45), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    this.drawStaff(ctx, r, t);

    ctx.restore();
  }

  // The blast ring. Three rings rather than one — a hard bright leading edge, a thicker warm
  // body lagging just behind it, and a wide faint outer halo running ahead — because a single
  // expanding circle reads as a cartoon ripple, whereas the offset speeds read as an actual
  // pressure front. The radius is wobbled per-angle so it stays fire rather than a clean shape,
  // and everything is additive so it blows out over whatever it crosses.
  drawShockwaves(ctx) {
    if (!this.shockwaves.length) return;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const sw of this.shockwaves) {
      const p = 1 - sw.timer / FIREMAGE_SHOCKWAVE_TIME; // 0 -> 1 over its life
      const fade = 1 - p;

      const rings = [
        { r: FIREMAGE_EXPLOSION_RADIUS * 1.15 * Math.pow(p, 0.55), w: 3.5, a: 0.9, c: "255,244,200" },
        { r: FIREMAGE_EXPLOSION_RADIUS * 1.00 * Math.pow(p, 0.65), w: 11,  a: 0.45, c: "255,150,40" },
        { r: FIREMAGE_EXPLOSION_RADIUS * 1.32 * Math.pow(p, 0.45), w: 2,   a: 0.3, c: "255,110,20" },
      ];

      for (const ring of rings) {
        if (ring.r < 2) continue;
        ctx.strokeStyle = `rgba(${ring.c},${(ring.a * fade * fade).toFixed(3)})`;
        ctx.lineWidth = ring.w * fade;
        ctx.beginPath();
        const pts = 26;
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const wob = 1 + Math.sin(a * 4 + sw.seed) * 0.055 + Math.sin(a * 7 - sw.seed * 1.6) * 0.03;
          const px = sw.x + Math.cos(a) * ring.r * wob;
          const py = sw.y + Math.sin(a) * ring.r * wob;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // A hot core flash that collapses as the rings run out, so the very centre of the blast
      // isn't left empty while the rings travel
      if (p < 0.55) {
        const coreFade = 1 - p / 0.55;
        const coreR = FIREMAGE_EXPLOSION_RADIUS * 0.5 * coreFade;
        const core = ctx.createRadialGradient(sw.x, sw.y, 0, sw.x, sw.y, Math.max(1, coreR));
        core.addColorStop(0, `rgba(255,252,235,${(0.75 * coreFade).toFixed(3)})`);
        core.addColorStop(0.45, `rgba(255,170,50,${(0.4 * coreFade).toFixed(3)})`);
        core.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, Math.max(1, coreR), 0, Math.PI * 2);
        ctx.fill();
      }

      // Streaks flung outward along the front, giving the ring some direction rather than
      // leaving it a bare outline
      ctx.lineCap = "round";
      for (let i = 0; i < 10; i++) {
        const a = sw.seed + i * (Math.PI * 2 / 10);
        const inner = FIREMAGE_EXPLOSION_RADIUS * 0.95 * Math.pow(p, 0.65);
        const outer = inner + FIREMAGE_EXPLOSION_RADIUS * 0.22 * fade;
        ctx.strokeStyle = `rgba(255,200,110,${(0.5 * fade * fade).toFixed(3)})`;
        ctx.lineWidth = 3 * fade;
        ctx.beginPath();
        ctx.moveTo(sw.x + Math.cos(a) * inner, sw.y + Math.sin(a) * inner);
        ctx.lineTo(sw.x + Math.cos(a) * outer, sw.y + Math.sin(a) * outer);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- victory fireworks
  // Fired once by main.js the instant Fire Mage is declared the winner.
  onVictory() {
    this.celebratingVictory = true;
    this.fireworksTimer = 0;
    this.throwStarted = false;
    this.mainShell = null;
    this.shells = [];
    this.sparks = [];
    this.blooms = [];
    // The display drives the cast animation itself from here on, so start it from a clean rest pose
    this.castPhase = null;
    this.castTimer = 0;
    this.lastFireworkTickMs = performance.now();
    // The lava ambience has no business droning under a victory display
    stopFiremageLavaLoop();
    playSfx("firemageFireworks", 0.75);
  }

  // The one shot the whole display hangs off, released at the peak of the staff swing.
  //
  // Its velocity is SOLVED, not chosen. The mage can be standing anywhere in the arena when it
  // wins, and the release lands wherever the drift to centre stage has got to by then — but the
  // detonation has to hit 1.75s on the sound regardless. Inverting the ballistic equation for the
  // exact remaining flight time is what makes the sync hold no matter where it was thrown from.
  launchMainShell() {
    const tip = this.staffTipPosition();
    const T = Math.max(0.2, FIREMAGE_FIREWORKS_BURST_AT - this.fireworksTimer);
    const g = FIREMAGE_FIREWORKS_GRAVITY;
    // y(T) = y0 + vy*T + g*T^2/2, solved for the vy that puts y(T) exactly at the burst height
    const burstY = ARENA.y - FIREMAGE_FIREWORKS_BURST_ABOVE_ARENA;
    const vy = (burstY - tip.y - (g * T * T) / 2) / T;
    // Drifts slightly off the arena's centre line on the way up, so it isn't a dead-straight column
    const targetX = ARENA.x + ARENA.w / 2 + (Math.random() - 0.5) * ARENA.w * 0.22;
    this.mainShell = {
      x: tip.x, y: tip.y,
      vx: (targetX - tip.x) / T,
      vy,
      radius: 13,
      trailTimer: 0,
    };
    this.blooms.push({ x: tip.x, y: tip.y, life: 0.24, maxLife: 0.24, color: "#ffcf40", radius: 52 });
    playSfx("firemageThrow", 0.5);
  }

  // The big one breaking open. Beyond its own sphere of sparks it throws out one sub-shell per
  // scripted crack in the audio, so every later bang has something visible causing it rather than
  // colour simply appearing out of nowhere.
  burstMainShell() {
    const { x, y } = this.mainShell;
    const gold = FIREMAGE_FIREWORK_COLORS[0];
    this.spawnBurst(x, y, gold, "peony", 2.7);
    this.spawnBurst(x, y, FIREMAGE_FIREWORK_COLORS[4], "ring", 2.2); // a leading edge racing ahead of the sphere
    // Short life on purpose: a detonation flash is a blink. Held any longer than this it stops
    // reading as light and starts reading as a white blob parked over the sparks.
    this.blooms.push({ x, y, life: 0.2, maxLife: 0.2, color: "#fff6d0", radius: 210 });

    for (const [burstAt, scale] of FIREMAGE_FIREWORKS_BREAKS) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 90;
      const styleRoll = Math.random();
      this.shells.push({
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 40, // biased upward so they hang rather than dropping straight out
        burstAt,
        scale,
        radius: 3.5 + scale * 3,
        palette: FIREMAGE_FIREWORK_COLORS[(Math.random() * FIREMAGE_FIREWORK_COLORS.length) | 0],
        style: styleRoll < 0.5 ? "peony" : styleRoll < 0.78 ? "ring" : "willow",
        trailTimer: 0,
      });
    }
  }

  // Styles differ in how the burst is distributed, which is what stops the secondaries from
  // looking like the same pop over and over: a peony throws an even sphere, a ring throws a flat
  // expanding circle, a willow throws fewer/slower sparks that hang and droop.
  spawnBurst(x, y, palette, style, scale) {
    const count = Math.round((style === "willow" ? 34 : style === "ring" ? 46 : 62) * scale);
    for (let i = 0; i < count; i++) {
      let ang, speed;
      if (style === "ring") {
        // Evenly spaced on a circle, with only a little speed scatter, so it reads as one ring
        ang = (i / count) * Math.PI * 2 + Math.random() * 0.05;
        speed = (150 + Math.random() * 22) * scale;
      } else {
        ang = Math.random() * Math.PI * 2;
        // sqrt keeps the sphere's interior from looking hollow
        speed = ((style === "willow" ? 60 : 95)
          + Math.sqrt(Math.random()) * (style === "willow" ? 70 : 135)) * scale;
      }
      const life = (style === "willow" ? 1.5 + Math.random() * 0.8 : 0.85 + Math.random() * 0.7)
        * (0.75 + scale * 0.35);
      this.sparks.push({
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life,
        maxLife: life,
        color: palette[(Math.random() * palette.length) | 0],
        size: (1.4 + Math.random() * 1.6) * (0.8 + scale * 0.3),
        twinkle: Math.random() * Math.PI * 2,
        drag: style === "willow" ? 0.985 : 0.965,
        px: x, py: y, // previous position, so each spark can be drawn as a short streak
      });
    }
    // Deliberately NOT spawnFlash: that renders a hard expanding ring outline (it's built for
    // impact shockwaves) and reads as a grey circle stamped on the screen. A firework burst wants
    // a soft bloom that dies immediately instead.
    this.blooms.push({
      x, y, life: 0.26 * (0.8 + scale * 0.3), maxLife: 0.26 * (0.8 + scale * 0.3),
      color: palette[0], radius: 46 * scale,
    });
  }

  updateFireworks(dt) {
    this.fireworksTimer += dt;

    // Ease to centre stage as the display opens. A mage that won pressed against the top wall has
    // no headroom to throw into and would set the whole show off in its own face; settling it
    // somewhere sensible first also just poses better than freezing wherever the last hit landed.
    // This runs after update() in the frame (see drawVictoryOverlay), so it wins over any drift
    // update() is still applying during the round's grace period.
    const ease = 1 - Math.pow(0.06, dt); // frame-rate independent: ~94% of the way there per second
    this.x += (ARENA.x + ARENA.w / 2 - this.x) * ease;
    this.y += (ARENA.y + ARENA.h * 0.72 - this.y) * ease;
    this.vx = 0;
    this.vy = 0;

    // One throw, at the very start, so the staff whips over while the launch whistle is swelling
    // and the shell leaves the gem (0.32s in) right as that whistle peaks.
    if (!this.throwStarted) {
      this.throwStarted = true;
      this.facingAngle = -Math.PI / 2 + (Math.random() - 0.5) * 0.16; // essentially straight up
      this.castPhase = "windup";
      this.castTimer = FIREMAGE_CAST_WINDUP;
    }

    // update() has stopped running by the time most of this plays (see drawVictoryOverlay), so the
    // cast state machine the staff pose is drawn from has to be stepped here rather than there.
    if (this.castPhase) {
      this.castTimer -= dt;
      if (this.castTimer <= 0) {
        if (this.castPhase === "windup") {
          this.castPhase = "swing";
          this.castTimer = FIREMAGE_CAST_SWING;
        } else if (this.castPhase === "swing") {
          this.launchMainShell();
          this.castPhase = "recover";
          this.castTimer = FIREMAGE_CAST_RECOVER;
        } else {
          this.castPhase = null;
        }
      }
    }

    // The big shell climbing the screen, trailing hard the whole way up
    if (this.mainShell) {
      const s = this.mainShell;
      s.vy += FIREMAGE_FIREWORKS_GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.trailTimer -= dt;
      if (s.trailTimer <= 0) {
        s.trailTimer = 0.012;
        for (let k = 0; k < 2; k++) {
          this.sparks.push({
            x: s.x, y: s.y, px: s.x, py: s.y,
            vx: (Math.random() - 0.5) * 46, vy: 26 + Math.random() * 44,
            life: 0.42, maxLife: 0.42,
            color: k ? "#ffcf40" : "#fff0b0", size: 2.0, twinkle: 0, drag: 0.9,
          });
        }
      }
      // Detonates on the clock, not on its own trajectory — the sound is the authority here
      if (this.fireworksTimer >= FIREMAGE_FIREWORKS_BURST_AT) {
        this.burstMainShell();
        this.mainShell = null;
      }
    }

    // Sub-shells thrown out by the big burst, each popping on its own scripted beat
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.vy += FIREMAGE_FIREWORKS_GRAVITY * 0.5 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      // Kept on screen: a sub-shell that wanders off the edge would pop where nobody can see it,
      // leaving an audible crack with nothing to show for it
      if (s.x < 30 || s.x > WIDTH - 30) { s.x = Math.max(30, Math.min(WIDTH - 30, s.x)); s.vx *= -0.4; }
      if (s.y < 30) { s.y = 30; s.vy = Math.abs(s.vy) * 0.4; }
      s.trailTimer -= dt;
      if (s.trailTimer <= 0) {
        s.trailTimer = 0.03;
        this.sparks.push({
          x: s.x, y: s.y, px: s.x, py: s.y,
          vx: (Math.random() - 0.5) * 20, vy: 14 + Math.random() * 20,
          life: 0.28, maxLife: 0.28,
          color: s.palette[0], size: s.radius * 0.3, twinkle: 0, drag: 0.9,
        });
      }
      if (this.fireworksTimer >= s.burstAt) {
        this.spawnBurst(s.x, s.y, s.palette, s.style, s.scale);
        this.shells.splice(i, 1);
      }
    }

    for (let i = this.blooms.length - 1; i >= 0; i--) {
      this.blooms[i].life -= dt;
      if (this.blooms[i].life <= 0) this.blooms.splice(i, 1);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.px = p.x; p.py = p.y;
      p.vy += FIREMAGE_FIREWORKS_GRAVITY * 0.55 * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.sparks.splice(i, 1);
    }
  }

  // main.js draws this every frame while celebratingVictory is set, layered over the scene but
  // under the keep/discard prompt.
  //
  // The simulation is advanced from HERE rather than from update(), because main.js stops calling
  // update() the moment roundState becomes "prompting" — which happens at ROUND_END_GRACE (3s),
  // only halfway through this 6s display. Driven off update() the fireworks would simply freeze
  // in mid-air while their own sound carried on playing to the end.
  drawVictoryOverlay(ctx) {
    const nowMs = performance.now();
    const dtMs = nowMs - this.lastFireworkTickMs;
    // While recording, main.js runs the whole draw twice per frame (display canvas, then the
    // higher-res capture canvas). Both land in the same millisecond, so this keeps the second
    // pass from advancing the simulation a second time.
    if (dtMs >= 1) {
      this.lastFireworkTickMs = nowMs;
      this.updateFireworks(Math.min(0.05, dtMs / 1000));
    }

    ctx.save();
    // Deliberately NOT clipped to the arena: the shot goes up the whole SCREEN, clearing the arena
    // and bursting near the top of the frame. Everything here draws with "lighter", which only
    // ever adds light — the title and HP bars underneath get lit by the display rather than hidden
    // behind it, which is why painting over them is fine.
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    // Burst blooms — a brief soft flare at each detonation point
    for (const b of this.blooms) {
      const f = Math.max(0, b.life / b.maxLife);
      const r = b.radius * (1.15 - f * 0.5);
      ctx.globalAlpha = f * f * 0.85;
      const bg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      bg.addColorStop(0, "#ffffff");
      bg.addColorStop(0.3, b.color);
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // The sub-shells drifting between breaks, then the big one. Both are drawn as the mage's own
    // fireball — white-hot core into an orange body — with a tail streaming out behind.
    const drawShell = (s, outer, coreScale) => {
      const sr = s.radius;
      const dir = Math.atan2(s.vy, s.vx);
      const tailLen = sr * (6 + coreScale * 3);
      const tailX = s.x - Math.cos(dir) * tailLen;
      const tailY = s.y - Math.sin(dir) * tailLen;
      const tg = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
      tg.addColorStop(0, outer);
      tg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = tg;
      ctx.lineWidth = sr * 1.3;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();

      const R = sr * 2.4 * coreScale;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.24, "#ffe6a0");
      g.addColorStop(0.5, "#ff7a1a");
      g.addColorStop(0.78, outer);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, R, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const s of this.shells) drawShell(s, s.palette[1], 1);
    // The main shell gets a wide halo on top, so a single object climbing the screen still carries
    // the display on its own for the first 1.75 seconds
    if (this.mainShell) {
      const s = this.mainShell;
      const haloR = s.radius * 6.5;
      const hg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
      hg.addColorStop(0, "rgba(255,214,130,0.55)");
      hg.addColorStop(0.4, "rgba(255,122,26,0.20)");
      hg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(s.x, s.y, haloR, 0, Math.PI * 2);
      ctx.fill();
      drawShell(s, "#ffc247", 1.25);
    }

    // Sparks as short motion streaks rather than dots — a falling ember reads as a streak, and
    // it also hides the frame stepping at these speeds
    for (const p of this.sparks) {
      const f = Math.max(0, p.life / p.maxLife);
      // Twinkle only once they're on the way out, which is when real fireworks crackle
      const tw = f < 0.55 ? 0.55 + 0.45 * Math.sin(nowMs / 1000 * 34 + p.twinkle) : 1;
      ctx.globalAlpha = Math.min(1, f * 1.5) * tw;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * (0.4 + f * 0.6);
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  draw(ctx) {
    // main.js only draws the two fighters themselves, never their extra bodies (same as the
    // Ninja drawing its own clones), so the tentacles are drawn here. Before the mage's own
    // body, so it stands in front of anything rooted behind it.
    for (const tn of this.tentacles) tn.draw(ctx);
    this.drawShockwaves(ctx);
    this.drawFireballsInFlight(ctx);
    if (!this.alive && this.deathFadeTimer <= 0) return;
    super.draw(ctx);
  }

  // No drawHud override: the HUD is deliberately just name + HP bar + ultimate bar for every
  // character. The ability/cooldown readouts that used to sit under it are gone.
}
