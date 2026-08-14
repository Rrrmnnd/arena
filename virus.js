// Virus: a tiny, fast, fragile menace — a spiky violet sphere smaller than either Punch Man,
// that pokes from range with Infection-carrying spikes and, once its ultimate is up, liquefies
// and slowly swims across the arena to its target before fusing directly into them
// symbiote-style: a spreading dark coating over their whole body, held for a few seconds while
// it bites down for real damage and Virus heals off the exchange, then peels back off and
// re-solidifies into its normal body. No mutation mechanic right now (removed for this pass) —
// just the spike/Infection poke and the Parasitize fusion.
//
// Virus has exactly two sources of damage, full stop — neither a melee bump (onCollide) nor a
// landed spit-spike hits for direct damage on its own anymore:
//   - Infection's own DoT tick (see the paragraph below and applyInfection's comment) — a landed
//     spike only ever applies/refreshes a stack, never damage directly.
//   - Parasitize's flat per-second bite while attached (VIRUS_PARASITE_TICK_DAMAGE).
//
// Parasitize runs through three phases, tracked in `parasitePhase`. It is JUST an infection —
// at no point does it stun or immobilize the target; they keep moving and fighting normally the
// entire time, on both sides of the attach:
//   "traveling" — liquid, translucent, no spikes; swims straight at the target at
//                 VIRUS_PARASITE_TRAVEL_SPEED, ignoring whatever it would normally be doing.
//                 The target can freely fight back or just walk away, which is the entire skill
//                 test of landing this ultimate in the first place.
//   "attached"  — fused into the target's body at the point of contact; Virus itself parks there
//                 (movable=false, not drawn as its own body — see beginAttach for why) rather
//                 than tracking the target, who's free to keep moving/fighting the whole time.
//                 Ticks VIRUS_PARASITE_TICK_DAMAGE once a second for VIRUS_PARASITE_ATTACH_DURATION.
//                 The heal lands immediately on attach; the sickness-stage bump only once the
//                 cast is actually over — see endParasite().
//   "returning" — liquid again, drifting from the (possibly now-stale) attach point to a fresh
//                 random point elsewhere in the arena at VIRUS_PARASITE_RETURN_SPEED, same mucus
//                 form as the swim-in. Ends either by arriving or timing out.
// The instant "returning" arrives, parasitePhase snaps straight back to null and full normal
// control (movement AI, spikes, next ultimate cast) resumes that SAME frame — there is no fourth
// held "reforming" phase that blocks anything. The liquid-to-solid morph still plays out visually
// (see bodySolidify / reformGlowTimer) but it's purely cosmetic on top of already-normal behavior,
// specifically so it never reads as a stuck/frozen beat.
//
// Infection: a landed spike (the only source now — bumping into the target on a normal
// collision does NOT apply it) stacks a DoT on whoever it hit, refreshing the stack's duration
// rather than starting a separate timer per hit, and ticking its own damage on a fixed interval.
// See the standalone comment above applyInfection() for the full mechanic, and above
// virusSicknessDamagePerStack() for how Parasitize modifies it without granting stacks itself.
//
// Every landed hit (melee or spike alike) also chips away at the ultimate's own cooldown — see
// registerHit()/VIRUS_HITS_PER_COOLDOWN_REDUCTION — and a landed spike leaves a small purple
// splat stuck to the target's body for VIRUS_SPIT_SPLAT_DURATION (see applySpitSplat).

const VIRUS_MAX_HP = 75;
const VIRUS_SPEED   = 230; // fast on purpose — it's tiny and fragile, it needs to actually be able to stay away
const VIRUS_SIZE    = CHAR_BASE_SIZE * 0.72; // smaller than either Punch Man (both CHAR_BASE_SIZE, 60)

const VIRUS_MELEE_COOLDOWN = 0.5; // a plain physical bump now — see onCollide — but still gated so it doesn't spam registerHit() every overlapping frame

const VIRUS_SPIKE_COOLDOWN = 1.8; // unlimited range like Ninja's shuriken, so the fire rate has to carry all of the restraint
const VIRUS_SPIKE_SPEED    = 800;
const VIRUS_SPIKE_LIFE     = 2.2; // safety timeout in case it somehow never leaves the arena
const VIRUS_SPIKE_INFECTION_STACKS = 1;
const VIRUS_SPIT_SPLAT_DURATION = 1.0; // seconds the purple residue mark left by a landed spit-spike lingers on the target's body

// Every VIRUS_HITS_PER_COOLDOWN_REDUCTION successful hits on the opponent (melee bump or landed
// spike alike — see registerHit()) shaves VIRUS_COOLDOWN_REDUCTION_PER_TRIGGER off whatever's
// left of the ultimate's cooldown, clamped at 0. The counter itself just keeps rolling over
// (6 hits = 1 trigger + 1 banked toward the next), not reset by anything else.
const VIRUS_HITS_PER_COOLDOWN_REDUCTION = 5;
const VIRUS_COOLDOWN_REDUCTION_PER_TRIGGER = 1.0;

// Infection stacking/decay/tick rules — see the detailed mechanic comment above applyInfection().
const VIRUS_INFECTION_STACK_DURATION   = 4.0;
const VIRUS_INFECTION_DECAY_GRACE      = 1.0; // seconds each stack lingers for once decay actually starts, before dropping another
const VIRUS_INFECTION_MAX_STACKS       = 5;
const VIRUS_INFECTION_TICK_INTERVAL    = 1.0;
const VIRUS_INFECTION_DAMAGE_PER_STACK = 1.0; // the "healthy" baseline — see virusSicknessDamagePerStack for what Parasitize does to this
const VIRUS_INFECTION_DAMAGE_NUMBER_COLOR = "#c060e8"; // Infection's own DoT ticks float up in this purple instead of the normal white/red, so a poisoned target's health loss reads as separate from direct hits

// Ultimate — Parasitize: liquefies and swims to the target (see the phase breakdown above),
// fuses into them for VIRUS_PARASITE_ATTACH_DURATION, heals Virus, permanently escalates that
// target's "sickness stage" (see virusSicknessDamagePerStack), and bites for
// VIRUS_PARASITE_TICK_DAMAGE once a second while attached — a flat rate, not modulated by
// Infection/sickness at all. Grants no Infection stacks itself. Flat cooldown, no damage-based
// reduction, same reasoning as before.
const VIRUS_ULTIMATE_COOLDOWN   = 12.0;
const VIRUS_PARASITE_TRAVEL_SPEED   = 650; // a fast streaking dash, not a walk — faster than everything else in the roster so it reliably closes the gap
const VIRUS_PARASITE_TRAVEL_TIMEOUT = 2.5; // safety: force-attach anyway if it somehow can't ever close the last bit of distance (a faster target) — shorter now that the swim itself is fast
// Ultimate is often thrown at point-blank range (Virus fights up close), which without this
// would let "traveling"/"returning" complete in a single frame — the swim sound (see
// playSwimLoop) then only gets a few milliseconds of runway, indistinguishable from not playing
// at all. This forces the liquid phase to actually run for a moment even when the arrival/touch
// distance check would otherwise pass immediately, so the swim is always audible/visible for at
// least this long. Still bounded by VIRUS_PARASITE_TRAVEL_TIMEOUT/VIRUS_PARASITE_RETURN_TIMEOUT
// as always — this only raises the floor, never the ceiling.
const VIRUS_PARASITE_MIN_SWIM_TIME  = 0.4;
const VIRUS_PARASITE_ATTACH_DURATION = 4.0; // seconds actually fused on, ticking damage — the target is never stunned/held still, see the file header. Matches sfx_virus_possess.mp3's own length (~3.997s) exactly, per explicit design: the hold IS as long as that sound plays, not a separately-tuned number that happens to be close
const VIRUS_PARASITE_TICK_DAMAGE    = 5;  // flat, per VIRUS_PARASITE_TICK_INTERVAL, while attached — now one of only two damage sources Virus has at all, alongside Infection's own DoT
const VIRUS_PARASITE_TICK_INTERVAL  = 1.0;
// The heal scales off however many Infection stacks the target is already carrying the instant
// attach lands — 15 against a clean target, +5 per stack already on them (so a fully-stacked
// 5-layer target heals 40) — rewarding landing the ultimate on something Virus has already been
// poking rather than treating it as a free heal regardless of setup.
const VIRUS_PARASITE_HEAL_BASE      = 15;
const VIRUS_PARASITE_HEAL_PER_STACK = 5;
const VIRUS_PARASITE_RETURN_SPEED   = 480; // a drift back out, not the urgent dash-in — see VIRUS_PARASITE_TRAVEL_SPEED
const VIRUS_PARASITE_RETURN_TIMEOUT = 2.0; // safety in case the rolled point is somehow never reached
// Purely cosmetic now — NOT a gameplay hold. The instant "returning" arrives, control returns to
// normal that same frame; this only times how long the liquid-to-solid blend (bodySolidify) takes
// to visually catch up on top of that, via reformGlowTimer. Short on purpose: this used to be a
// full 1.6s gameplay freeze (renamed from VIRUS_REFORM_DURATION) that read as the character being
// stuck/broken since nothing moved for the whole span — now that movement/attacks aren't gated on
// it at all, it can just be a quick visual pop instead of needing to be "long enough to notice".
const VIRUS_REFORM_VISUAL_DURATION = 0.45;

// How long the coating takes to fully spread across the host once it lands, and how long
// before the hold ends it visibly starts peeling back off — both fractions of
// VIRUS_PARASITE_ATTACH_DURATION's own timer, not separate real-time counters.
const VIRUS_SYMBIOTE_SPREAD_TIME   = 0.5;
const VIRUS_SYMBIOTE_RETRACT_TIME  = 0.45;

// Victory: the same root/vein visual language as the Parasitize coating, but radiating outward
// from Virus's own final position to engulf the whole arena instead of just one body — see
// onVictory/drawVictoryOverlay/generateVictoryVeinNetwork. Denser (more roots, more generations,
// tighter fork chance) than the coating so it reads as tightly packed at that much larger scale,
// per explicit design ("very tight, not sparse"). Comfortably under ROUND_END_GRACE (3.0s in
// main.js) so it's fully spread out and holding, not still visibly growing, by the time the
// keep/discard prompt appears and update() stops ticking victoryTimer forward.
const VIRUS_VICTORY_SPREAD_TIME = 2.0;
const VIRUS_VICTORY_ROOT_COUNT_MIN = 14;
const VIRUS_VICTORY_ROOT_COUNT_RANGE = 4;
const VIRUS_VICTORY_DEPTH = 7;
const VIRUS_VICTORY_FORK_CHANCE = 0.55;

// A single fixed light direction (up and to the left) that every part of the baked victory
// artwork shades against — the limb gradients, the wet specular streaks and the nodules all read
// off this same vector, which is what makes the whole mass look like one lit three-dimensional
// object rather than a pile of independently-drawn shapes.
const VIRUS_VICTORY_LIGHT = { x: -0.55, y: -0.83 };
// Supersampling factor for the bake. The artwork is drawn once at this multiple of the arena's
// pixel size and scaled back down on blit, so the fine capillaries and specular highlights stay
// crisp instead of aliasing into dashed lines.
const VIRUS_VICTORY_SUPERSAMPLE = 2;

// The actual "sickness" mechanic: how hard each point of Infection stack ticks depends on how
// many times a Parasitize cast has ever finished on that specific target — a SEPARATE,
// permanent counter (see bumpSicknessStage/getSicknessStage, bumped in endParasite() once the
// cast is actually over) that does NOT expire the way an individual Infection entry does. Stage
// 0 (never parasitized) uses the flat VIRUS_INFECTION_DAMAGE_PER_STACK baseline (1.0). Every
// completed cast after that adds a flat +0.5/stack, uncapped: "Cold" (stage 1) is 1.5, "Fever"
// (stage 2) is 2.0, stage 3 is 2.5, stage 4 is 3.0, and so on. Parasitize's own damage output is
// entirely indirect: it does nothing to a target with zero active Infection stacks (this formula
// is a multiplier, not a flat hit), so its real payoff is making every FUTURE spike-applied
// stack progressively more dangerous, on top of the heal it gives Virus on attach (itself scaled
// by however infected the target already is — see VIRUS_PARASITE_HEAL_BASE/PER_STACK) and the
// flat per-second bite it lands of its own while attached (see VIRUS_PARASITE_TICK_DAMAGE).
function virusSicknessDamagePerStack(stage) {
  return VIRUS_INFECTION_DAMAGE_PER_STACK + Math.max(0, stage) * 0.5;
}

