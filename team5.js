// 5-a-side relay ("team5") — the long-form landscape format.
//
// Two teams of five. One fighter from each side stands in the arena; when one goes down, the
// next name on that team's list walks in, and the match ends when a team has nobody left to
// send. Twelve or so fights' worth of drama in a single unbroken take.
//
// The survivor is NOT healed between kills (TEAM5_HEAL_ON_KILL = 0). That is the entire format:
// winning on 12hp means facing someone fresh immediately, and the run a fighter goes on when it
// somehow doesn't die is the thing worth watching. Raise that constant if it turns out too
// punishing to make good video.
//
// Deliberately reuses fighterA/fighterB, and therefore the ENTIRE 1v1 update path — targeting,
// collisions, obstacles, victory overlays, the lot (see the shared block in main.js's render).
// This file only ever decides WHO is standing there; it never simulates anything itself.

const TEAM5_SIZE = 5;
// Fraction of max HP handed back to a fighter that just won. 0 = it keeps whatever is left.
const TEAM5_HEAL_ON_KILL = 0;
// The beat between a body dropping and the next fighter walking in. Long enough to read the
// substitution on the panel, short enough not to stall a 10-minute video five times over.
const TEAM5_SWAP_DELAY = 1.7;

// Device pixels, not logical units — the columns are chrome and opt out of the world zoom (see
// team5AsChrome). Sized to their contents: a 48px portrait, a 10px gutter and the widest name on
// the roster ("Punch Man (New)") plus padding comes to 300. Anything wider is just empty column.
const TEAM5_PANEL_W = 300;
const TEAM5_FACE = 48;       // portrait square drawn at the left of each card
const TEAM5_FACE_BITMAP = 128; // rendered this big once, drawn down — see team5Face
// The bench: the squad standing in line outside its own side of the arena, #1 nearest the top,
// waiting its turn. Drawn in WORLD units (it lives in the picture, not on the chrome), in the
// margin between the squad column and the arena wall.
const TEAM5_BENCH_SIZE = 58;    // how big a benched figure is drawn, in world units
const TEAM5_BENCH_GAP = 92;     // vertical pitch between them
const TEAM5_BENCH_EASE = 6.5;   // how fast the queue closes up after someone leaves it

const TEAM5_A_COLOR = "#64f064";
const TEAM5_B_COLOR = "#64a0ff";

// 10 ROSTER indices: 0-4 are team A (left), 5-9 are team B (right).
let team5Picks = [];
let team5PickStep = 0;

// Squad records — one per slot, independent of whether that fighter is currently instantiated.
// { idx, state: "waiting" | "active" | "down", live, hp, maxHp, kills }
let team5A = [];
let team5B = [];

// Lineup draw timings. Ten reveals at LEAD + 10 * (SPIN + LOCK) + TAIL comes to about 9.4s,
// which is a title card's worth of time at the head of the video rather than dead air.
const TEAM5_DRAW_LEAD = 0.8;   // a beat on the empty boards before the first name
const TEAM5_DRAW_SPIN = 0.5;   // names cycling in the slot being drawn
const TEAM5_DRAW_LOCK = 0.22;  // held on the locked name before moving on
const TEAM5_DRAW_TAIL = 1.4;   // both squads complete, before the fight starts
const TEAM5_DRAW_TICK = 0.055; // how fast the cycling name changes

let team5State = "playing";  // "drawing" | "playing" | "swapping" | "ended" | "prompting"
let team5Winner = null;      // "A" | "B" | "draw" | null
let team5EndTimer = 0;
let team5SwapTimer = 0;
let team5SwapSide = { a: false, b: false };
let team5PendingBlob = null;
let team5PromptReady = false;
let team5QueuedDecision = null;
// null except during the draw: { order, revealed, phase, timer, spinName, spinT }
let team5Draw = null;
// Per side, non-null only while that side is mid-substitution: the figure walking from the front
// of the bench to the spot it will actually appear at. { member, fromX, fromY, toX, toY, t }
let team5Walkin = { a: null, b: null };
// Whether the match that is running was started from a random draw (true) or a hand-picked
// lineup (false) — see startTeam5Round.
let team5LastReroll = true;

// ---------------------------------------------------------------------------------------
// squads
// ---------------------------------------------------------------------------------------

// Everyone eligible to be drawn: the whole roster minus anything flagged excludeFromDraw in
// main.js (Archer, which wins 94% of everything and would simply be the answer to whichever
// squad it landed in). 13 eligible for 10 slots.
function team5DrawPool() {
  return ROSTER.map((_, i) => i).filter((i) => !ROSTER[i].excludeFromDraw);
}

// Ten distinct fighters. Distinct BY CONSTRUCTION — one shuffled pool sliced once, so no name
// can come out twice, whether inside a squad or across the two. There is deliberately no
// per-slot roll that could collide and need retrying.
function team5RandomPicks() {
  const pool = team5DrawPool();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picks = pool.slice(0, TEAM5_SIZE * 2);
  // Only reachable if the roster shrinks or the exclusions grow past 4. Better a repeated name
  // than a squad with a hole in it.
  while (picks.length < TEAM5_SIZE * 2) picks.push(pool[picks.length % pool.length]);
  return picks;
}

