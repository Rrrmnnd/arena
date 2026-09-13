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
// A fragile ranged caster with two things worth watching: a normal attack that accumulates into
// a scheduled, unmissable blade, and a rite that walks five spirits round a pentagram inscribed
// outside the arena and fires the star across the floor in five growing volleys.
//
// It had a second, "fallen" form for a while — at 0 HP it stood back up with black wings instead
// of dying. That has been removed: it dies at 0 HP like everything else.

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

// The judgement — the orbs and the blade they become — is ONE colour in five values, and the
// darkest of them is still a bright gold. Nothing in it is brown or black: an earlier pass shaded
// the fuller with a brown wash and bound the grip in near-black, and against the blade's own glow
// those read as dirt on a holy object rather than as shading. Depth comes only from where this
// ramp sits, never from adding darkness.
//
const HOLY_WHITE = "#ffffff";
const HOLY_PALE  = "#fff8e2";
const HOLY_LIGHT = "#ffeeb4";
const HOLY_GOLD  = "#ffd968";
const HOLY_DEEP  = "#f0b53a";   // the darkest value in the whole object

// ---------------------------------------------------------------- the white form
const ANGEL_SIZE = CHAR_BASE_SIZE;
// The mage baseline. It sat at 85 while this character had a second, "fallen" life to fall back
// on; with that gone it was the lowest pool in the roster with nothing to show for it — measured
// at 29% overall, 0% against the Archer.
const ANGEL_MAX_HP = 100;
const ANGEL_SPEED  = 260;          // between the mages (240) and the Demon (280)

// Weak and slow on purpose. The cooldown is also what paces the judgement count — five hits at
// 2.0s is a 10s build — so almost none of her damage is meant to come from the bolts themselves;
// they are the timer on the blade they add up to, and the blade is where the weight sits.
const ANGEL_BOLT_COOLDOWN = 2.0;
const ANGEL_BOLT_DAMAGE   = 6;
const ANGEL_BOLT_SPEED    = 850;   // -150
const ANGEL_BOLT_RADIUS   = 15;   // a heavier mote of light, not a pellet
const ANGEL_BOLT_LIFE     = 1.6;

// ---------------------------------------------------------------- the ultimate: the five rites
// A pentagram is inscribed around the OUTSIDE of the arena, and five guardian spirits walk it in
// turn. Each one travels one edge of the ring, stops on the vertex it reaches, and fires a beam
// straight down the pentagram's own chord — through the arena and out the far side. Five spirits,
// five chords: by the time the last one fires, the complete star has been drawn across the floor.
//
// A PASSIVE on a timer, not a cast. And deliberately NOT another burst of single-target damage:
// the judgement blade is already this character's aimed payoff. This one is indiscriminate
// geometry — the beams go where the star says, not where the enemy is, and the Angel is standing
// in the same arena. Getting caught by your own rite is the cost of it.
//
// The ring is an ELLIPSE, not a circle. A circle enclosing a 600x600 arena needs radius 424, and
// the canvas is only 720 wide — two of the five vertices would sit off-screen. 348 x 390 is the
// one shape that puts all five outside the arena and inside the frame; both were measured.
const ANGEL_ULT_INTERVAL = 16.0;   // between castings
// ...and every judgement blade that lands takes a second off that wait. The two halves of the kit
// were independent before; this makes landing the normal attack feed the rite, so a fight where
// the bolts connect is visibly a fight where the pentagram comes round sooner.
const ANGEL_ULT_REFUND = 1.0;
// The ring, as authored against a 600x600 arena. Read as a ratio to ANGEL_PENTA_REF_HALF rather
// than as absolute pixels, so the same shape scales to whatever arena the layout uses — see
// Angel.pentaRadii.
const ANGEL_PENTA_RX     = 348;
const ANGEL_PENTA_RY     = 390;
const ANGEL_PENTA_REF_HALF = 300;   // half of the 600 arena the two above were drawn for
const ANGEL_PENTA_POINTS = 5;
const ANGEL_RING_FADE    = 0.5;    // the pentagram drawing itself in, and dissolving at the end

// The rite is a MARCH, and every spirit moves in step with the others.
//
// One volley = brace, fire, walk. Every spirit on the ring fires from the vertex it is standing
// on, then all of them step to the next vertex together — and only once that step is finished,
// with the top vertex empty again, does the next spirit appear on it. So the line is always
// exactly one vertex apart, and the volleys grow 1, 2, 3, 4, 5.
//
// The fifth volley is the point of the whole thing: five spirits standing on five vertices firing
// all five chords at once, which draws the entire star in a single instant and ends the rite.
//
// They were previously spawned one-per-beam instead, which put all five on the same edge 0.3s
// apart: every chord got fired five times over, 21 beams in all, and the star crawled forward one
// line at a time. Spawning on the STEP rather than on the shot is what makes it a formation.
const ANGEL_SPIRIT_CHARGE = 0.3;   // held on the vertex, telegraphing the line it is about to fire
const ANGEL_SPIRIT_FIRE   = 0.4;   // how long the beam itself is live and visible
const ANGEL_SPIRIT_WALK   = 1.5;   // and then a deliberate walk to the next vertex
const ANGEL_SPIRIT_SCALE  = 1.5;   // multiples of the Angel's own size

const ANGEL_BEAM_DAMAGE = 12;
// Thrown clear of the line, the way a bomb throws you clear of the blast. Same base strength as
// the Bomber's 700 and scaled the same way — inversely with the target's size, so a Giant is
// shoved rather than launched. Pushed PERPENDICULAR to the chord, not along it: what happened to
// you is that a line swept through where you were standing, so you come out the side of it.
const ANGEL_BEAM_KNOCKBACK = 700;
// Half-width of the lethal band. Measured floor coverage as this grew: 20 -> 31%, 34 -> 49%,
// 44 -> 59%. The five chords still enclose an inner pentagon 109px off centre, so the middle of
// the arena stays a pocket you can stand in — closing that would need a half-width over 109.
const ANGEL_BEAM_WIDTH  = 44;

// Catching a beam yourself is not a punishment — it is the other half of the rite. The Angel
// takes no damage from it and is warded instead: a small white shield, drawn on top of its own
// health bar. Walking into a second beam ADDS to what is already there and puts the full 7s back
// on the clock, so standing in the star is a way to build the ward up rather than a way to keep
// resetting one stack of it.
const ANGEL_SHIELD_GAIN     = 8;
const ANGEL_SHIELD_DURATION = 7.0;

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
const ANGEL_SWORD_DAMAGE = 18;
// Shorter than the roster's other big stuns (the Earth Mage's pillar and Punch Man's finisher are
// both 2.0s) on purpose: those have to be landed, and this one cannot be dodged at all.
const ANGEL_SWORD_STUN = 1.2;
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