// Installs, once and idempotently, a permanent wrapper around a target's own draw() that also
// runs whatever callbacks are currently in target._virusDrawExtras, in order, right after the
// target's own body renders. Lets multiple independent Virus visual overlays (the symbiote
// fusion coating, spit splats, and anything added later) coexist on the same target without
// stepping on each other — each effect just pushes/splices its own callback into the shared
// array instead of monkeypatching target.draw directly and risking one `delete` wiping out
// another effect's hook.
function installVirusDrawExtras(target) {
  if (target._virusDrawExtras) return;
  target._virusDrawExtras = [];
  const originalDraw = target.draw;
  target.draw = function (ctx) {
    originalDraw.call(this, ctx);
    for (const fn of target._virusDrawExtras) fn(ctx);
  };
}

// A single glob of spit thrown as a ranged poke, aimed at the opponent's position the instant
// it's released (no homing after that) — see drawSpikesInFlight for the actual "吐痰" look.
class VirusSpike {
  constructor(x, y, angle, speed, infectionStacks) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.angle = angle;
    this.life = VIRUS_SPIKE_LIFE;
    this.infectionStacks = infectionStacks;
    this.wobbleSeed = Math.random() * Math.PI * 2; // per-instance phase so a volley doesn't wobble/rotate in lockstep
  }
}

class Virus extends Character {
  constructor(x, y) {
    super({
      x, y,
      size: VIRUS_SIZE,
      color: "#6e5a86",
      maxHp: VIRUS_MAX_HP,
      name: "Virus",
      speed: VIRUS_SPEED,
    });

    this.facingAngle = Math.random() * Math.PI * 2;
    this.meleeTimer = 0;
    this.spikeTimer = 0;
    this.spikes = [];
    this.infections = []; // { target, stacks, refreshTimer, tickTimer } — one entry per currently-infected target
    this.sicknessStages = []; // { target, stage } — permanent, never expires; see virusSicknessDamagePerStack

    this.ultimateCooldown = VIRUS_ULTIMATE_COOLDOWN;
    this.parasitePhase = null;   // null | "traveling" | "attached" | "returning" — see the file header
    this.parasiteTarget = null;
    this.parasiteTimer = 0;      // meaning depends on phase: attach countdown, unused elsewhere
    this.parasiteTravelTimer = 0; // seconds spent traveling/returning so far — see VIRUS_PARASITE_TRAVEL_TIMEOUT/VIRUS_PARASITE_RETURN_TIMEOUT
    this.parasiteTickTimer = 0;  // seconds until the next flat attach-phase damage tick
    this.parasiteAngle = 0;      // where on the target's body it fused in from, so the coating spreads from a fixed point
    this.parasiteRadius = 0;
    this.parasiteReturnX = 0;    // the fresh point in the arena "returning" drifts toward before solidifying
    this.parasiteReturnY = 0;
    this.reformGlowTimer = 0;    // purely cosmetic countdown driving bodySolidify's liquid->solid blend once "returning" arrives — does NOT gate movement/attacks, see the file header
    this.swimSoundSource = null; // the looping sfx_virus_swim BufferSource while "traveling"/"returning" — see playSwimLoop/stopSwimLoop
    this.veinBranches = []; // rolled fresh per cast in beginAttach() — see generateVeinBranches/drawSymbioteFusion
    this.comboHitCount = 0; // rolling count of landed hits toward the next ultimate-cooldown shave — see registerHit()
    this.spitSplats = []; // { target, offsetAngle, offsetRadius, timer } — purple residue marks left by landed spikes, see applySpitSplat/drawSpitSplatsOn
    this.symbioteDrawFn = null; // the active target._virusDrawExtras callback for the fusion coating while attached — see beginAttach/endParasite

    this.celebratingVictory = false; // see onVictory/drawVictoryOverlay
    this.victoryTimer = 0;
    this.victoryNetwork = [];
    this.victoryClaws = []; // four corner-gripping claws — see generateVictoryClaws
    this.victoryTexture = null; // offscreen canvas the whole victory mass is baked into once — see buildVictoryArtwork
    this.victoryOriginX = 0;
    this.victoryOriginY = 0;
    this.victoryMaxRadius = 0;

    // Fixed per-instance layout so the spiky silhouette and mottled texture don't reroll (and
    // visibly jitter) every single frame.
    this.spikeSeed = Math.random() * Math.PI * 2;
    this.textureDots = Array.from({ length: 12 }, () => ({
      dx: (Math.random() * 2 - 1) * 0.55,
      dy: (Math.random() * 2 - 1) * 0.55,
      ds: 0.05 + Math.random() * 0.07,
    }));
  }

  // Untargetable for the entire span of a Parasitize cast — "traveling" (the swim in) and
  // "reforming" (dissolving back into its normal body afterward) are both liquid with no fixed
  // useful position to aim at, and "attached" is parked at a fixed point that has nothing to do
  // with where the fight is actually happening (see beginAttach) and isn't even drawn as a
  // separate body (see draw()). main.js substitutes null for the opponent reference passed into
  // whoever it's fighting while this is true, so deliberate targeting/aiming can't track it
  // through any of the three phases. Per the base class's own doc comment this only blocks
  // deliberate targeting, not incidental contact damage — bumping into it mid-swim can still
  // land a hit, same as physically wandering into anything else.
  get isInvisibleToOpponents() {
    return this.parasitePhase === "traveling" || this.parasitePhase === "attached" || this.parasitePhase === "returning";
  }

  // Liquid with nothing solid to bump into — "traveling"/"returning" only (NOT "attached", which
  // is fused directly onto the target's own body, not swimming through open space). Arena walls
  // still apply; see the wall-clamp in each of those branches in update(). Without this, swimming
  // straight through the opponent's hurtbox (or, in VS BOSS, anyone else's) could shove Virus off
  // course or visibly wedge it against them mid-swim.
  get phasesThroughCharacters() {
    return this.parasitePhase === "traveling" || this.parasitePhase === "returning";
  }

  // Every landed hit (melee bump or spike alike) counts toward the next ultimate-cooldown shave —
  // see VIRUS_HITS_PER_COOLDOWN_REDUCTION.
  registerHit() {
    this.comboHitCount++;
    if (this.comboHitCount >= VIRUS_HITS_PER_COOLDOWN_REDUCTION) {
      this.comboHitCount -= VIRUS_HITS_PER_COOLDOWN_REDUCTION;
      this.ultimateCooldown = Math.max(0, this.ultimateCooldown - VIRUS_COOLDOWN_REDUCTION_PER_TRIGGER);
    }
  }

  // A landed spike leaves a small purple splatter stuck to wherever it hit on the target's body —
  // a fixed local offset (like parasiteAngle/parasiteRadius for the symbiote fusion) so it rides
  // along with the target as they move rather than staying pinned to the world position it
  // actually landed at. Fades out and is discarded after VIRUS_SPIT_SPLAT_DURATION — see
  // updateSpitSplats. Needs the same target.draw() hook trick as the symbiote fusion coating to
  // reliably render on TOP of the target's body regardless of fighterA/fighterB draw order — see
  // installVirusDrawExtras.
  applySpitSplat(target) {
    this.spitSplats.push({
      target,
      offsetAngle: Math.random() * Math.PI * 2,
      offsetRadius: Math.random() * target.size * 0.32,
      size: 0.16 + Math.random() * 0.1,
      timer: VIRUS_SPIT_SPLAT_DURATION,
    });
    installVirusDrawExtras(target);
    if (!target._virusSplatDrawFn) {
      target._virusSplatDrawFn = (ctx) => this.drawSpitSplatsOn(ctx, target);
      target._virusDrawExtras.push(target._virusSplatDrawFn);
    }
  }

  updateSpitSplats(dt) {
    for (let i = this.spitSplats.length - 1; i >= 0; i--) {
      const s = this.spitSplats[i];
      if (!s.target.alive) { this.spitSplats.splice(i, 1); continue; }
      s.timer -= dt;
      if (s.timer <= 0) this.spitSplats.splice(i, 1);
    }
  }