// ---------------------------------------------------------------------------------------
// the lineup draw
//
// The result is settled the instant the draw starts — team5RandomPicks has already produced the
// ten — and what plays on screen is the reveal of a decision already made. That is what makes
// "no duplicates" a property of the code rather than something the animation has to police.
//
// Revealed A1, B1, A2, B2 … so the two boards fill together and each name lands opposite the
// one it will actually have to fight.
// ---------------------------------------------------------------------------------------

function team5BeginDraw() {
  const order = [];
  for (let i = 0; i < TEAM5_SIZE; i++) {
    order.push({ side: "a", slot: i });
    order.push({ side: "b", slot: i });
  }
  team5Draw = { order, revealed: 0, phase: "lead", timer: TEAM5_DRAW_LEAD, spinName: "", spinT: 0 };
  team5State = "drawing";
  team5SetArena("board");
  for (const m of team5A) m.drawn = false;
  for (const m of team5B) m.drawn = false;
}

// Which entry of the reveal order a given panel slot is, so a card can ask whether its turn has
// come. Matches the A,B,A,B interleave built in team5BeginDraw.
function team5DrawIndex(side, slot) {
  return slot * 2 + (side === "b" ? 1 : 0);
}

function team5UpdateDraw(dt) {
  const d = team5Draw;
  if (!d) { team5State = "playing"; return; }

  d.timer -= dt;

  if (d.phase === "spin") {
    d.spinT -= dt;
    if (d.spinT <= 0) {
      d.spinT = TEAM5_DRAW_TICK;
      // Cycled through the names still unrevealed only, so the reel never teases someone who is
      // already sitting on a board.
      const taken = new Set([...team5A, ...team5B].filter((m) => m.drawn).map((m) => m.idx));
      const rest = team5DrawPool().filter((i) => !taken.has(i));
      if (rest.length) d.spinName = ROSTER[rest[Math.floor(Math.random() * rest.length)]].label;
    }
  }

  if (d.timer > 0) return;

  if (d.phase === "lead") {
    d.phase = "spin";
    d.timer = TEAM5_DRAW_SPIN;
    d.spinT = 0;
    return;
  }

  if (d.phase === "spin") {
    const at = d.order[d.revealed];
    team5Squad(at.side)[at.slot].drawn = true;
    // Particles live in the world, which is zoomed; the card whose centre this flash marks is
    // chrome, which is not. Convert into world units.
    const z = layoutZoom();
    const px = (at.side === "a" ? TEAM5_PANEL_W / 2 : WIDTH * z - TEAM5_PANEL_W / 2) / z;
    const py = (TEAM5_CARD_TOP + at.slot * (TEAM5_CARD_H + TEAM5_CARD_GAP) + TEAM5_CARD_H / 2) / z;
    spawnFlash(px, py, at.side === "a" ? TEAM5_A_COLOR : TEAM5_B_COLOR, 130 / z, 0.3);
    playSfx("collision", 0.35);
    d.phase = "lock";
    d.timer = TEAM5_DRAW_LOCK;
    return;
  }

  if (d.phase === "lock") {
    d.revealed++;
    if (d.revealed >= d.order.length) { d.phase = "tail"; d.timer = TEAM5_DRAW_TAIL; }
    else { d.phase = "spin"; d.timer = TEAM5_DRAW_SPIN; d.spinT = 0; }
    return;
  }

  // tail: the boards come down, the arena opens out into the space they were using, and the
  // first two are sent on.
  team5Draw = null;
  team5State = "playing";
  team5SetArena("match");
  team5SendIn("a");
  team5SendIn("b");
  placeAtCorners();
  team5NoGrace();
}

function resetTeam5Picks() {
  team5Picks = team5RandomPicks();
  team5PickStep = 0;
}

function team5MakeSquad(indices) {
  return indices.map((idx) => {
    const probe = ROSTER[idx].ctor();
    // `drawn` is false only while the lineup draw is still revealing; every other path builds
    // squads that are already on the boards.
    return { idx, state: "waiting", live: null, hp: probe.maxHp, maxHp: probe.maxHp,
             kills: 0, drawn: true };
  });
}

function team5Squad(side) {
  return side === "a" ? team5A : team5B;
}

function team5Active(side) {
  return team5Squad(side).find((m) => m.state === "active") || null;
}

function team5Remaining(squad) {
  return squad.filter((m) => m.state !== "down").length;
}

