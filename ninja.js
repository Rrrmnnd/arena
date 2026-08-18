// Ninja: an ANBU-style dual-wielder — HP 100, speed 400. Two completely separate weapons:
// shuriken are the primary attack, thrown at the opponent's current position every 0.75s
// with no range limit at all (works from anywhere on the field, like Gunner/Demon). The
// dagger is NOT range-gated the same way — it only ever swings as a reaction to an actual
// body-to-body collision (own or wandered-into), landing one hit per fresh touch. So the
// kit is "always poking from a distance, and rewarded extra for actually bumping into them."
//
// Drawn front-on rather than rotating with facingAngle like the rest of the roster — mirrored
// left/right only — so the mask reads clearly instead of spinning into an unrecognizable blob.

const NINJA_MAX_HP = 100;
const NINJA_SPEED  = 400;

const NINJA_MELEE_DAMAGE   = 4;
const NINJA_MELEE_COOLDOWN = 0.4; // one dagger hit per fresh collision, not specified further — tune later

const NINJA_SHURIKEN_DAMAGE   = 3;
const NINJA_SHURIKEN_COOLDOWN = 0.75;
const NINJA_SHURIKEN_SPEED    = 820;
const NINJA_SHURIKEN_LIFE     = 2.0; // safety timeout in case it somehow never leaves the arena
const NINJA_SHURIKEN_SPIN     = 14;  // radians/sec while in flight

const NINJA_ATTACK_ANIM_TIME     = 0.2; // full dagger swing arc on a melee hit
const NINJA_THROW_ANIM_TIME      = 0.15; // shuriken-hand snap on a throw

// A single soft blur left behind by a Three-Slash teleport, right where it dashed from — see
// triggerThreeSlash()/updateDashGhosts()/drawDashGhosts() — so the dash reads as blazing fast
// motion rather than a flat teleport jump-cut.
const NINJA_DASH_GHOST_LIFE = 0.22; // seconds the afterimage takes to fade out

// Victory: a real camera push toward whichever body is being celebrated, pans/zooms it to dead
// center of the screen, holds for a beat with a hard glare, then flickers rapidly in place and
// vanishes — a shunshin-style instant teleport-out rather than a dash across the screen —
// leaving the screen a plain isolated black/vignette hold for good, never cutting back to the
// arena. See onVictory()/updateVictoryZoom()/victoryCameraZoom. The character's own draw size
// never changes; main.js zooms the whole scene in around it instead (see
// Character.victoryCameraZoom).
const NINJA_VICTORY_ZOOM_DURATION    = 1.4;  // seconds to push the camera in to full zoom, centering the subject
const NINJA_VICTORY_HOLD_DURATION    = 0.5;  // seconds held centered at full zoom, glaring, before it starts flickering out
const NINJA_VICTORY_ZOOM_SCALE       = 3.2;  // how much the camera magnifies the scene at full zoom
const NINJA_VICTORY_FLICKER_DURATION = 0.32; // seconds of rapid in-place flicker before vanishing for good
const NINJA_VICTORY_FLICKER_COUNT    = 8;    // on/off toggles across that duration — a fast strobe, not a smooth fade

const NINJA_SWING_START_ANGLE = -1.3; // blade angle (local space) at the start of the swing — raised back
const NINJA_SWING_END_ANGLE   = 1.05; // ...and at the end — driven down across the front
const NINJA_DAGGER_SCALE = 1.3; // the blade is drawn at this x the character's own size scale — a bit bigger than the body proportions alone would give it

// A separate, much wider/bigger swing used only for Three-Slash strikes (see bigSlashTimer),
// so the ultimate reads as a heavier, more dramatic cut than a regular dagger poke. The third
// and final strike goes bigger still — see NINJA_SLASH_FINAL_DAGGER_SCALE below.
const NINJA_BIG_SWING_START_ANGLE = -1.95;
const NINJA_BIG_SWING_END_ANGLE   = 1.75;
const NINJA_BIG_DAGGER_SCALE      = 2.1;

// Ultimate — Three-Slash: on a 17s cooldown, teleports behind the current opponent (same
// "close the gap instantly" trick used throughout the roster) and lands three strikes on them,
// building in weight — NINJA_SLASH_DAMAGES is [5, 5, 10], so the finishing third blow is twice
// as heavy as the first two, with a bigger blade, an even heavier blood burst, and a longer
// hang-time (NINJA_SLASH_FINAL_ANIM_TIME) to sell it as the payoff. The pace between strikes
// (NINJA_SLASH_INTERVAL) is deliberately slow — more a held, cinematic beat than a fast flurry.
// The target is held completely still (a continuously topped-up stun, same idiom every
// multi-hit finisher in the game uses) from the teleport-in through the final strike. Landing
// the last strike doesn't chain into the regular dagger hit even though they're already
// standing right on top of each other afterward — meleeTimer gets set on the way out specifically
// to block that. Every strike still funnels through dealDamage() like anything else the Ninja
// lands, so it also chips normally at the cooldown for the NEXT cast — clones included now, same
// as the original (see NinjaClone below).
//
// Separately — not tied to the ultimate at all — every fighter in the family (the original, and
// any clone, independently) watches its own HP: the instant it first drops below half its own
// max, it summons one NINJA_CLONE_MAX_HP-HP clone to fight alongside it, using the exact same
// clone mechanism as before (see triggerShadowClone() and NinjaClone below) — just triggered by
// taking damage instead of a cooldown. Purely one-shot per fighter; it doesn't retrigger if HP
// climbs back up or drops further. A dashed marker on the HP bar (see drawHpMidpointMarker)
// shows exactly where that halfway line sits.
const NINJA_ULTIMATE_COOLDOWN      = 17.0;
const NINJA_SLASH_DAMAGES          = [5, 5, 10]; // per strike, in order — the third lands heaviest
const NINJA_SLASH_COUNT            = NINJA_SLASH_DAMAGES.length;
const NINJA_SLASH_TOTAL_DAMAGE     = NINJA_SLASH_DAMAGES.reduce((a, b) => a + b, 0); // 20
const NINJA_SLASH_INTERVAL         = 0.55; // seconds between strikes — slow and deliberate, not a fast flurry
const NINJA_SLASH_ANIM_TIME        = 0.4;  // how long strikes 1-2's swing takes to play out
const NINJA_SLASH_FINAL_ANIM_TIME  = 0.55; // the finishing third strike lingers even longer
const NINJA_SLASH_FINAL_DAGGER_SCALE = 2.8; // bigger than NINJA_BIG_DAGGER_SCALE, for strike 3 only
const NINJA_SLASH_STUN_TOPUP       = 0.2;  // refreshed every frame while slashing so the target's own update() keeps bailing early
const NINJA_CLONE_MAX_HP           = 25;
const NINJA_ULTIMATE_COOLDOWN_PER_DAMAGE = 0.1; // seconds shaved off the ultimate cooldown per point of damage dealt — original and clones alike

