// Gauntlet — one fighter against the entire rest of the cast, one at a time, without a break.
//
// The challenger keeps whatever HP they have left from the last fight and gets a small top-up
// for winning it; the next name walks in the moment the last one goes down. The run ends the
// first time the challenger loses, and the score is simply how many they got through.
//
// It rides the ordinary 1v1 update block in main.js rather than having one of its own — exactly
// the trick the 5-a-side relay uses, and for the same reason: this IS two fighters in an arena,
// and only the question of who arrives next differs. That means every character behaves here
// precisely as it does in a normal duel, with no second code path to keep in step.
//
// The carry-over is the whole design. A duel is a fair fight; this is an endurance run, and the
// interesting question is not "can A beat B" — 1v1 already answers that — but "how far does A
// get on one health bar", which is a different question with a different answer for every
// character in the roster.

// The challenger's health, multiplied. This is what makes the mode a gauntlet rather than
// fourteen duels in a row, and it is not decoration — it is the only thing that CAN work.
//
// Measured first without it: against a queue of fourteen where most fights are near even, the
// median run is one win and a third of all runs are zero, and raising the between-fights heal
// barely touches that (0.35 -> 0.55 -> 0.75 moved the mean 1.22 -> 1.78 -> 1.87 and left the
// median at 1). That is arithmetic, not tuning — chaining five coin flips is a 3% event, so no
// amount of healing between them produces a long run. The challenger has to be genuinely
// stronger than the queue, which is how a gauntlet has always worked.
//
// Same device VS BOSS already uses on its boss (see BOSS_HP_MULTIPLIER in main.js), pointed the
// other way: here the lone fighter is the one holding the arena.
// 2.0 measured, over 45 full runs at each setting. At 3.0 the median run cleared 9 of the 14
// and 40% of runs cleared the whole cast, which makes the ending a formality; at 2.0 the
// median is 3, clearing happens in about one run in eight, and a run lasts around two
// minutes — long enough to be a video, short enough that the roster's spread shows.
const GAUNTLET_HERO_HP_MULT = 2.0;
// ...and what winning is worth on top of that, as a fraction of the boosted maximum. Keeps the
// carry-over meaningful — a clean win leaves you close to full, a brawl does not.
const GAUNTLET_HEAL_ON_WIN = 0.30;
// A beat between a knockout and the next arrival, so the win registers before the next fight
// starts. The walk-on runs across it rather than the body appearing when it expires.
const GAUNTLET_SWAP_DELAY = 1.6;

// The progress strip. Its Y is derived from the arena rather than fixed, so it follows the
// frame instead of falling off the bottom of a shorter one — see drawGauntletProgress.
const GAUNTLET_PIP = 34;
const GAUNTLET_PIP_GAP = 5;

let gauntletHeroIdx = null;     // ROSTER index of the challenger
let gauntletFoeIdx = null;      // ROSTER index of whoever is in front of them right now
let gauntletQueue = [];         // ROSTER indices still to come, in the order they will arrive
let gauntletBeaten = [];        // ROSTER indices already put down, in the order they fell
let gauntletOrder = [];         // the full running order, kept for the progress strip
let gauntletState = "playing";  // "playing" | "swapping" | "ended" | "prompting"
let gauntletOutcome = null;     // "cleared" | "fell" | null
let gauntletSwapTimer = 0;
let gauntletEndTimer = 0;
let gauntletPendingBlob = null;
let gauntletPromptReady = false;
let gauntletQueuedDecision = null;
let gauntletWalkin = null;      // { toX, toY, t } while the next one is coming on