// Every looping sound a fighter can own outlives the fighter itself, and a relay throws four
// fighters away per side per match — far more discards than 1v1 ever does. Same teardown list
// as reset() in main.js, applied to one body instead of the whole round.
function team5Silence(f) {
  if (!f) return;
  // Not just sound: anything this fighter registered with the world outlives the object itself.
  // The Earth Mage's pillars are registered as projectile blockers globally, and a discarded mage
  // took its pillars off screen while leaving the blockers behind — invisible walls for the rest
  // of the match. See EarthMage.releaseWorldObstacles.
  if (typeof f.releaseWorldObstacles === "function") f.releaseWorldObstacles();
  if (typeof f.stopAllTridentSounds === "function") f.stopAllTridentSounds();
  if (typeof f.stopAllPillarSounds === "function") f.stopAllPillarSounds();
  if (typeof f.stopAllRiteSounds === "function") f.stopAllRiteSounds();
  if (typeof f.stopAllPoopSounds === "function") f.stopAllPoopSounds();
  if (typeof f.stopSnoring === "function") f.stopSnoring();
  if (typeof f.stopLaserAudio === "function") f.stopLaserAudio();
  if (typeof f.stopSwimLoop === "function") f.stopSwimLoop();
  // NOT stopWoosh — that one takes a trident and silences just that one; the Demon's whole-set
  // teardown is stopAllTridentSounds, already called above.
  // The lava bed is owned globally rather than by the mage that lit it (see firemage.js), so
  // it has to be killed off here or it would burn for the rest of the match under whoever
  // walks in next.
  if (f instanceof FireMage) stopFiremageLavaLoop();
}

// Sends the next waiting name on that side into the arena. Returns false if there is nobody
// left, which is what ends the match.
function team5SendIn(side) {
  const squad = team5Squad(side);
  const next = squad.find((m) => m.state === "waiting");
  if (!next) return false;

  const f = ROSTER[next.idx].ctor();
  Object.assign(f, randomVelocity(f.speed));
  next.state = "active";
  next.live = f;
  next.maxHp = f.maxHp;
  next.hp = f.hp;
  if (side === "a") fighterA = f; else fighterB = f;
  return true;
}

// Where a substitute actually appears: on ITS OWN side of the arena, since that is the side it
// just walked in from, and at whichever end of that side is further from the survivor — a fresh
// fighter must never materialise on top of the one already standing there. That matters more now
// than it did: this mode gives no spawn grace (see startTeam5Round), so a bad spawn is a free
// hit rather than a free half-second.
function team5EntryPoint(side, f, foe) {
  const r = f.size / 2;
  const x = side === "a" ? ARENA.x + CORNER_MARGIN + r
                         : ARENA.x + ARENA.w - CORNER_MARGIN - r;
  const top = ARENA.y + CORNER_MARGIN + r;
  const bottom = ARENA.y + ARENA.h - CORNER_MARGIN - r;
  if (!foe) return { x, y: (top + bottom) / 2 };
  const dTop = Math.hypot(x - foe.x, top - foe.y);
  const dBottom = Math.hypot(x - foe.x, bottom - foe.y);
  return { x, y: dTop >= dBottom ? top : bottom };
}

function team5PlaceEntrant(f, at) {
  f.x = at.x;
  f.y = at.y;
  spawnFlash(f.x, f.y, "#ffffff", f.size * 2.2, 0.35);
  spawnImpactParticles(f.x, f.y, ["#ffffff", "#cfe0ff", "#a0c0ff"], 22, 1.2, 0);
}

// ---------------------------------------------------------------------------------------
// the bench
// ---------------------------------------------------------------------------------------

// Where a benched fighter stands: a column in the gap between that side's squad panel and the
// arena wall. The panel is chrome and measured in device pixels, so it has to be divided back
// into world units to sit next to an arena that is measured in them.
// The squad boards only exist during the lineup draw. While they are up the arena is the narrow
// `boardArena` that fits beside them; once they go, it opens out into `arena`.
function team5SetArena(which) {
  const L = ARENA_LAYOUTS[arenaLayout];
  if (!L) return;
  const rect = (which === "board" && L.boardArena) ? L.boardArena : L.arena;
  ARENA = { ...rect };
}

// The bench stands in the lane between the arena wall and the Angel's ring, which sits at
// 1.16 arena-half-widths out (see Angel.pentaRadii). Derived rather than fixed, so it follows
// the arena when the boards go away and it opens out.
function team5BenchX(side) {
  const cx = ARENA.x + ARENA.w / 2;
  const out = (ARENA.w / 2) * 1.08;   // midway between the wall (1.00) and the ring (1.16)
  return side === "a" ? cx - out : cx + out;
}

// Slot 0 is the front of the queue — nearest the top, and the next one in.
function team5BenchY(slot) {
  const top = ARENA.y + ARENA.h / 2 - (TEAM5_SIZE - 1) * TEAM5_BENCH_GAP / 2;
  return top + slot * TEAM5_BENCH_GAP;
}

// Everyone still waiting on that side, in squad order. Their INDEX in this list is their place
// in the queue, so the moment the front one is called up everyone behind shuffles forward by
// one — which is the whole point of drawing a queue rather than a static list.
//
// The one currently walking on is excluded even though its record does not flip to "active"
// until the walk lands: it is already out of the line and drawn separately, and leaving it in
// would both draw it twice and hold the shuffle up until it arrived.
function team5Queue(side) {
  const walking = team5Walkin[side] && team5Walkin[side].member;
  return team5Squad(side).filter((m) => m.state === "waiting" && m !== walking);
}