// HUD geometry for the clone panel (see drawCloneHud). These mirror what Character.drawHud()
// lays out from its `y`, which it doesn't expose: the name sits on the baseline at y, the HP bar
// spans y+14..y+32, the ultimate bar y+36..y+46, and it returns y+62. So a block's bottom edge is
// DROP below its baseline, and the next block's baseline is BLOCK_H below this one's.
const NINJA_HUD_BLOCK_H       = 62;
const NINJA_HUD_BLOCK_DROP    = 46;
const NINJA_CLONE_HUD_GAP     = 8;  // breathing room between the Ninja's own panel and the clones'

class Shuriken {
  constructor(x, y, angle) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * NINJA_SHURIKEN_SPEED;
    this.vy = Math.sin(angle) * NINJA_SHURIKEN_SPEED;
    this.spin = Math.random() * Math.PI * 2;
    this.life = NINJA_SHURIKEN_LIFE;
  }
}

class Ninja extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: CHAR_BASE_SIZE,
      color: "#3a3a46",
      maxHp: NINJA_MAX_HP,
      name: "Ninja",
      speed: NINJA_SPEED,
    });

    this.facingAngle = Math.random() * Math.PI * 2; // still tracked for aim/mirror, just not drawn as a rotation
    this.meleeTimer = 0;      // >0 briefly after a dagger hit, gates the next one to a fresh collision
    this.meleeAnimTimer = 0;  // purely cosmetic swing flash
    this.bigSlashTimer = 0;   // >0 during a Three-Slash strike specifically — draws bigger/wider than a normal swing
    this.bigSlashDuration = NINJA_SLASH_ANIM_TIME; // whichever duration bigSlashTimer was actually set to (strikes 1-2 vs the longer strike 3), so swing progress reads correctly
    this.bigSlashScale = NINJA_BIG_DAGGER_SCALE;    // ditto, for the blade's drawn size (strike 3 goes bigger — see NINJA_SLASH_FINAL_DAGGER_SCALE)
    this.shurikenTimer = 0;
    this.throwAnimTimer = 0;
    this.shurikens = [];

    this.ultimateCooldown = NINJA_ULTIMATE_COOLDOWN; // starts on cooldown, not ready at spawn
    this.clones = []; // every NinjaClone this fighter has summoned directly, dead ones included
    this.cloneRoot = this; // shared by every body in the same clone family — see onCollide's family check
    this.lowHpCloneSummoned = false; // one-shot: set the instant this fighter's own HP first drops below half

    this.slashing = false;   // mid-Three-Slash: takes over update() entirely, same idea as PM2's blitz
    this.slashTarget = null; // locked at teleport-in, ignores whatever opponent update() is called with afterward
    this.slashesLanded = 0;
    this.slashTimer = 0;     // counts down between strikes
    this.dashGhosts = [];    // { x, y, life } — afterimages left behind by a Three-Slash teleport

    // Victory: a real camera push (see victoryCameraZoom below) toward whichever body actually
    // represents the win — the character itself stays put at its own actual field position and
    // just gets drawn glaring; it's the whole scene around it that zooms in, via main.js's
    // generic hook, same idea as the celebratingVictory/drawVictoryOverlay hook Demon uses for
    // its own (different) fullscreen technique. celebratingVictory and the timer/phase only
    // ever live on the original — that's what main.js checks — even when the focus is a clone;
    // isVictoryFocus marks whichever single body, original or clone, is the one actually being
    // celebrated, which is what drives both the glare and (once "gone") vanishing from the field.
    this.celebratingVictory = false;
    this.victoryTimer = 0;
    this.victoryPhase = "zoom"; // "zoom" -> "hold" -> "flicker" -> "black" (terminal — stays forever)
    this.victoryFocus = null;
    this.isVictoryFocus = false;
  }

  onVictory() {
    this.celebratingVictory = true;
    this.victoryTimer = 0;
    this.victoryPhase = "zoom";
    playSfx("ninjaVictory", 0.8);

    // The original if it's still standing; otherwise the win only happened because a clone was
    // still fighting after it died (see isFighterDown() in main.js), so that's who the camera
    // actually needs to focus on instead.
    const focus = this.alive ? this : (this.getExtraBodies()[0] || this);
    this.victoryFocus = focus;
    focus.isVictoryFocus = true;
    focus.movable = false;
    focus.vx = 0;
    focus.vy = 0;
  }

  // zoom: the camera pushes in AND pans, ending with the subject dead centered on screen at
  // full zoom, over NINJA_VICTORY_ZOOM_DURATION; hold: sits there, centered, glaring, for
  // NINJA_VICTORY_HOLD_DURATION; flicker: strobes rapidly in place — camera and character both
  // completely still, only visibility toggling — over NINJA_VICTORY_FLICKER_DURATION; black:
  // terminal — nothing left to draw, the isolated dark frame just holds forever, since main.js's
  // isolate branch never falls back to the normal arena/HUD scene while this is still
  // "celebratingVictory".
  updateVictoryZoom(dt) {
    this.victoryTimer += dt;
    const focus = this.victoryFocus || this;
    if (this.victoryPhase === "zoom" && this.victoryTimer >= NINJA_VICTORY_ZOOM_DURATION) {
      this.victoryPhase = "hold";
      this.victoryTimer = 0;
    } else if (this.victoryPhase === "hold" && this.victoryTimer >= NINJA_VICTORY_HOLD_DURATION) {
      this.victoryPhase = "flicker";
      this.victoryTimer = 0;
      playSfx("ninjaSmokeThrow", 0.6);
      playSfx("ninjaTeleport", 0.7);
      spawnFlash(focus.x, focus.y, "#dcdce4", 40, 0.12);
    } else if (this.victoryPhase === "flicker" && this.victoryTimer >= NINJA_VICTORY_FLICKER_DURATION) {
      this.victoryPhase = "black";
      this.victoryTimer = 0;
      playSfx("ninjaClone", 0.6); // reuses the same poof/teleport sound as the Shadow Clone jutsu
      spawnSmokePuff(focus.x, focus.y, 56, 0.5);
      spawnFlash(focus.x, focus.y, "#dcdce4", 70, 0.22);
    }
  }

  // A real camera push toward victoryFocus, for main.js to apply as a transform around the
  // whole scene — see the generic default on Character for the full rationale. isolate/subject
  // ask main.js for a stark "to be continued" freeze-frame — just this one body on the
  // background, no arena, no other fighter, no HUD clutter — instead of the normal full scene.
  // Never reports null while still celebrating (even once "black" and subject is empty) — the
  // isolated frame is meant to hold for good, not hand the draw back to the normal scene.
  //
  // panX/panY is where the anchor point should land on screen; anchorX/anchorY is the world
  // point being tracked — during "zoom" it pans from the subject's own actual position to dead
  // center; every phase after that just keeps tracking the subject live since it never actually
  // moves again (see the "flicker" branch below for how the vanish itself is sold instead).
  get victoryCameraZoom() {
    if (!this.celebratingVictory) return null;
    const focus = this.victoryFocus || this;

    if (this.victoryPhase === "zoom") {
      const t = Math.min(1, this.victoryTimer / NINJA_VICTORY_ZOOM_DURATION);
      const eased = t * t * (3 - 2 * t); // smoothstep: gentle at both ends, not a rush
      const scale = 1 + (NINJA_VICTORY_ZOOM_SCALE - 1) * eased;
      const panX = focus.x + (WIDTH / 2 - focus.x) * eased;
      const panY = focus.y + (HEIGHT / 2 - focus.y) * eased;
      return { panX, panY, anchorX: focus.x, anchorY: focus.y, scale, isolate: true, subject: focus };
    }

    if (this.victoryPhase === "hold") {
      return { panX: WIDTH / 2, panY: HEIGHT / 2, anchorX: focus.x, anchorY: focus.y, scale: NINJA_VICTORY_ZOOM_SCALE, isolate: true, subject: focus };
    }

    if (this.victoryPhase === "flicker") {
      // A fast in-place strobe — camera and position both frozen, subject alternates between
      // fully drawn and skipped entirely every fraction of a second. Reusing the same "subject
      // can be null" plumbing main.js already needs for the "black" phase below is what makes
      // this read as an instant flicker-and-cut rather than a smooth fade.
      const stepDur = NINJA_VICTORY_FLICKER_DURATION / NINJA_VICTORY_FLICKER_COUNT;
      const step = Math.floor(this.victoryTimer / stepDur);
      const visible = step % 2 === 0;
      return { panX: WIDTH / 2, panY: HEIGHT / 2, anchorX: focus.x, anchorY: focus.y, scale: NINJA_VICTORY_ZOOM_SCALE, isolate: true, subject: visible ? focus : null };
    }

    // "black": gone for good — hold the isolated dark frame with nothing left to draw.
    return { panX: WIDTH / 2, panY: HEIGHT / 2, anchorX: focus.x, anchorY: focus.y, scale: NINJA_VICTORY_ZOOM_SCALE, isolate: true, subject: null };
  }

  // Every hit the Ninja lands funnels through here, so the ultimate cooldown melts down in
  // proportion to damage dealt regardless of which weapon actually landed it.
  dealDamage(opponent, dmg) {
    opponent.takeDamage(dmg);
    this.ultimateCooldown = Math.max(0, this.ultimateCooldown - dmg * NINJA_ULTIMATE_COOLDOWN_PER_DAMAGE);
  }

  // Reacts to an actual touch — own wandering into them, or them into it — rather than a range
  // check. Bodies sharing a cloneRoot (the original and any of its clones, at any depth) still
  // physically bounce off each other via resolveCollision, but never land a hit on each other.
  onCollide(opponent) {
    if (!opponent.alive || !this.canAttack || this.stunTimer > 0) return;
    // Mid-Three-Slash, they're standing right on top of each other for several overlapping
    // frames in a row — without this, the ordinary per-touch dagger hit would fire on top of
    // the combo instead of after it, since resolveCollision() has no idea a combo is running.
    if (this.slashing) return;
    if (opponent.cloneRoot === this.cloneRoot) return;
    if (this.meleeTimer > 0) return;
    this.meleeTimer = NINJA_MELEE_COOLDOWN;
    this.meleeAnimTimer = NINJA_ATTACK_ANIM_TIME;
    this.dealDamage(opponent, NINJA_MELEE_DAMAGE);

    playSfx("ninjaDagger", 0.35);
    const impactX = (this.x + opponent.x) / 2;
    const impactY = (this.y + opponent.y) / 2;
    const hitAngle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
    spawnBloodSpurt(impactX, impactY, hitAngle, 22, 1.3);
  }

  throwShuriken(opponent) {
    const dx = opponent.x - this.x, dy = opponent.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const spawnDist = this.size / 2 + 6;
    this.shurikens.push(new Shuriken(this.x + Math.cos(angle) * spawnDist, this.y + Math.sin(angle) * spawnDist, angle));
    this.throwAnimTimer = NINJA_THROW_ANIM_TIME;
    playSfx("ninjaShuriken", 0.3);
  }

  updateShurikens(dt, opponent) {
    for (let i = this.shurikens.length - 1; i >= 0; i--) {
      const s = this.shurikens[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.spin += dt * NINJA_SHURIKEN_SPIN;

      let gone = s.life <= 0 || s.x < ARENA.x || s.x > ARENA.x + ARENA.w || s.y < ARENA.y || s.y > ARENA.y + ARENA.h;

      if (!gone && opponent && opponent.alive) {
        const dist = Math.hypot(opponent.x - s.x, opponent.y - s.y);
        if (dist <= opponent.size / 2 + 6) {
          this.dealDamage(opponent, NINJA_SHURIKEN_DAMAGE);
          // A lighter spurt than the dagger's own hit — it's a quick puncture, not a slash —
          // on top of the existing metal-on-impact sparks.
          spawnBloodSpurt(s.x, s.y, Math.atan2(s.vy, s.vx), 12, 0.9);
          spawnImpactParticles(s.x, s.y, ["#c4cdd6", "#ffffff", "#8a94a0"], 10, 1, 0);
          gone = true;
        }
      }

      if (gone) this.shurikens.splice(i, 1);
    }
  }

  // Fired once — and only once — by whichever fighter's own HP just crossed below half; always
  // adds a new clone alongside whatever it already has, nothing is ever replaced or dismissed.
  triggerShadowClone() {
    const clone = new NinjaClone(this.x, this.y);
    clone.cloneRoot = this.cloneRoot;
    this.clones.push(clone);
    playSfx("ninjaSmokeThrow", 0.6); // the little puff pop, layered under...
    playSfx("ninjaClone", 0.7);      // ...the actual summon sound
    // A Naruto-style poof of smoke at the summon point — the clone is already standing there
    // underneath it (see the constructor call above), just briefly obscured as the smoke blooms
    // and clears, rather than simply popping into view with nothing to sell the transformation.
    spawnSmokePuff(this.x, this.y, 56, 0.5);
    spawnFlash(this.x, this.y, "#c8c8d0", 60, 0.25);
  }

  // Teleports directly behind the opponent — relative to whichever way THEY'RE currently facing
  // (falling back to their direction of travel, then a random angle, if neither is available) —
  // and locks them in as slashTarget for the whole sequence, ignoring whatever opponent update()
  // gets called with from here on, same reasoning as PM2's blitz (see its updateBlitz comment):
  // a multi-hit finisher has to keep hitting whoever it actually grabbed, not whoever main.js's
  // targeting happens to prefer a frame later.
  triggerThreeSlash(opponent) {
    this.slashing = true;
    this.slashTarget = opponent;
    this.slashesLanded = 0;

    const startX = this.x, startY = this.y;

    const facingDir = typeof opponent.facingAngle === "number"
      ? opponent.facingAngle
      : Math.hypot(opponent.vx, opponent.vy) > 1
        ? Math.atan2(opponent.vy, opponent.vx)
        : Math.random() * Math.PI * 2;
    const standDist = (this.size + opponent.size) / 2 + 4;
    // Their back is the point directly opposite their front; standing there and facing back
    // toward them means facing along the same direction they're facing.
    this.x = opponent.x - Math.cos(facingDir) * standDist;
    this.y = opponent.y - Math.sin(facingDir) * standDist;
    this.facingAngle = facingDir;

    // A single soft blur left behind right where it dashed from — sells "closed that gap in a
    // blazing-fast blur" without cluttering the screen with a whole strung-out trail of full,
    // detailed copies (dagger swing and all). sparkAngles are rolled once here and reused every
    // frame it's drawn (see drawDashGhosts) so the scattering glints hold a fixed layout instead
    // of jittering to a new random spread each frame.
    this.dashGhosts.push({
      x: startX, y: startY, life: NINJA_DASH_GHOST_LIFE,
      dashAngle: Math.atan2(this.y - startY, this.x - startX),
      sparkAngles: Array.from({ length: 6 }, () => Math.random() * Math.PI * 2),
    });

    playSfx("ninjaSmokeThrow", 0.5); // the little pop it teleports in with
    playSfx("ninjaTeleport", 0.6);
    spawnFlash(this.x, this.y, "#dcdce4", 46, 0.15);

    opponent.movable = false;
    opponent.stunTimer = Math.max(opponent.stunTimer, NINJA_SLASH_STUN_TOPUP);

    this.landSlash(); // the first strike lands the instant it arrives, no extra delay
  }

  // One strike of the three, called on arrival and then again every NINJA_SLASH_INTERVAL.
  // bigSlashTimer/bigSlashDuration/bigSlashScale run in parallel with meleeAnimTimer purely so
  // drawBody() can tell this swing apart from a regular dagger hit and render it bigger, wider,
  // and (for the third strike) bigger still, instead of the normal quick flick.
  landSlash() {
    const target = this.slashTarget;
    const hitIndex = this.slashesLanded; // 0, 1, 2 for strikes 1, 2, 3
    const isFinal = hitIndex === NINJA_SLASH_COUNT - 1;
    this.slashesLanded++;

    const animTime = isFinal ? NINJA_SLASH_FINAL_ANIM_TIME : NINJA_SLASH_ANIM_TIME;
    this.meleeAnimTimer = animTime;
    this.bigSlashTimer = animTime;
    this.bigSlashDuration = animTime;
    this.bigSlashScale = isFinal ? NINJA_SLASH_FINAL_DAGGER_SCALE : NINJA_BIG_DAGGER_SCALE;
    this.dealDamage(target, NINJA_SLASH_DAMAGES[hitIndex]);

    playSfx("ninjaDagger", isFinal ? 0.95 : 0.7);
    const cutX = (this.x + target.x) / 2, cutY = (this.y + target.y) / 2;
    const cutAngle = Math.atan2(target.y - this.y, target.x - this.x);
    // Strikes 1-2 are toned down from the original pass (read as too much blood for what's
    // meant to be the buildup) — the finishing third strike is unchanged, still the big payoff.
    if (isFinal) {
      spawnBloodSpurt(cutX, cutY, cutAngle, 90, 3.1);
      spawnImpactParticles(cutX, cutY, ["#b03030", "#8a0f0f", "#ffffff"], 30, 2.2, 60);
      spawnFlash(cutX, cutY, "#ff2020", 135, 0.38);
      triggerShake(15, 0.32);
    } else {
      spawnBloodSpurt(cutX, cutY, cutAngle, 30, 1.6);
      spawnImpactParticles(cutX, cutY, ["#b03030", "#8a0f0f", "#ffffff"], 10, 1.0, 60);
      spawnFlash(cutX, cutY, "#ff2020", 95, 0.28);
      triggerShake(9, 0.22);
    }

    if (this.slashesLanded >= NINJA_SLASH_COUNT) this.endThreeSlash();
    else this.slashTimer = NINJA_SLASH_INTERVAL;
  }

  // Releases the target and, critically, gates the regular dagger off for a beat — they're
  // still standing right on top of each other afterward, and without this the very next
  // overlapping frame would immediately chain into a normal onCollide() hit on top of the
  // combo that was just supposed to be the whole payoff.
  endThreeSlash() {
    const target = this.slashTarget;
    if (target) target.movable = true;
    this.slashing = false;
    this.slashTarget = null;
    this.meleeTimer = NINJA_MELEE_COOLDOWN;
  }

  updateDashGhosts(dt) {
    for (let i = this.dashGhosts.length - 1; i >= 0; i--) {
      this.dashGhosts[i].life -= dt;
      if (this.dashGhosts[i].life <= 0) this.dashGhosts.splice(i, 1);
    }
  }

  // Not a full detailed copy (no dagger, no swing — nothing that could read as also mid-attack)
  // but dressed up enough to still land as "a fading afterimage of the ninja", not just a plain
  // smudge: a two-tone silhouette core, a hint of the headband color so it reads as *this*
  // character, a quick outward light-pulse ring (the classic "just teleported" beat), and a
  // handful of tiny scattering shuriken-shard glints — all fading together over the same short
  // window, right where the dash started from.
  drawDashGhosts(ctx) {
    for (const g of this.dashGhosts) {
      const t = Math.max(0, g.life / NINJA_DASH_GHOST_LIFE); // 1 -> 0
      const r = (this.size / 2) * 1.15;

      ctx.save();
      ctx.translate(g.x, g.y);

      // Silhouette core: a two-stop gradient instead of a flat smudge, so it has some depth
      ctx.globalAlpha = t * 0.5;
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, "#4a4a58");
      grad.addColorStop(0.55, "#26262e");
      grad.addColorStop(1, "rgba(38,38,46,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      // A faint arc of headband red, just enough to hint whose afterimage this is
      ctx.globalAlpha = t * 0.4;
      ctx.strokeStyle = "#7a1f22";
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.6, -0.55, 0.55);
      ctx.stroke();

      // An outward light-pulse ring and scattering glints, glowing on top of the silhouette
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = t * 0.5;
      ctx.strokeStyle = "#dcdce4";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * (0.85 + (1 - t) * 0.9), 0, Math.PI * 2);
      ctx.stroke();

      for (const a of g.sparkAngles) {
        const dist = r * (0.55 + (1 - t) * 1.2);
        ctx.save();
        ctx.translate(Math.cos(a) * dist, Math.sin(a) * dist);
        ctx.rotate(a + g.dashAngle);
        ctx.globalAlpha = t * 0.85;
        ctx.fillStyle = "#e8ecf4";
        ctx.beginPath();
        ctx.moveTo(0, -3.2); ctx.lineTo(1.6, 0); ctx.lineTo(0, 3.2); ctx.lineTo(-1.6, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    }
  }

  // Bounces every body in this clone family — the original and its whole tree of clones, at
  // any depth — off each other, so they never just overlap. Only the original (not any clone)
  // actually runs this each frame, resolving the whole tree in one pass, since every clone's
  // own update() would otherwise redundantly re-resolve the same pairs a second time.
  resolveCloneCollisions() {
    if (this !== this.cloneRoot) return;
    const bodies = [this, ...this.getExtraBodies()];
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++)
        resolveCollision(bodies[i], bodies[j]);
  }

  update(dt, opponent) {
    // Independent of everything below — every clone is its own fighter and keeps acting even if
    // the original is mid-death-fade or otherwise not updating past this point.
    for (const c of this.clones) c.update(dt, opponent);
    this.resolveCloneCollisions();
    this.updateDashGhosts(dt);

    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt;

    // Has to run before the alive-gate below, not after: the original can win via a surviving
    // clone even after its own body is gone (see onVictory()/victoryFocus), and the victory
    // sequence's shared timing always lives here regardless of who's actually being shown —
    // it can't be allowed to freeze just because the original itself already died.
    if (this.celebratingVictory) {
      this.updateVictoryZoom(dt);
      return;
    }

    if (!this.alive) return;

    // A clone that got picked as the victory focus (see onVictory()) just holds still, glaring,
    // instead of acting normally, while the camera does the rest (see victoryCameraZoom).
    if (this.isVictoryFocus) return;

    // Checked unconditionally (not gated on canAttack/stun/slashing/etc.) so it can't be starved
    // out — the instant this fighter's own HP first drops below half, it gets its one backup
    // clone, full stop.
    if (!this.lowHpCloneSummoned && this.hp < this.maxHp / 2) {
      this.lowHpCloneSummoned = true;
      this.triggerShadowClone();
    }

    // The combo takes over completely — no wandering, no shuriken, no new ultimate cast — until
    // the third strike lands or the target's gone.
    if (this.slashing) {
      if (this.meleeAnimTimer > 0) this.meleeAnimTimer -= dt;
      if (this.bigSlashTimer > 0) this.bigSlashTimer -= dt;
      const target = this.slashTarget;
      if (!target || !target.alive) { this.endThreeSlash(); return; }
      target.movable = false;
      target.stunTimer = Math.max(target.stunTimer, NINJA_SLASH_STUN_TOPUP);
      this.slashTimer -= dt;
      if (this.slashTimer <= 0) this.landSlash();
      return;
    }

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x, dy = opponent.y - this.y;
      if (Math.hypot(dx, dy) > 0.01) this.facingAngle = Math.atan2(dy, dx);
    }

    // Plain wandering, no attack-range slowdown — melee isn't something it walks up to use
    // any more, it's purely a reaction to whatever collisions happen to occur.
    super.update(dt, opponent);

    if (this.meleeTimer > 0) this.meleeTimer -= dt;
    if (this.meleeAnimTimer > 0) this.meleeAnimTimer -= dt;
    if (this.bigSlashTimer > 0) this.bigSlashTimer -= dt;
    if (this.throwAnimTimer > 0) this.throwAnimTimer -= dt;

    this.updateShurikens(dt, opponent);

    if (this.stunTimer > 0) return;

    if (this.shurikenTimer > 0) this.shurikenTimer -= dt;
    if (opponent && opponent.alive && this.shurikenTimer <= 0 && this.canAttack) {
      this.shurikenTimer += NINJA_SHURIKEN_COOLDOWN;
      this.throwShuriken(opponent);
    }

    // Needs a live opponent to teleport to, unlike the old cooldown-based clone summon this
    // replaced — if the cooldown comes up with nobody to hit, it just waits.
    if (this.ultimateCooldown > 0) this.ultimateCooldown -= dt;
    if (this.ultimateCooldown <= 0 && this.canAttack && opponent && opponent.alive) {
      this.ultimateCooldown = NINJA_ULTIMATE_COOLDOWN;
      this.triggerThreeSlash(opponent);
    }
  }

  // A single four-pointed throwing star.
  drawShurikenShape(ctx, size, spin) {
    ctx.save();
    ctx.rotate(spin);
    ctx.fillStyle = "#c4cdd6";
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const ax = Math.cos(a) * size, ay = Math.sin(a) * size;
      const ba = a + Math.PI / 4;
      const bx = Math.cos(ba) * size * 0.3, by = Math.sin(ba) * size * 0.3;
      if (i === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = size * 0.08;
    ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawShurikensInFlight(ctx) {
    for (const s of this.shurikens) {
      ctx.save();
      ctx.translate(s.x, s.y);
      this.drawShurikenShape(ctx, this.size * 0.16, s.spin); // slightly bigger than the held off-hand fan's own scale, just for the in-flight throw
      ctx.restore();
    }
  }

  // The dagger's angle mid-swing (local space), 0 -> 1 across the arc. `big` swaps in the
  // wider, more dramatic sweep used for Three-Slash strikes instead of the normal quick flick.
  swingAngleAt(swingT, big = false) {
    const k = Math.max(0, Math.min(1, swingT));
    const start = big ? NINJA_BIG_SWING_START_ANGLE : NINJA_SWING_START_ANGLE;
    const end   = big ? NINJA_BIG_SWING_END_ANGLE   : NINJA_SWING_END_ANGLE;
    return start + (end - start) * k;
  }

  // A proper double-edged dagger: wrapped grip, a small crossguard, then a leaf-shaped blade
  // tapering to a point with a center ridge line — not just a thin triangle, which read as a
  // saw blade once a few copies overlapped at different angles. `scale` lets Three-Slash draw
  // it bigger than a regular swing (bigger still for the finishing third strike).
  drawDagger(ctx, pivotX, pivotY, angle, alpha, scale = NINJA_DAGGER_SCALE) {
    const s = this.size * scale;
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;

    // grip, with a couple of wrap lines
    ctx.fillStyle = "#4a3524";
    ctx.fillRect(-s * 0.16, -s * 0.055, s * 0.22, s * 0.11);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    for (const wx of [-s * 0.1, -s * 0.02, s * 0.06]) {
      ctx.beginPath();
      ctx.moveTo(wx, -s * 0.055);
      ctx.lineTo(wx, s * 0.055);
      ctx.stroke();
    }

    // crossguard
    ctx.fillStyle = "#7a828c";
    ctx.fillRect(s * 0.06, -s * 0.09, s * 0.04, s * 0.18);

    // blade: tapers from the guard to a sharp point, slightly widest just past the guard
    ctx.fillStyle = "#e4eaf0";
    ctx.beginPath();
    ctx.moveTo(s * 0.1, -s * 0.065);
    ctx.lineTo(s * 0.24, -s * 0.075);
    ctx.lineTo(s * 0.5, 0);
    ctx.lineTo(s * 0.24, s * 0.075);
    ctx.lineTo(s * 0.1, s * 0.065);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // center ridge for a bit of dimension
    ctx.strokeStyle = "rgba(120,130,140,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s * 0.12, 0);
    ctx.lineTo(s * 0.46, 0);
    ctx.stroke();

    ctx.restore();
  }

  // The white-light streak the blade leaves behind as it sweeps — an arc traced from the
  // start of the swing to its current position, not overlapping blade copies, so it reads as
  // one clean slash mark instead of a stack of angled shapes. `big` matches drawDagger's wider
  // sweep; `scale` matches its blade size (bigger still for the finishing third strike) and
  // scales the trail's thickness right along with it.
  drawSwingTrail(ctx, pivotX, pivotY, swingT, big = false, scale = NINJA_DAGGER_SCALE) {
    const tipR = this.size * scale * 0.5;
    const startAngle = big ? NINJA_BIG_SWING_START_ANGLE : NINJA_SWING_START_ANGLE;
    const endAngle = this.swingAngleAt(swingT, big);
    if (Math.abs(endAngle - startAngle) < 0.02) return;

    // Eases out over the last stretch of the swing instead of cutting off abruptly
    const fade = swingT < 0.8 ? 1 : Math.max(0, 1 - (swingT - 0.8) / 0.2);
    const widthMul = big ? scale / NINJA_DAGGER_SCALE : 1;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    ctx.globalAlpha = fade * (big ? 0.55 : 0.35);
    ctx.strokeStyle = big ? "#ffe0e0" : "#ffffff";
    ctx.lineWidth = this.size * 0.16 * widthMul;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, tipR, startAngle, endAngle);
    ctx.stroke();

    ctx.globalAlpha = fade * (big ? 1 : 0.9);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = this.size * 0.045 * widthMul;
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, tipR, startAngle, endAngle);
    ctx.stroke();

    ctx.restore();
  }

  // A solid black wrapped figure — no separate body/head, just the one circle everyone else
  // in the roster uses — with a skin-toned band showing only around the eyes, a headband
  // tied above it, and both weapons held out past the silhouette. Always drawn front-on;
  // only mirrored left/right based on facing, so it never rotates into an unreadable blob.
  // x/y/size default to its own; glaring defaults to whether it's currently the victory focus
  // (see isVictoryFocus), so the narrowed, hard eyes just happen automatically during that
  // sequence without every caller needing to know or care.
  drawBody(ctx, x = this.x, y = this.y, size = this.size, glaring = this.isVictoryFocus) {
    const r = size / 2;
    const flip = Math.cos(this.facingAngle) < 0 ? -1 : 1;
    const t = performance.now() / 1000;
    const throwKick = this.throwAnimTimer > 0 ? this.throwAnimTimer / NINJA_THROW_ANIM_TIME : 0;
    const swinging = this.meleeAnimTimer > 0;
    const bigSlash = swinging && this.bigSlashTimer > 0;
    const swingT = swinging ? 1 - this.meleeAnimTimer / (bigSlash ? this.bigSlashDuration : NINJA_ATTACK_ANIM_TIME) : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flip, 1);

    // Headband tails, streaming down behind, fluttering on their own
    for (const side of [-1, 1]) {
      const rootX = side * r * 0.42;
      const len = r * 0.95;
      ctx.beginPath();
      for (let i = 0; i <= 5; i++) {
        const f = i / 5;
        const wob = Math.sin(t * 5 + f * 3.5 + side * 1.3) * 3 * f;
        ctx.lineTo(rootX + wob - r * 0.07 * (1 - f * 0.5), -r * 0.3 + len * f);
      }
      for (let i = 5; i >= 0; i--) {
        const f = i / 5;
        const wob = Math.sin(t * 5 + f * 3.5 + side * 1.3) * 3 * f;
        ctx.lineTo(rootX + wob + r * 0.07 * (1 - f * 0.5), -r * 0.3 + len * f);
      }
      ctx.closePath();
      ctx.fillStyle = side < 0 ? "#7a1f22" : "#5f1618";
      ctx.fill();
    }

    // Body: one solid, near-black wrapped circle
    const grad = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.12, 0, 0, r * 1.02);
    grad.addColorStop(0, "#26262c");
    grad.addColorStop(1, "#0e0e11");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Skin-toned band, showing only around the eyes — clipped to the body circle so it never
    // pokes past the silhouette
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#caa06e";
    ctx.fillRect(-r, -r * 0.16, r * 2, r * 0.34);
    ctx.restore();

    // Eyes, dark against the exposed skin — round and calm normally; narrowed into a sharp,
    // determined glare (with a thin glint of light along each one) for the victory pose.
    if (glaring) {
      ctx.fillStyle = "#181818";
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * r * 0.24, -r * 0.02);
        ctx.rotate(side * -0.28); // tilts inward/downward toward the nose
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.19, r * 0.055, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.65)";
        ctx.lineWidth = Math.max(1, r * 0.018);
        ctx.beginPath();
        ctx.moveTo(-r * 0.13, 0);
        ctx.lineTo(r * 0.13, 0);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      ctx.fillStyle = "#181818";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * r * 0.24, -r * 0.02, r * 0.16, r * 0.11, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Headband, tied above the eyes, with a small metal plate
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#5f1618";
    ctx.fillRect(-r, -r * 0.42, r * 2, r * 0.22);
    ctx.restore();
    ctx.fillStyle = "#aab4c0";
    ctx.fillRect(-r * 0.16, -r * 0.4, r * 0.32, r * 0.18);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-r * 0.16, -r * 0.4, r * 0.32, r * 0.18);

    // Off hand: shuriken fan, held out past the silhouette, snapping outward on a throw
    const throwOffset = throwKick * r * 0.35;
    ctx.save();
    ctx.translate(-r * 1.02 - throwOffset, r * 0.3);
    ctx.fillStyle = "#101013";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
    for (let i = -1; i <= 1; i++) {
      ctx.save();
      ctx.translate(i * r * 0.16, -Math.abs(i) * r * 0.1);
      this.drawShurikenShape(ctx, r * 0.24, t * 3 + i);
      ctx.restore();
    }
    ctx.restore();

    // Main hand: the dagger, swinging through the arc on a hit with a white slash trail
    // marking the path already swept; held ready (raised, pre-swing pose) otherwise. Three-Slash
    // strikes swap in the wider, bigger-bladed version of all three (see bigSlash above).
    const pivotX = r * 0.55, pivotY = r * 0.05;
    const daggerScale = bigSlash ? this.bigSlashScale : NINJA_DAGGER_SCALE;
    if (swinging) this.drawSwingTrail(ctx, pivotX, pivotY, swingT, bigSlash, daggerScale);
    const angle = swinging ? this.swingAngleAt(swingT, bigSlash) : this.swingAngleAt(0);
    this.drawDagger(ctx, pivotX, pivotY, angle, 1, daggerScale);

    ctx.restore();
  }

  // How close the ultimate is to ready — same 0..1 recharge convention every other character's
  // auto-triggering ultimate uses for its HUD bar.
  get ultimateRatio() {
    return Math.max(0, 1 - this.ultimateCooldown / NINJA_ULTIMATE_COOLDOWN);
  }

  get ultimateBarColor() {
    return "#a8acb4";
  }

  // True only for a fighter whose own low-HP clone trigger actually does something — the
  // original, not a NinjaClone (whose version of that trigger is a no-op, see NinjaClone
  // below). Drives whether drawFieldHpBar()/drawHud() bother showing the halfway marker at all.
  get showsLowHpMarker() {
    return true;
  }

  // A short dashed line marking the halfway point of an HP bar — exactly where the low-HP
  // backup clone triggers (see update()). Drawn on top of whatever's already there, so it
  // doesn't need to touch the generic drawBar() every other character's bars go through.
  drawHpMidpointMarker(ctx, cx, y1, y2) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, y1);
    ctx.lineTo(cx, y2);
    ctx.stroke();
    ctx.restore();
  }

  // Same geometry Character.drawFieldHpBar() computes internally for the HP bar, duplicated
  // here just to place the marker — there's no way to get it back out of the base method.
  drawFieldHpBar(ctx) {
    super.drawFieldHpBar(ctx);
    if (!this.showsLowHpMarker) return;
    const barW = Math.max(70, this.size * 0.9);
    const barX = this.x - barW / 2;
    const barY = this.y - this.size / 2 - 22;
    this.drawHpMidpointMarker(ctx, barX + barW / 2, barY, barY + 10);
  }

  // Every living body down the clone chain — the clone, its own clone, and so on — is just as
  // targetable/collidable as the original itself; main.js consults this so the opponent can
  // actually aim at and collide with any of them, not just whichever it's currently fighting.
  // See the generic default on Character for the full rationale.
  getExtraBodies() {
    const bodies = [];
    // Walks every clone this fighter directly summoned, and recurses into each one's own
    // clones regardless of that clone's own alive state — a dead clone shouldn't hide any
    // still-living clones further down its own branch.
    for (const c of this.clones) {
      if (c.alive) bodies.push(c);
      bodies.push(...c.getExtraBodies());
    }
    return bodies;
  }

  draw(ctx) {
    for (const c of this.clones) c.draw(ctx); // each handles its own alive/fade-out internally
    // Once "black" it's teleported out of frame entirely — stop drawing it at all. (In practice
    // main.js's isolate branch already stops calling draw() on it once victoryCameraZoom's
    // subject goes null, but this stays as a direct guard too.)
    if (this.isVictoryFocus && this.victoryPhase === "black") return;
    if (!this.alive && this.deathFadeTimer <= 0) return;
    this.drawDashGhosts(ctx);
    this.drawShurikensInFlight(ctx);
    if (this.isVictoryFocus) {
      // The isolated victory freeze-frame (see main.js): just the glaring body, no HP bar or
      // stun icon — main.js already strips the arena/HUD/other fighter around it, so this
      // shouldn't hand any of that clutter back via its own normal draw path.
      this.drawBody(ctx);
      return;
    }
    super.draw(ctx);
  }

  drawHud(ctx, x, y, w) {
    const ny = super.drawHud(ctx, x, y, w);
    if (this.showsLowHpMarker) {
      const barH = 18, barY = y + 14; // same geometry Character.drawHud() uses for the HP bar
      this.drawHpMidpointMarker(ctx, x + w / 2, barY, barY + barH);
    }
    ctx.textAlign = "left";

    // The only thing left under the bars for any character: a Ninja's clones, because each is a
    // whole extra fighter rather than a status readout — see drawCloneHud.
    this.drawCloneHud(ctx, x, ny, w, this.getExtraBodies());
  }

  // Would `count` clone blocks, starting at `top`, still finish above the arena?
  cloneHudFits(top, count) {
    return top + NINJA_CLONE_HUD_GAP + (count - 1) * NINJA_HUD_BLOCK_H + NINJA_HUD_BLOCK_DROP
      <= ARENA.y - 6;
  }

  // Each living clone gets the SAME HUD block the Ninja itself gets — bold name, full-width HP
  // bar, HP numbers, ultimate bar — just labelled "Clone".
  //
  // Worth the space because a clone is not decoration: it's a full fighter with its own HP that
  // attacks, takes damage, and counts for the win condition. main.js's isFighterDown() only calls
  // a Ninja out once the body is dead AND every clone is gone, so a Ninja on 0 HP with a clone
  // still up is very much alive — and a top HUD showing nothing but one empty bar was actively
  // misleading about that.
  drawCloneHud(ctx, x, y, w, clones) {
    if (!clones.length) return;

    // Fitted to the gap above the arena rather than assuming a count, so nothing is ever drawn
    // over the arena wall. In practice this always resolves to a single block: a clone can't
    // summon a clone of its own (NinjaClone.triggerShadowClone is a no-op), and simulating the
    // Ninja against the whole roster never put more than one on the field at a time. The rest of
    // this is here so an unexpected second one degrades gracefully instead of overdrawing.
    let showing = clones.length;
    while (showing > 0 && !this.cloneHudFits(y, showing)) showing--;

    let by = y + NINJA_CLONE_HUD_GAP;
    for (let i = 0; i < showing; i++) {
      const label = clones.length > 1 ? `Clone ${i + 1}` : "Clone";
      by = this.drawCloneBlock(ctx, clones[i], label, x, by, w);
    }
    // Whatever didn't fit gets a count, but only if there's a spare line for it — never at the
    // cost of dropping a block that did fit
    if (showing < clones.length && by + 4 <= ARENA.y) {
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "13px Arial";
      ctx.fillText(`+${clones.length - showing} more clone(s)`, x, by);
    }
  }

  // Routed through Character.prototype rather than calling clone.drawHud(): NinjaClone inherits
  // Ninja's drawHud, which would print a second set of ability lines and recurse straight back
  // into the clone panel. The base method is exactly the block wanted here and nothing more.
  drawCloneBlock(ctx, clone, label, x, y, w) {
    const savedName = clone.name;
    clone.name = label;
    const ny = Character.prototype.drawHud.call(clone, ctx, x, y, w);
    clone.name = savedName;
    ctx.textAlign = "left";
    return ny;
  }
}

// The clone: shuriken, dagger, and now Three-Slash too — everything the original can do,
// including the same damage-based cooldown reduction (dealDamage() is fully inherited,
// unmodified) — except summoning a clone of its own, which stays a no-op: update()'s
// HP-threshold trigger still fires on schedule (harmless — the one-shot flag just gets
// consumed) but lands here instead of actually doing anything, so nothing needs to change in
// the shared update() logic itself.
class NinjaClone extends Ninja {
  constructor(x, y) {
    super(x, y);
    this.maxHp = NINJA_CLONE_MAX_HP;
    this.hp = NINJA_CLONE_MAX_HP;
  }

  triggerShadowClone() {}

  // Its own version of that trigger doesn't do anything, so the marker would be misleading.
  get showsLowHpMarker() {
    return false;
  }
}
