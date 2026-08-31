// The Angel — two characters wearing one slot.
//
// The design problem this is built around: an angel's classic kit (heal, shield, sustain) is
// continuous and defensive, and continuous defence is invisible in an autonomous fight. Nobody is
// playing, so nobody feels the relief of being saved — a viewer just sees a bar fall slightly
// slower. Every memorable character in this roster instead owns a discrete, loud, irreversible
// EVENT: the Troll's rampage, the Demon filling the screen, the sun coming down.
//
// So the Angel's power is an event, and it is the most dramatic one this game's structure allows.
// The whole game is "first one to die loses". The Angel does not die the first time.
//
// White form  — ranged, evasive, takes off periodically and cannot be targeted while airborne.
// Fallen form — at 0 HP it drops, the halo physically shatters onto the floor, and it stands back
//               up with black wings: no flight, no second resurrection, but far more dangerous.
//
// The two halves deliberately play OPPOSITE ways, so this is not a recolour. White survives by not
// being where you are aiming; Fallen has no escape left and simply hits harder and faster than
// anything it is standing next to.

// ---------------------------------------------------------------- palette
const ANGEL_ROBE_LIGHT  = "#ffffff";
const ANGEL_ROBE_MID    = "#e8eef8";
const ANGEL_ROBE_SHADE  = "#b9c6dc";
const ANGEL_ROBE_HEM    = "#8a9ab5";
const ANGEL_GOLD        = "#ffd968";
const ANGEL_GOLD_DEEP   = "#c99b28";
const ANGEL_WING        = "#ffffff";
const ANGEL_WING_SHADE  = "#ccd7e8";
const ANGEL_LIGHT       = ["#ffffff", "#ffe9a8", "#ffd968", "#cfe4ff"];

const FALLEN_ROBE_LIGHT = "#6a5f74";
const FALLEN_ROBE_MID   = "#413a4c";
const FALLEN_ROBE_SHADE = "#2a2432";
const FALLEN_ROBE_HEM   = "#17131d";
const FALLEN_EMBER      = "#ff4a3d";
const FALLEN_EMBER_DEEP = "#8f1d16";
const FALLEN_WING       = "#241f2c";
const FALLEN_WING_SHADE = "#100d15";
const FALLEN_LIGHT      = ["#ff4a3d", "#ff8a5c", "#5a4660", "#241f2c"];

// The judgement — the orbs and the blade they become — is ONE colour in five values, and the
// darkest of them is still a bright gold. Nothing in it is brown or black: an earlier pass shaded
// the fuller with a brown wash and bound the grip in near-black, and against the blade's own glow
// those read as dirt on a holy object rather than as shading. Depth comes only from where this
// ramp sits, never from adding darkness.
//
// Deliberately shared by BOTH forms. The fallen angel's bolts stay its own red, but what it calls
// down is the same light it always could — which is the more interesting reading anyway.
const HOLY_WHITE = "#ffffff";
const HOLY_PALE  = "#fff8e2";
const HOLY_LIGHT = "#ffeeb4";
const HOLY_GOLD  = "#ffd968";
const HOLY_DEEP  = "#f0b53a";   // the darkest value in the whole object

// ---------------------------------------------------------------- the white form
const ANGEL_SIZE = CHAR_BASE_SIZE;
// Below the mage baseline of 100, deliberately: this character effectively has two health bars,
// so the first one is not allowed to also be an average one. 85 + 40 = 125 total, a little over
// the roster median of 110, but split so the second half is genuinely fragile.
const ANGEL_MAX_HP = 85;
const ANGEL_SPEED  = 260;          // between the mages (240) and the Demon (280)

const ANGEL_BOLT_COOLDOWN = 2.2;   // between the Fire Mage's 3.0 and the faster shooters
const ANGEL_BOLT_DAMAGE   = 9;
const ANGEL_BOLT_SPEED    = 700;
const ANGEL_BOLT_RADIUS   = 11;
const ANGEL_BOLT_LIFE     = 1.6;

// ---------------------------------------------------------------- the guardian
// A spirit that manifests BEHIND the Angel and closes around it — armour, not a summon. A PASSIVE
// on a timer, not a cast: an ultimate can go a whole round without firing, and this is the
// character's rhythm, so it has to be seen every round.
//
// It replaced flight, and the replacement is deliberate on two counts:
//
//  - Flight was this character's only defence, and the guardian takes that slot — but plays the
//    opposite way. Flight was "you cannot reach me"; the shell is "you can reach me and it will
//    not get you anywhere". Same job in the kit, completely different fight.
//  - It must NOT be another burst of damage. The judgement blade is already this character's big
//    scheduled payoff; a second one would compete with it and neither would land. So the guardian
//    changes the Angel's STATE instead: a fragile ranged caster becomes something with armour and
//    reach, which is a change you can see rather than a number going up.
const ANGEL_SUSANOO_INTERVAL = 9.0;    // between manifestations
const ANGEL_SUSANOO_SUMMON   = 0.7;    // it builds itself up out of light over this
const ANGEL_SUSANOO_DURATION = 6.0;    // then holds, unless it is broken first
const ANGEL_SUSANOO_FADE     = 0.45;   // and dissolves
// Its own health, spent before the Angel's. Overflow carries through, so one enormous hit is not
// wholly eaten by a shell with 1 HP left.
const ANGEL_SUSANOO_HP       = 45;
// How big it stands relative to the Angel inside it.
const ANGEL_SUSANOO_SCALE    = 3.4;
// It carries a blade of the same light the Angel's judgement is made of, and runs people through
// with it. A thrust rather than a swing: a swing is a hit, but a thrust that stays IN the target
// is a state — the pinned enemy stands there with a sword of light through it for as long as the
// guardian cares to hold it, which is the picture worth building the move around.
const ANGEL_SUSANOO_BLADE_LEN    = 2.35;  // multiples of the shell's radius
const ANGEL_SUSANOO_BLADE_WIDTH  = 0.15;
const ANGEL_SUSANOO_THRUST_CD     = 2.6;
const ANGEL_SUSANOO_THRUST_DAMAGE = 14;
const ANGEL_SUSANOO_THRUST_REACH  = 1.95;  // multiples of the shell's own radius
const ANGEL_SUSANOO_THRUST_WINDUP = 0.34;  // blade drawn back, clearly telegraphed
const ANGEL_SUSANOO_THRUST_DRIVE  = 0.12;  // and then it is fast
const ANGEL_SUSANOO_THRUST_HOLD   = 1.6;   // run through, held there
const ANGEL_SUSANOO_THRUST_PULL   = 0.3;   // withdrawn
// Held in place, but NOT dazed — applyPin, the Earth Mage's mechanic. A target run through can
// still fight back, which keeps this from being a full lockout on an already-strong character.
const ANGEL_SUSANOO_PIN = ANGEL_SUSANOO_THRUST_HOLD;

// ---------------------------------------------------------------- the fall from grace
// Phases: "fall" (dropping, dead weight) -> "shatter" (the halo comes apart on the floor)
// -> "rise" (black wings unfurl). blocksRoundEnd holds the round open for all three, exactly the
// way it already does for the Archer's sun and the Earth Mage's toppling pillar: a result that is
// still visibly resolving must not be called.
const ANGEL_FALL_TIME    = 0.6;
const ANGEL_SHATTER_TIME = 0.5;
const ANGEL_RISE_TIME    = 1.2;
const ANGEL_FALL_GRAVITY = 900;     // px/s^2 while the body drops out of the air

// ---------------------------------------------------------------- the fallen form
const ANGEL_FALLEN_HP       = 40;
const ANGEL_FALLEN_SPEED    = 330;  // Punch Man's speed — it closes distance now instead of keeping it
const ANGEL_FALLEN_DAMAGE   = 16;
const ANGEL_FALLEN_COOLDOWN = 1.4;
const ANGEL_FALLEN_BOLT_SPEED = 820;

// ---------------------------------------------------------------- judgement: marks and the sword
// Every landed bolt leaves an orb of light circling whoever it hit. The fifth one closes the
// count: the orbs gather over that target's head, fuse into a blade, hang there for a beat, and
// come down. The blade cannot miss — it tracks the body it was built on, so once the fifth orb
// lands the damage is already decided and only the timing is left.
//
// This is why the normal attack is worth watching. On its own a 9-damage bolt every 2.2s has no
// moment in it; the count turns five ordinary hits into one scheduled, announced, unavoidable one,
// and the 1.5s hang is the announcement.
const ANGEL_MARK_MAX     = 5;
const ANGEL_MARK_ORBIT   = 1.9;    // radians/sec the orbs circle their target
const ANGEL_SWORD_DELAY  = 1.5;    // from the fifth orb to impact, exactly
// The forming half is split in two, because the first version ran them at the same time: the
// blade grew at full height from t=0 while the orbs were still drifting up off the target's head,
// so they read as two unrelated things and the "gathering" never happened on screen. Now the orbs
// travel FIRST, gather into one point above the head, and only then does the blade grow out of
// that point.
const ANGEL_SWORD_GATHER = 0.22;   // orbs fly up and collapse into one light
const ANGEL_SWORD_FORM   = 0.45;   // through to the blade being fully drawn
const ANGEL_SWORD_DROP   = 0.18;   // and the drive down at the end
const ANGEL_SWORD_DAMAGE = 15;
// The blade scales with WHOEVER IT IS AIMED AT — a judgement passed on a Giant is a Giant-sized
// blade. Multiples of the target's own size, so it always reads as built to that body.
//
// An earlier version sized it off the target too and hung already buried in it, because the hang
// height was a flat number. That is fixed by deriving the height from the blade (see swordPose):
// however long the blade gets, it is always lifted clear of the head it is over.
const ANGEL_SWORD_LEN    = 2.0;    // multiples of the TARGET's size
const ANGEL_SWORD_WIDTH  = 0.225;  // same, keeping the blade's own proportions constant
// How far the point sits above the target's crown while it waits.
const ANGEL_SWORD_CLEAR  = 14;