// Eased rather than snapped, so the shuffle forward is something you watch happen.
function team5UpdateBench(dt) {
  for (const side of ["a", "b"]) {
    const bx = team5BenchX(side);
    team5Queue(side).forEach((m, i) => {
      const ty = team5BenchY(i);
      if (m.benchY === undefined) { m.benchX = bx; m.benchY = ty; return; }
      const k = Math.min(1, dt * TEAM5_BENCH_EASE);
      m.benchX += (bx - m.benchX) * k;
      m.benchY += (ty - m.benchY) * k;
    });
  }
}

// Drawn in world space, above the Angel's ring (which passes through this margin) but below
// nothing else that matters. Uses the same portrait bitmap the panel cards use, so a benched
// fighter is unmistakably the character that is about to walk on.
function drawTeam5Bench(ctx) {
  if (team5Draw) return;   // during the lineup draw the boards are the show, not the bench
  for (const side of ["a", "b"]) {
    const accent = side === "a" ? TEAM5_A_COLOR : TEAM5_B_COLOR;
    team5Queue(side).forEach((m, i) => {
      const x = m.benchX !== undefined ? m.benchX : team5BenchX(side);
      const y = m.benchY !== undefined ? m.benchY : team5BenchY(i);
      drawTeam5Bencher(ctx, m, x, y, i === 0 ? accent : null);
    });
  }
  // The one currently walking on, mid-substitution.
  for (const side of ["a", "b"]) {
    const w = team5Walkin[side];
    if (!w) continue;
    const t = 1 - Math.max(0, Math.min(1, w.t / TEAM5_SWAP_DELAY));
    const e = t * t * (3 - 2 * t);
    drawTeam5Bencher(ctx, w.member, w.fromX + (w.toX - w.fromX) * e,
                     w.fromY + (w.toY - w.fromY) * e,
                     side === "a" ? TEAM5_A_COLOR : TEAM5_B_COLOR, 1 - e * 0.35);
  }
}