  drawSpitSplatsOn(ctx, target) {
    const r = target.size / 2;
    ctx.save();
    ctx.translate(target.x, target.y);
    for (const s of this.spitSplats) {
      if (s.target !== target) continue;
      const alpha = Math.min(1, s.timer / VIRUS_SPIT_SPLAT_DURATION);
      const ox = Math.cos(s.offsetAngle) * s.offsetRadius, oy = Math.sin(s.offsetAngle) * s.offsetRadius;
      const blobR = s.size * r;

      // A thin drip trailing down from the blob, slowly lengthening as the splat ages — sells it
      // as still running down the skin rather than a static sticker, drawn first so the blob
      // itself covers the seam where the drip starts.
      const dripLen = blobR * (0.9 + (1 - alpha) * 1.8);
      const dripWidth = blobR * 0.22;
      ctx.strokeStyle = `rgba(168,56,192,${(alpha * 0.6).toFixed(3)})`;
      ctx.lineWidth = dripWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ox, oy + blobR * 0.3);
      ctx.lineTo(ox, oy + blobR * 0.3 + dripLen);
      ctx.stroke();
      ctx.fillStyle = `rgba(140,40,168,${(alpha * 0.7).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(ox, oy + blobR * 0.3 + dripLen, dripWidth * 0.9, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = "#a838c0";
      ctx.beginPath();
      const lobes = 5;
      for (let i = 0; i <= lobes; i++) {
        const a = (i / lobes) * Math.PI * 2;
        const wob = 0.75 + Math.sin(a * 3 + s.offsetAngle * 5) * 0.25;
        const px = ox + Math.cos(a) * blobR * wob, py = oy + Math.sin(a) * blobR * wob;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e060ff";
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath();
      ctx.arc(ox, oy, blobR * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------------------------------------------------------------- Infection
  // A stack is a single number per (Virus, target) pair, applied only by a landed spike (1
  // stack) — bumping into the target on a normal collision does NOT apply it (see onCollide),
  // and Parasitize no longer grants stacks directly either (see virusSicknessDamagePerStack).
  //
  // Landing a new hit does two things to the target's entry: it ADDS to the stack count
  // (capped at VIRUS_INFECTION_MAX_STACKS — extra stacks past the cap are simply lost, not
  // banked for later), and it RESETS `refreshTimer` back to the full VIRUS_INFECTION_STACK_DURATION
  // (4s) regardless of what it was doing before — even mid-decay-cascade (see below), a fresh
  // hit always snaps all the way back to the full 4s window at whatever the (possibly now
  // higher) stack count ends up being.
  //
  // Independently of stacking, an infected entry ticks its own damage once every
  // VIRUS_INFECTION_TICK_INTERVAL (1s), for `stacks x virusSicknessDamagePerStack(stage)` —
  // more stacks means a harder tick, not a faster one, and the per-stack rate itself climbs
  // permanently the more times Parasitize has landed on that target (see that function).
  //
  // Decay, once no fresh hit lands before `refreshTimer` runs out, is a CASCADE, not an
  // all-at-once wipe: it drops exactly one stack, and if any are left, gives that smaller pile
  // another VIRUS_INFECTION_DECAY_GRACE (1s) before dropping another — so 3 stacks with nothing
  // refreshing them plays out as 3 -> (1s) -> 2 -> (1s) -> 1 -> (1s) -> gone, each step still
  // ticking its own (now smaller) damage along the way, rather than the whole thing just
  // vanishing the instant the first 4s window closes. This keeps running even if Virus itself
  // dies or gets stunned mid-fight (see updateInfections), since the infection is already in
  // the target's system and doesn't need Virus's own action to keep going.
  //
  // Exception: while Parasitize is actually fused onto that exact target ("attached"), their
  // Infection's decay clock is frozen entirely for the whole hold — not reset, just paused — and
  // endParasite() hands it a full fresh 4s window the instant the hold ends. So landing the
  // ultimate on an already-infected target guarantees their Infection survives the attach and
  // walks away with a full timer, instead of risking decaying away mid-hold.
  applyInfection(target, stacks) {
    let entry = this.infections.find((e) => e.target === target);
    if (!entry) {
      entry = { target, stacks: 0, refreshTimer: 0, tickTimer: VIRUS_INFECTION_TICK_INTERVAL };
      this.infections.push(entry);
    }
    entry.stacks = Math.min(VIRUS_INFECTION_MAX_STACKS, entry.stacks + stacks);
    entry.refreshTimer = VIRUS_INFECTION_STACK_DURATION;
  }

  getSicknessStage(target) {
    const e = this.sicknessStages.find((s) => s.target === target);
    return e ? e.stage : 0;
  }

  // Only ever called by Parasitize landing — permanent, unlike an Infection entry's own timer.
  bumpSicknessStage(target) {
    let e = this.sicknessStages.find((s) => s.target === target);
    if (!e) { e = { target, stage: 0 }; this.sicknessStages.push(e); }
    e.stage++;
    return e.stage;
  }

  updateInfections(dt) {
    for (let i = this.infections.length - 1; i >= 0; i--) {
      const e = this.infections[i];
      if (!e.target.alive) { this.infections.splice(i, 1); continue; }

      // While actually fused onto THIS specific target, their Infection is protected — its
      // decay clock is simply frozen (not reset, not banked, just paused) for the whole hold, so
      // getting parasitized can never itself cost them a stack mid-attach. endParasite() then
      // hands it a full fresh VIRUS_INFECTION_STACK_DURATION the instant the hold actually ends,
      // rather than resuming from wherever the frozen countdown was.
      const protectedByAttach = this.parasitePhase === "attached" && this.parasiteTarget === e.target;
      if (!protectedByAttach) {
        e.refreshTimer -= dt;
        if (e.refreshTimer <= 0) {
          // Cascade, not a wipe: drop exactly one stack, then — if any are left — give that
          // smaller pile its own shorter grace window before dropping another. Only actually
          // removes the entry once a decay step brings it all the way down to 0.
          e.stacks -= 1;
          if (e.stacks <= 0) { this.infections.splice(i, 1); continue; }
          e.refreshTimer = VIRUS_INFECTION_DECAY_GRACE;
        }
      }

      e.tickTimer -= dt;
      if (e.tickTimer <= 0) {
        e.tickTimer = VIRUS_INFECTION_TICK_INTERVAL;
        const perStack = virusSicknessDamagePerStack(this.getSicknessStage(e.target));
        e.target.takeDamage(e.stacks * perStack, VIRUS_INFECTION_DAMAGE_NUMBER_COLOR);
        spawnImpactParticles(e.target.x, e.target.y - e.target.size * 0.2, ["#a838c0", "#e060ff"], 6, 0.6, 0);
      }
    }
  }

  // No damage of its own — just a physical bump. Doesn't touch Infection either; that's reserved
  // for a landed spike. Damage now only comes from two places: Infection's own DoT tick and the
  // Parasitize attach bite (see updateInfections / VIRUS_PARASITE_TICK_DAMAGE).
  onCollide(opponent) {
    if (!opponent.alive || !this.canAttack || this.stunTimer > 0) return;
    if (this.meleeTimer > 0) return;
    this.meleeTimer = VIRUS_MELEE_COOLDOWN;
    this.registerHit();

    const impactX = (this.x + opponent.x) / 2, impactY = (this.y + opponent.y) / 2;
    spawnImpactParticles(impactX, impactY, ["#a838c0", "#e060ff", "#3c2c52"], 14, 1.0, 0);
  }

  // No direct impact damage either — a landed spit only applies the Infection stack (+ splat +
  // hit-counter) that goes on to do the actual damage over time; see the file header.
  throwSpike(opponent) {
    const angle = Math.atan2(opponent.y - this.y, opponent.x - this.x);
    const spawnDist = this.size / 2 + 6;
    this.spikes.push(new VirusSpike(
      this.x + Math.cos(angle) * spawnDist, this.y + Math.sin(angle) * spawnDist,
      angle, VIRUS_SPIKE_SPEED, VIRUS_SPIKE_INFECTION_STACKS
    ));
    playSfx("virusSaliva", 0.4);
  }

  updateSpikes(dt, opponent) {
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      let gone = s.life <= 0 || s.x < ARENA.x || s.x > ARENA.x + ARENA.w || s.y < ARENA.y || s.y > ARENA.y + ARENA.h;

      if (!gone && opponent && opponent.alive) {
        const dist = Math.hypot(opponent.x - s.x, opponent.y - s.y);
        if (dist <= opponent.size / 2 + 6) {
          this.applyInfection(opponent, s.infectionStacks);
          this.applySpitSplat(opponent);
          this.registerHit();
          spawnImpactParticles(s.x, s.y, ["#a838c0", "#e060ff"], 10, 0.9, 0);
          gone = true;
        }
      }

      if (gone) this.spikes.splice(i, 1);
    }
  }

  // Builds a chaotic branching root/vein network — like a tangle of tree roots or a spread of
  // blood vessels, not a tidy geometric wrap — as a flat list of line segments in UNIT-CIRCLE
  // space (coordinates roughly -1..1; drawSymbioteFusion scales them by the actual target's
  // radius at draw time, so the same network works on any body size). Several "roots" start
  // near the edge of the circle and grow inward, each step jittering its heading, tapering its
  // width, and — about half the time — forking into two thinner children; a handful of
  // generations of that is what actually produces the tangled, uneven look, rather than any
  // single smooth curve ever could.
  generateVeinBranches() {
    const segments = [];
    const grow = (x, y, angle, len, width, depth) => {
      if (depth <= 0 || width < 0.016) return;
      const a2 = angle + (Math.random() - 0.5) * 1.1;
      const nx = x + Math.cos(a2) * len;
      const ny = y + Math.sin(a2) * len;
      const forkCount = Math.random() < 0.5 ? 2 : 1;
      segments.push({
        x1: x, y1: y, x2: nx, y2: ny, width,
        phase: Math.random() * Math.PI * 2,
        bow: (Math.random() - 0.5) * 0.9, // perpendicular curve offset — see drawSymbioteFusion
        node: forkCount === 2, // small pulsing nodule at this joint — only where it actually forks
      });
      for (let f = 0; f < forkCount; f++) {
        const spread = forkCount === 2 ? (f === 0 ? -1 : 1) * (0.35 + Math.random() * 0.55) : (Math.random() - 0.5) * 0.5;
        grow(nx, ny, a2 + spread, len * (0.68 + Math.random() * 0.2), width * (0.58 + Math.random() * 0.16), depth - 1);
      }
    };
    const rootCount = 6 + Math.floor(Math.random() * 2);
    for (let i = 0; i < rootCount; i++) {
      const startAngle = (i / rootCount) * Math.PI * 2 + Math.random() * 0.4;
      const sx = Math.cos(startAngle) * 0.98, sy = Math.sin(startAngle) * 0.98;
      grow(sx, sy, startAngle + Math.PI + (Math.random() - 0.5) * 0.8, 0.32, 0.09, 4);
    }
    return segments;
  }

  // Same recursive branch/fork/taper language as generateVeinBranches, but seeded to radiate
  // OUTWARD from the center (0,0 — Virus's own position at the moment of victory) instead of
  // inward from the unit circle's edge, and denser (more roots, one extra generation, a higher
  // fork chance, a much smaller width cutoff) so it still reads as tightly packed once
  // drawVictoryOverlay scales it up to cover the whole arena rather than one character's body.
  generateVictoryVeinNetwork() {
    const segments = [];
    const grow = (x, y, angle, len, width, depth) => {
      if (depth <= 0 || width < 0.006) return;
      const a2 = angle + (Math.random() - 0.5) * 0.9;
      const nx = x + Math.cos(a2) * len;
      const ny = y + Math.sin(a2) * len;
      const forkCount = Math.random() < VIRUS_VICTORY_FORK_CHANCE ? 2 : 1;
      segments.push({
        x1: x, y1: y, x2: nx, y2: ny, width,
        phase: Math.random() * Math.PI * 2,
        bow: (Math.random() - 0.5) * 0.7,
        node: forkCount === 2,
      });
      for (let f = 0; f < forkCount; f++) {
        const spread = forkCount === 2 ? (f === 0 ? -1 : 1) * (0.3 + Math.random() * 0.5) : (Math.random() - 0.5) * 0.45;
        grow(nx, ny, a2 + spread, len * (0.8 + Math.random() * 0.18), width * (0.62 + Math.random() * 0.16), depth - 1);
      }
    };
    const rootCount = VIRUS_VICTORY_ROOT_COUNT_MIN + Math.floor(Math.random() * VIRUS_VICTORY_ROOT_COUNT_RANGE);
    for (let i = 0; i < rootCount; i++) {
      const startAngle = (i / rootCount) * Math.PI * 2 + Math.random() * 0.3;
      grow(0, 0, startAngle, 0.22, 0.05, VIRUS_VICTORY_DEPTH);
    }
    return segments;
  }

  // The swim sound has to last exactly as long as the liquid phase actually does — which is
  // variable (arrival vs. timeout, different distances every cast) — not just however long the
  // clip itself happens to run. Looping it and having the caller explicitly stop() the returned
  // node the instant "traveling"/"returning" actually ends (arrival, timeout, or an interruption
  // like the target/Virus dying mid-swim) is what guarantees that, in both directions: a short
  // swim cuts the loop off early, a long one just keeps looping seamlessly instead of going quiet.
  playSwimLoop() {
    this.stopSwimLoop();
    this.swimSoundSource = playSfx("virusSwim", 0.45, 0.05, 0, true);
  }

  stopSwimLoop() {
    if (!this.swimSoundSource) return;
    try { this.swimSoundSource.stop(); } catch (e) { /* already stopped/ended on its own */ }
    this.swimSoundSource = null;
  }

  // "traveling"/"returning" move Virus manually (not through the base class's own
  // moveAndBounce, which also applies vx/vy/knockback that don't apply here) so they need their
  // own wall clamp — phasesThroughCharacters only excuses it from OTHER characters, not the
  // arena edge. Same bounds moveAndBounce uses, just a clamp rather than a velocity-reflecting
  // bounce since nothing here is driven by vx/vy anyway.
  clampToArenaBounds() {
    const half = this.size / 2;
    const left = ARENA.x + ARENA_BORDER + half, right = ARENA.x + ARENA.w - ARENA_BORDER - half;
    const top = ARENA.y + ARENA_BORDER + half, bottom = ARENA.y + ARENA.h - ARENA_BORDER - half;
    this.x = Math.min(right, Math.max(left, this.x));
    this.y = Math.min(bottom, Math.max(top, this.y));
  }

  // Kicks off the "traveling" phase only — see the file header for the full three-phase
  // breakdown. Doesn't touch the target at all yet; that's all in beginAttach(), once it
  // actually arrives.
  triggerParasite(opponent) {
    this.parasitePhase = "traveling";
    this.parasiteTarget = opponent;
    this.parasiteTravelTimer = 0;
    spawnFlash(this.x, this.y, "#c060e8", 40, 0.2);
    this.playSwimLoop();
  }

  // Called the instant the liquid form actually reaches the target — fuses into them (see
  // drawSymbioteFusion) for VIRUS_PARASITE_ATTACH_DURATION. This is JUST an infection, not a
  // stun: the target is never made unable to move or act, only carries the fusion visual and
  // takes VIRUS_PARASITE_TICK_DAMAGE once a second (see update()'s "attached" branch) for the
  // duration. The heal lands immediately here, on attach; the sickness-stage step-up (see
  // virusSicknessDamagePerStack) happens at the other end, once the cast is actually over — see
  // endParasite().
  //
  // Virus itself just parks at the attach point and goes movable=false there rather than
  // chasing the target around for the rest of the hold. Nothing about it needs to track the
  // target's position any more: it isn't drawn as a separate body while attached (see draw()),
  // and the fusion coating/damage/particles are all driven off the TARGET's own position, not
  // Virus's. Parking it also sidesteps a real bug: with the target now free to move, if Virus
  // kept re-snapping onto their body every frame the two would be in constant contact, and
  // resolveCollision()'s "both movable" branch SWAPS velocities on contact rather than
  // reflecting them — exactly the mechanism that caused the PM2 hit-stun freeze bug earlier
  // this project. movable=false sidesteps that path entirely (contact just reflects harmlessly)
  // instead of risking corrupting the target's own velocity.
  beginAttach(target) {
    this.stopSwimLoop();
    this.parasitePhase = "attached";
    this.parasiteTimer = VIRUS_PARASITE_ATTACH_DURATION;
    this.parasiteTickTimer = VIRUS_PARASITE_TICK_INTERVAL;
    this.parasiteAngle = Math.random() * Math.PI * 2;
    this.parasiteRadius = target.size * 0.32;

    this.x = target.x + Math.cos(this.parasiteAngle) * this.parasiteRadius;
    this.y = target.y + Math.sin(this.parasiteAngle) * this.parasiteRadius;
    this.movable = false;

    // A fresh branching vein/root network every cast — see generateVeinBranches — so the same
    // target getting parasitized more than once doesn't look identical each time.
    this.veinBranches = this.generateVeinBranches();

    // See VIRUS_PARASITE_HEAL_BASE/PER_STACK — reads whatever Infection is on the target AT THE
    // MOMENT of attach, not at any later point in the hold.
    const existingInfection = this.infections.find((e) => e.target === target);
    const infectionStacks = existingInfection ? existingInfection.stacks : 0;
    this.heal(VIRUS_PARASITE_HEAL_BASE + infectionStacks * VIRUS_PARASITE_HEAL_PER_STACK);

    // main.js always draws fighterA before fighterB — if Virus happens to BE fighterA, painting
    // the fusion coating from Virus's own draw() call would get drawn UNDER the target's body a
    // moment later when they draw themselves. installVirusDrawExtras guarantees the coating
    // always lands on top of their body specifically regardless of draw order, and — unlike
    // directly monkeypatching target.draw here — coexists safely with any other Virus overlay
    // (e.g. spit splats) already hooked onto the same target. endParasite() removes just this
    // one callback again, not the whole hook.
    installVirusDrawExtras(target);
    this.symbioteDrawFn = (ctx) => this.drawSymbioteFusion(ctx);
    target._virusDrawExtras.push(this.symbioteDrawFn);

    playSfx("virusPossess", 0.8); // one-shot, not looped — VIRUS_PARASITE_ATTACH_DURATION is tuned to this clip's own length, see that constant
    spawnFlash(this.x, this.y, "#e060ff", 90, 0.3);
    spawnImpactParticles(this.x, this.y, ["#a838c0", "#e060ff", "#3c2c52"], 30, 1.4, 0);
    triggerShake(9, 0.28);
  }

  // Releases the target, drops the draw() hook, steps up their sickness stage now that the cast
  // is actually finished (see virusSicknessDamagePerStack), and drops Virus into "returning" —
  // liquid, swimming out from the target's CURRENT body toward a fresh random spot in the arena
  // before it starts solidifying back into its normal body (see update()'s "returning" branch).
  //
  // During attach Virus stays parked at a fixed world point rather than tracking the now-freely-
  // moving target every frame (see beginAttach's comment on the resolveCollision hazard that
  // sidesteps) — so by the time the hold ends that parked point can be well away from wherever
  // the target has actually walked to since. The fusion coating itself never had this problem
  // (drawSymbioteFusion is drawn relative to the target's live x/y every frame), but Virus's own
  // x/y does — so it has to be snapped back onto the target's current body, at the same
  // parasiteAngle/parasiteRadius offset the coating's been rendering at, right before the swim-out
  // starts. Otherwise the liquid visibly launches from stale empty space instead of the host.
  endParasite() {
    const target = this.parasiteTarget;
    if (target) {
      this.bumpSicknessStage(target);
      // Remove just the symbiote-fusion callback — NOT the whole target.draw hook, which any
      // still-active spit splats on this same target also depend on (see installVirusDrawExtras).
      if (target._virusDrawExtras && this.symbioteDrawFn) {
        const idx = target._virusDrawExtras.indexOf(this.symbioteDrawFn);
        if (idx >= 0) target._virusDrawExtras.splice(idx, 1);
      }
      this.symbioteDrawFn = null;
      this.x = target.x + Math.cos(this.parasiteAngle) * this.parasiteRadius;
      this.y = target.y + Math.sin(this.parasiteAngle) * this.parasiteRadius;

      // The attach-long decay freeze (see updateInfections) ends here — hand any still-active
      // Infection on this target a full fresh window right as the hold actually ends, rather
      // than resuming from wherever the frozen countdown was.
      const infection = this.infections.find((e) => e.target === target);
      if (infection) infection.refreshTimer = VIRUS_INFECTION_STACK_DURATION;
    }
    // A clear "coming apart" burst right as the network drops off — flags "look here, something
    // just happened" the instant the liquid starts pulling away. A second burst lands separately
    // once it actually arrives and starts solidifying — see the "returning" branch in update().
    spawnFlash(this.x, this.y, "#d060f0", 75, 0.3);
    spawnImpactParticles(this.x, this.y, ["#a838c0", "#e060ff", "#3c2c52"], 18, 1.1, 0);
    this.movable = true;
    this.parasitePhase = "returning";
    this.parasiteTravelTimer = 0;
    const margin = this.size * 1.5;
    this.parasiteReturnX = ARENA.x + margin + Math.random() * Math.max(0, ARENA.w - margin * 2);
    this.parasiteReturnY = ARENA.y + margin + Math.random() * Math.max(0, ARENA.h - margin * 2);
    this.parasiteTarget = null;
    this.playSwimLoop();
  }

  update(dt, opponent) {
    // Infection runs its own course independent of Virus's own alive/stun state — see
    // updateInfections' comment. Spit splats are purely cosmetic timers, same idea.
    this.updateInfections(dt);
    this.updateSpitSplats(dt);

    if (this.deathFadeTimer > 0) this.deathFadeTimer -= dt;
    if (!this.alive) {
      // Dying mid-fusion would otherwise leave the target's draw() permanently hooked, still
      // trying to render a coating for a Virus that no longer exists.
      if (this.parasitePhase === "attached") this.endParasite();
      // Dying mid-swim would otherwise leave the looping swim sound playing forever — see the
      // file header on the swim sound's own "exactly as long as it lasts" requirement.
      if (this.parasitePhase === "traveling" || this.parasitePhase === "returning") this.stopSwimLoop();
      this.updateSpikes(dt, opponent);
      return;
    }

    // Won — freezes in place right where it is (mid-swim, mid-idle, wherever) and just lets the
    // arena-engulfing vein network grow outward from that spot; see onVictory/drawVictoryOverlay.
    // No more movement/attacks/AI of any kind once this starts.
    if (this.celebratingVictory) {
      this.victoryTimer += dt;
      return;
    }

    // Liquid, swimming toward the target — never stuns them, see the file header. Ends
    // either by arriving (-> beginAttach) or, failing that, by timing out (a target that's
    // somehow consistently outrunning the swim speed) so this can never strand Virus mid-swim
    // forever.
    if (this.parasitePhase === "traveling") {
      const target = this.parasiteTarget;
      if (!target || !target.alive) { this.stopSwimLoop(); this.parasitePhase = null; this.parasiteTarget = null; return; }
      const dx = target.x - this.x, dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      // The same "touching" distance resolveCollision() itself uses — attach fires the instant
      // it actually makes contact, not at some separate, tighter proximity check. (Using a
      // tighter threshold than this meant it could visibly bump into the target — taking normal
      // contact damage via onCollide, and getting shoved back apart by resolveCollision's own
      // physics — one or more times before ever getting close enough to trigger the attach.)
      const touchDist = (this.size + target.size) / 2;
      this.parasiteTravelTimer += dt;
      // The touch-distance check alone can pass on the very first frame if the ultimate was
      // thrown at point-blank range — gated on VIRUS_PARASITE_MIN_SWIM_TIME too so it can't ever
      // skip straight past the swim (see that constant). The timeout is a separate, unconditional
      // escape hatch either way.
      if ((dist <= touchDist && this.parasiteTravelTimer >= VIRUS_PARASITE_MIN_SWIM_TIME)
        || this.parasiteTravelTimer >= VIRUS_PARASITE_TRAVEL_TIMEOUT) {
        this.beginAttach(target);
      } else {
        const ang = dist > 0.01 ? Math.atan2(dy, dx) : this.facingAngle;
        this.x += Math.cos(ang) * VIRUS_PARASITE_TRAVEL_SPEED * dt;
        this.y += Math.sin(ang) * VIRUS_PARASITE_TRAVEL_SPEED * dt;
        this.facingAngle = ang;
        this.clampToArenaBounds(); // phasesThroughCharacters skips the opponent, but walls still apply
      }
      return;
    }

    // Fused on — just an infection, not a stun: the target keeps fighting/moving normally the
    // whole time (see beginAttach), Virus just sits parked wherever it attached, invisible, no
    // wandering/spikes/new ultimate cast of its own, until the hold runs out or the target dies.
    // The flat per-second bite is entirely separate from Infection/sickness (see
    // VIRUS_PARASITE_TICK_DAMAGE).
    if (this.parasitePhase === "attached") {
      const target = this.parasiteTarget;
      if (!target || !target.alive) { this.endParasite(); return; }

      this.parasiteTickTimer -= dt;
      if (this.parasiteTickTimer <= 0) {
        this.parasiteTickTimer += VIRUS_PARASITE_TICK_INTERVAL;
        target.takeDamage(VIRUS_PARASITE_TICK_DAMAGE);
        spawnImpactParticles(target.x, target.y, ["#a838c0", "#e060ff"], 8, 0.7, 0);
      }

      this.parasiteTimer -= dt;
      if (this.parasiteTimer <= 0) this.endParasite();
      return;
    }

    // Liquid, drifting away from the (possibly stale) attach point toward the fresh spot rolled
    // in endParasite(). Ends either by arriving or, failing that, by timing out — same safety
    // pattern as the "traveling" swim-in. On arrival this does NOT hold a separate blocking
    // phase: it snaps parasitePhase back to null and falls straight through into the normal
    // AI/movement/attack code below in this SAME frame, so there's no stuck-looking beat where
    // it just sits mid-arena — see the file header. Only the visual liquid->solid catch-up
    // (reformGlowTimer, see bodySolidify) rides along on top of that, purely cosmetic.
    if (this.parasitePhase === "returning") {
      const dx = this.parasiteReturnX - this.x, dy = this.parasiteReturnY - this.y;
      const dist = Math.hypot(dx, dy);
      this.parasiteTravelTimer += dt;
      // Same VIRUS_PARASITE_MIN_SWIM_TIME floor as "traveling" — see that constant.
      if ((dist <= 14 && this.parasiteTravelTimer >= VIRUS_PARASITE_MIN_SWIM_TIME)
        || this.parasiteTravelTimer >= VIRUS_PARASITE_RETURN_TIMEOUT) {
        this.stopSwimLoop();
        this.parasitePhase = null;
        this.reformGlowTimer = VIRUS_REFORM_VISUAL_DURATION;
        spawnFlash(this.x, this.y, "#d060f0", 65, 0.28);
        spawnImpactParticles(this.x, this.y, ["#a838c0", "#e060ff"], 12, 0.9, 0);
        // deliberately no `return` here — falls through into normal control below
      } else {
        const ang = Math.atan2(dy, dx);
        this.x += Math.cos(ang) * VIRUS_PARASITE_RETURN_SPEED * dt;
        this.y += Math.sin(ang) * VIRUS_PARASITE_RETURN_SPEED * dt;
        this.facingAngle = ang;
        this.clampToArenaBounds();
        return;
      }
    }

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x, dy = opponent.y - this.y;
      if (Math.hypot(dx, dy) > 0.01) this.facingAngle = Math.atan2(dy, dx);
    }

    super.update(dt, opponent);
    if (this.meleeTimer > 0) this.meleeTimer -= dt;
    if (this.reformGlowTimer > 0) this.reformGlowTimer -= dt;

    this.updateSpikes(dt, opponent);

    if (this.stunTimer > 0) return;

    if (this.spikeTimer > 0) this.spikeTimer -= dt;
    if (opponent && opponent.alive && this.spikeTimer <= 0 && this.canAttack) {
      this.spikeTimer += VIRUS_SPIKE_COOLDOWN;
      this.throwSpike(opponent);
    }

    if (this.ultimateCooldown > 0) this.ultimateCooldown -= dt;
    if (this.ultimateCooldown <= 0 && this.canAttack && opponent && opponent.alive) {
      this.ultimateCooldown = VIRUS_ULTIMATE_COOLDOWN;
      this.triggerParasite(opponent);
    }
  }

  // A glob of spit, not a dart: a bulbous rounded head out front with a short, uneven tail
  // dragging behind it (built the same layered-wobble way as drawMucusBody, just tiny and
  // simplified), a glossy highlight, and one or two little droplets trailing off the tail —
  // reads as viscous/thrown rather than a solid thrown object.
  drawSpikesInFlight(ctx) {
    const t = performance.now() / 1000;
    for (const s of this.spikes) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);

      const headR = 8; // was 6.5 — a touch bigger so it actually reads at gameplay scale, still small next to the body
      const tailLen = 15 + Math.sin(t * 9 + s.wobbleSeed) * 1.8;

      ctx.beginPath();
      ctx.moveTo(headR, 0);
      const topWobble = Math.sin(t * 12 + s.wobbleSeed) * 1.5;
      const botWobble = Math.sin(t * 12 + s.wobbleSeed + 2.3) * 1.5;
      ctx.quadraticCurveTo(headR * 0.3, -headR * 0.85 + topWobble, -tailLen * 0.6, -1.8 + topWobble * 0.5);
      ctx.quadraticCurveTo(-tailLen, 0, -tailLen * 0.6, 1.8 + botWobble * 0.5);
      ctx.quadraticCurveTo(headR * 0.3, headR * 0.85 + botWobble, headR, 0);
      ctx.closePath();

      const grad = ctx.createRadialGradient(headR * 0.3, 0, 1, headR * 0.3, 0, headR * 1.4);
      grad.addColorStop(0, "#d060f0");
      grad.addColorStop(1, "#8a2fa8");
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.88;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Small glossy highlight on the head, like light catching a wet surface
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(headR * 0.5, -headR * 0.3, 2, 0, Math.PI * 2);
      ctx.fill();

      // A trailing droplet or two, like it's still stringing off the back
      for (let i = 0; i < 2; i++) {
        const dropT = 0.55 + i * 0.35;
        const dropR = 2 - i * 0.85;
        const dropX = -tailLen * (0.9 + dropT * 0.5);
        const dropY = Math.sin(t * 10 + s.wobbleSeed + i * 2) * 2.5;
        ctx.fillStyle = "rgba(168,56,192,0.5)";
        ctx.beginPath();
        ctx.arc(dropX, dropY, dropR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // A small purple pip + stack count floating over whoever's currently infected. Only shown
  // while there's an active, ticking Infection entry. The sickness stage itself (see
  // virusSicknessDamagePerStack) keeps affecting damage permanently under the hood either way —
  // it's just no longer spelled out on screen (Cold/Fever text read as more clutter than useful
  // information), to keep this readout to the one number that actually matters moment to moment.
  drawInfectionIndicators(ctx) {
    for (const e of this.infections) {
      if (!e.target.alive) continue;
      const ix = e.target.x, iy = e.target.y - e.target.size / 2 - 46;
      ctx.save();
      ctx.fillStyle = "#c060e8";
      ctx.beginPath();
      ctx.arc(ix - 14, iy - 4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "left";
      ctx.fillText(`x${e.stacks}`, ix - 6, iy);
      ctx.restore();
    }
  }

  // 0 = pure liquid (traveling/returning — no spikes, translucent, wobbling outline), 1 = fully
  // solid (normal idle body). Once "returning" arrives, reformGlowTimer ramps this linearly from
  // 0 to 1 across VIRUS_REFORM_VISUAL_DURATION while gameplay is already back to normal (see the
  // "returning" branch in update()) — purely cosmetic catch-up, not a real phase. drawBody blends
  // continuously on this single number so every state shares the same rendering path instead of
  // needing separate draw methods.
  get bodySolidify() {
    if (this.parasitePhase === "traveling" || this.parasitePhase === "returning") return 0;
    if (this.reformGlowTimer > 0) return Math.min(1, 1 - this.reformGlowTimer / VIRUS_REFORM_VISUAL_DURATION);
    return 1;
  }

  // 0 = normal round body, 1 = fully stretched into the long mucus-strand shape (see
  // drawMucusBody) — nonzero while actually streaking at full speed, "traveling" (swim-in) or
  // "returning" (drift back out) alike; "reforming" is stationary, so it settles as a round
  // puddle instead. Eases in over the first 0.2s of whichever phase so the very first frame
  // doesn't snap straight into a fully-stretched strand.
  get bodyStretch() {
    if (this.parasitePhase !== "traveling" && this.parasitePhase !== "returning") return 0;
    return Math.min(1, this.parasiteTravelTimer / 0.2);
  }

  // A mottled violet sphere ringed with clubbed spikes — a stalk capped by a bulb, same
  // silhouette language as the real coronavirus illustration this is styled after, just shifted
  // into purple/magenta instead of red/orange. A slow breathing pulse and a glowing inner
  // nucleus sell it as alive. While traveling/reforming (see bodySolidify) the spikes and
  // texture fade out and the silhouette itself turns into a soft, translucent, wobbling blob —
  // the liquid form the Parasitize swim-in/out animation asked for.
  drawBody(ctx) {
    const r = this.size / 2;
    const t = performance.now() / 1000;
    const breathe = 1 + Math.sin(t * 1.6) * 0.02;
    const solidify = this.bodySolidify;
    const stretch = this.bodyStretch;

    ctx.save();
    ctx.translate(this.x, this.y);
    // Oriented along the direction of travel only while actually stretched into the mucus
    // strand — the spikes/texture/nucleus below are all rotationally symmetric, so this is
    // harmless for them the rest of the time (stretch is 0 whenever they're visible anyway).
    if (stretch > 0.01) ctx.rotate(this.facingAngle);
    ctx.scale(breathe, breathe);

    // Spikes: hidden while liquid, fade and lengthen in as it solidifies. Each one bobs in and
    // out independently (its own phase offset off the spike's own index) rather than all
    // holding a fixed length — that asynchronous ripple around the ring, more than the gentle
    // whole-body "breathe" pulse alone, is what actually sells it as a living, restless thing
    // instead of a static spiky ball that merely drifts around the arena.
    if (solidify > 0.1) {
      const spikeAlpha = Math.min(1, (solidify - 0.1) / 0.6);
      const spikeCount = 16;
      const spikeLen = r * 0.48 * solidify;
      ctx.globalAlpha = spikeAlpha;
      for (let i = 0; i < spikeCount; i++) {
        const a = (i / spikeCount) * Math.PI * 2 + this.spikeSeed;
        const bobPhase = i * 0.9 + this.spikeSeed * 3;
        const bob = Math.sin(t * 2.4 + bobPhase) * 0.3; // -0.3..+0.3 fractional length swing, out of sync per spike
        const wobble = Math.sin(t * 1.4 + i * 1.7) * 0.08;
        const len = spikeLen * (0.8 + 0.2 * Math.sin(i * 2.3)) * (1 + bob);
        const baseR = r * (0.86 + Math.sin(t * 2.4 + bobPhase + 1.4) * 0.025); // the base itself gently breathes too, slightly out of phase with the tip
        const baseX = Math.cos(a) * baseR, baseY = Math.sin(a) * baseR;
        const tipX = Math.cos(a + wobble) * (baseR + len), tipY = Math.sin(a + wobble) * (baseR + len);

        ctx.strokeStyle = "#8b2fa0";
        ctx.lineWidth = r * 0.09;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        ctx.fillStyle = "#d060e8";
        ctx.beginPath();
        ctx.arc(tipX, tipY, r * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Body: a clean circle once solid, a long trailing mucus strand while streaking at full
    // swim speed (see drawMucusBody), or — between those, i.e. settling during "reforming" — an
    // irregular wobbling round blob. solidify/stretch blend these continuously so it visibly
    // firms up (or stretches out) rather than snapping between shapes.
    if (stretch > 0.01) {
      this.drawMucusBody(ctx, r, t, stretch);
    } else {
      ctx.beginPath();
      const outlinePoints = 16;
      for (let i = 0; i <= outlinePoints; i++) {
        const a = (i / outlinePoints) * Math.PI * 2;
        const wobble = (1 - solidify) * Math.sin(t * 3 + a * 3) * 0.16;
        const rad = r * (1 + wobble);
        const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();

      const grad = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
      grad.addColorStop(0, "#786894");
      grad.addColorStop(1, "#332b44");
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.55 + solidify * 0.45; // translucent goo while liquid, opaque once solid
      ctx.fill();
      ctx.globalAlpha = 1;
      if (solidify > 0.4) {
        ctx.globalAlpha = (solidify - 0.4) / 0.6;
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Mottled texture only once mostly solid — pure noise on a wobbling blob doesn't read as
    // anything, so it's not worth showing until the shape has settled down.
    if (solidify > 0.6) {
      ctx.save();
      ctx.globalAlpha = (solidify - 0.6) / 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      for (const d of this.textureDots) {
        ctx.fillStyle = "rgba(20,14,30,0.35)";
        ctx.beginPath();
        ctx.arc(d.dx * r, d.dy * r, d.ds * r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Pulsing inner nucleus glow — visible throughout (brighter while liquid, reads as "still
    // alive and moving" even with no spikes or texture to look at). Shifted into the front bulb
    // while stretched, so the glow reads as "that's the head" rather than sitting in empty
    // space behind the leading edge.
    const glowPulse = 0.5 + Math.sin(t * 2.4) * 0.25;
    const glowCx = r * 0.35 * stretch;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = glowPulse * (0.3 + (1 - solidify) * 0.3);
    const ng = ctx.createRadialGradient(glowCx, 0, 0, glowCx, 0, r * 0.45);
    ng.addColorStop(0, "#c060e0");
    ng.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.arc(glowCx, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  // The "snot" look: a bulbous head at the front (direction of travel, local +x) trailing into
  // a long strand dragging behind it. The top and bottom edges are each built from several
  // overlapping sine waves at different frequencies/phases (not mirrors of each other), so the
  // outline bulges and pinches unevenly along its length instead of tapering in one clean smooth
  // curve — that unevenness is what actually reads as "flowing" rather than just "stretched".
  drawMucusBody(ctx, r, t, stretch) {
    const frontR = r * 0.95;
    const tailLen = r * 5.5 * stretch;
    const baseWidth = r * 0.6;
    const segments = 16;

    // u: 0 at the front bulb -> 1 at the tail tip. Three layered waves per edge, at different
    // frequencies and running at different speeds, so no two points ripple in lockstep — the
    // combined effect looks like liquid actually moving through the strand rather than the
    // whole shape just wobbling as one rigid unit. Top and bottom use different phase offsets
    // so they're never mirror images of each other.
    function edgeWidth(u, phaseOffset) {
      const taper = Math.pow(1 - u, 0.65); // fuller near the head, thinning toward the tip
      const ripple =
        Math.sin(t * 6.0 + u * 9 + phaseOffset) * 0.4 +
        Math.sin(t * 3.4 - u * 6 + phaseOffset * 1.8) * 0.3 +
        Math.sin(t * 10.5 + u * 14 + phaseOffset * 0.5) * 0.18;
      return Math.max(r * 0.04, baseWidth * taper * (0.6 + ripple));
    }

    const topPts = [], botPts = [];
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const x = frontR - (frontR + tailLen) * u;
      topPts.push({ x, y: -edgeWidth(u, 0) * stretch });
      botPts.push({ x, y: edgeWidth(u, 3.4) * stretch });
    }

    // Smooths through each run of points by curving to the midpoint between consecutive
    // vertices instead of drawing straight segments to them — an easy way to get an organic,
    // continuously-flowing line out of a handful of noisy sample points.
    function traceSmooth(pts) {
      for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    }

    ctx.beginPath();
    ctx.moveTo(topPts[0].x, topPts[0].y);
    traceSmooth(topPts);
    // Round tail tip, then back up the bottom edge to the head
    ctx.quadraticCurveTo(-tailLen * 1.02, 0, botPts[botPts.length - 1].x, botPts[botPts.length - 1].y);
    traceSmooth([...botPts].reverse());
    ctx.quadraticCurveTo(frontR * 1.05, 0, topPts[0].x, topPts[0].y); // rounds the head back to the start
    ctx.closePath();

    const grad = ctx.createLinearGradient(frontR, 0, -tailLen, 0);
    grad.addColorStop(0, "#8a72a8");
    grad.addColorStop(0.35, "#5c4878");
    grad.addColorStop(1, "rgba(60,44,80,0)"); // fades out at the very tip
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.78;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Glossy highlight streak, itself riding the same top-edge ripple so it stays glued to the
    // surface instead of cutting a straight line through an uneven shape
    ctx.strokeStyle = "rgba(240,220,255,0.4)";
    ctx.lineWidth = r * 0.08;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(topPts[1].x, topPts[1].y * 0.7);
    for (let i = 2; i < topPts.length - 3; i++) ctx.lineTo(topPts[i].x, topPts[i].y * 0.6);
    ctx.stroke();

    // A couple of small droplets trailing off the very tip, like the strand is breaking apart
    for (let i = 0; i < 2; i++) {
      const dropT = 0.15 + i * 0.2;
      const dropR = r * (0.14 - i * 0.05) * stretch;
      if (dropR <= 0.5) continue;
      const dropX = -tailLen * (1 + dropT);
      const dropY = Math.sin(t * 6 + i * 2) * r * 0.15;
      ctx.fillStyle = "rgba(120,96,150,0.55)";
      ctx.beginPath();
      ctx.arc(dropX, dropY, dropR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The fusion coating — hooked onto the TARGET's own draw() by triggerParasite, so this always
  // renders after (on top of) their body regardless of fighterA/fighterB draw order. Spreads
  // out from the attach point over VIRUS_SYMBIOTE_SPREAD_TIME, holds fully coated, then visibly
  // peels back over the last VIRUS_SYMBIOTE_RETRACT_TIME before Virus detaches — both driven off
  // parasiteTimer, not a separate clock, so the animation always matches the actual hold length
  // even if that gets tuned later.
  //
  // Deliberately no face, no radiating tentacles, and no solid coating fill either (that read
  // as a flat black disc sitting on the host, not a wrap). The host's own body stays fully
  // visible; all that's added is the branching root/vein network built once per cast by
  // generateVeinBranches() — a chaotic tangle, not a tidy geometric wrap.
  drawSymbioteFusion(ctx) {
    if (this.parasitePhase !== "attached" || !this.parasiteTarget || !this.parasiteTarget.alive) return;
    const target = this.parasiteTarget;
    const t = performance.now() / 1000;
    const elapsed = VIRUS_PARASITE_ATTACH_DURATION - this.parasiteTimer;
    const spreadT = Math.min(1, elapsed / VIRUS_SYMBIOTE_SPREAD_TIME);
    const retractT = this.parasiteTimer < VIRUS_SYMBIOTE_RETRACT_TIME
      ? Math.max(0, this.parasiteTimer / VIRUS_SYMBIOTE_RETRACT_TIME) : 1;
    const coverage = Math.min(spreadT, retractT); // 0 -> 1 -> 0 across the whole hold
    if (coverage <= 0) return;

    const r = target.size / 2;
    const originX = Math.cos(this.parasiteAngle) * r, originY = Math.sin(this.parasiteAngle) * r;
    const pulse = 0.75 + Math.sin(t * 2.4) * 0.25; // shared breathing rhythm, same cadence as drawBody's nucleus glow

    ctx.save();
    ctx.translate(target.x, target.y);

    // The vein network is clipped to a circle growing out from the attach point, so it visibly
    // creeps across the host's body instead of all popping into view at once.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r + 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(originX, originY, coverage * r * 2.6, 0, Math.PI * 2);
    ctx.clip();

    // A faint magenta bloom under the network, centered on the attach point — softens the edge of
    // the growing clip-reveal (which would otherwise read as a hard geometric cutoff) and reads
    // as an infected "hot spot" the veins are radiating out from.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.22 * coverage;
    const glow = ctx.createRadialGradient(originX, originY, 0, originX, originY, r * 0.95);
    glow.addColorStop(0, "#c060e0");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(originX, originY, r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // How close the growing coverage circle's own edge is right now — segments near that
    // boundary fade out (see `feather` below) instead of ending in a hard geometric line, since
    // the ctx.clip() above alone would otherwise cut the network off with a razor-sharp edge.
    const edgeRadius = coverage * r * 2.6;
    const featherBand = Math.max(1, edgeRadius * 0.32);

    ctx.lineCap = "round";
    for (const seg of this.veinBranches) {
      // A tiny organic sway per segment — not enough to change the branching structure, just
      // enough that the network reads as faintly alive rather than a static decal.
      const sway = Math.sin(t * 2.2 + seg.phase) * 0.012;
      const x1 = seg.x1 * r, y1 = seg.y1 * r;
      const x2 = (seg.x2 + sway) * r, y2 = (seg.y2 - sway) * r;

      // Each vein bows through a perpendicular-offset control point instead of running dead
      // straight — a network of straight rods read as too geometric/mechanical; a real vein or
      // root never travels in a perfectly straight line.
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const perpX = -(y2 - y1), perpY = x2 - x1;
      const perpLen = Math.hypot(perpX, perpY) || 1;
      const bowAmt = seg.bow * r * 0.4;
      const cx = mx + (perpX / perpLen) * bowAmt, cy = my + (perpY / perpLen) * bowAmt;

      // Segments out near the growing edge fade smoothly toward 0 rather than getting sheared
      // off flush by the clip circle — softens the reveal into a feathered edge instead of a
      // hard geometric boundary.
      const distFromOrigin = Math.hypot(x2 - originX, y2 - originY);
      const feather = Math.min(1, Math.max(0, (edgeRadius - distFromOrigin) / featherBand));
      if (feather <= 0) continue;

      // Dark base vein first, then a thin brighter highlight riding the same curve slightly
      // narrower — reads as a raised, fleshy ridge with its own sheen instead of a flat painted
      // line, and the highlight's opacity breathes with `pulse` so the whole network feels alive.
      ctx.strokeStyle = `rgba(30,15,42,${(0.92 * feather).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.7, seg.width * r);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(172,60,196,${(0.55 * pulse * feather).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.4, seg.width * r * 0.4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();

      // A small pulsing nodule at every fork joint — like a swollen node along the vein, and
      // enough scattered texture on top of the lines alone to sell the "crawling infection" look.
      if (seg.node) {
        ctx.fillStyle = `rgba(100,32,126,${(0.7 * pulse * feather).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x2, y2, Math.max(1, seg.width * r * 1.35) * pulse, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore(); // end clip
    ctx.restore();
  }

  // The floating HP number/bar that normally hovers over Virus's own head reads as clutter once
  // it's sitting in the middle of the arena-engulfing victory mass — the whole point there is the
  // battlefield looking consumed, not still showing routine combat HUD through it. Everywhere
  // else (mid-fight, dead) it behaves exactly like every other character's.
  drawFieldHpBar(ctx) {
    if (this.celebratingVictory) return;
    super.drawFieldHpBar(ctx);
  }

  draw(ctx) {
    this.drawSpikesInFlight(ctx);
    this.drawInfectionIndicators(ctx);
    if (!this.alive && this.deathFadeTimer <= 0) return;
    // Fused into the host — no separate body of its own on screen; see drawSymbioteFusion,
    // which is hooked onto the target's own draw() by beginAttach(). "traveling"/"reforming"
    // still draw normally, just with drawBody rendering the liquid form (see bodySolidify).
    if (this.parasitePhase === "attached") return;
    super.draw(ctx);
  }

  get ultimateRatio() {
    return Math.max(0, 1 - this.ultimateCooldown / VIRUS_ULTIMATE_COOLDOWN);
  }

  get ultimateBarColor() {
    return "#c060e8";
  }

  drawHud(ctx, x, y, w) {
    let ny = super.drawHud(ctx, x, y, w);
    ctx.textAlign = "left";

    if (this.parasitePhase) {
      const label = this.parasitePhase === "traveling" ? "SWIMMING"
        : this.parasitePhase === "attached" ? "PARASITIZING" : "RETURNING";
      ctx.fillStyle = "#ff70f0";
      ctx.font = "bold 14px Arial";
      ctx.fillText(label, x, ny);
      ny += 18;
    }

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "13px Arial";
    ctx.fillText(this.spikeTimer > 0 ? `Spike: ${this.spikeTimer.toFixed(2)}s` : "Spike ready", x, ny);
    ctx.fillText(`Parasitize: ${this.ultimateCooldown > 0 ? this.ultimateCooldown.toFixed(1) + "s" : "ready"}`, x, ny + 18);
  }

  // Fired once by main.js the instant Virus is declared the winner. Freezes it in place (see the
  // celebratingVictory branch in update()) and rolls a fresh dense root network PLUS four
  // corner-gripping claws (see generateVictoryClaws), all radiating out from wherever it happens
  // to be standing — see drawVictoryOverlay for how it actually grows in, hard-clipped to the
  // arena rectangle so none of it spills past the battlefield's own walls.
  onVictory() {
    // Winning mid-Parasitize would otherwise strand the cast forever, since the celebration
    // branch in update() returns before any of the phase handling runs: the looping swim sound
    // would never be stopped, a target caught mid-attach would keep its draw() hook, and the HUD
    // would sit on a stale SWIMMING/PARASITIZING/RETURNING tag for the whole victory. Close the
    // cast out properly first, then clear the phase.
    if (this.parasitePhase === "attached") this.endParasite();
    this.stopSwimLoop();
    this.parasitePhase = null;
    this.parasiteTarget = null;
    this.movable = true;

    this.celebratingVictory = true;
    this.victoryTimer = 0;
    this.victoryOriginX = this.x;
    this.victoryOriginY = this.y;
    const corners = [
      { x: ARENA.x, y: ARENA.y }, { x: ARENA.x + ARENA.w, y: ARENA.y },
      { x: ARENA.x, y: ARENA.y + ARENA.h }, { x: ARENA.x + ARENA.w, y: ARENA.y + ARENA.h },
    ];
    this.victoryMaxRadius = Math.max(...corners.map((c) => Math.hypot(c.x - this.victoryOriginX, c.y - this.victoryOriginY)));
    this.victoryNetwork = this.generateVictoryVeinNetwork();
    this.victoryClaws = this.generateVictoryClaws(this.victoryOriginX, this.victoryOriginY);
    this.buildVictoryArtwork();
    playSfx("virusWin", 0.8);
  }

  // ---------------------------------------------------------------- victory artwork bake
  // Flattens both layers (the fine root network, in unit space around the origin, and the four
  // corner claws, already in absolute arena coordinates) into one list of limbs in absolute
  // coordinates, each with a start/end RADIUS rather than a stroke width — the bake below fills
  // them as solid tapered capsules instead of stroking lines, which is what allows real
  // cylindrical shading across each limb's thickness.
  collectVictoryLimbs() {
    const R = this.victoryMaxRadius;
    const ox = this.victoryOriginX, oy = this.victoryOriginY;
    const limbs = [];
    for (const s of this.victoryNetwork) {
      const r = Math.max(0.45, (s.width * R) / 2);
      limbs.push({
        x1: ox + s.x1 * R, y1: oy + s.y1 * R,
        x2: ox + s.x2 * R, y2: oy + s.y2 * R,
        w1: r, w2: r * 0.74, node: s.node, main: false,
        seed: s.phase, bow: (s.bow || 0) * r * 1.2, off: 0, tint: Math.random(),
      });
    }
    for (const claw of this.victoryClaws) {
      for (const s of claw) {
        const r = s.width / 2;
        limbs.push({
          x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, w1: r, w2: r * 0.82, node: false, main: s.main,
          seed: Math.random() * 10, bow: (Math.random() - 0.5) * r * 1.4, off: 0, tint: Math.random(),
        });
      }
    }
    return limbs;
  }

  // Adds one limb's silhouette to whatever path is currently open — deliberately does NOT call
  // beginPath, so the shadow/webbing passes can accumulate every limb into a single path and pay
  // for an expensive blur filter exactly once instead of once per limb.
  //
  // Not a plain tapered capsule: the centreline bows to one side, and each side of the limb is
  // walked as its own run of points whose distance from that centreline is modulated by two
  // out-of-phase sine terms (different phases per side, so the two edges never mirror each other).
  // That irregular bulging and pinching is what stops the mass reading as a bundle of moulded
  // plastic tubes — real vessels are never the same thickness twice along their length.
  addVictoryLimbPath(g, L) {
    const dx = L.x2 - L.x1, dy = L.y2 - L.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const seed = L.seed || 0;
    const bow = L.bow || 0;
    const off = L.off || 0;
    const N = 7;

    const spineAt = (f) => {
      const bend = Math.sin(f * Math.PI) * bow + off;
      return { x: L.x1 + ux * len * f + px * bend, y: L.y1 + uy * len * f + py * bend };
    };
    const radiusAt = (f, phase) => {
      const base = L.w1 + (L.w2 - L.w1) * f;
      const n = 1 + Math.sin(f * 7.3 + seed + phase) * 0.17 + Math.sin(f * 13.9 + seed * 2.1 + phase) * 0.1;
      return Math.max(0.3, base * n);
    };

    const ring = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N, c = spineAt(f), r = radiusAt(f, 0);
      ring.push({ x: c.x + px * r, y: c.y + py * r });
    }
    // Rounded cap over the far end, then back down the other side
    const endC = spineAt(1), endR = (radiusAt(1, 0) + radiusAt(1, 2.9)) / 2;
    const endA = Math.atan2(py, px);
    for (let k = 1; k < 4; k++) {
      const a = endA - (k / 4) * Math.PI;
      ring.push({ x: endC.x + Math.cos(a) * endR, y: endC.y + Math.sin(a) * endR });
    }
    for (let i = N; i >= 0; i--) {
      const f = i / N, c = spineAt(f), r = radiusAt(f, 2.9);
      ring.push({ x: c.x - px * r, y: c.y - py * r });
    }
    const startC = spineAt(0), startR = (radiusAt(0, 0) + radiusAt(0, 2.9)) / 2;
    for (let k = 1; k < 4; k++) {
      const a = endA + Math.PI - (k / 4) * Math.PI;
      ring.push({ x: startC.x + Math.cos(a) * startR, y: startC.y + Math.sin(a) * startR });
    }

    // Smooth through the ring by curving to the midpoint between consecutive vertices, so the
    // outline flows instead of showing every sample point as a corner.
    const n = ring.length;
    let mx = (ring[n - 1].x + ring[0].x) / 2, my = (ring[n - 1].y + ring[0].y) / 2;
    g.moveTo(mx, my);
    for (let i = 0; i < n; i++) {
      const cur = ring[i], nxt = ring[(i + 1) % n];
      g.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
    }
    g.closePath();
  }

  // The core of the realism: a gradient running ACROSS the limb rather than along it, dark at
  // both rims and bright at a band offset toward VIRUS_VICTORY_LIGHT — the standard way to read a
  // cylinder as round. Because the offset tracks each limb's own orientation, limbs pointing
  // different directions catch the light differently, exactly as real tubes lying at different
  // angles under one lamp would.
  fillVictoryLimb(g, L) {
    const dx = L.x2 - L.x1, dy = L.y2 - L.y1;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const w = Math.max(L.w1, L.w2);
    const mx = (L.x1 + L.x2) / 2, my = (L.y1 + L.y2) / 2;

    const lightDot = px * VIRUS_VICTORY_LIGHT.x + py * VIRUS_VICTORY_LIGHT.y;
    const hp = Math.min(0.82, Math.max(0.18, 0.5 + lightDot * 0.3));

    // Deliberately dark and low-saturation, with the lit band kept narrow: bright saturated
    // violet across the full width read as glowing plastic, whereas diseased tissue is mostly in
    // shadow with only a slim band actually catching the light. Each limb also sits somewhere on
    // its own violet-to-raw-flesh tint (see `tint`), because a mass where every strand is the
    // exact same hue is the other thing that instantly reads as computer-generated.
    const k = L.tint || 0;
    const mix = (a, b) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`;
    const litCol = mix([99, 44, 116], [118, 42, 82]);
    const midCol = mix([74, 31, 92], [90, 30, 64]);

    const grad = g.createLinearGradient(mx - px * w, my - py * w, mx + px * w, my + py * w);
    grad.addColorStop(0, "#070310");
    grad.addColorStop(Math.max(0.03, hp - 0.30), "#22102e");
    grad.addColorStop(Math.max(0.05, hp - 0.10), midCol);
    grad.addColorStop(hp, litCol);
    grad.addColorStop(Math.min(0.97, hp + 0.22), "#2a1038");
    grad.addColorStop(1, "#06020c");
    g.fillStyle = grad;
    g.beginPath();
    this.addVictoryLimbPath(g, L);
    g.fill();
  }

  // A thin wet glint riding the lit side of a limb. Narrow, dim, and deliberately broken into
  // patches along its length (the alpha stops fade in and out several times rather than running
  // one continuous streak) — an unbroken bright stripe down the middle is exactly what makes CG
  // tubes look like polished plastic. Follows the same bowed, irregular outline as the limb via
  // the shared path builder, just inset and offset toward the light.
  drawVictorySpecular(g, L) {
    const dx = L.x2 - L.x1, dy = L.y2 - L.y1;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const side = (px * VIRUS_VICTORY_LIGHT.x + py * VIRUS_VICTORY_LIGHT.y) >= 0 ? 1 : -1;
    const S = {
      x1: L.x1, y1: L.y1, x2: L.x2, y2: L.y2,
      w1: L.w1 * 0.15, w2: L.w2 * 0.15,
      seed: (L.seed || 0) + 1.3, bow: L.bow, off: (L.off || 0) + L.w1 * 0.5 * side,
    };
    const grad = g.createLinearGradient(L.x1, L.y1, L.x2, L.y2);
    grad.addColorStop(0, "rgba(228,198,240,0)");
    grad.addColorStop(0.18, "rgba(228,198,240,0.17)");
    grad.addColorStop(0.34, "rgba(228,198,240,0.03)");
    grad.addColorStop(0.55, "rgba(220,188,236,0.13)");
    grad.addColorStop(0.74, "rgba(220,188,236,0.02)");
    grad.addColorStop(1, "rgba(220,188,236,0)");
    g.fillStyle = grad;
    g.beginPath();
    this.addVictoryLimbPath(g, S);
    g.fill();
  }

  // A swollen nodule at a fork. Built as an irregular lumpy blob rather than a circle, and shaded
  // with the light band well off centre and falling to near-black at the far rim — a clean sphere
  // with a big round highlight reads as a glass marble sitting on top of the mass, not as part of
  // the same tissue.
  drawVictoryNode(g, x, y, r, seed) {
    const lx = x + VIRUS_VICTORY_LIGHT.x * r * 0.42, ly = y + VIRUS_VICTORY_LIGHT.y * r * 0.42;
    const grad = g.createRadialGradient(lx, ly, r * 0.06, x, y, r * 1.05);
    grad.addColorStop(0, "#7d3792");
    grad.addColorStop(0.4, "#4c1f5e");
    grad.addColorStop(1, "#0b0412");
    g.fillStyle = grad;

    const pts = 9;
    g.beginPath();
    const ring = [];
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rr = r * (0.82 + Math.sin(a * 2.3 + seed) * 0.13 + Math.sin(a * 3.7 + seed * 1.9) * 0.08);
      ring.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
    }
    g.moveTo((ring[pts - 1].x + ring[0].x) / 2, (ring[pts - 1].y + ring[0].y) / 2);
    for (let i = 0; i < pts; i++) {
      const cur = ring[i], nxt = ring[(i + 1) % pts];
      g.quadraticCurveTo(cur.x, cur.y, (cur.x + nxt.x) / 2, (cur.y + nxt.y) / 2);
    }
    g.closePath();
    g.fill();

    g.fillStyle = "rgba(240,214,250,0.3)";
    g.beginPath();
    g.ellipse(lx, ly, r * 0.2, r * 0.13, Math.atan2(VIRUS_VICTORY_LIGHT.y, VIRUS_VICTORY_LIGHT.x), 0, Math.PI * 2);
    g.fill();
  }

  // Renders the entire victory mass ONCE into an offscreen canvas, which drawVictoryOverlay then
  // just blits behind a growing clip each frame. Baking is the whole point: per frame none of
  // this would be affordable, but as a one-off it buys soft connective webbing, a real cast
  // shadow, per-limb cylindrical shading, ambient occlusion pooled at the joints, wet speculars
  // and pore speckle — the things that separate "lit organic matter" from "purple lines".
  buildVictoryArtwork() {
    const SS = VIRUS_VICTORY_SUPERSAMPLE;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(ARENA.w * SS));
    cv.height = Math.max(1, Math.round(ARENA.h * SS));
    const g = cv.getContext("2d");
    g.scale(SS, SS);
    g.translate(-ARENA.x, -ARENA.y);

    // Thin limbs first so the thick claws end up layered convincingly on top of the fine mesh
    // rather than being buried under it.
    const limbs = this.collectVictoryLimbs().sort(
      (a, b) => Math.max(a.w1, a.w2) - Math.max(b.w1, b.w2)
    );

    // 1) Connective webbing — the whole silhouette blurred hard and drawn faint, so dense regions
    //    fuse into translucent membrane between the strands instead of every strand reading as a
    //    separate free-floating object.
    g.save();
    g.filter = "blur(16px)";
    g.fillStyle = "rgba(58,16,78,0.4)";
    g.beginPath();
    for (const L of limbs) this.addVictoryLimbPath(g, L);
    g.fill();
    g.restore();

    // 2) Cast shadow, offset away from the light so the mass sits ON the arena floor. Kept close
    //    and soft — a long hard-edged shadow makes the mass look like a sticker hovering above
    //    the floor rather than something grown onto it.
    g.save();
    g.filter = "blur(7px)";
    g.globalAlpha = 0.42;
    g.translate(-VIRUS_VICTORY_LIGHT.x * 4, -VIRUS_VICTORY_LIGHT.y * 4);
    g.fillStyle = "#04010a";
    g.beginPath();
    for (const L of limbs) this.addVictoryLimbPath(g, L);
    g.fill();
    g.restore();

    // 3) The limbs themselves, each shaded as a lit cylinder.
    for (const L of limbs) this.fillVictoryLimb(g, L);

    // 4) Ambient occlusion pooled where limbs meet. source-atop keeps it strictly inside pixels
    //    already covered by the mass, so it darkens the crevices without smudging the arena.
    g.save();
    g.globalCompositeOperation = "source-atop";
    for (const L of limbs) {
      const r = Math.max(L.w1 * 2.4, 3);
      const ao = g.createRadialGradient(L.x1, L.y1, 0, L.x1, L.y1, r);
      ao.addColorStop(0, "rgba(6,2,12,0.5)");
      ao.addColorStop(1, "rgba(6,2,12,0)");
      g.fillStyle = ao;
      g.beginPath();
      g.arc(L.x1, L.y1, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // 5) Pore/mottle speckle, again confined to the mass itself.
    g.save();
    g.globalCompositeOperation = "source-atop";
    for (let i = 0; i < 900; i++) {
      const L = limbs[(Math.random() * limbs.length) | 0];
      const f = Math.random();
      const x = L.x1 + (L.x2 - L.x1) * f + (Math.random() - 0.5) * L.w1 * 1.6;
      const y = L.y1 + (L.y2 - L.y1) * f + (Math.random() - 0.5) * L.w1 * 1.6;
      g.fillStyle = Math.random() < 0.65 ? "rgba(10,4,18,0.32)" : "rgba(206,130,224,0.16)";
      g.beginPath();
      g.arc(x, y, Math.max(0.4, L.w1 * (0.1 + Math.random() * 0.16)), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // 6) Fibrous striations running lengthwise along the thicker limbs — real vessels and roots
    //    have visible grain along their axis, and without it a smoothly-shaded tube still reads
    //    as moulded rather than grown. Confined to the mass with source-atop as above.
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.lineCap = "round";
    for (const L of limbs) {
      if (L.w1 < 2.5) continue;
      const dx = L.x2 - L.x1, dy = L.y2 - L.y1;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len;
      const lines = 3;
      for (let i = 0; i < lines; i++) {
        const o = (i / (lines - 1) - 0.5) * 1.3;
        g.strokeStyle = `rgba(8,3,14,${(0.16 + Math.random() * 0.12).toFixed(3)})`;
        g.lineWidth = Math.max(0.4, L.w1 * 0.14);
        g.beginPath();
        g.moveTo(L.x1 + px * L.w1 * o, L.y1 + py * L.w1 * o);
        g.lineTo(L.x2 + px * L.w2 * o, L.y2 + py * L.w2 * o);
        g.stroke();
      }
    }
    g.restore();

    // 7) Nodules at the forks, then the wet speculars over everything. The speculars go on with
    //    source-atop for a specific reason: near the origin dozens of limbs radiate out from the
    //    same point, and unconstrained their highlights piled up on each other and on the bare
    //    floor between them, reading as bright straight light beams shooting out of the middle.
    //    Clipping them to pixels the mass actually occupies keeps them as surface sheen.
    for (const L of limbs) {
      if (L.node) this.drawVictoryNode(g, L.x2, L.y2, Math.max(1.4, L.w2 * 1.9), L.seed || 0);
    }
    g.save();
    g.globalCompositeOperation = "source-atop";
    for (const L of limbs) this.drawVictorySpecular(g, L);
    g.restore();

    this.victoryTexture = cv;
  }

  // One thick tendril reaching from the origin straight at an arena corner, then forking into
  // two shorter "fingers" that curl a short way along each of the two walls meeting there —
  // reads as a hand actually gripping the edge of the battlefield, not just a line pointing at a
  // corner. Returns both the flat tapered-segment list (for stroking) and the raw main polyline
  // (so drawVictoryClaw can walk distance-along-path for the growth reveal and the traveling
  // pulse) — see generateVictoryClaws for how the four corners/wall directions are worked out.
  buildVictoryClaw(originX, originY, corner, wallDirA, wallDirB) {
    const segments = [];
    const dx = corner.x - originX, dy = corner.y - originY;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const perpX = -uy, perpY = ux;
    const baseWidth = Math.max(6, dist * 0.022);

    const steps = 5;
    let px = originX, py = originY;
    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      let nx = originX + ux * dist * frac;
      let ny = originY + uy * dist * frac;
      if (i < steps) {
        const jitter = (Math.random() - 0.5) * dist * 0.045 * (1 - frac * 0.4);
        nx += perpX * jitter;
        ny += perpY * jitter;
      }
      segments.push({ x1: px, y1: py, x2: nx, y2: ny, width: baseWidth * (1 - frac * 0.4), main: true });
      px = nx; py = ny;
    }

    // Finger tips curling along each wall from wherever the main tendril actually landed
    const fingerLen = Math.min(dist * 0.26, 85);
    for (const wallDir of [wallDirA, wallDirB]) {
      let fx = px, fy = py;
      const fingerSteps = 2;
      for (let i = 1; i <= fingerSteps; i++) {
        const frac = i / fingerSteps;
        const nx = px + wallDir.x * fingerLen * frac;
        const ny = py + wallDir.y * fingerLen * frac;
        segments.push({ x1: fx, y1: fy, x2: nx, y2: ny, width: baseWidth * 0.5 * (1 - frac * 0.55), main: false });
        fx = nx; fy = ny;
      }
    }

    return segments;
  }

  // The four claws — one per arena corner, each hooking along the two walls that meet there —
  // so the overall shape reads as "gripped the whole rectangle by its corners" rather than a
  // shape that merely happens to reach that far in a few random directions.
  generateVictoryClaws(originX, originY) {
    const TL = { x: ARENA.x, y: ARENA.y };
    const TR = { x: ARENA.x + ARENA.w, y: ARENA.y };
    const BL = { x: ARENA.x, y: ARENA.y + ARENA.h };
    const BR = { x: ARENA.x + ARENA.w, y: ARENA.y + ARENA.h };
    const dir = (ax, ay, bx, by) => {
      const ddx = bx - ax, ddy = by - ay, d = Math.hypot(ddx, ddy) || 1;
      return { x: ddx / d, y: ddy / d };
    };
    const corners = [
      { corner: TL, wallDirA: dir(TL.x, TL.y, TR.x, TR.y), wallDirB: dir(TL.x, TL.y, BL.x, BL.y) },
      { corner: TR, wallDirA: dir(TR.x, TR.y, TL.x, TL.y), wallDirB: dir(TR.x, TR.y, BR.x, BR.y) },
      { corner: BL, wallDirA: dir(BL.x, BL.y, TL.x, TL.y), wallDirB: dir(BL.x, BL.y, BR.x, BR.y) },
      { corner: BR, wallDirA: dir(BR.x, BR.y, TR.x, TR.y), wallDirB: dir(BR.x, BR.y, BL.x, BL.y) },
    ];
    return corners.map((c) => this.buildVictoryClaw(originX, originY, c.corner, c.wallDirA, c.wallDirB));
  }

  // A bioluminescent bead running out along one claw's main tendril — the only part of a claw
  // still drawn live rather than baked, since it has to actually move. Fades in and out at the
  // ends of its run so it never pops into or out of existence mid-arena.
  drawVictoryClawBead(ctx, segments, coverage, t, phase) {
    const main = segments.filter((s) => s.main);
    if (!main.length) return;
    let total = 0;
    const withLen = main.map((s) => {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      const e = { ...s, startDist: total, len };
      total += len;
      return e;
    });

    const travel = ((((t * 0.42 + phase) % 1) + 1) % 1);
    const target = travel * total * coverage;
    let acc = 0;
    for (const s of withLen) {
      if (target >= acc && target <= acc + s.len) {
        const f = s.len > 0 ? (target - acc) / s.len : 0;
        const bx = s.x1 + (s.x2 - s.x1) * f, by = s.y1 + (s.y2 - s.y1) * f;
        const r = Math.max(3, s.width * 1.7);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.8 * Math.sin(travel * Math.PI);
        const glow = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        glow.addColorStop(0, "#f8dcff");
        glow.addColorStop(0.4, "rgba(198,104,232,0.5)");
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      acc += s.len;
    }
  }

  // The whole-arena overlay — main.js calls this every frame once celebratingVictory is true,
  // layered above the normal scene/HUD but below the keep/discard prompt (see drawFrame).
  // Everything is hard-clipped to the ARENA rectangle itself, not merely sized to roughly fit it:
  // the point is gripping the battlefield exactly, never spilling past its own walls.
  //
  // The mass itself is a pre-baked bitmap (see buildVictoryArtwork) rather than per-frame vector
  // strokes, which is what lets it be properly lit and three-dimensional; all this does is reveal
  // more of that bitmap over time behind a growing circular clip. Growth eases out (fast start,
  // settling in tight at the end) for a deliberate, weighty "closing its grip" feel rather than a
  // uniformly expanding circle. Only the slow breathing glow and the beads running the claws are
  // still drawn live, since those have to move.
  drawVictoryOverlay(ctx) {
    if (!this.victoryTexture) return;
    const t = performance.now() / 1000;
    const rawT = Math.min(1, this.victoryTimer / VIRUS_VICTORY_SPREAD_TIME);
    const coverage = 1 - Math.pow(1 - rawT, 3);
    if (coverage <= 0) return;

    const originX = this.victoryOriginX, originY = this.victoryOriginY;
    const edgeRadius = Math.max(1, coverage * this.victoryMaxRadius);
    const pulse = 0.7 + Math.sin(t * 2.0) * 0.3;

    ctx.save();
    ctx.beginPath();
    ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.clip();

    // Infection soaking into the floor itself, under the mass
    ctx.save();
    ctx.beginPath();
    ctx.arc(originX, originY, edgeRadius, 0, Math.PI * 2);
    ctx.clip();
    const stain = ctx.createRadialGradient(originX, originY, 0, originX, originY, edgeRadius);
    stain.addColorStop(0, "rgba(46,10,58,0.62)");
    stain.addColorStop(0.35, "rgba(38,10,52,0.46)");
    stain.addColorStop(0.7, "rgba(28,8,40,0.27)");
    stain.addColorStop(1, "rgba(18,6,28,0)");
    ctx.fillStyle = stain;
    ctx.fillRect(originX - edgeRadius, originY - edgeRadius, edgeRadius * 2, edgeRadius * 2);
    ctx.restore();

    // The baked mass, revealed by a growing circle — blitted in three concentric passes at rising
    // alpha so the growth front feathers out instead of ending on a hard circular cut. The inner
    // passes redraw identical pixels, so the overlap costs nothing visually.
    for (const pass of [[1.0, 0.3], [0.93, 0.62], [0.85, 1.0]]) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(originX, originY, edgeRadius * pass[0], 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = pass[1];
      ctx.drawImage(this.victoryTexture, ARENA.x, ARENA.y, ARENA.w, ARENA.h);
      ctx.restore();
    }

    // Slow bioluminescent breathing across whatever has taken hold so far
    ctx.save();
    ctx.beginPath();
    ctx.arc(originX, originY, edgeRadius, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.05 + pulse * 0.07;
    const breathe = ctx.createRadialGradient(originX, originY, 0, originX, originY, edgeRadius);
    breathe.addColorStop(0, "#c65ce0");
    breathe.addColorStop(0.6, "rgba(150,50,190,0.35)");
    breathe.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = breathe;
    ctx.fillRect(originX - edgeRadius, originY - edgeRadius, edgeRadius * 2, edgeRadius * 2);
    ctx.restore();

    this.victoryClaws.forEach((claw, i) => this.drawVictoryClawBead(ctx, claw, coverage, t, i * 0.25));

    ctx.restore();
  }
}