// ---------------------------------------------------------------- victory: the deluge
// She rises, gathers, and then floods — white pouring out of her body until the frame is drowned
// in it, and the arena dimming underneath so the only light left in the picture is hers.
//
// Deliberately borrows NOTHING from the rite. It used to re-inscribe the pentagram and pour the
// light out along the star's chords, which made a won round look like a sixth cast rather than
// the end of the fight. The ring, the chords and the vertex rays are all gone from here; the only
// geometry in the victory is the Angel herself.
//
// Budgeted against ROUND_END_GRACE (3.0s in main.js), which is all the time there is before the
// round is torn down. Most of that budget goes to the flood itself: it starts as a glow no wider
// than she is and has to be seen SPREADING, which at 0.8s it was not — it simply arrived.
const ANGEL_VICTORY_HOLD     = 0.35;  // a beat of her just rising, before the light starts
const ANGEL_VICTORY_GATHER   = 0.55;
const ANGEL_VICTORY_FLOOD    = 1.6;
const ANGEL_VICTORY_RISE     = 1.3;
const ANGEL_VICTORY_HEIGHT   = 70;   // she lifts a little; the light does the rest

// A single bolt of light. Pure data — see Angel.updateBolts for the flight and the hit.
class LightBolt {
  constructor(x, y, vx, vy) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
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
      name: "Angel",
      nameZh: "天使",
      speed: ANGEL_SPEED,
    });

    this.facingAngle = Math.random() * Math.PI * 2;
    this.hasFacedOpponent = false;
    this.bodySeed = Math.random() * Math.PI * 2;

    this.bolts = [];
    this.boltTimer = ANGEL_BOLT_COOLDOWN;   // opens on cooldown rather than firing at the bell
    this.castTimer = 0;                     // >0 while the arm is still extended from a shot

    // The ultimate — see "the five rites" above
    this.ultActive = false;
    this.ultTimer = ANGEL_ULT_INTERVAL;     // counts down to the next casting
    this.ringT = 0;                         // 0..1, the pentagram drawing itself in / out
    // Spirits ACCUMULATE: one more joins the ring every time a beam goes off, so the rite starts
    // as a single walker and finishes as five firing over each other. Each one carries its own
    // clock and its own position on the ring — they are not in step with one another.
    this.spirits = [];                      // [{ at }] — they share one clock, see updateUltimate
    this.firedChords = [];                  // which of the five chords have been drawn so far
    this.ritePhase = null;                  // null | "charge" | "fire" | "walk"
    this.volley = 0;                        // how many volleys have gone off, 1..5
    this.starFlash = 0;                     // 1 -> 0 bloom over the whole figure on the last volley
    this.riteSound = null;                  // looped for exactly as long as the rite lasts
    this.victorySound = null;               // the deluge cue, held so a round teardown can cut it
    this.phaseTimer = 0;
    this.beams = [];                        // live beams: [{ax,ay,bx,by,t,life,hitAngel,hitFoe}]

    // The ward a beam leaves on the Angel itself
    this.shieldHp = 0;
    this.shieldTimer = 0;
    this.lift = 0;                          // drawn height off the floor (the fall, and the victory)
    this.wingPhase = Math.random() * Math.PI * 2;

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
  get boltDamage()   { return ANGEL_BOLT_DAMAGE; }
  get boltCooldown() { return ANGEL_BOLT_COOLDOWN; }
  get boltSpeed()    { return ANGEL_BOLT_SPEED; }
  get palette()      { return ANGEL_LIGHT; }

  // What the white band on the health bar shows — see Character.drawShieldBand.
  get shieldPoints() {
    return this.shieldTimer > 0 ? this.shieldHp : 0;
  }

  // ---------------------------------------------------------------- engine hooks
  // Frozen for the whole transformation. Flight deliberately does NOT stop it moving: it drifts
  // around the arena while airborne, which is what makes losing track of it matter.
  get movable() {
    return super.movable && !this.celebrating;
  }

  set movable(v) {
    super.movable = v;
  }

  // A death that is being undone is the strongest possible reason to hold the round open — the
  // opponent has, for a moment, actually won. See Character.blocksRoundEnd.
  get blocksRoundEnd() {
    return super.blocksRoundEnd
        || this.marks.some((m) => m.sword);   // a blade in the air still has to land
  }

  onDeath() {
    super.onDeath();
    // The rite goes out with the one who called it. This is the opposite rule to her bolts and her
    // blades — those are committed physical things that finish landing whatever happens to her —
    // because the spirits are not objects she threw. They are hers, and there is nothing left to
    // hold them on the ring.
    //
    // The five are dismissed here, each with a burst on the vertex it was standing on so it
    // dissolves rather than blinking out. What is left — the ring itself and any beam still being
    // drawn — is handed to fadeRite(), which update() keeps calling after death so the light dies
    // down over ANGEL_RING_FADE instead of being cut.
    if (this.ultActive) {
      for (const sp of this.spirits) {
        const p = this.spiritPoint(sp);
        spawnImpactParticles(p.x, p.y, [HOLY_WHITE, HOLY_PALE, HOLY_GOLD], 20, 1.4, 0);
        spawnFlash(p.x, p.y, HOLY_PALE, ANGEL_SPIRIT_SCALE * this.size * 0.9, 0.3);
      }
    }
    // Also stops the looped rite sound, clears ultActive and empties this.spirits.
    this.endUltimate();
  }

  takeDamage(dmg, colorOverride = null) {

    // The ward is spent before the body. Overflow carries through rather than being swallowed:
    // a 2-point shield should not eat a 40-damage hit in full.
    if (dmg > 0 && this.shieldTimer > 0 && this.shieldHp > 0) {
      const absorbed = Math.min(this.shieldHp, dmg);
      this.shieldHp -= absorbed;
      dmg -= absorbed;
      spawnImpactParticles(this.x, this.y, [HOLY_WHITE, HOLY_PALE], 8, 1.0, 0);
      if (this.shieldHp <= 0) { this.shieldHp = 0; this.shieldTimer = 0; }
      if (dmg <= 0.0001) return;
    }

    super.takeDamage(dmg, colorOverride);
  }

  // ---------------------------------------------------------------- the ultimate: the five rites
  // The ring has to satisfy two things at once, and they pull against each other: every one of
  // the five vertices must land OUTSIDE the arena (a spirit standing inside the fight is not a
  // spirit walking the perimeter), and the whole ellipse should stay INSIDE the canvas.
  //
  // The authored 348x390 is not a fixed pair of numbers — it is a SHAPE, 1.16 x 1.30 of the half
  // width of the 600 arena it was drawn against. Every clearance that makes it work is a ratio
  // (the top vertex sits at 1.30 of half-height, the -18 pair at 1.10 of half-width, the 54 pair
  // at 1.05 of half-height), so scaling both radii with the arena keeps all five outside it at
  // any arena size. That is what lets the relay frame use a 720 arena and still get the same
  // ring, and it reproduces 348x390 exactly wherever the arena is 600.
  //
  // If the frame cannot hold that ring, it is flattened and widened to fit instead. And if no
  // fitted ellipse can clear the arena — the 720x850 twitch frame is too small in both
  // directions at once — the proportional one is kept and allowed to overhang the canvas,
  // exactly as it always has there. A spirit drawn off the bottom of the frame is merely
  // invisible; a spirit standing inside the arena would be wrong.
  pentaRadii() {
    const cx = ARENA.x + ARENA.w / 2, cy = ARENA.y + ARENA.h / 2;
    const halfW = ARENA.w / 2, halfH = ARENA.h / 2;
    const FRAME_PAD = 8;    // never let the ring touch the very edge of the canvas
    const CLEAR = 14;       // how far outside the arena wall a vertex has to sit
    const C54 = Math.cos(Math.PI * 54 / 180);   // 0.5878
    const S54 = Math.sin(Math.PI * 54 / 180);   // 0.8090

    const maxRx = Math.min(cx, WIDTH - cx) - FRAME_PAD;
    const maxRy = Math.min(cy, HEIGHT - cy) - FRAME_PAD;

    // The authored shape, scaled to whatever arena is actually on screen.
    const wantRx = halfW * (ANGEL_PENTA_RX / ANGEL_PENTA_REF_HALF);
    const wantRy = halfH * (ANGEL_PENTA_RY / ANGEL_PENTA_REF_HALF);
    if (wantRx <= maxRx && wantRy <= maxRy) return { cx, cy, rx: wantRx, ry: wantRy };

    // Too tall for this frame: flatten it, and let the lower pair clear on width instead.
    const ry = Math.min(wantRy, maxRy);
    let rx = Math.min(wantRx, maxRx);
    if (S54 * ry < halfH + CLEAR) rx = Math.max(rx, (halfW + CLEAR) / C54);
    if (rx <= maxRx && ry > halfH + CLEAR) return { cx, cy, rx, ry };

    return { cx, cy, rx: wantRx, ry: wantRy };
  }

  // The i-th vertex of the pentagram ring, starting straight above the arena and going clockwise.
  pentaVertex(i) {
    const { cx, cy, rx, ry } = this.pentaRadii();
    const a = -Math.PI / 2 + (i % ANGEL_PENTA_POINTS) * Math.PI * 2 / ANGEL_PENTA_POINTS;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  }

  // A point part-way along the ring between two adjacent vertices. Interpolated in ANGLE, not in
  // a straight line between the two points, so the spirit follows the ring instead of cutting the
  // corner off it.
  pentaWalk(fromIdx, k) {
    const { cx, cy, rx, ry } = this.pentaRadii();
    const step = Math.PI * 2 / ANGEL_PENTA_POINTS;
    const a = -Math.PI / 2 + (fromIdx + k) * step;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
  }

  // Where one spirit is: on its vertex, or part-way along the edge to the next one. The whole
  // line walks together, so the phase and timer come from the rite rather than from the spirit.
  spiritPoint(sp) {
    const k = this.ritePhase === "walk" ? angelEase(1 - this.phaseTimer / ANGEL_SPIRIT_WALK) : 0;
    return this.pentaWalk(sp.at, k);
  }

  // The vertex it is standing on, which is also the one it fires from.
  spiritVertex(sp) {
    return sp.at;
  }

  // The chord a spirit fires down: from its own vertex, across the arena, to the vertex two steps
  // away. Skipping one vertex is what makes it a pentagram chord rather than an edge of the ring.
  beamLine(vertexIdx) {
    const a = this.pentaVertex(vertexIdx);
    const b = this.pentaVertex(vertexIdx + 2);
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  }

  spawnSpirit() {
    // Always onto the top vertex, and only ever when it is standing empty.
    this.spirits.push({ at: 0 });
    const v = this.pentaVertex(0);
    spawnFlash(v.x, v.y, HOLY_GOLD, this.size * 1.4, 0.3);
    spawnImpactParticles(v.x, v.y, [HOLY_WHITE, HOLY_PALE, HOLY_GOLD], 18, 1.3, 0);
  }

  beginUltimate() {
    this.ultActive = true;
    // Looped rather than a one-shot, so it fills the rite exactly however long that runs and is
    // cut by hand the moment it ends — the same pattern the Demon's recalled tridents and the
    // Earth Mage's rising pillars use for their own sustained sounds.
    this.stopRiteSound();
    this.riteSound = playSfx("angelUlt", 0.6, 0.02, 0, true);
    this.ringT = 0;
    this.spirits.length = 0;
    this.firedChords.length = 0;
    this.beams.length = 0;
    this.volley = 0;
    this.ritePhase = "charge";
    this.phaseTimer = ANGEL_SPIRIT_CHARGE;
    this.spawnSpirit();
    triggerShake(5, 0.3, true);   // sustained: scenery arriving, not an impact — no hit-stop
  }

  // Cuts the rite loop, wherever the rite ends — finishing normally, the caster dying part-way
  // through, a victory interrupting it, or the whole round being torn down underneath it.
  stopRiteSound() {
    if (!this.riteSound) return;
    try { this.riteSound.stop(); } catch (e) {}
    this.riteSound = null;
  }

  // Called by reset() in main.js: a round ending mid-rite would otherwise leave the loop running
  // with nothing alive that could ever stop it.
  stopAllRiteSounds() {
    this.stopRiteSound();
    if (this.victorySound) {
      try { this.victorySound.stop(); } catch (e) {}
      this.victorySound = null;
    }
  }

  endUltimate() {
    this.stopRiteSound();
    this.ultActive = false;
    this.ritePhase = null;
    this.spirits.length = 0;
    this.ultTimer = ANGEL_ULT_INTERVAL;
  }

  // The tail end of the rite, running on a dead Angel. updateUltimate() is unreachable below the
  // alive gate in update(), so without this the ring would sit on the floor at full brightness and
  // the last beam would hang half-drawn for the rest of the round. Deliberately does nothing but
  // wind things down: no phases, no volleys, no new spirits, and no restarting the cooldown.
  fadeRite(dt) {
    this.ringT = Math.max(0, this.ringT - dt / ANGEL_RING_FADE);
    if (this.starFlash > 0) this.starFlash = Math.max(0, this.starFlash - dt / 0.7);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].t += dt;
      if (this.beams[i].t >= this.beams[i].life) this.beams.splice(i, 1);
    }
  }

  fireBeam(vertexIdx, opponent) {
    const ln = this.beamLine(vertexIdx);
    this.beams.push({ ...ln, t: 0, life: ANGEL_SPIRIT_FIRE });
    if (!this.firedChords.includes(vertexIdx)) this.firedChords.push(vertexIdx);

    // Everything standing on the line is caught, the Angel included. Resolved once, on the frame
    // it fires — the beam is instantaneous; its life is only how long it is drawn.
    const bodies = [];
    if (opponent && opponent.alive) bodies.push(opponent, ...opponent.getExtraBodies());
    bodies.push(this, ...this.getExtraBodies());
    for (const t of bodies) {
      if (!t || !t.alive) continue;
      if (pointToSegmentDistance(t.x, t.y, ln.ax, ln.ay, ln.bx, ln.by) > ANGEL_BEAM_WIDTH + t.size * 0.5) continue;
      if (t === this) {
        this.gainShield();
      } else {
        t.takeDamage(ANGEL_BEAM_DAMAGE, HOLY_LIGHT);
        // Out the side of the beam. The sign of the cross product says which side of the chord it
        // is standing on, so it is always pushed the short way out rather than back through.
        const bx = ln.bx - ln.ax, by = ln.by - ln.ay;
        const bl = Math.hypot(bx, by) || 1;
        const cross = (bx * (t.y - ln.ay) - by * (t.x - ln.ax));
        const side = cross >= 0 ? 1 : -1;
        const kb = ANGEL_BEAM_KNOCKBACK * (CHAR_BASE_SIZE / t.size);
        t.applyKnockback(-by / bl * side, bx / bl * side, kb);
        spawnImpactParticles(t.x, t.y, [HOLY_WHITE, HOLY_PALE, HOLY_GOLD], 26, 1.6, 0);
        spawnFlash(t.x, t.y, HOLY_WHITE, t.size * 1.4, 0.22);
      }
    }
  }

  // Warded rather than hurt. Stacks, and every new beam refreshes the whole timer — walking two
  // lines at once should read as being twice as protected, not as restarting from five again.
  gainShield() {
    this.shieldHp += ANGEL_SHIELD_GAIN;
    this.shieldTimer = ANGEL_SHIELD_DURATION;
    spawnFlash(this.x, this.y, HOLY_WHITE, this.size * 1.5, 0.28);
    spawnImpactParticles(this.x, this.y, [HOLY_WHITE, HOLY_PALE], 20, 1.3, 270);
  }

  updateUltimate(dt, opponent) {
    // The ward runs on its own clock, whether or not the rite is still going
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) { this.shieldTimer = 0; this.shieldHp = 0; }
    }

    // Beams keep fading even after the rite ends, so the last volley is never cut off mid-draw
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].t += dt;
      if (this.beams[i].t >= this.beams[i].life) this.beams.splice(i, 1);
    }

    if (!this.ultActive) {
      this.ringT = Math.max(0, this.ringT - dt / ANGEL_RING_FADE);
      this.ultTimer -= dt;
      if (this.ultTimer <= 0 && this.canAttack) this.beginUltimate();
      return;
    }

    this.ringT = Math.min(1, this.ringT + dt / ANGEL_RING_FADE);
    if (this.starFlash > 0) this.starFlash = Math.max(0, this.starFlash - dt / 0.7);
    this.phaseTimer -= dt;
    if (this.phaseTimer > 0) return;

    if (this.ritePhase === "charge") {
      // The whole line fires at once, each from its own vertex
      this.ritePhase = "fire";
      this.phaseTimer = ANGEL_SPIRIT_FIRE;
      this.volley++;
      for (const sp of this.spirits) this.fireBeam(sp.at, opponent);
      playSfx("angelUltLaser", 0.55);      // once per volley, not once per beam

        triggerShake(6 + this.spirits.length * 1.6, 0.28);
      // The last volley is five chords at once and completes the figure — it gets its own bloom
      // over the middle of the arena so the climax reads as one event rather than five beams.
      if (this.volley >= ANGEL_PENTA_POINTS) {
        this.starFlash = 1;
        spawnFlash(ARENA.x + ARENA.w / 2, ARENA.y + ARENA.h / 2, HOLY_WHITE, ARENA.w * 0.55, 0.45);
        triggerShake(16, 0.4);
      }
      return;
    }

    if (this.ritePhase === "fire") {
      // The fifth volley is every spirit on every vertex — the star is complete and it is done
      if (this.volley >= ANGEL_PENTA_POINTS) { this.endUltimate(); return; }
      this.ritePhase = "walk";
      this.phaseTimer = ANGEL_SPIRIT_WALK;
      return;
    }

    // walk finished: everyone steps on, and only now is the top vertex free for the next spirit
    for (const sp of this.spirits) {
      sp.at = (sp.at + 1) % ANGEL_PENTA_POINTS;
      const v = this.pentaVertex(sp.at);
      spawnImpactParticles(v.x, v.y, [HOLY_WHITE, HOLY_PALE, HOLY_GOLD], 10, 1.0, 270);
    }
    if (this.spirits.length < ANGEL_PENTA_POINTS) this.spawnSpirit();
    this.ritePhase = "charge";
    this.phaseTimer = ANGEL_SPIRIT_CHARGE;
  }

  // ---------------------------------------------------------------- attack
  fireBolt(opponent) {
    const tip = this.handPoint();
    const dx = opponent.x - tip.x, dy = opponent.y - tip.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = this.boltSpeed;
    this.bolts.push(new LightBolt(tip.x, tip.y, dx / d * sp, dy / d * sp));
    this.castTimer = 0.22;
    // Quiet on purpose. The release clip runs 1.7s but the bolt crosses a typical engagement in
    // about 0.3s, so this is still playing underneath the landing cue for almost its whole length —
    // it has to sit under that rather than compete with it. Roster range for a release is 0.3-0.6.
    playSfx("angelShoot", 0.28);
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
          t.takeDamage(this.boltDamage, ANGEL_GOLD);
          this.addMark(t);
          playSfx("angelHit", 0.5);
          spawnImpactParticles(b.x, b.y, this.palette, 16, 1.3, 0);
          spawnFlash(b.x, b.y, "#ffe9a8", t.size * 0.8, 0.16);
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
    // Louder than the landing that follows it. This is the announcement — the moment the count
    // closes and the result is already decided — and the 1.5s hang after it is dead air otherwise.
    playSfx("angelSword", 0.75);
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
      b.applyStun(ANGEL_SWORD_STUN);
      playSfx("angelSwordHit", 0.6);
      // Feeds the rite. Only while it is off cooldown — shaving time off a rite that is already
      // running would do nothing, and could hand it a negative timer to climb back out of.
      if (!this.ultActive) this.ultTimer = Math.max(0, this.ultTimer - ANGEL_ULT_REFUND);
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
    // Everything above outlives her; the rite does not. See onDeath.
    if (!this.alive) this.fadeRite(dt);

    super.update(dt, opponent);
    if (!this.alive) return;

    if (this.celebrating) {
      this.updateVictory(dt);
      return;
    }

    // Above the stun gate on purpose. The rite is not something the Angel is DOING — five spirits
    // are walking a ring outside the arena on their own clock, and the beams come from them. Once
    // it is called, knocking the caster senseless or pinning her feet to the floor does not reach
    // them, any more than stunning the Archer stops a sun that has already been loosed.
    //
    // The ward's own countdown lives in here too, so that keeps running as well — a shield should
    // not stop expiring just because its owner got hit.
    this.updateUltimate(dt, opponent);

    if (opponent && opponent.alive) {
      const dx = opponent.x - this.x, dy = opponent.y - this.y;
      if (Math.hypot(dx, dy) > 0.01) {
        this.facingAngle = Math.atan2(dy, dx);
        this.hasFacedOpponent = true;
      }
    }

    this.wingPhase += dt * (this.ultActive ? 5.0 : 3.2);
    if (this.castTimer > 0) this.castTimer -= dt;

    // Everything below IS the Angel's own action, and a stun stops all of it.
    if (this.stunTimer > 0) return;

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
    // main.js draws drawVictoryOverlay for anything flying this flag, above the HUD — see there.
    this.celebratingVictory = true;
    this.victoryTimer = 0;
    this.victoryStartX = this.x;
    this.victoryStartY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.ultActive = false;
    this.spirits.length = 0;
    this.beams.length = 0;
    this.bolts.length = 0;
    this.marks.length = 0;
    // No pentagram in the victory. The ring belongs to the rite — it is the thing the spirits
    // walk — and drawing it again over a won round made the celebration read as another cast.
    // What is left is only her: she rises, and the light comes out of her.
    //
    // ringT is NOT forced to 0 here: winning mid-rite would then snap a fully-lit ring off the
    // floor in a single frame. It is left where it is and walked down in updateVictory instead.
    this.stopRiteSound();
    // Held rather than fired and forgotten: the clip runs 7.5s but ROUND_END_GRACE is 3.0s, so
    // without a handle it would still be playing several seconds into whatever came next.
    this.victorySound = playSfx("angelVictory", 0.85, 0.02);
  }

  // 0 = nothing, 1 = the frame is pure white. Drives both the flood and how far the arena beneath
  // it has been washed out.
  get victoryFlood() {
    const t = this.victoryTimer - ANGEL_VICTORY_HOLD - ANGEL_VICTORY_GATHER;
    if (t <= 0) return 0;
    const k = Math.min(1, t / ANGEL_VICTORY_FLOOD);
    // Accelerating, NOT smoothstep. It has to seep out of her slowly at first and then run away
    // with itself; a symmetric ease spends its fastest moment in the middle and its slowest at the
    // very end, which is backwards for something engulfing a frame.
    return k * k;
  }

  // 0..1 across the gathering beat — the star brightening before it lets go.
  get victoryGather() {
    const t = this.victoryTimer - ANGEL_VICTORY_HOLD;
    if (t <= 0) return 0;
    return Math.min(1, t / ANGEL_VICTORY_GATHER);
  }

  updateVictory(dt) {
    this.victoryTimer += dt;
    // Down, never up. Normally already 0 and this does nothing; if the round was won part-way
    // through a rite it takes the ring off the floor over ANGEL_RING_FADE rather than cutting it.
    this.ringT = Math.max(0, this.ringT - dt / ANGEL_RING_FADE);
    const t = Math.min(1, this.victoryTimer / ANGEL_VICTORY_RISE);
    this.lift = ANGEL_VICTORY_HEIGHT * angelEase(t);
    this.wingPhase += dt * 5.0;

    const g = this.victoryGather;
    // Motes drawn UP out of the floor across the whole arena while it gathers — the light is being
    // collected from everywhere, not just from her.
    if (g > 0 && this.victoryFlood <= 0 && Math.random() < 0.55) {
      spawnImpactParticles(ARENA.x + Math.random() * ARENA.w,
                           ARENA.y + Math.random() * ARENA.h,
                           [HOLY_WHITE, HOLY_PALE, HOLY_GOLD], 2, 0.9 + g, 270);
    }
    if (g >= 1 && this.victoryFlood > 0 && this.victoryFlood < 0.08) {
      triggerShake(14, 0.5, true);   // sustained: the light breaking, not an impact
    }
  }

  // ---------------------------------------------------------------- HUD
  get ultimateRatio() {
    // While the rite runs the bar shows how far THROUGH it is — which of the five has fired —
    // rather than a cooldown nobody is waiting on at that moment.
    if (this.ultActive) return Math.max(0, Math.min(1, this.volley / ANGEL_PENTA_POINTS));
    return Math.max(0, Math.min(1, 1 - this.ultTimer / ANGEL_ULT_INTERVAL));
  }

  get ultimateBarColor() {
    return ANGEL_GOLD;
  }

  drawHud(ctx, x, y, w) {
    const ny = super.drawHud(ctx, x, y, w);
    let note = null, color = ANGEL_GOLD;
    if (this.ultActive) { note = L(`RITE — volley ${Math.max(1, this.volley)}/${ANGEL_PENTA_POINTS}, ${this.spirits.length} spirits`,
                                        `五芒儀式 — 第 ${Math.max(1, this.volley)}/${ANGEL_PENTA_POINTS} 輪，${this.spirits.length} 靈體`); }
    else if (this.shieldPoints > 0) {
      note = L(`WARD ${Math.ceil(this.shieldHp)}  ${this.shieldTimer.toFixed(1)}s`,
               `護盾 ${Math.ceil(this.shieldHp)}  ${this.shieldTimer.toFixed(1)}s`);
      color = HOLY_WHITE;
    }
    let cy = ny;
    if (note) { this.drawHudNote(ctx, x, cy, note, color); cy += 18; }

    // The count is the whole read on this character's normal attack, so it gets its own line
    const m = this.marks.find((r) => r.body && r.body.alive);
    if (m) {
      const txt = m.sword ? L("JUDGEMENT — blade falling", "審判 — 光劍落下")
                          : L(`MARKS ${m.orbs.length}/${ANGEL_MARK_MAX}`,
                              `印記 ${m.orbs.length}/${ANGEL_MARK_MAX}`);
      this.drawHudNote(ctx, x, cy, txt, m.sword ? "#fff3c4" : ANGEL_GOLD);
      cy += 18;
    }
    return cy;
  }

  // ---------------------------------------------------------------- drawing
  // The contact shadow lives here rather than in drawBody, because the body is drawn lifted and
  // the shadow must not travel with it — the gap between them IS the height cue.
  drawGroundEffects(ctx) {
    if (this.ringT > 0) this.drawPentagram(ctx);

    if (!this.alive && this.deathFadeTimer <= 0) return;
    // No contact shadow once she is the light source. A dark ellipse under someone the glare is
    // pouring OUT of reads as a hole in the floor.
    if (this.celebratingVictory && this.victoryGather > 0) return;
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
    for (const b of this.beams) this.drawBeam(ctx, b);
    if (this.ultActive) for (const sp of this.spirits) this.drawSpirit(ctx, sp);
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
    super.draw(ctx);
    ctx.restore();
  }

  // The deluge. Drawn over the arena, the fighters and the HUD alike (see main.js) — by the end
  // there is nothing left to see under it anyway.
  //
  // Three layers, in order: a wash that drains the colour out of everything beneath, the star
  // itself burning at full strength, and the flood proper — white poured out of the ring in a
  // front that overtakes the frame. The Angel is left as a silhouette because the glare is behind
  // and around her, not in front.
  drawVictoryOverlay(ctx) {
    const cx = ARENA.x + ARENA.w / 2, cy = ARENA.y + ARENA.h / 2;
    const g = this.victoryGather;
    const f = this.victoryFlood;
    const t = performance.now() / 1000;

    ctx.save();

    // ---- 1. the arena dims and desaturates as the light is drawn out of it
    if (g > 0 && f < 1) {
      ctx.globalAlpha = 0.5 * g * (1 - f);
      ctx.fillStyle = "#05060c";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // ---- 3. the flood, pouring out of HER rather than out of the ring. She is the source, so
    // the gradient is centred on her body and starts no wider than she is.
    //
    // It was centred on the arena before, which made her a dark shape standing in front of a light
    // that was coming from somewhere else — the thing that read as a shadow. Light that comes out
    // of someone has to have them as its brightest point.
    const sx = this.x, sy = this.y - this.lift;

    // A halo on her from the moment the gathering starts, so the source is already glowing before
    // any of it spills — the flood is that glow growing, not a separate effect switching on.
    if (g > 0) {
      const r0 = this.size * (0.55 + 1.5 * g);
      ctx.globalAlpha = 0.35 + 0.65 * g;
      const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r0);
      hg.addColorStop(0, "rgba(255,255,255,0.95)");
      hg.addColorStop(0.35, "rgba(255,248,226,0.6)");
      hg.addColorStop(1, "rgba(255,217,104,0)");
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(sx, sy, r0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (f > 0) {
      // From her own size out to past the far corner of the frame
      const maxR = Math.hypot(WIDTH, HEIGHT) * 1.15;
      const R = this.size * 1.1 + (maxR - this.size * 1.1) * f;
      // A soft shoulder rather than a hard front: this is light welling up, not a shockwave
      const fg = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, R));
      fg.addColorStop(0, "rgba(255,255,255,1)");
      fg.addColorStop(0.55, "rgba(255,253,246,0.95)");
      fg.addColorStop(0.82, "rgba(255,240,196,0.6)");
      fg.addColorStop(1, "rgba(255,217,104,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(sx, sy, R, 0, Math.PI * 2);
      ctx.fill();

      // and only at the very end does the last of the frame go
      if (f > 0.86) {
        ctx.globalAlpha = (f - 0.86) / 0.14;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
    }
    ctx.restore();
  }

  // The ring the rite is inscribed on. It lives in the ground pass, under every fighter — it is
  // marked on the floor, not floating over it.
  //
  // Built so the figure COMPLETES itself across the rite rather than being fully there from the
  // start: a chord is a faint guide line until a spirit has fired down it, then it stays lit. By
  // the fifth volley all five are burning and the star is finished.
  drawPentagram(ctx) {
    const k = angelEase(this.ringT);
    if (k <= 0.01) return;
    // Same solver the vertices come from, so the drawn ring and the walked ring are the same
    // ellipse in every layout — see pentaRadii.
    const PR = this.pentaRadii();
    const cx = PR.cx, cy = PR.cy;
    const t = performance.now() / 1000;
    const v = [];
    for (let i = 0; i < ANGEL_PENTA_POINTS; i++) v.push(this.pentaVertex(i));

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // ---- two rings, counter-rotating tick marks between them
    ctx.globalAlpha = 0.3 * k;
    ctx.strokeStyle = HOLY_GOLD;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, cy, PR.rx, PR.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.16 * k;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, PR.rx * 0.945, PR.ry * 0.945, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.22 * k;
    ctx.strokeStyle = HOLY_LIGHT;
    ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const a = t * 0.18 + (i / 40) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const long = i % 8 === 0;
      const r0 = long ? 0.9 : 0.955, r1 = 1.0;
      ctx.beginPath();
      ctx.moveTo(cx + c * PR.rx * r0, cy + sn * PR.ry * r0);
      ctx.lineTo(cx + c * PR.rx * r1, cy + sn * PR.ry * r1);
      ctx.stroke();
    }

    // ---- the star. Unlit chords are thin guide lines; lit ones burn, and glow along their length.
    for (let i = 0; i < ANGEL_PENTA_POINTS; i++) {
      const a = v[i], b = v[(i + 2) % ANGEL_PENTA_POINTS];
      const fired = this.firedChords.includes(i);
      if (!fired) {
        ctx.globalAlpha = 0.12 * k;
        ctx.strokeStyle = HOLY_GOLD;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 14]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      // a soft wash under a bright core, both fading toward the two ends
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, "rgba(255,217,104,0)");
      g.addColorStop(0.5, HOLY_GOLD);
      g.addColorStop(1, "rgba(255,217,104,0)");
      ctx.strokeStyle = g;
      ctx.globalAlpha = 0.3 * k;
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 0.55 * k;
      ctx.strokeStyle = HOLY_PALE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // ---- vertex sigils: a ring, a lit core once fired from, and four little rays
    for (let i = 0; i < ANGEL_PENTA_POINTS; i++) {
      const lit = this.firedChords.includes(i);
      ctx.save();
      ctx.translate(v[i].x, v[i].y);
      ctx.globalAlpha = (lit ? 0.75 : 0.4) * k;
      ctx.strokeStyle = lit ? HOLY_PALE : HOLY_LIGHT;
      ctx.lineWidth = lit ? 3 : 2;
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.rotate(t * 0.5 * (i % 2 ? 1 : -1));
      ctx.lineWidth = 2;
      for (let r = 0; r < 4; r++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(17, 0);
        ctx.lineTo(24, 0);
        ctx.stroke();
      }
      if (lit) {
        ctx.globalAlpha = 0.8 * k;
        ctx.fillStyle = HOLY_WHITE;
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- the completed figure blooms once, on the fifth volley
    if (this.starFlash > 0) {
      const f = this.starFlash;
      ctx.globalAlpha = 0.5 * f * f;
      ctx.strokeStyle = HOLY_WHITE;
      ctx.lineWidth = 3 + 26 * f;
      ctx.beginPath();
      for (let i = 0; i < ANGEL_PENTA_POINTS; i++) {
        const a = v[i], b = v[(i + 2) % ANGEL_PENTA_POINTS];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // A beam, for as long as it is visible. The damage was already resolved on the frame it fired
  // (see fireBeam) — this is purely the picture of it.
  //
  // Three things happen over its short life: a leading edge races the length of the chord in the
  // first instant, the body of it swells and then thins, and both ends keep a flare. Drawing it as
  // one flat bar reads as a painted stripe rather than as something that was fired.
  drawBeam(ctx, b) {
    const p = Math.max(0, Math.min(1, b.t / b.life));
    const k = 1 - p;                         // overall fade
    const dx = b.bx - b.ax, dy = b.by - b.ay;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const w = ANGEL_BEAM_WIDTH;
    // Swells fast, then thins out as it fades
    const body = p < 0.16 ? p / 0.16 : 0.55 + 0.45 * k;

    ctx.save();
    ctx.translate(b.ax, b.ay);
    ctx.rotate(ang);

    // wide soft wash
    const g = ctx.createLinearGradient(0, -w * 2.1, 0, w * 2.1);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, `rgba(255,233,168,${0.42 * k})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, -w * 2.1, len, w * 4.2);

    // the body, tapering to nothing at both ends so it never shows a hard cap
    const along = ctx.createLinearGradient(0, 0, len, 0);
    along.addColorStop(0, "rgba(255,217,104,0)");
    along.addColorStop(0.12, HOLY_GOLD);
    along.addColorStop(0.88, HOLY_GOLD);
    along.addColorStop(1, "rgba(255,217,104,0)");
    ctx.globalAlpha = 0.9 * k;
    ctx.fillStyle = along;
    ctx.fillRect(0, -w * 0.55 * body, len, w * 1.1 * body);

    // white core
    const core = ctx.createLinearGradient(0, 0, len, 0);
    core.addColorStop(0, "rgba(255,255,255,0)");
    core.addColorStop(0.1, HOLY_WHITE);
    core.addColorStop(0.9, HOLY_WHITE);
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = k;
    ctx.fillStyle = core;
    ctx.fillRect(0, -w * 0.17 * body, len, w * 0.34 * body);

    // leading edge, only in the first instant — the sense of it being fired rather than appearing
    if (p < 0.28) {
      const e = p / 0.28;
      const ex = len * angelEase(e);
      ctx.globalAlpha = (1 - e) * 0.9;
      const eg = ctx.createRadialGradient(ex, 0, 0, ex, 0, w * 2.2);
      eg.addColorStop(0, HOLY_WHITE);
      eg.addColorStop(0.4, `rgba(255,246,214,0.5)`);
      eg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(ex, 0, w * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // a flare at each end, so the chord visibly starts and finishes somewhere
    for (const [fx, fy] of [[b.ax, b.ay], [b.bx, b.by]]) {
      ctx.save();
      ctx.globalAlpha = 0.75 * k;
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, w * 1.9);
      fg.addColorStop(0, HOLY_WHITE);
      fg.addColorStop(0.35, `rgba(255,233,168,0.55)`);
      fg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(fx, fy, w * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // The spirit currently walking the ring: the same guardian figure as before, standing on the
  // pentagram rather than wrapped around the Angel. Built from filled angular plates — an earlier
  // version drawn from thin curved strokes with horizontal banding read as an insect.
  drawSpirit(ctx, sp) {
    const p = this.spiritPoint(sp);
    if (!p) return;
    const R = this.size * 0.5 * ANGEL_SPIRIT_SCALE;
    const t = performance.now() / 1000;
    // Braced and brightening while it charges, so the beam is announced before it lands
    const charging = this.ritePhase === "charge";
    const heat = charging ? 0.5 + 0.5 * Math.sin(t * 22) : 1;
    // Faces along the chord it is about to fire
    const ln = this.beamLine(this.spiritVertex(sp));
    const face = Math.cos(Math.atan2(ln.by - ln.ay, ln.bx - ln.ax)) >= 0 ? 1 : -1;
    // Each one bobs on its own phase, so five of them on the ring never move as a block
    const seed = this.bodySeed + this.spirits.indexOf(sp) * 1.7;

    // A wake trailing back along the ring while it walks — three ghosts of itself, thinning out,
    // so a spirit crossing the arena's edge reads as travelling rather than sliding.
    if (this.ritePhase === "walk") {
      const k = angelEase(1 - this.phaseTimer / ANGEL_SPIRIT_WALK);
      for (let i = 1; i <= 3; i++) {
        const q = this.pentaWalk(sp.at, Math.max(0, k - i * 0.055));
        ctx.save();
        ctx.globalAlpha = 0.16 / i;
        const wg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, R * 0.8);
        wg.addColorStop(0, HOLY_GOLD);
        wg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = wg;
        ctx.beginPath();
        ctx.arc(q.x, q.y, R * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // A pool of light under it, so it is standing ON the ring rather than floating over it
    ctx.save();
    ctx.globalAlpha = 0.3 * heat;
    const pool = ctx.createRadialGradient(p.x, p.y + R * 0.75, 0, p.x, p.y + R * 0.75, R * 0.95);
    pool.addColorStop(0, HOLY_LIGHT);
    pool.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + R * 0.75, R * 0.95, R * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(t * 1.6 + seed) * 0.03);

    ctx.globalAlpha = 0.85;
    const aura = ctx.createRadialGradient(0, -R * 0.2, R * 0.2, 0, -R * 0.2, R * 1.3);
    aura.addColorStop(0, `rgba(255,246,214,${0.3 * heat})`);
    aura.addColorStop(0.55, `rgba(255,217,104,${0.14 * heat})`);
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, -R * 0.2, R * 1.3, 0, Math.PI * 2);
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

    // cuirass
    ctx.globalAlpha = 0.55;
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
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = HOLY_PALE;
    ctx.lineWidth = R * 0.045;
    ctx.stroke();

    // central ridge, vertical — the horizontal banding is what made the old one look striped
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = R * 0.05;
    ctx.strokeStyle = HOLY_LIGHT;
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.8);
    ctx.lineTo(0, R * 0.72);
    ctx.stroke();

    // pauldrons
    for (const sgn of [-1, 1]) {
      ctx.fillStyle = plate(1);
      ctx.beginPath();
      ctx.moveTo(sgn * R * 0.5, -R * 0.86);
      ctx.lineTo(sgn * R * 1.24, -R * 0.72);
      ctx.lineTo(sgn * R * 1.3, -R * 0.16);
      ctx.lineTo(sgn * R * 0.82, -R * 0.3);
      ctx.closePath();
      ctx.fill();
    }

    // arms, both braced forward while it channels
    ctx.strokeStyle = HOLY_GOLD;
    ctx.lineWidth = R * 0.19;
    for (const sgn of [-1, 1]) {
      ctx.save();
      ctx.translate(sgn * R * 0.62, -R * 0.46);
      ctx.scale(sgn, 1);
      ctx.rotate(charging ? -0.15 : 0.3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(R * 0.46, R * 0.52);
      ctx.lineTo(R * 0.34, R * 1.08);
      ctx.stroke();
      ctx.restore();
    }

    // helm with a swept crest and slit eyes
    ctx.fillStyle = plate(1);
    ctx.beginPath();
    ctx.moveTo(-R * 0.42, -R * 0.9);
    ctx.lineTo(-R * 0.46, -R * 1.36);
    ctx.lineTo(0, -R * 1.56);
    ctx.lineTo(R * 0.46, -R * 1.36);
    ctx.lineTo(R * 0.42, -R * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = HOLY_PALE;
    ctx.lineWidth = R * 0.04;
    ctx.stroke();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = plate(1);
    ctx.beginPath();
    ctx.moveTo(-face * R * 0.06, -R * 1.5);
    ctx.quadraticCurveTo(-face * R * 0.5, -R * 1.95, -face * R * 1.02, -R * 1.78);
    ctx.quadraticCurveTo(-face * R * 0.52, -R * 1.68, -face * R * 0.16, -R * 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = heat;
    ctx.fillStyle = HOLY_WHITE;
    for (const sgn of [-1, 1]) {
      ctx.save();
      ctx.translate(sgn * R * 0.18, -R * 1.16);
      ctx.rotate(sgn * 0.24);
      ctx.fillRect(-R * 0.11, -R * 0.028, R * 0.22, R * 0.056);
      ctx.restore();
    }
    ctx.restore();

    // The line it is about to fire down. Grows brighter and wider across the brace rather than
    // just blinking, so the 0.3s warning actually counts down in front of you.
    if (charging) {
      const c = 1 - this.phaseTimer / ANGEL_SPIRIT_CHARGE;   // 0 -> 1 across the brace
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.3 * c;
      ctx.strokeStyle = HOLY_WHITE;
      ctx.lineWidth = 2 + 5 * c;
      ctx.setLineDash([16, 13]);
      ctx.lineDashOffset = -t * 90;
      ctx.beginPath();
      ctx.moveTo(ln.ax, ln.ay);
      ctx.lineTo(ln.bx, ln.by);
      ctx.stroke();
      ctx.restore();
    }
  }

  // A bolt in flight: a soft halo with a four-pointed star spinning inside it, so it reads as
  // light rather than as a pellet at any speed.
  drawBolt(ctx, b) {
    const R = ANGEL_BOLT_RADIUS;
    const core = "#ffffff";
    const glow = ANGEL_GOLD;
    ctx.save();
    ctx.translate(b.x, b.y);

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.1);
    g.addColorStop(0, "rgba(255,233,168,0.55)");
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

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(breathe, breathe);

    this.drawWings(ctx, r, t, 1);
    this.drawRobe(ctx, r);
    this.drawHalo(ctx, r, t);
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
    const flap = Math.sin(this.wingPhase) * (this.ultActive ? 0.22 : 0.12);
    const light = ANGEL_WING;
    const shade = ANGEL_WING_SHADE;
    const edge  = "rgba(126,146,178,0.42)";
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
      const n = 8;
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
        g.addColorStop(1, "#ffffff");
        ctx.fillStyle = g;
        ctx.strokeStyle = edge;
        ctx.lineWidth = r * 0.025;
        ctx.beginPath();
        ctx.moveTo(0, r * 0.05);
        // Rounded tip, not a spike — a pointed one made the wing read as broken glass
        ctx.quadraticCurveTo(len * 0.5, -w, len * 0.94, -w * 0.22);
        ctx.quadraticCurveTo(len * 1.02, 0, len * 0.9, w * 0.2);
        ctx.quadraticCurveTo(len * 0.45, w * 0.72, 0, r * 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  drawRobe(ctx, r) {
    const c0 = ANGEL_ROBE_LIGHT;
    const c1 = ANGEL_ROBE_MID;
    const c2 = ANGEL_ROBE_SHADE;
    const c3 = ANGEL_ROBE_HEM;

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
    ctx.strokeStyle = "rgba(140,160,190,0.35)";
    ctx.lineCap = "round";
    for (let i = -2; i <= 2; i++) {
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.moveTo(i * r * 0.24, r * 0.18);
      ctx.quadraticCurveTo(i * r * 0.3, r * 0.6, i * r * 0.36, r * 1.05);
      ctx.stroke();
    }

    // A sash across the chest
    ctx.strokeStyle = ANGEL_GOLD_DEEP;
    ctx.lineWidth = r * 0.15;
    ctx.beginPath();
    ctx.moveTo(-r * 0.95, -r * 0.1);
    ctx.quadraticCurveTo(0, r * 0.28, r * 0.95, -r * 0.32);
    ctx.stroke();
    ctx.strokeStyle = ANGEL_GOLD;
    ctx.lineWidth = r * 0.06;
    ctx.stroke();

    // Hood and eyes. Fallen eyes burn; the white form's are calm and gold.
    ctx.fillStyle = ANGEL_ROBE_SHADE;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.12);
    ctx.quadraticCurveTo(-r * 0.58, -r * 1.0, 0, -r * 0.95);
    ctx.quadraticCurveTo(r * 0.58, -r * 1.0, r * 0.7, -r * 0.12);
    ctx.quadraticCurveTo(0, -r * 0.36, -r * 0.7, -r * 0.12);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#5f6f89";
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.5, r * 0.52, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    const eye = ANGEL_GOLD;
    ctx.fillStyle = eye;
    ctx.shadowColor = eye;
    ctx.shadowBlur = r * 0.3;
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