function drawTeam5Bencher(ctx, m, x, y, ring, alpha = 1) {
  const S = TEAM5_BENCH_SIZE;
  ctx.save();

  // A contact shadow, so they read as standing on the floor rather than floating in the margin.
  ctx.globalAlpha = 0.22 * alpha;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.ellipse(x, y + S * 0.5, S * 0.34, S * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();

  // The next one up gets its team's colour under it; the rest are dimmed back.
  if (ring) {
    ctx.globalAlpha = 0.5 * alpha;
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y + S * 0.5, S * 0.4, S * 0.15, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = (ring ? 0.95 : 0.55) * alpha;
  ctx.drawImage(team5Face(m.idx), x - S / 2, y - S / 2, S, S);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------
// match flow
// ---------------------------------------------------------------------------------------

// Two separate things, because they are not the same question:
//
//   reveal — play the lineup reveal before the fight. Wanted for anything being recorded,
//            including a hand-picked lineup: the ten were chosen rather than rolled, but the
//            video still opens with them landing on the boards one at a time.
//   reroll — replace team5Picks with a fresh random ten first. Only the auto-draw wants this;
//            a hand-picked lineup must obviously keep the names that were picked.
//
// They used to be one flag, which is why picking your own ten skipped the reveal entirely.
function startTeam5Round(reveal = false, reroll = reveal) {
  team5Winner = null;
  team5State = "playing";
  team5EndTimer = 0;
  team5SwapTimer = 0;
  team5SwapSide = { a: false, b: false };
  team5Walkin = { a: null, b: null };
  team5PendingBlob = null;
  team5PromptReady = false;
  team5QueuedDecision = null;

  clearWorldObstacles();
  // The draw holds an empty arena for ~10s; without this it holds the last match's debris too.
  clearFieldEffects();
  stopFiremageLavaLoop();
  team5Silence(fighterA);
  team5Silence(fighterB);

  team5Draw = null;
  if (reroll) team5Picks = team5RandomPicks();
  // Remembered so the keep/discard decision at the end of a match starts the next one the same
  // way this one started: an auto-drawn match rolls a fresh ten, a hand-picked one runs the same
  // ten again — and either way the reveal plays.
  team5LastReroll = reroll;
  if (team5Picks.length < TEAM5_SIZE * 2) resetTeam5Picks();
  team5A = team5MakeSquad(team5Picks.slice(0, TEAM5_SIZE));
  team5B = team5MakeSquad(team5Picks.slice(TEAM5_SIZE, TEAM5_SIZE * 2));

  matchTitle = "TEAM A vs TEAM B";
  document.title = matchTitle;
  // Recording starts BEFORE the draw, so the reveal is the head of the video rather than
  // something that happened off camera.
  startRecording();

  if (reveal) {
    team5BeginDraw();
    return;
  }
  team5SetArena("match");
  team5SendIn("a");
  team5SendIn("b");
  placeAtCorners();
  team5NoGrace();
}

// No spawn grace in this mode. The half-second freeze that opens an ordinary round reads as
// hesitation here — the two of them have just been sent on, and the crowd is watching them stand
// there. Both sides lose it equally, so it costs neither of them anything.
function team5NoGrace() {
  if (fighterA) fighterA.attackGraceTimer = 0;
  if (fighterB) fighterB.attackGraceTimer = 0;
}

function team5Credit(side) {
  const m = team5Active(side);
  if (m) m.kills++;
}

// Freezes that slot's HP at what it died on and lets go of the live body, so the panel keeps
// showing a defeated entry rather than reading off an object about to be discarded.
function team5MarkDown(side) {
  const m = team5Active(side);
  if (!m) return;
  m.hp = 0;
  m.state = "down";
}

// Called every frame from the shared update block, in place of 1v1's checkWinner().
function team5Tick(dt) {
  team5UpdateBench(dt);

  if (team5State === "swapping") {
    team5SwapTimer -= dt;
    for (const side of ["a", "b"]) if (team5Walkin[side]) team5Walkin[side].t -= dt;
    if (team5SwapTimer <= 0) team5CompleteSwap();
    return;
  }
  if (team5State !== "playing") return;

  // Exactly the guards checkWinner() uses: a pending self-destruct or an armed bomb can still
  // take the other one with it, and a blade already in the air has to be allowed to land.
  if (hasSelfDestructPending(fighterA) || hasSelfDestructPending(fighterB)) return;
  if (hasBombsPending(fighterA) || hasBombsPending(fighterB)) return;
  if (fighterA.blocksRoundEnd || fighterB.blocksRoundEnd) return;

  const aDown = isFighterDown(fighterA);
  const bDown = isFighterDown(fighterB);
  if (!aDown && !bDown) return;

  // Credited before anything is marked down, so a double KO credits neither.
  if (aDown && !bDown) team5Credit("b");
  if (bDown && !aDown) team5Credit("a");
  if (aDown) team5MarkDown("a");
  if (bDown) team5MarkDown("b");

  const aOut = aDown && !team5A.some((m) => m.state === "waiting");
  const bOut = bDown && !team5B.some((m) => m.state === "waiting");

  if (aOut || bOut) {
    team5Winner = aOut && bOut ? "draw" : (aOut ? "B" : "A");
    team5State = "ended";
    team5EndTimer = 0;
    if (team5Winner === "draw") {
      playSfx("draw", 0.8);
    } else {
      // Only the fighter actually left standing celebrates. A team can win the match with its
      // own last fighter dead (both went down, but the other side had nobody in reserve), and
      // in that case there is simply nobody to run a victory animation.
      const champ = team5Winner === "A" ? fighterA : fighterB;
      if (champ && champ.alive && typeof champ.onVictory === "function") champ.onVictory();
    }
    return;
  }

  team5SwapSide = { a: aDown, b: bDown };
  team5SwapTimer = TEAM5_SWAP_DELAY;
  team5State = "swapping";

  // Start the walk-on now, so the substitution is something that happens over the delay rather
  // than a body appearing when it expires.
  for (const side of ["a", "b"]) {
    if (!team5SwapSide[side === "a" ? "a" : "b"]) continue;
    const next = team5Queue(side)[0];
    if (!next) continue;
    const probe = ROSTER[next.idx].ctor();
    const foe = side === "a" ? (bDown ? null : fighterB) : (aDown ? null : fighterA);
    const at = team5EntryPoint(side, probe, foe);
    team5Walkin[side] = {
      member: next,
      fromX: next.benchX !== undefined ? next.benchX : team5BenchX(side),
      fromY: next.benchY !== undefined ? next.benchY : team5BenchY(0),
      toX: at.x, toY: at.y, t: TEAM5_SWAP_DELAY, at,
    };
  }
}

function team5CompleteSwap() {
  for (const side of ["a", "b"]) {
    if (!team5SwapSide[side]) continue;
    team5Silence(side === "a" ? fighterA : fighterB);
    if (!team5SendIn(side)) continue;
    const f = side === "a" ? fighterA : fighterB;
    const w = team5Walkin[side];
    const foe = side === "a" ? (team5SwapSide.b ? null : fighterB)
                             : (team5SwapSide.a ? null : fighterA);
    team5PlaceEntrant(f, w ? w.at : team5EntryPoint(side, f, foe));
    f.attackGraceTimer = 0;   // see team5NoGrace
    team5Walkin[side] = null;
  }

  if (TEAM5_HEAL_ON_KILL > 0) {
    for (const side of ["a", "b"]) {
      const m = team5Active(side);
      if (m && m.live && m.live.alive) {
        m.live.hp = Math.min(m.live.maxHp, m.live.hp + m.live.maxHp * TEAM5_HEAL_ON_KILL);
      }
    }
  }

  team5SwapSide = { a: false, b: false };
  team5State = "playing";
}

function keepTeam5Recording() {
  if (team5PendingBlob) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = team5PendingBlob.type.includes("mp4") ? "mp4" : "webm";
    downloadBlob(team5PendingBlob, `team5-${ts}.${ext}`);
  }
  startTeam5Round(true, team5LastReroll);
}

function discardTeam5Recording() {
  startTeam5Round(true, team5LastReroll);
}

// ---------------------------------------------------------------------------------------
// drawing — the two side panels are the whole reason this mode is worth a 16:9 frame
// ---------------------------------------------------------------------------------------

// Portraits, rendered from the characters themselves rather than drawn as separate art — a
// throwaway instance of each, its own drawBody() called into a small offscreen canvas. That way
// a portrait can never drift out of sync with how the character actually looks, and adding a
// character to the roster gets one for free.
//
// Body only, not draw(): draw() also puts the field HP bar over its head and applies hit flashes
// and stun/pin decorations, none of which belong on a mugshot.
//
// Cached forever, keyed by roster index — these never change.
const team5FaceCache = {};

function team5Face(idx) {
  if (team5FaceCache[idx]) return team5FaceCache[idx];

  const S = TEAM5_FACE_BITMAP;
  const f = ROSTER[idx].ctor();
  f.x = 0;
  f.y = 0;
  f.facingAngle = 0;      // everyone faces the same way, so the row reads as a set
  f.lift = 0;

  // Two passes, because `size` is the COLLISION diameter and almost nobody draws inside it —
  // wings, hats, hair, shoulder armour and held weapons all overhang. Fitting on `size` alone
  // clipped 13 of the 14. So: draw once, small, into a roomy scratch canvas; measure where the
  // ink actually landed; then blit that box, scaled and centred, into the portrait.
  const PROBE = 256;
  const probe = document.createElement("canvas");
  probe.width = PROBE;
  probe.height = PROBE;
  const pg = probe.getContext("2d");
  pg.save();
  pg.translate(PROBE / 2, PROBE / 2);
  const k0 = 80 / f.size;   // small enough that even the widest overhang cannot reach the edge
  pg.scale(k0, k0);
  try { f.drawBody(pg); } catch (e) { /* a body needing world state it hasn't got — leave blank */ }
  pg.restore();

  const px = pg.getImageData(0, 0, PROBE, PROBE).data;
  let minX = PROBE, minY = PROBE, maxX = -1, maxY = -1;
  for (let y = 0; y < PROBE; y++) {
    for (let x = 0; x < PROBE; x++) {
      if (px[(y * PROBE + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d");
  if (maxX >= 0) {
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    // 0.9 rather than 1.0 leaves a hair of margin inside the portrait's own border.
    const k1 = (S * 0.9) / Math.max(bw, bh);
    g.translate(S / 2, S / 2);
    g.scale(k1, k1);
    g.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    g.drawImage(probe, 0, 0);
  }

  team5FaceCache[idx] = c;
  return c;
}

function drawTeam5Face(ctx, idx, x, y, size, dim) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(x, y, size, size);
  ctx.globalAlpha = dim ? 0.35 : 1;
  ctx.drawImage(team5Face(idx), x, y, size, size);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  ctx.restore();
}

// Drawn AFTER everything in world space, and opaque, because effects authored for the portrait
// frame legitimately spill past the arena — the Angel's pentagram is 534px wide in this layout
// and reaches well into both panels. Letting them cover it makes the ring pass behind the
// panels, which reads correctly, instead of having to clip the world.
// Drawn across the middle of the empty arena while the squads are being picked, so the frame
// is not just two boards either side of a void.
function drawTeam5DrawStage(ctx) {
  if (!team5Draw) return;
  const cx = ARENA.x + ARENA.w / 2, cy = ARENA.y + ARENA.h / 2;
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,220,50,0.9)";
  ctx.font = "bold 56px Arial";
  ctx.fillText("5 vs 5", cx, cy + 12);
  ctx.restore();
}

// The squad columns, the title band and the end-of-match prompt are CHROME — they sit on the
// picture rather than in it, and must NOT grow with the layout's world zoom (see layoutZoom in
// arena.js). The whole frame is drawn through one scale(zoom), so this undoes it: everything
// inside runs in real device pixels, and every size in here stays the size it was authored at,
// however far the world is zoomed.
//
// `fn` is handed the frame in those device pixels, since WIDTH/HEIGHT are logical.
function team5AsChrome(ctx, fn) {
  const z = layoutZoom();
  ctx.save();
  ctx.scale(1 / z, 1 / z);
  fn(WIDTH * z, HEIGHT * z);
  ctx.restore();
}

function drawTeam5Panels(ctx) {
  team5AsChrome(ctx, (SW, SH) => {
    drawTeam5Panel(ctx, 0, SH, team5A, "TEAM A", TEAM5_A_COLOR);
    drawTeam5Panel(ctx, SW - TEAM5_PANEL_W, SH, team5B, "TEAM B", TEAM5_B_COLOR);
  });
}

const TEAM5_CARD_TOP = 168;
const TEAM5_CARD_H = 118;
const TEAM5_CARD_GAP = 14;

function drawTeam5Panel(ctx, px, SH, squad, title, accent) {
  ctx.save();

  ctx.fillStyle = "#07070f";
  ctx.fillRect(px, 0, TEAM5_PANEL_W, SH);
  const edgeX = px === 0 ? px + TEAM5_PANEL_W : px;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(edgeX, 0);
  ctx.lineTo(edgeX, SH);
  ctx.stroke();

  const cx = px + TEAM5_PANEL_W / 2;
  ctx.textAlign = "center";
  ctx.fillStyle = accent;
  ctx.font = "bold 30px Arial";
  ctx.fillText(title, cx, 104);

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "15px Arial";
  ctx.fillText(team5Draw ? `${squad.filter((m) => m.drawn).length} / ${TEAM5_SIZE} drawn`
                         : `${team5Remaining(squad)} / ${TEAM5_SIZE} remaining`, cx, 132);

  const cardX = px + 16;
  const cardW = TEAM5_PANEL_W - 32;
  const side = squad === team5A ? "a" : "b";
  squad.forEach((m, i) => {
    drawTeam5Card(ctx, cardX, TEAM5_CARD_TOP + i * (TEAM5_CARD_H + TEAM5_CARD_GAP),
                  cardW, m, i, accent, side);
  });

  ctx.restore();
}

function drawTeam5Card(ctx, x, y, w, m, index, accent, side) {
  // Mid-draw, a card is one of three things: already locked in, the one being rolled right now,
  // or still empty. Nothing below it applies until a name has landed.
  if (team5Draw && !m.drawn) {
    const rolling = team5DrawIndex(side, index) === team5Draw.revealed
                 && team5Draw.phase === "spin";
    drawTeam5EmptyCard(ctx, x, y, w, index, accent, rolling ? team5Draw.spinName : null);
    return;
  }

  const active = m.state === "active";
  const down = m.state === "down";
  const justDrawn = !!team5Draw;

  ctx.fillStyle = active ? "rgba(255,255,255,0.10)" : down ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.05)";
  ctx.fillRect(x, y, w, TEAM5_CARD_H);
  ctx.strokeStyle = active ? accent : "rgba(255,255,255,0.16)";
  ctx.lineWidth = active ? 2.5 : 1.5;
  ctx.strokeRect(x, y, w, TEAM5_CARD_H);

  // The slot number, and the status word next to it
  ctx.textAlign = "left";
  ctx.font = "bold 13px Arial";
  ctx.fillStyle = active ? accent : "rgba(255,255,255,0.35)";
  ctx.fillText(`#${index + 1}`, x + 10, y + 18);

  // Up here beside the slot number rather than along the bottom of the card: the active card's
  // bottom row belongs to whatever note that character's own drawHud puts there (the Angel's
  // "RITE — volley 3/5", the Demon's trident count), and a KO tally sat straight on top of it.
  if (m.kills > 0) {
    ctx.fillStyle = "#ffdc32";
    ctx.font = "bold 14px Arial";
    ctx.fillText(`${m.kills} KO`, x + 40, y + 18);
  }

  ctx.textAlign = "right";
  ctx.font = "bold 12px Arial";
  ctx.fillStyle = justDrawn ? accent
                : active ? accent : down ? "rgba(255,90,90,0.75)" : "rgba(255,255,255,0.3)";
  ctx.fillText(justDrawn ? "DRAWN" : active ? "FIGHTING" : down ? "DOWN" : "WAITING",
               x + w - 10, y + 18);

  // Portrait on the left, everything else in the column beside it.
  const faceX = x + 10, faceY = y + 30;
  drawTeam5Face(ctx, m.idx, faceX, faceY, TEAM5_FACE, down);

  const colX = faceX + TEAM5_FACE + 10;
  const colW = x + w - 10 - colX;

  ctx.globalAlpha = down ? 0.4 : 1;

  if (active && m.live) {
    // The real HUD, so the ultimate bar, the shield band and each character's own note line
    // (e.g. the Angel's "RITE — volley 2/5") all come along for free and stay in lockstep with
    // the rest of the game rather than being reimplemented here.
    m.live.drawHud(ctx, colX, y + 46, colW);
  } else {
    ctx.textAlign = "left";
    ctx.fillStyle = down ? "rgba(255,255,255,0.55)" : "#ffffff";
    ctx.font = "bold 19px Arial";
    ctx.fillText(ROSTER[m.idx].label, colX, y + 48);

    const barY = y + 60;
    const ratio = Math.max(0, m.hp / m.maxHp);
    ctx.fillStyle = "#1e1e23";
    ctx.fillRect(colX, barY, colW, 14);
    ctx.fillStyle = down ? "#5a2020" : "#50f050";
    ctx.fillRect(colX, barY, colW * ratio, 14);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(colX, barY, colW, 14);
  }

  ctx.globalAlpha = 1;

  if (down) {
    ctx.strokeStyle = "rgba(255,80,80,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 6);
    ctx.lineTo(x + w - 6, y + TEAM5_CARD_H - 6);
    ctx.stroke();
  }
}

// A slot with nothing in it yet, or the one the reel is currently spinning through. The rolling
// one gets the accent border and the cycling name; the rest are deliberately near-blank so the
// eye goes to the single slot that is actually being decided.
function drawTeam5EmptyCard(ctx, x, y, w, index, accent, spinName) {
  ctx.fillStyle = spinName ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)";
  ctx.fillRect(x, y, w, TEAM5_CARD_H);
  ctx.strokeStyle = spinName ? accent : "rgba(255,255,255,0.10)";
  ctx.lineWidth = spinName ? 2.5 : 1.5;
  ctx.strokeRect(x, y, w, TEAM5_CARD_H);

  ctx.textAlign = "left";
  ctx.font = "bold 13px Arial";
  ctx.fillStyle = spinName ? accent : "rgba(255,255,255,0.25)";
  ctx.fillText(`#${index + 1}`, x + 10, y + 18);

  ctx.textAlign = "center";
  if (spinName) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 21px Arial";
    ctx.fillText(spinName, x + w / 2, y + TEAM5_CARD_H / 2 + 10);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.font = "bold 26px Arial";
    ctx.fillText("—", x + w / 2, y + TEAM5_CARD_H / 2 + 10);
  }
}

// The two fighters' HUDs, in the top corners. The squad boards used to carry this; once they
// come down it is the only place the ultimate bar, the shield band and each character's own note
// line ("RITE — volley 3/5") are shown at all.
//
// Logical units, NOT chrome: drawHud picks its font from hudNameFont(), whose landscape value is
// already sized for the frame's zoom.
const TEAM5_HUD_W = 215;        // 300 device px at 1.4x
const TEAM5_HUD_MARGIN = 26;
const TEAM5_HUD_Y = 64;

function drawTeam5MatchHud(ctx) {
  if (team5Draw) return;
  for (const side of ["a", "b"]) {
    const f = side === "a" ? fighterA : fighterB;
    if (!f) continue;
    const x = side === "a" ? TEAM5_HUD_MARGIN : WIDTH - TEAM5_HUD_MARGIN - TEAM5_HUD_W;
    f.drawHud(ctx, x, TEAM5_HUD_Y, TEAM5_HUD_W);
    const m = team5Active(side);
    if (m && m.kills > 0) {
      // On the name's own row, right-aligned, rather than under the block: drawHud is documented
      // to return the next free y but only 3 of the 15 overrides actually do, so anything placed
      // off that return lands at NaN for most of the roster. This row is free either way — the
      // name is left-aligned and the HP figure sits 10px lower.
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffdc32";
      ctx.font = "bold 13px Arial";
      ctx.fillText(`${m.kills} KO`, x + TEAM5_HUD_W, TEAM5_HUD_Y - 2);
      ctx.textAlign = "left";
    }
  }
}

// Its own baseline rather than the layout's TITLE_Y: this band is chrome, so it is positioned
// in device pixels like the columns beside it, not in the zoomed world's units.
const TEAM5_TITLE_Y = 46;

function drawTeam5Title(ctx) {
  team5AsChrome(ctx, (SW) => drawTeam5TitleInner(ctx, SW));
}

function drawTeam5TitleInner(ctx, SW) {
  ctx.textAlign = "center";
  const cx = SW / 2;

  if (team5Draw) {
    ctx.fillStyle = "#ffdc32";
    ctx.font = "bold 34px Arial";
    ctx.fillText("DRAWING THE SQUADS", cx, TEAM5_TITLE_Y);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "20px Arial";
    ctx.fillText(team5Draw.phase === "tail"
      ? "Both squads set"
      : `Pick ${Math.min(team5Draw.revealed + 1, TEAM5_SIZE * 2)} of ${TEAM5_SIZE * 2}`,
      cx, TEAM5_TITLE_Y + 34);
    return;
  }

  const a = team5Active("a");
  const b = team5Active("b");
  const an = a ? ROSTER[a.idx].label : "-";
  const bn = b ? ROSTER[b.idx].label : "-";

  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 34px Arial";
  ctx.fillText(`${an}  vs  ${bn}`, cx, TEAM5_TITLE_Y);

  if (team5State === "swapping") {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "bold 20px Arial";
    ctx.fillText("NEXT FIGHTER IN…", cx, TEAM5_TITLE_Y + 34);
  }
}

function drawTeam5PromptOverlay(ctx) {
  team5AsChrome(ctx, (SW, SH) => {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, SW, SH);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffdc32";
    ctx.font = "bold 34px Arial";
    const title =
      team5Winner === "A" ? "TEAM A Wins!" :
      team5Winner === "B" ? "TEAM B Wins!" :
      "Draw!";
    ctx.fillText(title, SW / 2, SH / 2 - 50);

    ctx.fillStyle = "#ffffff";
    ctx.font = "22px Arial";
    ctx.fillText(team5PromptReady ? "Keep this recording?" : "Finalizing recording…",
                 SW / 2, SH / 2 + 6);

    if (team5PromptReady) {
      ctx.font = "bold 20px Arial";
      ctx.fillStyle = "#64f064";
      ctx.fillText("[Y] Keep", SW / 2 - 80, SH / 2 + 46);
      ctx.fillStyle = "#ff6464";
      ctx.fillText("[N] Discard", SW / 2 + 80, SH / 2 + 46);
    }
  });
}