function gauntletShuffled(indices) {
  const a = indices.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Everyone but the challenger. Archer is left in deliberately: it is excluded from win-rate
// REPORTS because it skews the averages, but a gauntlet is meant to be survived rather than
// averaged, and leaving the hardest opponent out would take the teeth out of the run.
function gauntletPool(heroIdx) {
  return ROSTER.map((_, i) => i).filter((i) => i !== heroIdx);
}

// `forStream` is a Twitch-triggered run: no clip recording is started, because that mode is
// meant to be captured by OBS as a whole scene and its keep/discard prompt needs a keypress
// nobody is there to give. See triggerTwitchBattle in main.js.
function startGauntletRun(heroIdx, forStream = false) {
  if (isRecording) stopRecording();
  // Stone pillars are registered globally so projectiles can be blocked without knowing who put
  // them there — a previous run's Earth Mage would go on blocking things here. See combat.js.
  clearWorldObstacles();
  clearFieldEffects();

  gauntletHeroIdx = heroIdx;
  gauntletOrder = gauntletShuffled(gauntletPool(heroIdx));
  gauntletQueue = gauntletOrder.slice();
  gauntletBeaten = [];
  gauntletOutcome = null;
  gauntletSwapTimer = 0;
  gauntletEndTimer = 0;
  gauntletPendingBlob = null;
  gauntletPromptReady = false;
  gauntletQueuedDecision = null;
  gauntletWalkin = null;

  fighterA = ROSTER[heroIdx].ctor();
  fighterA.maxHp = Math.round(fighterA.maxHp * GAUNTLET_HERO_HP_MULT);
  fighterA.hp = fighterA.maxHp;
  Object.assign(fighterA, randomVelocity(fighterA.speed));
  gauntletFoeIdx = gauntletQueue.shift();
  fighterB = ROSTER[gauntletFoeIdx].ctor();
  Object.assign(fighterB, randomVelocity(fighterB.speed));

  // Opposite corners, the same opening a duel gets.
  fighterA.x = ARENA.x + CORNER_MARGIN + fighterA.size / 2;
  fighterA.y = ARENA.y + ARENA.h - CORNER_MARGIN - fighterA.size / 2;
  fighterB.x = ARENA.x + ARENA.w - CORNER_MARGIN - fighterB.size / 2;
  fighterB.y = ARENA.y + CORNER_MARGIN + fighterB.size / 2;

  gauntletState = "playing";
  matchTitle = `${fighterA.name} — Gauntlet`;
  document.title = matchTitle;
  if (!forStream) startRecording();
}

// Where the next challenger appears: the far side of the arena from the survivor, so nobody ever
// materialises on top of the fighter already standing there.
function gauntletEntryPoint(f) {
  const r = f.size / 2;
  const left = ARENA.x + CORNER_MARGIN + r;
  const right = ARENA.x + ARENA.w - CORNER_MARGIN - r;
  const top = ARENA.y + CORNER_MARGIN + r;
  const bottom = ARENA.y + ARENA.h - CORNER_MARGIN - r;
  const hero = fighterA;
  let best = { x: right, y: top }, bestD = -1;
  for (const p of [{ x: left, y: top }, { x: right, y: top },
                   { x: left, y: bottom }, { x: right, y: bottom }]) {
    const d = hero ? Math.hypot(p.x - hero.x, p.y - hero.y) : 1;
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}

function gauntletSendNext() {
  if (!gauntletQueue.length) return false;
  gauntletFoeIdx = gauntletQueue.shift();
  const f = ROSTER[gauntletFoeIdx].ctor();
  Object.assign(f, randomVelocity(f.speed));
  const at = gauntletEntryPoint(f);
  f.x = at.x;
  f.y = at.y;
  fighterB = f;
  spawnFlash(f.x, f.y, "#ffffff", f.size * 2.2, 0.35);
  spawnImpactParticles(f.x, f.y, ["#ffffff", "#cfe0ff", "#a0c0ff"], 22, 1.2, 0);
  return true;
}

function gauntletFinish(outcome) {
  gauntletOutcome = outcome;
  gauntletState = "ended";
  gauntletEndTimer = 0;
  if (outcome === "cleared" && fighterA && fighterA.alive
      && typeof fighterA.onVictory === "function") {
    fighterA.onVictory();
  } else if (outcome === "fell" && fighterB && fighterB.alive
             && typeof fighterB.onVictory === "function") {
    fighterB.onVictory();
  }
}

// Called from the shared update block every frame the run is live.
function gauntletTick(dt) {
  if (gauntletState === "swapping") {
    gauntletSwapTimer -= dt;
    if (gauntletWalkin) gauntletWalkin.t -= dt;
    if (gauntletSwapTimer <= 0) {
      gauntletWalkin = null;
      // The body that just lost is discarded here rather than when it fell, so its death
      // animation plays out across the delay. team5Silence is the cast-wide teardown for a
      // fighter being thrown away mid-match — looping sounds, registered world obstacles, the
      // lot — and is exactly as correct here as it is in the relay.
      team5Silence(fighterB);
      if (!gauntletSendNext()) gauntletFinish("cleared");
      else gauntletState = "playing";
    }
    return;
  }
  if (gauntletState !== "playing") return;

  // Exactly the guards checkWinner() uses: a pending self-destruct or an armed bomb can still
  // take the other one with it, and a blade already in the air has to be allowed to land.
  if (hasSelfDestructPending(fighterA) || hasSelfDestructPending(fighterB)) return;
  if (hasBombsPending(fighterA) || hasBombsPending(fighterB)) return;
  if (fighterA.blocksRoundEnd || fighterB.blocksRoundEnd) return;

  const heroDown = isFighterDown(fighterA);
  const foeDown = isFighterDown(fighterB);
  if (!heroDown && !foeDown) return;

  // A double knockout ends the run: the challenger is down, and that is the only thing the run
  // measures. The one they took with them still counts as beaten.
  if (heroDown) {
    if (foeDown) gauntletBeaten.push(gauntletFoeIdx);
    gauntletFinish("fell");
    return;
  }

  // Won this one.
  gauntletBeaten.push(gauntletFoeIdx);
  const heal = Math.round(fighterA.maxHp * GAUNTLET_HEAL_ON_WIN);
  if (typeof fighterA.heal === "function") fighterA.heal(heal);
  playSfx("draw", 0.25);

  if (!gauntletQueue.length) { gauntletFinish("cleared"); return; }

  gauntletState = "swapping";
  gauntletSwapTimer = GAUNTLET_SWAP_DELAY;
  const probe = ROSTER[gauntletQueue[0]].ctor();
  const at = gauntletEntryPoint(probe);
  gauntletWalkin = { idx: gauntletQueue[0], toX: at.x, toY: at.y, t: GAUNTLET_SWAP_DELAY };
}

function keepGauntletRecording() {
  if (gauntletPendingBlob) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = gauntletPendingBlob.type.includes("mp4") ? "mp4" : "webm";
    const name = `${ROSTER[gauntletHeroIdx].label}-gauntlet-${gauntletBeaten.length}`;
    downloadBlob(gauntletPendingBlob, `${name}-${ts}.${ext}`.replace(/\s+/g, "-").toLowerCase());
  }
  startGauntletRun(gauntletHeroIdx);
}

function discardGauntletRecording() {
  startGauntletRun(gauntletHeroIdx);
}

// ---------------------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------------------

function drawGauntletHud(ctx) {
  if (fighterA) fighterA.drawHud(ctx, HUD_MARGIN, HUD_Y, HUD_W);
  if (fighterB) fighterB.drawHud(ctx, WIDTH - HUD_MARGIN - HUD_W, HUD_Y, HUD_W);
}

// The running order, left to right: beaten, current, still to come. The strip is the scoreboard —
// it is the one thing on screen that says what this mode is.
function drawGauntletProgress(ctx) {
  const total = gauntletOrder.length;
  if (!total) return;

  // The strip lives in the band under the arena, which the 9:16 battle frame has 310px of. The
  // Twitch overlay frame is 720x850 and has THIRTY — so there, the score degrades to a single
  // line. Drawing the faces anyway would put them on top of the fight.
  const roomBelow = HEIGHT - (ARENA.y + ARENA.h);
  if (roomBelow < GAUNTLET_PIP + 56) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffdc32";
    ctx.font = "bold 18px Arial";
    ctx.fillText(`${gauntletBeaten.length} / ${total} DEFEATED`,
                 WIDTH / 2, ARENA.y + ARENA.h + Math.min(22, roomBelow - 4));
    ctx.restore();
    return;
  }

  const pitch = GAUNTLET_PIP + GAUNTLET_PIP_GAP;
  // Squeezed to fit however many are in the running order, so adding characters cannot push the
  // strip off the sides the way the picker's fixed pitch once did.
  const maxW = WIDTH - 60;
  const scale = Math.min(1, maxW / (total * pitch));
  const pip = GAUNTLET_PIP * scale;
  const step = pitch * scale;
  let x = WIDTH / 2 - (total * step - GAUNTLET_PIP_GAP * scale) / 2;
  const y = ARENA.y + ARENA.h + 65;

  ctx.save();
  ctx.textAlign = "center";

  for (const idx of gauntletOrder) {
    const done = gauntletBeaten.includes(idx);
    const current = idx === gauntletFoeIdx && !done;

    ctx.globalAlpha = done ? 0.28 : 1;
    const face = typeof team5Face === "function" ? team5Face(idx) : null;
    if (face) ctx.drawImage(face, x, y, pip, pip);

    ctx.globalAlpha = 1;
    if (current) {
      ctx.strokeStyle = "#ffdc32";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x - 1, y - 1, pip + 2, pip + 2);
    } else if (done) {
      // Struck through rather than hidden, so the run's history stays on screen.
      ctx.strokeStyle = "rgba(255,90,70,0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + pip * 0.12, y + pip * 0.12);
      ctx.lineTo(x + pip * 0.88, y + pip * 0.88);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, pip, pip);
    }
    x += step;
  }

  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 30px Arial";
  ctx.fillText(`${gauntletBeaten.length} / ${total}`, WIDTH / 2, y - 22);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "15px Arial";
  ctx.fillText("DEFEATED", WIDTH / 2, y + pip + 24);
  ctx.restore();
}

function drawGauntletPromptOverlay(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 32px Arial";
  const hero = ROSTER[gauntletHeroIdx] ? ROSTER[gauntletHeroIdx].label : "";
  const title = gauntletOutcome === "cleared"
    ? `${hero} cleared the Gauntlet!`
    : `${hero} fell after ${gauntletBeaten.length}`;
  ctx.fillText(title, WIDTH / 2, HEIGHT / 2 - 50);

  ctx.fillStyle = "#ffffff";
  ctx.font = "24px Arial";
  ctx.fillText(`${gauntletBeaten.length} of ${gauntletOrder.length} defeated`, WIDTH / 2, HEIGHT / 2 - 10);

  ctx.font = "22px Arial";
  ctx.fillText(gauntletPromptReady ? "Keep this recording?" : "Finalizing recording…",
               WIDTH / 2, HEIGHT / 2 + 34);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "18px Arial";
  ctx.fillText("Y = keep    N = discard", WIDTH / 2, HEIGHT / 2 + 66);
  ctx.textAlign = "left";
}