// ---------------------------------------------------------------- victory
const ANGEL_VICTORY_RISE = 1.3;
const ANGEL_VICTORY_HEIGHT = 150;

// A single bolt of light. Pure data — see Angel.updateBolts for the flight and the hit.
class LightBolt {
  constructor(x, y, vx, vy, fallen) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.fallen = fallen;
    this.life = ANGEL_BOLT_LIFE;
    this.seed = Math.random() * Math.PI * 2;
    this.spin = Math.random() * Math.PI * 2;
  }
}

// Smoothstep: gentle at both ends. Used for every eased motion on this character so the flight,
// the fall and the victory all share one feel.
function angelEase(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

class Angel extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: ANGEL_SIZE,
      color: ANGEL_ROBE_MID,
      maxHp: ANGEL_MAX_HP,
      name: "天使",
      speed: ANGEL_SPEED,
    });

    this.facingAngle = Math.random() * Math.PI * 2;
    this.hasFacedOpponent = false;
    this.bodySeed = Math.random() * Math.PI * 2;

    this.bolts = [];
    this.boltTimer = ANGEL_BOLT_COOLDOWN;   // opens on cooldown rather than firing at the bell
    this.castTimer = 0;                     // >0 while the arm is still extended from a shot

    // The guardian
    this.susanooPhase = null;               // null | "summon" | "hold" | "fade"
    this.susanooTimer = ANGEL_SUSANOO_INTERVAL;
    this.phaseTimer = 0;
    this.shellHp = 0;
    this.shellCracks = [];                  // fixed fracture lines, grown as the shell is worn down
    this.thrustTimer = 0;
    this.thrustPhase = null;                // null | "windup" | "drive" | "held" | "pull"
    this.thrustTarget = null;               // who is currently on the end of the blade
    this.thrustAim = 0;                     // the direction it committed to, fixed at the drive
    this.lift = 0;                          // drawn height off the floor (the fall, and the victory)
    this.wingPhase = Math.random() * Math.PI * 2;

    // The fall from grace
    this.fallen = false;
    this.transformPhase = null;             // null | "fall" | "shatter" | "rise"
    this.transformTimer = 0;
    this.fallVel = 0;
    this.halo = null;                       // once shattered, the pieces left lying on the floor

    // Judgement. One record per marked body rather than a counter on this character, because the
    // opponent can be several bodies at once (the Ninja's clones) and each carries its own count.
    // Stored here rather than on the target so nothing has to be cleaned off another character.
    this.marks = [];        // [{ body, orbs: [{phase}], sword: {t} | null }]
    this.orbSpin = 0;

    // Victory
    this.celebrating = false;
    this.victoryTimer = 0;
    this.victoryStartX = 0;
    this.victoryStartY = 0;
  }

  // ---------------------------------------------------------------- form-dependent stats
  get boltDamage()   { return this.fallen ? ANGEL_FALLEN_DAMAGE : ANGEL_BOLT_DAMAGE; }
  get boltCooldown() { return this.fallen ? ANGEL_FALLEN_COOLDOWN : ANGEL_BOLT_COOLDOWN; }
  get boltSpeed()    { return this.fallen ? ANGEL_FALLEN_BOLT_SPEED : ANGEL_BOLT_SPEED; }
  get palette()      { return this.fallen ? FALLEN_LIGHT : ANGEL_LIGHT; }

  // ---------------------------------------------------------------- engine hooks
  // Frozen for the whole transformation. Flight deliberately does NOT stop it moving: it drifts
  // around the arena while airborne, which is what makes losing track of it matter.
  get movable() {
    return super.movable && !this.transformPhase && !this.celebrating;
  }

  set movable(v) {
    super.movable = v;
  }

  // A death that is being undone is the strongest possible reason to hold the round open — the
  // opponent has, for a moment, actually won. See Character.blocksRoundEnd.
  get blocksRoundEnd() {
    return super.blocksRoundEnd
        || (this.alive && this.transformPhase !== null)
        || this.marks.some((m) => m.sword);   // a blade in the air still has to land
  }

  // Nothing lands on it while it is falling and getting back up. Not a courtesy: without this the
  // whole mechanic is cancellable by accident. It sits at 0 HP for the ~1.1s before the fallen
  // form takes over, and takeDamage's saveable check is false by then (transformPhase is set), so
  // ANY incidental damage in that window — one stray bolt, one tick of lava — killed it outright
  // and the transformation never finished. Measured: a 5-damage hit 0.33s in was lethal.
  get damageImmune() {
    return this.transformPhase !== null;
  }

  // Same window, same reason, via the engine's existing hook: a stun landing mid-fall would still
  // be running when the fallen form stood up, so it would rise already helpless.
  get immuneToControl() {
    return this.transformPhase !== null;
  }

  // The one that makes the character. The base class kills at 0 HP inside takeDamage, so rather
  // than duplicating that whole damage pipeline (bleed multiplier, damage numbers, flash) this
  // lets it run and then takes the death back — which also means the death burst, flash and shake
  // in Character.onDeath all fire for free, at exactly the right moment.
  takeDamage(dmg, colorOverride = null) {
    if (this.damageImmune) return;

    // The shell is spent before the body. Overflow carries through rather than being swallowed:
    // a shell with 3 HP left should not absorb a 40-damage hit in full.
    if (dmg > 0 && this.shellUp && this.shellHp > 0) {
      const absorbed = Math.min(this.shellHp, dmg);
      this.shellHp -= absorbed;
      dmg -= absorbed;
      this.markShellDamage(absorbed);
      if (this.shellHp <= 0) this.breakShell();
      if (dmg <= 0.0001) return;
    }

    const wasSaveable = this.alive && !this.fallen && !this.transformPhase;
    super.takeDamage(dmg, colorOverride);
    if (wasSaveable && !this.alive) {
      this.alive = true;
      this.deathFadeTimer = 0;   // the base class started a fade-out; there is nothing to fade
      this.hp = 0;
      this.beginFall();
    }
  }

  // ---------------------------------------------------------------- the fall from grace
  beginFall() {
    this.transformPhase = "fall";
    this.transformTimer = ANGEL_FALL_TIME;
    this.fallVel = 0;
    this.vx = 0;
    this.vy = 0;
    this.bolts.length = 0;       // nothing it fired before dying should still be in the air
    this.susanooPhase = null;    // the shell goes with the light, whatever state it was in
    this.shellHp = 0;
    this.thrustPhase = null;
    this.thrustTarget = null;
    this.castTimer = 0;
    playSfx("demonUltimate", 0.55);   // PLACEHOLDER: wants its own "the light goes out" cue
  }

  updateTransform(dt) {
    this.transformTimer -= dt;

    if (this.transformPhase === "fall") {
      // Dead weight. If it was airborne when it died it drops the whole way, which is why this
      // integrates rather than tweening — the distance is different every time.
      this.fallVel += ANGEL_FALL_GRAVITY * dt;
      this.lift = Math.max(0, this.lift - this.fallVel * dt);
      if (Math.random() < 0.5) {
        spawnImpactParticles(this.x + (Math.random() - 0.5) * this.size,
                             this.y - this.lift, ANGEL_LIGHT, 2, 0.8, 90);
      }
      if (this.lift <= 0 && this.transformTimer <= 0) {
        this.transformPhase = "shatter";
        this.transformTimer = ANGEL_SHATTER_TIME;
        this.shatterHalo();
      }
      return;
    }

    if (this.transformPhase === "shatter") {
      if (this.transformTimer <= 0) {
        this.transformPhase = "rise";
        this.transformTimer = ANGEL_RISE_TIME;
        this.beginFallen();
      }
      return;
    }

    if (this.transformPhase === "rise") {
      // Embers streaming off the new wings as they unfurl
      if (Math.random() < 0.6) {
        spawnImpactParticles(this.x + (Math.random() - 0.5) * this.size * 1.6,
                             this.y - this.size * 0.2, FALLEN_LIGHT, 2, 0.9, 270);
      }
      if (this.transformTimer <= 0) {
        this.transformPhase = null;
        triggerShake(7, 0.3);
      }
    }
  }

  // The halo comes off and stays on the floor for the rest of the round. Same idea as the Earth
  // Mage's pillars: the arena should carry evidence of what happened in it.
  shatterHalo() {
    this.halo = {
      x: this.x,
      y: this.y + this.size * 0.35,
      seed: Math.random() * Math.PI * 2,
      // Broken into arcs rather than dust, so it still reads as a ring that was broken
      shards: Array.from({ length: 5 }, (_, i) => ({
        a0: (i / 5) * Math.PI * 2 + Math.random() * 0.2,
        span: Math.PI * 2 / 5 * (0.55 + Math.random() * 0.25),
        off: (Math.random() - 0.5) * 10,
        rot: (Math.random() - 0.5) * 0.5,
      })),
    };
    playSfx("wallSlam", 0.6);        // PLACEHOLDER: wants a glass/bell shatter
    spawnFlash(this.x, this.y, "#ffffff", this.size * 2.2, 0.3);
    spawnImpactParticles(this.x, this.y, ANGEL_LIGHT, 34, 1.6, 90);
    triggerShake(9, 0.35);
  }

  beginFallen() {
    this.fallen = true;
    this.hp = ANGEL_FALLEN_HP;
    this.maxHp = ANGEL_FALLEN_HP;   // the bar refills as the new, smaller pool — not a heal
    this.color = FALLEN_ROBE_MID;
    this.name = "Fallen Angel";
    this.speed = ANGEL_FALLEN_SPEED;
    this.boltTimer = this.boltCooldown * 0.5;   // half a beat before it starts hitting back
    this.susanooTimer = Infinity;               // nothing left to call on
    playSfx("demonWings", 0.8);
    spawnFlash(this.x, this.y, FALLEN_EMBER, this.size * 2.4, 0.35);
  }

  // ---------------------------------------------------------------- the guardian
  get shellUp() {
    return this.susanooPhase === "hold" || this.susanooPhase === "summon";
  }

  // 0..1, how far the shell has built itself / how much is left of it while dissolving.
  get shellForm() {
    if (this.susanooPhase === "summon") return angelEase(1 - this.phaseTimer / ANGEL_SUSANOO_SUMMON);
    if (this.susanooPhase === "hold") return 1;
    if (this.susanooPhase === "fade") return angelEase(this.phaseTimer / ANGEL_SUSANOO_FADE);
    return 0;
  }

  get shellRadius() {
    return this.size * 0.5 * ANGEL_SUSANOO_SCALE;
  }

  summonSusanoo() {
    this.susanooPhase = "summon";
    this.phaseTimer = ANGEL_SUSANOO_SUMMON;
    this.shellHp = ANGEL_SUSANOO_HP;
    this.thrustTimer = ANGEL_SUSANOO_THRUST_CD * 0.45;
    this.thrustPhase = null;
    this.thrustTarget = null;
    // Fracture lines are fixed the moment it forms, and simply become visible as it is worn down —
    // so the same shell always breaks along the same seams instead of the cracks crawling about.
    this.shellCracks = Array.from({ length: 9 }, () => ({
      a: Math.random() * Math.PI * 2,
      r0: 0.25 + Math.random() * 0.4,
      len: 0.3 + Math.random() * 0.45,
      bend: (Math.random() - 0.5) * 0.9,
      at: Math.random(),            // fraction of damage taken before this one shows
    }));
    playSfx("demonWings", 0.65);          // PLACEHOLDER: wants its own manifestation cue
    spawnFlash(this.x, this.y, HOLY_GOLD, this.shellRadius * 1.5, 0.3);
    spawnImpactParticles(this.x, this.y, [HOLY_WHITE, HOLY_PALE, HOLY_GOLD], 26, 1.5, 90);
    triggerShake(6, 0.3, true);   // sustained: something arriving, not an impact — no hit-stop
  }

  markShellDamage(amount) {
    spawnImpactParticles(this.x + (Math.random() - 0.5) * this.shellRadius,
                         this.y + (Math.random() - 0.5) * this.shellRadius,
                         [HOLY_WHITE, HOLY_PALE, HOLY_GOLD], Math.min(14, 3 + amount), 1.1, 0);
  }

  breakShell() {
    this.susanooPhase = null;
    this.susanooTimer = ANGEL_SUSANOO_INTERVAL;
    this.thrustPhase = null;
    this.thrustTarget = null;
    this.shellHp = 0;
    playSfx("wallSlam", 0.7);              // PLACEHOLDER: wants a glass-shatter
    spawnFlash(this.x, this.y, HOLY_WHITE, this.shellRadius * 1.8, 0.32);
    spawnImpactParticles(this.x, this.y, [HOLY_WHITE, HOLY_PALE, HOLY_GOLD, HOLY_DEEP], 40, 1.9, 0);
    triggerShake(10, 0.32);
  }

  updateSusanoo(dt, opponent) {
    if (this.susanooPhase === null) {
      if (this.fallen) return;             // the fallen form has nothing left to call
      this.susanooTimer -= dt;
      if (this.susanooTimer <= 0 && this.canAttack) this.summonSusanoo();
      return;
    }

    this.phaseTimer -= dt;
    if (this.susanooPhase === "summon" && this.phaseTimer <= 0) {
      this.susanooPhase = "hold";
      this.phaseTimer = ANGEL_SUSANOO_DURATION;
    } else if (this.susanooPhase === "hold" && this.phaseTimer <= 0) {
      this.susanooPhase = "fade";
      this.phaseTimer = ANGEL_SUSANOO_FADE;
    } else if (this.susanooPhase === "fade" && this.phaseTimer <= 0) {
      this.susanooPhase = null;
      this.susanooTimer = ANGEL_SUSANOO_INTERVAL;
      this.shellHp = 0;
    }

    if (this.susanooPhase === "hold") this.updateThrust(dt, opponent);
  }

  // Where the guardian's blade currently is: a point (base) and a direction, in world space.
  // One place computes it, so what the physics runs the target through is exactly what is drawn.
  bladePose() {
    const R = this.shellRadius;
    const aim = this.thrustPhase ? this.thrustAim : this.facingAngle;
    let ext;                       // how far the arm has pushed the blade out, in shell radii
    switch (this.thrustPhase) {
      case "windup": ext = -0.35 * angelEase(1 - this.thrustTimer / ANGEL_SUSANOO_THRUST_WINDUP); break;
      case "drive":  ext = -0.35 + 1.35 * angelEase(1 - this.thrustTimer / ANGEL_SUSANOO_THRUST_DRIVE); break;
      case "held":   ext = 1.0; break;
      case "pull":   ext = 1.0 * angelEase(this.thrustTimer / ANGEL_SUSANOO_THRUST_PULL); break;
      default:       ext = 0;
    }
    // The HAND, not the tip. At (0.55 + ext*0.95) this reached 1.5R at full extension — further
    // out than the target it was aiming at, so the blade began BEYOND the enemy and drew away from
    // it. Measured: target 120px away, blade base 153px away, 53px off the blade line, no contact.
    const reachOut = R * (0.5 + ext * 0.35);
    return {
      x: this.x + Math.cos(aim) * reachOut,
      y: this.y - this.lift + Math.sin(aim) * reachOut - R * 0.28,
      aim,
      len: R * ANGEL_SUSANOO_BLADE_LEN,
      w: R * ANGEL_SUSANOO_BLADE_WIDTH,
      ext,
    };
  }

  // Thrust, run through, hold, withdraw. The blade STAYS in the target for the whole hold, and the
  // target is pinned for exactly as long — so the pin is not an invisible status, it is the sword
  // you can see sticking out of them.
  updateThrust(dt, opponent) {
    if (!opponent || !opponent.alive) {
      this.thrustPhase = null;
      this.thrustTarget = null;
      return;
    }

    if (this.thrustPhase === null) {
      if (this.thrustTimer > 0) this.thrustTimer -= dt;
      const d = Math.hypot(opponent.x - this.x, opponent.y - this.y);
      if (this.thrustTimer <= 0 && d <= this.shellRadius * ANGEL_SUSANOO_THRUST_REACH) {
        this.thrustPhase = "windup";
        this.thrustTimer = ANGEL_SUSANOO_THRUST_WINDUP;
        playSfx("archerUltCharge", 0.4);     // PLACEHOLDER
      }
      return;
    }

    this.thrustTimer -= dt;

    if (this.thrustPhase === "windup") {
      // Still tracking while it winds up — the direction is only committed when it drives
      // Aimed from the BLADE's own height, not from the body's centre. The guardian holds it at
      // chest level (R*0.28 above centre), so aiming from the centre left the blade running
      // parallel to the target and 29px over its middle — it grazed rather than ran through.
      this.thrustAim = Math.atan2(opponent.y - (this.y - this.lift - this.shellRadius * 0.28),
                                  opponent.x - this.x);
      if (this.thrustTimer <= 0) {
        this.thrustPhase = "drive";
        this.thrustTimer = ANGEL_SUSANOO_THRUST_DRIVE;
        this.thrustTarget = null;
        playSfx("trollWave", 0.6);           // PLACEHOLDER
      }
      return;
    }

    if (this.thrustPhase === "drive") {
      // Anything along the blade's line gets run through, once
      if (!this.thrustTarget) {
        const R_CHEST = this.shellRadius * 0.15;
        const p = this.bladePose();
        const tipX = p.x + Math.cos(p.aim) * p.len;
        const tipY = p.y + Math.sin(p.aim) * p.len;
        // Tested from the guardian's CHEST rather than from the hand. The drawn blade starts at
        // the hand, but the arm driving it occupies the space behind that — without this, anything
        // standing closer than the hand sits in a dead zone in front of a sword being thrust at it.
        const baseX = this.x + Math.cos(p.aim) * R_CHEST;
        const baseY = this.y - this.lift + Math.sin(p.aim) * R_CHEST - this.shellRadius * 0.28;
        const targets = [opponent, ...opponent.getExtraBodies()].filter((t) => t.alive);
        for (const t of targets) {
          if (pointToSegmentDistance(t.x, t.y, baseX, baseY, tipX, tipY) > t.size * 0.5) continue;
          t.takeDamage(ANGEL_SUSANOO_THRUST_DAMAGE, HOLY_LIGHT);
          t.applyPin(ANGEL_SUSANOO_PIN);
          this.thrustTarget = t;
          playSfx("archerBowHit", 0.7);      // PLACEHOLDER
          spawnFlash(t.x, t.y, HOLY_WHITE, t.size * 1.5, 0.24);
          spawnImpactParticles(t.x, t.y, [HOLY_WHITE, HOLY_PALE, HOLY_GOLD], 28, 1.7, 0);
          triggerShake(9, 0.26);
          break;
        }
      }
      if (this.thrustTimer <= 0) {
        this.thrustPhase = "held";
        // If it hit, hold exactly as long as the pin lasts; if it missed, recover quickly instead
        // of standing there with the blade out for a second and a half for nothing.
        this.thrustTimer = this.thrustTarget ? ANGEL_SUSANOO_THRUST_HOLD : 0.18;
      }
      return;
    }

    if (this.thrustPhase === "held") {
      const t = this.thrustTarget;
      if (t && t.alive) {
        // Refreshed every frame so the pin can never outlast the blade, or the blade the pin
        t.applyPin(Math.max(0.08, this.thrustTimer));
        if (Math.random() < 0.4) {
          spawnImpactParticles(t.x, t.y, [HOLY_WHITE, HOLY_PALE], 2, 0.9, 0);
        }
      } else if (t) {
        this.thrustTarget = null;
      }
      if (this.thrustTimer <= 0) {
        this.thrustPhase = "pull";
        this.thrustTimer = ANGEL_SUSANOO_THRUST_PULL;
        if (this.thrustTarget) {
          spawnImpactParticles(this.thrustTarget.x, this.thrustTarget.y,
                               [HOLY_WHITE, HOLY_GOLD], 16, 1.3, 0);
          playSfx("earthmageSand", 0.4);     // PLACEHOLDER: the blade coming back out
        }
      }
      return;
    }

    // pull
    if (this.thrustTimer <= 0) {
      this.thrustPhase = null;
      this.thrustTarget = null;
      this.thrustTimer = ANGEL_SUSANOO_THRUST_CD;
    }
  }

  // ---------------------------------------------------------------- attack
  fireBolt(opponent) {
    const tip = this.handPoint();
    const dx = opponent.x - tip.x, dy = opponent.y - tip.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = this.boltSpeed;
    this.bolts.push(new LightBolt(tip.x, tip.y, dx / d * sp, dy / d * sp, this.fallen));
    this.castTimer = 0.22;
    playSfx("archerBow", this.fallen ? 0.5 : 0.4);   // PLACEHOLDER: wants its own release cue
    spawnImpactParticles(tip.x, tip.y, this.palette, 8, 0.9, 0);
  }

  updateBolts(dt, opponent) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      b.spin += dt * 9;

      let gone = b.life <= 0 || b.x < ARENA.x || b.x > ARENA.x + ARENA.w
                             || b.y < ARENA.y || b.y > ARENA.y + ARENA.h;

      // Solid scenery stops it, the same as everyone else's projectiles — see combat.js
      if (!gone && typeof obstacleBlocking === "function" && obstacleBlocking(b.x, b.y, ANGEL_BOLT_RADIUS * 0.5)) {
        spawnImpactParticles(b.x, b.y, this.palette, 10, 1.0, 0);
        gone = true;
      }

      if (!gone && opponent && opponent.alive) {
        const targets = [opponent, ...opponent.getExtraBodies()].filter((t) => t.alive);
        for (const t of targets) {
          if (Math.hypot(t.x - b.x, t.y - b.y) > t.size / 2 + ANGEL_BOLT_RADIUS) continue;
          t.takeDamage(this.boltDamage, this.fallen ? FALLEN_EMBER : ANGEL_GOLD);
          this.addMark(t);
          playSfx("archerBowHit", 0.45);   // PLACEHOLDER
          spawnImpactParticles(b.x, b.y, this.palette, 16, 1.3, 0);
          spawnFlash(b.x, b.y, this.fallen ? FALLEN_EMBER : "#ffe9a8", t.size * 0.8, 0.16);
          gone = true;
          break;
        }
      }

      if (gone) this.bolts.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- judgement
  markRecord(body) {
    let m = this.marks.find((x) => x.body === body);
    if (!m) { m = { body, orbs: [], sword: null }; this.marks.push(m); }
    return m;
  }

  addMark(body) {
    const m = this.markRecord(body);
    if (m.sword) return;                 // the count is already closed; further hits just damage
    m.orbs.push({ phase: Math.random() * Math.PI * 2, born: 0 });
    spawnFlash(body.x, body.y, HOLY_GOLD, body.size * 0.55, 0.14);
    if (m.orbs.length < ANGEL_MARK_MAX) return;

    // Fifth orb: the blade is committed from here. The orbs are kept, not discarded — they are
    // what visibly converges into it during the forming phase.
    m.sword = { t: 0 };
    playSfx("archerUltCharge", 0.5);     // PLACEHOLDER: wants its own "judgement passed" cue
  }

  updateMarks(dt) {
    this.orbSpin += dt * ANGEL_MARK_ORBIT;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      // A body that died (or a clone that was dispelled) takes its count with it
      if (!m.body || !m.body.alive) { this.marks.splice(i, 1); continue; }
      for (const o of m.orbs) o.born += dt;
      if (!m.sword) continue;

      m.sword.t += dt;
      if (m.sword.t < ANGEL_SWORD_DELAY) continue;

      // Impact. Tracks the body's CURRENT position, which is what makes it unmissable — the
      // target running does not change where the blade lands, only what it lands on top of.
      const b = m.body;
      b.takeDamage(ANGEL_SWORD_DAMAGE, HOLY_LIGHT);
      playSfx("archerSunCrash", 0.6);    // PLACEHOLDER
      spawnFlash(b.x, b.y, "#ffffff", b.size * 1.9, 0.28);
      spawnImpactParticles(b.x, b.y, [HOLY_WHITE, HOLY_PALE, HOLY_GOLD, HOLY_DEEP], 30, 1.7, 90);
      triggerShake(8, 0.28);
      this.marks.splice(i, 1);
    }
  }

  // Where one orb sits on its ring around a target. sin(a) < 0 is the BACK of the ring — further
  // from the camera — which is what the depth sorting and the size falloff both key off.
  orbPos(m, i) {
    const b = m.body;
    const R = b.size * 0.78;
    const a = this.orbSpin + (i / ANGEL_MARK_MAX) * Math.PI * 2;
    const depth = Math.sin(a);                       // -1 behind .. +1 in front
    return {
      x: b.x + Math.cos(a) * R,
      y: b.y + depth * R * 0.42,
      // Smaller and dimmer at the back, so the ring reads as a circle lying around the body
      // rather than a flat halo painted over it.
      scale: 0.72 + 0.28 * (depth * 0.5 + 0.5),
      depth,
    };
  }

  // Where the blade is right now: hanging above the head, then driven down into it.
  swordPose(m) {
    const t = m.sword.t;
    const hangEnd = ANGEL_SWORD_DELAY - ANGEL_SWORD_DROP;
    // ALWAYS fully clear of the head, whatever the target's size and wherever it is standing.
    //
    // There was an arena cap here and it has been removed on purpose. A Giant is 150 across, so
    // its blade is 300 long and needs 389px of lift to hang clear — and a Giant pressed against
    // the top wall does not have 389px of arena above it. No blade length satisfies both "always
    // directly overhead" and "never crosses the arena border": even zero lift already puts the
    // guard past the border for a body that big that high. Being overhead is the point of the
    // effect, so that is what wins; against the largest targets the pommel can sit above the
    // arena border, in the empty margin under the HUD.
    const b = m.body;
    const top = b.size * 0.5 + b.size * ANGEL_SWORD_LEN + ANGEL_SWORD_CLEAR;
    if (t < ANGEL_SWORD_GATHER) {
      return { phase: "gather", k: t / ANGEL_SWORD_GATHER, lift: top };
    }
    if (t < ANGEL_SWORD_FORM) {
      return { phase: "forge", k: (t - ANGEL_SWORD_GATHER) / (ANGEL_SWORD_FORM - ANGEL_SWORD_GATHER),
               lift: top };
    }
    if (t < hangEnd) {
      const k = (t - ANGEL_SWORD_FORM) / (hangEnd - ANGEL_SWORD_FORM);
      return { phase: "hang", k, lift: top + Math.sin(t * 5) * 4 };
    }
    const k = Math.min(1, (t - hangEnd) / ANGEL_SWORD_DROP);
    // Accelerating, so it drives rather than glides
    return { phase: "drop", k, lift: top * (1 - k * k) };
  }

  // ---------------------------------------------------------------- update
  update(dt, opponent) {
    // Unconditional and first, for the same reason the Archer's arrows and the Earth Mage's
    // pillars are: a bolt already in the air is a committed physical thing, independent of
    // whoever fired it.
    this.updateBolts(dt, opponent);
    // Also unconditional: a blade that has already formed is a committed, announced result, and
    // killing the Angel in the 1.5s before it drops must not take it back. Same rule as the
    // Archer's sun and the Earth Mage's toppling pillar.
    this.updateMarks(dt);

    // The transformation runs BEFORE super.update, because it has to keep running while hp is 0
    // and it is the reason this character is still standing at all.
    if (this.transformPhase) {
      this.updateTransform(dt);
      if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
      return;
    }

    super.update(dt, opponent);
    if (!this.alive) return;

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

    this.wingPhase += dt * (this.shellUp ? 5.0 : 3.2);
    if (this.castTimer > 0) this.castTimer -= dt;

    if (this.stunTimer > 0) return;

    this.updateSusanoo(dt, opponent);

    if (this.boltTimer > 0) this.boltTimer -= dt;
    if (this.boltTimer <= 0 && this.canAttack && opponent && opponent.alive) {
      this.boltTimer = this.boltCooldown;
      this.fireBolt(opponent);
    }
  }

  // ---------------------------------------------------------------- victory
  onVictory() {
    if (this.celebrating) return;
    this.celebrating = true;
    this.victoryTimer = 0;
    this.victoryStartX = this.x;
    this.victoryStartY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.susanooPhase = null;
    this.thrustPhase = null;
    this.thrustTarget = null;
    this.bolts.length = 0;
    playSfx("demonWings", 0.9);
  }

  updateVictory(dt) {
    this.victoryTimer += dt;
    const t = Math.min(1, this.victoryTimer / ANGEL_VICTORY_RISE);
    // The white form ascends; the fallen one has nothing left to ascend with and stays planted,
    // which is the whole point of what happened to it.
    this.lift = this.fallen ? 0 : ANGEL_VICTORY_HEIGHT * angelEase(t);
    this.wingPhase += dt * (this.fallen ? 2.2 : 5.0);
    if (Math.random() < 0.5) {
      spawnImpactParticles(this.x + (Math.random() - 0.5) * this.size * 2,
                           this.y - this.lift - this.size * 0.2,
                           this.palette, 2, 0.8, this.fallen ? 270 : 90);
    }
  }

  // ---------------------------------------------------------------- HUD
  get ultimateRatio() {
    if (this.transformPhase) return 1;
    if (this.fallen) return null;             // nothing left to charge
    // While it is up the bar shows what is LEFT of the shell, not a cooldown — that is the number
    // that actually matters to the fight at that moment.
    if (this.shellUp) return Math.max(0, this.shellHp / ANGEL_SUSANOO_HP);
    if (this.susanooPhase) return 0;
    return Math.max(0, Math.min(1, 1 - this.susanooTimer / ANGEL_SUSANOO_INTERVAL));
  }

  get ultimateBarColor() {
    return this.fallen ? FALLEN_EMBER : ANGEL_GOLD;
  }

  drawHud(ctx, x, y, w) {
    const ny = super.drawHud(ctx, x, y, w);
    let note = null, color = ANGEL_GOLD;
    if (this.transformPhase) { note = "墜落中"; color = FALLEN_EMBER; }
    else if (this.fallen)    { note = "墮天 — 不再復活"; color = FALLEN_EMBER; }
    else if (this.shellUp)   { note = `護體 ${Math.ceil(this.shellHp)}/${ANGEL_SUSANOO_HP}`; }
    else if (this.susanooPhase === "fade") { note = "護體消散中"; }
    let cy = ny;
    if (note) { this.drawHudNote(ctx, x, cy, note, color); cy += 18; }

    // The count is the whole read on this character's normal attack, so it gets its own line
    const m = this.marks.find((r) => r.body && r.body.alive);
    if (m) {
      const txt = m.sword ? "審判 — 光劍落下"
                          : `印記 ${m.orbs.length}/${ANGEL_MARK_MAX}`;
      this.drawHudNote(ctx, x, cy, txt, m.sword ? "#fff3c4" : ANGEL_GOLD);
      cy += 18;
    }
    return cy;
  }

  // ---------------------------------------------------------------- drawing
  // The contact shadow lives here rather than in drawBody, because the body is drawn lifted and
  // the shadow must not travel with it — the gap between them IS the height cue.
  drawGroundEffects(ctx) {
    if (this.halo) this.drawBrokenHalo(ctx);

    if (!this.alive && this.deathFadeTimer <= 0) return;
    const r = this.size / 2;
    const h = Math.max(0, this.lift);
    const k = 1 - Math.min(1, h / (ANGEL_VICTORY_HEIGHT * 0.9));  // higher => smaller, fainter
    ctx.save();
    ctx.globalAlpha = 0.14 + 0.2 * k;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(this.x + r * 0.1, this.y + r * 0.93,
                r * (0.42 + 0.32 * k), r * (0.12 + 0.09 * k), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Orbiting orbs are physically AROUND the target, so half of them are behind it. They join the
  // engine's single sorted pass by their own screen y — main.js draws whatever is higher up first
  // — which is what puts the back of the ring behind the body and the front of it in front. See
  // Character.getDepthItems and collectDepthItems in main.js.
  //
  // Only the orbiting ones: once the count closes, the orbs fly up above the head and the blade
  // hangs in the air, and both belong over everything (see drawOverlayEffects).
  getDepthItems() {
    const items = [];
    for (const m of this.marks) {
      if (m.sword) continue;
      const b = m.body;
      if (!b || !b.alive) continue;
      for (let i = 0; i < m.orbs.length; i++) {
        const p = this.orbPos(m, i);
        const grow = Math.min(1, m.orbs[i].born / 0.25);
        const r = b.size * 0.105 * p.scale * (0.4 + 0.6 * grow);
        const alpha = 0.55 + 0.45 * (p.depth * 0.5 + 0.5);
        items.push({ depthY: p.y, draw: (ctx) => this.drawOrb(ctx, p.x, p.y, r, alpha) });
      }
    }
    return items;
  }

  // Bolts, gathering orbs and blades are all airborne and pass over everything.
  drawOverlayEffects(ctx) {
    for (const b of this.bolts) this.drawBolt(ctx, b);
    for (const m of this.marks) if (m.sword) this.drawMark(ctx, m);
  }

  drawMark(ctx, m) {
    const b = m.body;
    if (!b || !b.alive || !m.sword) return;
    const p = this.swordPose(m);
    const gx = b.x, gy = b.y - p.lift;      // the gather point, directly over the head

    if (p.phase === "gather") {
      // The orbs leave their ring and rise to one point. Nothing else is drawn yet — the blade
      // does not exist until they have arrived.
      const k = angelEase(p.k);
      for (let i = 0; i < m.orbs.length; i++) {
        const o = this.orbPos(m, i);
        // Curved in, not a straight line: they swing up and inward like they are being pulled
        const cx = o.x + (gx - o.x) * k;
        const cy = o.y + (gy - o.y) * k - Math.sin(k * Math.PI) * b.size * 0.3;
        this.drawOrb(ctx, cx, cy, b.size * 0.105 * (1 + k * 0.5), 1);
      }
      // The point they are gathering into brightens as they arrive
      this.drawOrb(ctx, gx, gy, b.size * 0.06 * k, 0.9);
      return;
    }

    if (p.phase === "forge") {
      // One bright flash of gathered light, fading as the blade takes its place
      const k = angelEase(p.k);
      this.drawOrb(ctx, gx, gy, b.size * 0.22 * (1 - k) + b.size * 0.05, 1 - k * 0.6);
    }

    this.drawSword(ctx, b, p);
    // (C) While the guardian stands, the judgement is not floating on its own — the shell reaches
    // over and drives it down by hand. Drawn after the blade so the arm laps over the grip.
    if (this.shellUp) this.drawSusanooGrip(ctx, b, p);
  }

  // Same ramp as the blade they turn into — if the orbs were the form's own colour the light
  // would visibly change hue at the moment it forged, which is the one moment it must not.
  drawOrb(ctx, x, y, r, alpha = 1) {
    if (r <= 0.2) return;
    const gold = HOLY_GOLD;
    const core = HOLY_WHITE;
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.8);
    g.addColorStop(0, gold);
    g.addColorStop(0.45, "rgba(255,217,104,0.30)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The blade itself. Built as a real object rather than a lit triangle: a tapered blade with a
  // fuller ground down the middle, swept quillons with a feather cut into them, a bound grip and
  // a pommel stone.
  //
  // Every value in it comes from the HOLY_* ramp — see the note there. There is no dark colour
  // anywhere in this method by design: shape is carried by where the highlights fall, not by
  // outlining anything in shadow.
  drawSword(ctx, b, p) {
    const grow = p.phase === "forge" ? angelEase(p.k) : 1;
    if (grow <= 0.02) return;
    const L = b.size * ANGEL_SWORD_LEN;        // blade, guard downward
    const W = b.size * ANGEL_SWORD_WIDTH;

    ctx.save();
    ctx.translate(b.x, b.y - p.lift);
    // Grows out of the gathered light along its own axis, so it is forged rather than scaled up
    ctx.scale(0.45 + 0.55 * grow, grow);

    const heat = p.phase === "hang" ? 0.55 + 0.45 * Math.sin(p.k * Math.PI * 5) : 1;

    // ---- the light it throws: a soft radial falloff and two shafts, both fading to nothing at
    // every edge, so the glow never shows a boundary of its own
    ctx.save();
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, L * 1.5);
    halo.addColorStop(0, "rgba(255,233,168,0.36)");
    halo.addColorStop(0.45, "rgba(255,217,104,0.12)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = heat;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, L * 1.5, 0, Math.PI * 2);
    ctx.fill();
    for (const sgn of [-1, 1]) {
      const shaft = ctx.createLinearGradient(0, -L * 1.3, 0, L * 0.5);
      shaft.addColorStop(0, "rgba(0,0,0,0)");
      shaft.addColorStop(0.5, "rgba(255,246,214,0.17)");
      shaft.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.8 * heat;
      ctx.fillStyle = shaft;
      ctx.beginPath();
      ctx.moveTo(sgn * W * 0.2, L * 0.5);
      ctx.lineTo(sgn * W * 2.6, -L * 1.3);
      ctx.lineTo(sgn * W * 0.6, -L * 1.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.shadowColor = HOLY_GOLD;
    ctx.shadowBlur = b.size * 0.28 * heat;

    // ---- blade, point down. Bright core running its length, deepening only to HOLY_DEEP at the
    // two edges — the whole sense of a ground bevel, with nothing dark in it.
    const bl = ctx.createLinearGradient(-W, 0, W, 0);
    bl.addColorStop(0, HOLY_DEEP);
    bl.addColorStop(0.22, HOLY_GOLD);
    bl.addColorStop(0.47, HOLY_WHITE);
    bl.addColorStop(0.72, HOLY_LIGHT);
    bl.addColorStop(1, HOLY_DEEP);
    ctx.fillStyle = bl;
    ctx.beginPath();
    ctx.moveTo(-W, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W * 0.86, L * 0.58);
    ctx.lineTo(W * 0.42, L * 0.84);
    ctx.lineTo(0, L);
    ctx.lineTo(-W * 0.42, L * 0.84);
    ctx.lineTo(-W * 0.86, L * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // ---- fuller: the groove down the centre, read as a band of the DEEPER gold rather than as a
    // shadow, which is what keeps the blade one material instead of a gold blade with a dirty stripe
    const fl = ctx.createLinearGradient(-W * 0.22, 0, W * 0.22, 0);
    fl.addColorStop(0, HOLY_DEEP);
    fl.addColorStop(0.5, HOLY_GOLD);
    fl.addColorStop(1, HOLY_LIGHT);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = fl;
    ctx.beginPath();
    ctx.moveTo(-W * 0.2, L * 0.05);
    ctx.lineTo(W * 0.2, L * 0.05);
    ctx.lineTo(W * 0.1, L * 0.72);
    ctx.lineTo(-W * 0.1, L * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // ---- the lit edge, one side only, so the blade has a light direction
    ctx.strokeStyle = HOLY_WHITE;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = W * 0.17;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-W * 0.9, L * 0.05);
    ctx.lineTo(-W * 0.78, L * 0.56);
    ctx.lineTo(0, L * 0.95);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ---- grip FIRST, and run it down THROUGH where the guard will sit.
    //
    // This order and that overlap are both load-bearing. Previously the guard was drawn first and
    // the grip stopped at y = -W*0.9, while the guard's centre only reached up to y = -W*0.05 —
    // leaving an 11px band down the middle of the sword where nothing at all was painted. Against
    // the dark arena that gap read as a black stripe through the hilt, which is exactly the
    // "black part" that had to go: it was never a dark colour, it was a hole. Measured at
    // luminance 82 against 188-252 everywhere else on the blade.
    //
    // Light body, deeper-gold binding — the reverse of an earlier version that used a near-black
    // core and read as a charred handle.
    const gr = ctx.createLinearGradient(-W * 0.42, 0, W * 0.42, 0);
    gr.addColorStop(0, HOLY_DEEP);
    gr.addColorStop(0.45, HOLY_LIGHT);
    gr.addColorStop(1, HOLY_GOLD);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(-W * 0.42, W * 0.45);      // well below the guard's top edge, so they overlap
    ctx.lineTo(W * 0.42, W * 0.45);
    ctx.lineTo(W * 0.34, -L * 0.4);
    ctx.lineTo(-W * 0.34, -L * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = HOLY_DEEP;
    ctx.lineWidth = W * 0.14;
    for (let i = 0; i < 4; i++) {
      const y = -W * 1.15 - i * (L * 0.4 - W * 1.2) / 4;
      ctx.beginPath();
      ctx.moveTo(-W * 0.4, y);
      ctx.lineTo(W * 0.4, y);
      ctx.stroke();
    }

    // ---- crossguard, laid OVER the grip the way a real guard sits over the tang. Swept up at the
    // tips, with feathers cut into each quillon — the cuts drawn in the PALE tone, not a dark one,
    // so they catch light rather than casting shadow.
    ctx.shadowColor = HOLY_GOLD;
    ctx.shadowBlur = b.size * 0.14;
    const gg = ctx.createLinearGradient(0, -W, 0, W * 0.7);
    gg.addColorStop(0, HOLY_PALE);
    gg.addColorStop(0.55, HOLY_GOLD);
    gg.addColorStop(1, HOLY_DEEP);
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(-W * 3.4, -W * 0.95);
    ctx.quadraticCurveTo(-W * 1.4, -W * 0.15, -W * 1.05, -W * 0.05);
    ctx.lineTo(W * 1.05, -W * 0.05);
    ctx.quadraticCurveTo(W * 1.4, -W * 0.15, W * 3.4, -W * 0.95);
    ctx.quadraticCurveTo(W * 1.5, W * 0.62, 0, W * 0.68);
    ctx.quadraticCurveTo(-W * 1.5, W * 0.62, -W * 3.4, -W * 0.95);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = HOLY_PALE;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = W * 0.1;
    ctx.lineCap = "round";
    for (const sgn of [-1, 1]) {
      for (let i = 1; i <= 3; i++) {
        const f = i / 4;
        ctx.beginPath();
        ctx.moveTo(sgn * W * 3.3 * f, -W * 0.7 * f + W * 0.2);
        ctx.lineTo(sgn * W * 3.3 * f * 0.86, W * 0.42 * (1 - f * 0.5));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // ---- a collar where the grip meets the guard, closing the seam for good
    ctx.fillStyle = HOLY_LIGHT;
    ctx.beginPath();
    ctx.ellipse(0, -W * 0.55, W * 0.52, W * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- pommel and its stone
    const pg = ctx.createRadialGradient(-W * 0.2, -L * 0.47, 0, 0, -L * 0.44, W * 0.72);
    pg.addColorStop(0, HOLY_PALE);
    pg.addColorStop(1, HOLY_DEEP);
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(0, -L * 0.44, W * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HOLY_WHITE;
    ctx.shadowColor = HOLY_WHITE;
    ctx.shadowBlur = b.size * 0.15 * heat;
    ctx.beginPath();
    ctx.arc(0, -L * 0.44, W * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ---- the line it will come down on, so the hit is announced rather than sprung
    if (p.phase === "hang") {
      ctx.save();
      ctx.globalAlpha = 0.16 + 0.12 * Math.sin(p.k * Math.PI * 5);
      ctx.strokeStyle = HOLY_GOLD;
      ctx.lineWidth = b.size * 0.035;
      ctx.setLineDash([b.size * 0.08, b.size * 0.1]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - p.lift + L);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

    // ---- a trail behind the drive, so the last 0.18s does not read as a teleport
    if (p.phase === "drop") {
      ctx.save();
      ctx.globalAlpha = 0.32 * (1 - p.k);
      const trail = b.size * 1.6;
      const g = ctx.createLinearGradient(b.x, b.y - p.lift, b.x, b.y - p.lift - trail);
      g.addColorStop(0, HOLY_GOLD);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(b.x - W * 1.1, b.y - p.lift - trail, W * 2.2, trail);
      ctx.restore();
    }
  }

  draw(ctx) {
    const h = Math.max(0, this.lift);
    ctx.save();
    if (h > 0) ctx.translate(0, -h);
    // Behind the body, in the same depth slot: it is worn, so it never sorts apart from its wearer.
    if (this.susanooPhase) this.drawSusanoo(ctx);
    super.draw(ctx);
    ctx.restore();
  }

  // The guardian: a warrior in light, standing behind the Angel with a blade in its hand.
  //
  // The previous pass read as an insect and it is worth writing down why, because every one of
  // these choices is the fix for one of those reasons:
  //
  //  - It was built from thin curved strokes with horizontal bands across the torso. Curved ribs
  //    plus gold plus stripes is a wasp. It is now built from FILLED, angular plates.
  //  - Two thin horns stood straight up off a small round head — antennae. It is now a single
  //    swept crest over a proper faceplate with slit eyes.
  //  - The arms were thin rods off a narrow body. There are broad pauldrons now, and the mass
  //    sits in the shoulders the way armour does.
  //
  // Still translucent throughout: the Angel has to stay legible inside it, and a solid figure
  // would simply hide the character it is supposed to be protecting.
  drawSusanoo(ctx) {
    const f = this.shellForm;
    if (f <= 0.01) return;
    const R = this.shellRadius * (0.85 + 0.15 * f);
    const t = performance.now() / 1000;
    const wear = 1 - Math.max(0, this.shellHp) / ANGEL_SUSANOO_HP;   // 0 fresh .. 1 about to break
    const sway = Math.sin(t * 1.4 + this.bodySeed) * 0.025;
    // Faces whoever it is about to run through; otherwise faces the way the Angel does
    const face = Math.cos(this.thrustPhase ? this.thrustAim : this.facingAngle) >= 0 ? 1 : -1;

    ctx.save();
    ctx.translate(this.x, this.y - this.lift);
    ctx.rotate(sway);

    // ---- the aura it stands in
    ctx.globalAlpha = f;
    const aura = ctx.createRadialGradient(0, -R * 0.2, R * 0.25, 0, -R * 0.2, R * 1.25);
    aura.addColorStop(0, "rgba(255,246,214,0.26)");
    aura.addColorStop(0.55, "rgba(255,217,104,0.13)");
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, -R * 0.2, R * 1.25, 0, Math.PI * 2);
    ctx.fill();

    const plate = (alpha) => {
      const g = ctx.createLinearGradient(0, -R, 0, R);
      g.addColorStop(0, `rgba(255,248,226,${alpha})`);
      g.addColorStop(0.55, `rgba(255,217,104,${alpha * 0.8})`);
      g.addColorStop(1, `rgba(240,181,58,${alpha * 0.6})`);
      return g;
    };
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // ---- cuirass: one broad angular plate, wide at the shoulders, tapering to the waist
    ctx.globalAlpha = 0.42 * f;
    ctx.fillStyle = plate(1);
    ctx.beginPath();
    ctx.moveTo(-R * 0.94, -R * 0.62);
    ctx.lineTo(-R * 0.34, -R * 0.86);
    ctx.lineTo(R * 0.34, -R * 0.86);
    ctx.lineTo(R * 0.94, -R * 0.62);
    ctx.lineTo(R * 0.6, R * 0.66);
    ctx.lineTo(0, R * 0.86);
    ctx.lineTo(-R * 0.6, R * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.85 * f;
    ctx.strokeStyle = HOLY_PALE;
    ctx.lineWidth = R * 0.045;
    ctx.stroke();

    // a single vertical ridge down the centre — vertical, not the horizontal banding that made
    // the old one look striped
    ctx.globalAlpha = 0.5 * f;
    ctx.lineWidth = R * 0.05;
    ctx.strokeStyle = HOLY_LIGHT;
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.8);
    ctx.lineTo(0, R * 0.72);
    ctx.stroke();
    // two angled chest facets, catching light off the ridge
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sgn * R * 0.1, -R * 0.72);
      ctx.lineTo(sgn * R * 0.66, -R * 0.4);
      ctx.lineTo(sgn * R * 0.46, R * 0.3);
      ctx.stroke();
    }

    // ---- pauldrons: the mass sits here, which is what makes it read as armour
    ctx.globalAlpha = 0.5 * f;
    for (const sgn of [-1, 1]) {
      ctx.fillStyle = plate(1);
      ctx.beginPath();
      ctx.moveTo(sgn * R * 0.5, -R * 0.86);
      ctx.lineTo(sgn * R * 1.24, -R * 0.72);
      ctx.lineTo(sgn * R * 1.3, -R * 0.16);
      ctx.lineTo(sgn * R * 0.82, -R * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.8 * f;
      ctx.strokeStyle = HOLY_PALE;
      ctx.lineWidth = R * 0.04;
      ctx.stroke();
      ctx.globalAlpha = 0.5 * f;
    }

    // ---- helm: a faceplate with slit eyes under a single swept crest
    ctx.fillStyle = plate(1);
    ctx.globalAlpha = 0.5 * f;
    ctx.beginPath();
    ctx.moveTo(-R * 0.42, -R * 0.9);
    ctx.lineTo(-R * 0.46, -R * 1.36);
    ctx.lineTo(0, -R * 1.56);
    ctx.lineTo(R * 0.46, -R * 1.36);
    ctx.lineTo(R * 0.42, -R * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.85 * f;
    ctx.strokeStyle = HOLY_PALE;
    ctx.lineWidth = R * 0.04;
    ctx.stroke();
    // crest, swept back over the helm
    ctx.globalAlpha = 0.6 * f;
    ctx.fillStyle = plate(1);
    ctx.beginPath();
    ctx.moveTo(-face * R * 0.06, -R * 1.5);
    ctx.quadraticCurveTo(-face * R * 0.5, -R * 1.95, -face * R * 1.02, -R * 1.78);
    ctx.quadraticCurveTo(-face * R * 0.52, -R * 1.68, -face * R * 0.16, -R * 1.4);
    ctx.closePath();
    ctx.fill();
    // slit eyes
    ctx.globalAlpha = 0.95 * f;
    ctx.fillStyle = HOLY_WHITE;
    for (const sgn of [-1, 1]) {
      ctx.save();
      ctx.translate(sgn * R * 0.18, -R * 1.16);
      ctx.rotate(sgn * 0.24);
      ctx.fillRect(-R * 0.11, -R * 0.028, R * 0.22, R * 0.056);
      ctx.restore();
    }
    ctx.globalAlpha = 0.5 * f;

    // ---- arms. The blade arm reaches out along the thrust; the other is braced across the body.
    const pose = this.bladePose();
    const armAim = pose.aim;
    // shoulder of the sword arm, on whichever side it is reaching
    const sx = Math.cos(armAim) * R * 0.72, sy = Math.sin(armAim) * R * 0.72 - R * 0.5;
    const hx = pose.x - this.x, hy = pose.y - (this.y - this.lift);
    const ex = (sx + hx) * 0.5 + Math.cos(armAim + Math.PI / 2) * R * 0.28;
    const ey = (sy + hy) * 0.5 + Math.sin(armAim + Math.PI / 2) * R * 0.28;

    // the off arm, braced
    ctx.strokeStyle = HOLY_GOLD;
    ctx.lineWidth = R * 0.2;
    ctx.beginPath();
    ctx.moveTo(-face * R * 0.86, -R * 0.5);
    ctx.lineTo(-face * R * 1.0, R * 0.16);
    ctx.lineTo(-face * R * 0.5, R * 0.5);
    ctx.stroke();

    // the sword arm
    ctx.lineWidth = R * 0.22;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.globalAlpha = 0.55 * f;
    ctx.strokeStyle = HOLY_PALE;
    ctx.lineWidth = R * 0.08;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    // the fist closed on the grip
    ctx.globalAlpha = 0.6 * f;
    ctx.fillStyle = HOLY_LIGHT;
    ctx.beginPath();
    ctx.arc(hx, hy, R * 0.19, 0, Math.PI * 2);
    ctx.fill();

    // ---- fractures, revealed in the order they were fixed at summon time
    if (wear > 0) {
      ctx.globalAlpha = 0.8 * f;
      ctx.strokeStyle = HOLY_WHITE;
      ctx.lineWidth = R * 0.028;
      for (const cr of this.shellCracks) {
        if (cr.at > wear) continue;
        const x0 = Math.cos(cr.a) * R * cr.r0, y0 = Math.sin(cr.a) * R * cr.r0 - R * 0.2;
        const x1 = Math.cos(cr.a + cr.bend) * R * (cr.r0 + cr.len);
        const y1 = Math.sin(cr.a + cr.bend) * R * (cr.r0 + cr.len) - R * 0.2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo((x0 + x1) * 0.5 + cr.bend * R * 0.2, (y0 + y1) * 0.5, x1, y1);
        ctx.stroke();
      }
    }
    ctx.restore();

    // ---- the blade it is holding, in world space so the drawing and the hit test cannot drift
    this.drawGuardianBlade(ctx, pose, f);
  }

  // The guardian's own sword: the same holy ramp as the judgement blade, but long and narrow —
  // a thrusting weapon rather than something to bring down on a head.
  drawGuardianBlade(ctx, p, f) {
    const L = p.len, W = p.w;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aim);
    ctx.globalAlpha = 0.9 * f;
    ctx.shadowColor = HOLY_GOLD;
    ctx.shadowBlur = W * 3.5;

    // guard
    ctx.fillStyle = HOLY_GOLD;
    ctx.beginPath();
    ctx.moveTo(-W * 0.6, -W * 2.1);
    ctx.lineTo(W * 0.5, -W * 1.3);
    ctx.lineTo(W * 0.5, W * 1.3);
    ctx.lineTo(-W * 0.6, W * 2.1);
    ctx.closePath();
    ctx.fill();

    // blade, running out along +x to a point
    const g = ctx.createLinearGradient(0, -W, 0, W);
    g.addColorStop(0, HOLY_DEEP);
    g.addColorStop(0.42, HOLY_WHITE);
    g.addColorStop(0.7, HOLY_GOLD);
    g.addColorStop(1, HOLY_DEEP);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -W);
    ctx.lineTo(L * 0.72, -W * 0.82);
    ctx.lineTo(L, 0);
    ctx.lineTo(L * 0.72, W * 0.82);
    ctx.lineTo(0, W);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // fuller down the centre, and a lit edge
    ctx.fillStyle = HOLY_GOLD;
    ctx.globalAlpha = 0.7 * f;
    ctx.fillRect(W * 0.4, -W * 0.22, L * 0.62, W * 0.44);
    ctx.globalAlpha = 0.9 * f;
    ctx.strokeStyle = HOLY_WHITE;
    ctx.lineWidth = W * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, -W * 0.86);
    ctx.lineTo(L * 0.72, -W * 0.7);
    ctx.lineTo(L * 0.98, 0);
    ctx.stroke();

    // pommel behind the hand
    ctx.fillStyle = HOLY_PALE;
    ctx.beginPath();
    ctx.arc(-W * 1.5, 0, W * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // (C) The guardian's arm, reaching from the shell's shoulder to the hilt of a judgement blade
  // that is currently hanging. Purely a drawing — the blade's timing, damage and tracking are
  // unchanged, and it still falls exactly the same way if the shell is not up.
  //
  // The point is that the two halves of this character stop looking like two unrelated effects:
  // the light the Angel gathers is handed to the thing standing behind it, and THAT is what
  // brings it down.
  drawSusanooGrip(ctx, b, p) {
    const f = this.shellForm;
    if (f <= 0.01) return;
    const R = this.shellRadius;
    const L = b.size * ANGEL_SWORD_LEN;

    // shoulder on whichever side the target is, so the arm never reaches across its own chest
    const side = b.x >= this.x ? 1 : -1;
    const sx = this.x + side * R * 0.78;
    const sy = this.y - this.lift - R * 0.5;
    // the grip sits a little above the guard
    const hx = b.x;
    const hy = b.y - p.lift - L * 0.2;

    // Elbow pushed outward and up, so the arm reads as reaching over rather than as a straight rod
    const mx = sx + (hx - sx) * 0.45 + side * R * 0.34;
    const my = sy + (hy - sy) * 0.45 - R * 0.3;

    ctx.save();
    ctx.globalAlpha = 0.55 * f;
    ctx.lineCap = "round";
    ctx.strokeStyle = HOLY_GOLD;
    ctx.lineWidth = R * 0.17;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, hx, hy);
    ctx.stroke();
    // a lit core down the middle of the limb
    ctx.globalAlpha = 0.5 * f;
    ctx.strokeStyle = HOLY_PALE;
    ctx.lineWidth = R * 0.07;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, hx, hy);
    ctx.stroke();
    // the fist closed around the grip
    ctx.globalAlpha = 0.62 * f;
    ctx.fillStyle = HOLY_LIGHT;
    ctx.beginPath();
    ctx.arc(hx, hy, R * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The broken halo, lying where it came off. Stays for the rest of the round — the arena should
  // carry evidence of what happened in it, the same way the Earth Mage's pillars do.
  drawBrokenHalo(ctx) {
    const h = this.halo;
    const r = this.size * 0.42;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.globalAlpha = 0.75;
    for (const sh of h.shards) {
      ctx.save();
      ctx.rotate(sh.rot);
      ctx.strokeStyle = ANGEL_GOLD_DEEP;
      ctx.lineWidth = this.size * 0.075;
      ctx.lineCap = "round";
      ctx.beginPath();
      // Flattened hard: it is lying on the floor now, not hovering over a head
      ctx.ellipse(sh.off * 0.4, 0, r, r * 0.3, 0, sh.a0, sh.a0 + sh.span);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,217,104,0.5)";
      ctx.lineWidth = this.size * 0.03;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // A bolt in flight: a soft halo with a four-pointed star spinning inside it, so it reads as
  // light rather than as a pellet at any speed.
  drawBolt(ctx, b) {
    const R = ANGEL_BOLT_RADIUS;
    const core = b.fallen ? "#ffcfc4" : "#ffffff";
    const glow = b.fallen ? FALLEN_EMBER : ANGEL_GOLD;
    ctx.save();
    ctx.translate(b.x, b.y);

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.1);
    g.addColorStop(0, b.fallen ? "rgba(255,74,61,0.55)" : "rgba(255,233,168,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R * 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(b.spin);
    ctx.fillStyle = glow;
    for (let i = 0; i < 2; i++) {
      ctx.save();
      ctx.rotate(i * Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -R * 1.7);
      ctx.quadraticCurveTo(R * 0.28, 0, 0, R * 1.7);
      ctx.quadraticCurveTo(-R * 0.28, 0, 0, -R * 1.7);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- the figure
  drawBody(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const breathe = 1 + Math.sin(t * 1.3 + this.bodySeed) * 0.02;

    // Collapsed on the floor for the two phases before it stands again
    const down = this.transformPhase === "fall" || this.transformPhase === "shatter";
    const rising = this.transformPhase === "rise"
      ? 1 - Math.max(0, this.transformTimer) / ANGEL_RISE_TIME
      : 1;

    ctx.save();
    ctx.translate(this.x, this.y);
    if (down) {
      // Face down, slumped — the silhouette alone should say it is not standing
      ctx.rotate(Math.PI * 0.42);
      ctx.scale(1, 0.82);
    } else if (this.transformPhase === "rise") {
      ctx.rotate(Math.PI * 0.42 * (1 - angelEase(rising)));
    }
    ctx.scale(breathe, breathe);

    this.drawWings(ctx, r, t, down ? 0.25 : (this.transformPhase === "rise" ? angelEase(rising) : 1));
    this.drawRobe(ctx, r);
    if (!this.fallen && !down) this.drawHalo(ctx, r, t);
    ctx.restore();
  }

  // The wings are the whole silhouette, so they get the geometry rather than the body.
  //
  // Two earlier passes were wrong in different ways. The first fanned every feather between -31
  // and -73 degrees, which in this near-top-down view pointed them all straight UP: the character
  // read as wearing a spiky white crest. The second fanned them around the horizontal, correctly,
  // but kept them narrow and evenly spaced — so the wing came out as a starburst of separate
  // shards rather than a wing.
  //
  // What fixes it is how real feathers sit: they OVERLAP heavily, and the half nearest the body is
  // a solid mass with no gaps in it at all. So this draws a filled wing shape first and lays wide,
  // overlapping feathers over it, back-to-front. The separation only shows at the tips, which is
  // the only place it should.
  drawWings(ctx, r, t, spread) {
    if (spread <= 0.01) return;
    const fallen = this.fallen;
    const flap = Math.sin(this.wingPhase) * (this.shellUp ? 0.22 : 0.12);
    const light = fallen ? FALLEN_WING : ANGEL_WING;
    const shade = fallen ? FALLEN_WING_SHADE : ANGEL_WING_SHADE;
    const edge  = fallen ? "rgba(0,0,0,0.55)" : "rgba(126,146,178,0.42)";
    const reach = r * 2.25 * spread;

    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * r * 0.5, -r * 0.26);
      ctx.scale(side, 1);
      ctx.rotate(flap);

      // The solid mass of the wing. Everything else is laid over this, so the inner half can
      // never show a gap between feathers no matter how they land.
      const body = ctx.createLinearGradient(0, 0, reach, 0);
      body.addColorStop(0, shade);
      body.addColorStop(1, light);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, r * 0.16);
      ctx.quadraticCurveTo(r * 0.5, -r * 0.95, reach * 0.82, -r * 0.5);
      ctx.quadraticCurveTo(reach * 0.6, r * 0.34, -r * 0.2, r * 0.16);
      ctx.closePath();
      ctx.fill();

      // Feathers: wide, overlapping, drawn from the top of the fan downward so each one laps over
      // the one behind it the way a real primary does.
      const n = fallen ? 7 : 8;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const a = -0.95 + f * 1.28;                       // -54deg .. +19deg
        const len = reach * (0.62 + Math.sin(f * Math.PI) * 0.42);
        const w = r * 0.34;                               // wide enough that neighbours overlap

        ctx.save();
        ctx.rotate(a);
        const g = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, shade);
        g.addColorStop(0.45, light);
        g.addColorStop(1, fallen ? FALLEN_WING_SHADE : "#ffffff");
        ctx.fillStyle = g;
        ctx.strokeStyle = edge;
        ctx.lineWidth = r * 0.025;
        ctx.beginPath();
        ctx.moveTo(0, r * 0.05);
        if (fallen && i % 3 === 1) {
          // Torn: cut short with a bite out of the trailing edge. Same skeleton as the white
          // wing, so the two forms read as the same wings after something happened to them.
          ctx.quadraticCurveTo(len * 0.45, -w * 0.9, len * 0.66, -w * 0.1);
          ctx.lineTo(len * 0.5, w * 0.3);
          ctx.lineTo(len * 0.68, w * 0.55);
          ctx.quadraticCurveTo(len * 0.34, w * 0.7, 0, r * 0.05);
        } else {
          // Rounded tip, not a spike — the point is what made the last pass read as broken glass
          ctx.quadraticCurveTo(len * 0.5, -w, len * 0.94, -w * 0.22);
          ctx.quadraticCurveTo(len * 1.02, 0, len * 0.9, w * 0.2);
          ctx.quadraticCurveTo(len * 0.45, w * 0.72, 0, r * 0.05);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  drawRobe(ctx, r) {
    const fallen = this.fallen;
    const c0 = fallen ? FALLEN_ROBE_LIGHT : ANGEL_ROBE_LIGHT;
    const c1 = fallen ? FALLEN_ROBE_MID   : ANGEL_ROBE_MID;
    const c2 = fallen ? FALLEN_ROBE_SHADE : ANGEL_ROBE_SHADE;
    const c3 = fallen ? FALLEN_ROBE_HEM   : ANGEL_ROBE_HEM;

    const robe = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.06, 0, 0, r);
    robe.addColorStop(0, c0);
    robe.addColorStop(0.45, c1);
    robe.addColorStop(0.8, c2);
    robe.addColorStop(1, c3);
    ctx.fillStyle = robe;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.995, 0, Math.PI * 2);
    ctx.clip();

    // Folds
    ctx.strokeStyle = fallen ? "rgba(0,0,0,0.45)" : "rgba(140,160,190,0.35)";
    ctx.lineCap = "round";
    for (let i = -2; i <= 2; i++) {
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.moveTo(i * r * 0.24, r * 0.18);
      ctx.quadraticCurveTo(i * r * 0.3, r * 0.6, i * r * 0.36, r * 1.05);
      ctx.stroke();
    }

    // A sash across the chest: gold while it still has a halo, smouldering red once it does not
    ctx.strokeStyle = fallen ? FALLEN_EMBER_DEEP : ANGEL_GOLD_DEEP;
    ctx.lineWidth = r * 0.15;
    ctx.beginPath();
    ctx.moveTo(-r * 0.95, -r * 0.1);
    ctx.quadraticCurveTo(0, r * 0.28, r * 0.95, -r * 0.32);
    ctx.stroke();
    ctx.strokeStyle = fallen ? FALLEN_EMBER : ANGEL_GOLD;
    ctx.lineWidth = r * 0.06;
    ctx.stroke();

    // Hood and eyes. Fallen eyes burn; the white form's are calm and gold.
    ctx.fillStyle = fallen ? FALLEN_ROBE_SHADE : ANGEL_ROBE_SHADE;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.12);
    ctx.quadraticCurveTo(-r * 0.58, -r * 1.0, 0, -r * 0.95);
    ctx.quadraticCurveTo(r * 0.58, -r * 1.0, r * 0.7, -r * 0.12);
    ctx.quadraticCurveTo(0, -r * 0.36, -r * 0.7, -r * 0.12);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = fallen ? "#120e17" : "#5f6f89";
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.5, r * 0.52, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    const eye = fallen ? FALLEN_EMBER : ANGEL_GOLD;
    ctx.fillStyle = eye;
    ctx.shadowColor = eye;
    ctx.shadowBlur = r * (fallen ? 0.5 : 0.3);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * 0.2, -r * 0.5, r * 0.09, r * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  drawHalo(ctx, r, t) {
    const bob = Math.sin(t * 1.7 + this.bodySeed) * r * 0.04;
    ctx.save();
    ctx.translate(0, -r * 1.02 + bob);
    ctx.strokeStyle = ANGEL_GOLD;
    ctx.shadowColor = ANGEL_GOLD;
    ctx.shadowBlur = r * 0.4;
    ctx.lineWidth = r * 0.11;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.56, r * 0.19, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = r * 0.04;
    ctx.stroke();
    ctx.restore();
  }

  // Where a bolt leaves from — the outstretched hand, which reaches further mid-cast.
  handPoint() {
    const r = this.size / 2;
    const reach = r * (0.95 + (this.castTimer > 0 ? 0.3 : 0));
    return {
      x: this.x + Math.cos(this.facingAngle) * reach,
      y: this.y - this.lift + Math.sin(this.facingAngle) * reach - r * 0.15,
    };
  }
}
