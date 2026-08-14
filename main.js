const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const CORNER_MARGIN = ARENA_BORDER + 10;
const ROUND_END_GRACE = 3.0; // seconds after a winner is decided before we cut the recording

// The full cast: each entry builds a brand-new instance so every round starts from a clean,
// canonical state (the constructor is the only source of truth — no parallel reset logic to
// keep in sync with it).
const ROSTER = [
  { label: "Giant", ctor: () => new Giant(0, 0) },
  { label: "Punch Man", ctor: () => new PunchMan(0, 0) },
  { label: "Demon", ctor: () => new Demon(0, 0) },
  { label: "Bomber", ctor: () => new Bomber(0, 0) },
  { label: "Soldier", ctor: () => new Gunner(0, 0) },
  { label: "Knight", ctor: () => new Knight(0, 0) },
  { label: "Punch Man (New)", ctor: () => new PunchManNew(0, 0) },
  { label: "Ninja", ctor: () => new Ninja(0, 0) },
  { label: "Virus", ctor: () => new Virus(0, 0) },
];

let gameMode = "1v1"; // "1v1" | "vsboss" — which mode is currently toggled in the setup screen

let pickA = 0; // ROSTER index for the left-corner fighter
let pickB = 1; // ROSTER index for the right-corner fighter
let fighterA = ROSTER[pickA].ctor();
let fighterB = ROSTER[pickB].ctor();
let matchTitle = "";

// Fighter A starts top-left, fighter B starts top-right
function placeAtCorners() {
  fighterA.x = ARENA.x + CORNER_MARGIN + fighterA.size / 2;
  fighterA.y = ARENA.y + CORNER_MARGIN + fighterA.size / 2;

  fighterB.x = ARENA.x + ARENA.w - CORNER_MARGIN - fighterB.size / 2;
  fighterB.y = ARENA.y + CORNER_MARGIN + fighterB.size / 2;
}

const HUD_Y = 190;
const HUD_W = 280;
const HUD_MARGIN = 50;

let winner = null;
let roundState = "playing"; // playing | ended | prompting
let mode = "battle"; // "battle" | "setup" | "twitchIdle" (see twitch.js — parked here between Channel Points redemptions)
let selectA = null; // ROSTER index picked so far for the left slot, while in the setup screen
let selectB = null; // ROSTER index picked so far for the right slot, while in the setup screen
let endTimer = 0;
let pendingBlob = null;
let promptReady = false;
let queuedDecision = null; // "keep" | "discard" | null — a Y/N pressed before the prompt was ready
let twitchRoundActive = false; // true for the duration of a round started by triggerTwitchBattle() — see that function and the "ended" handling below

let shakeMagnitude = 0;
let shakeTimer = 0;
let shakeRoll = 0; // current rotational kick (radians) — big hits twist the frame, not just slide it

// Hit-stop: the single biggest "weight" cue in an action game — the whole simulation holds
// still for a few frames the instant a heavy blow connects, so the eye reads impact instead of
// a smooth continuous slide. Derived automatically from triggerShake's magnitude (every
// character already calls that with a magnitude scaled to how big the hit was), so the entire
// cast gets it without touching a single character file.
let hitStopTimer = 0;
const HITSTOP_MIN_MAGNITUDE = 6;    // below this it's a light tap — no freeze, it'd just feel laggy
const HITSTOP_MAX_SECONDS   = 0.085; // cap, so even the heaviest blow never reads as a stutter

function triggerHitStop(seconds) {
  hitStopTimer = Math.max(hitStopTimer, Math.min(seconds, HITSTOP_MAX_SECONDS));
}

function triggerShake(magnitude, duration) {
  shakeMagnitude = Math.max(shakeMagnitude, magnitude);
  shakeTimer = Math.max(shakeTimer, duration);
  // Scales in from nothing at the threshold up to the cap at magnitude ~20 (the heaviest
  // finishers in the game: PM2's wall slam, the Ninja's third slash).
  if (magnitude >= HITSTOP_MIN_MAGNITUDE) {
    const k = Math.min(1, (magnitude - HITSTOP_MIN_MAGNITUDE) / 14);
    triggerHitStop(0.03 + k * (HITSTOP_MAX_SECONDS - 0.03));
    // Finisher weight only (ultimates, wall slams) — not ordinary trades. There is deliberately
    // no full-screen flash here: washing the whole frame white on every heavy hit was harsh to
    // watch over a full match. The freeze, the shake and the local impact effects carry it.
    if (magnitude >= 14) spawnSpeedLines();
  }
}

// True while a dead fighter still has a self-destruct pending (e.g. the Bomber) — it might
// still take the survivor down too, so we shouldn't lock in a "winner" or start a victory
// animation until that resolves one way or the other.
function hasSelfDestructPending(f) {
  return typeof f.selfDestructTimer === "number" && f.selfDestructTimer > 0;
}

// True while a fighter (e.g. the Bomber) still has any bombs armed on the field — the round
// shouldn't end or start a victory celebration while those are still ticking down.
function hasBombsPending(f) {
  return Array.isArray(f.bombs) && f.bombs.length > 0;
}

// True only once a fighter's own body AND every extra body it owns (e.g. a Ninja's shadow
// clone, at any depth of its own clone chain) are all dead — its own death alone isn't enough
// to count it out while a clone is still fighting on its behalf.
function isFighterDown(f) {
  return !f.alive && f.getExtraBodies().length === 0;
}

function checkWinner() {
  if (roundState !== "playing") return;
  if (hasSelfDestructPending(fighterA) || hasSelfDestructPending(fighterB)) return;
  if (hasBombsPending(fighterA) || hasBombsPending(fighterB)) return;

  const aDown = isFighterDown(fighterA);
  const bDown = isFighterDown(fighterB);

  if (aDown && bDown) {
    winner = null; // draw
    playSfx("draw", 0.8);
  } else if (bDown && !aDown) {
    winner = fighterA;
  } else if (aDown && !bDown) {
    winner = fighterB;
  } else {
    return; // still fighting
  }

  roundState = "ended";
  endTimer = 0;
  if (winner && typeof winner.onVictory === "function") winner.onVictory();
}

function randomVelocity(speed) {
  const angle = Math.random() * Math.PI * 2;
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

function reset() {
  winner = null;
  fighterA = ROSTER[pickA].ctor();
  fighterB = ROSTER[pickB].ctor();
  Object.assign(fighterA, randomVelocity(fighterA.speed));
  Object.assign(fighterB, randomVelocity(fighterB.speed));
  placeAtCorners();
  matchTitle = `${fighterA.name} vs ${fighterB.name}`;
  document.title = matchTitle;
}

// Kicks off a fresh round: reset the fighters, announce the match, and start recording it.
function startRound() {
  reset();
  roundState = "playing";
  endTimer = 0;
  pendingBlob = null;
  promptReady = false;
  queuedDecision = null;
  startRecording();
}

function keepRecording() {
  if (pendingBlob) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = pendingBlob.type.includes("mp4") ? "mp4" : "webm";
    downloadBlob(pendingBlob, `${fighterA.name}-vs-${fighterB.name}-${ts}.${ext}`.replace(/\s+/g, "-").toLowerCase());
  }
  startRound();
}

function discardRecording() {
  startRound();
}

// Called by twitch.js the instant a matching Channel Points redemption comes in. Only actually
// does anything while genuinely idle (mode === "twitchIdle") — a redemption arriving mid-fight,
// or while someone's mid-way through the manual setup screen, is just dropped rather than
// interrupting whatever's already showing on stream.
function triggerTwitchBattle() {
  if (mode !== "twitchIdle") return;

  gameMode = "1v1";
  let a = Math.floor(Math.random() * ROSTER.length);
  let b;
  do { b = Math.floor(Math.random() * ROSTER.length); } while (b === a);
  pickA = a;
  pickB = b;

  twitchRoundActive = true;
  mode = "battle";
  reset();
  roundState = "playing";
  endTimer = 0;
  // Deliberately no startRecording() here — this is meant to run as an OBS Browser Source,
  // which is already capturing the whole scene itself. The game's own separate clip-recording
  // feature needs a Y/N keypress to resolve its keep/discard prompt, and nobody's sitting at the
  // keyboard to give one mid-stream — see the twitchRoundActive branch below, which skips that
  // prompt entirely and drops straight back into the waiting screen instead.
}

function pickRosterSlot(index) {
  if (mode !== "setup" || gameMode !== "1v1" || index < 0 || index >= ROSTER.length) return;

  if (selectA === null) {
    selectA = index;
  } else if (selectB === null && index !== selectA) {
    selectB = index;
    pickA = selectA;
    pickB = selectB;
    mode = "battle";
    startRound();
  }
}

// ---------------------------------------------------------------------------------------
// VS BOSS mode: 3 player-picked allies team up against a single boosted "boss" character.
// This reuses the same per-character update/draw/collision/HUD machinery as 1v1 — every
// character's update(dt, opponent) only ever needs a single opponent reference, so each
// ally simply treats the boss as its opponent, and the boss treats whichever living ally is
// nearest as its momentary opponent (see nearestTo()). No changes needed to any individual
// character class for any of this.
// ---------------------------------------------------------------------------------------

const BOSS_HP_MULTIPLIER = 10 / 3; // e.g. Giant's 300 base HP -> exactly 1000 as a boss

let allies = [];
let boss = null;
let vsBossPicks = [null, null, null, null]; // ally1, ally2, ally3, boss — ROSTER indices
let vsBossPickStep = 0;
let vsBossState = "playing"; // "playing" | "ended" | "prompting"
let vsBossWinner = null; // "allies" | "boss" | "draw" | null
let vsBossEndTimer = 0;
let vsBossPendingBlob = null;
let vsBossPromptReady = false;
let vsBossQueuedDecision = null;

// Closest-by-distance entry in `list` to `from` — how the boss picks which ally to go after.
function nearestTo(from, list) {
  let best = null;
  let bestDist = Infinity;
  for (const c of list) {
    const d = Math.hypot(c.x - from.x, c.y - from.y);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function pickVsBossSlot(index) {
  if (mode !== "setup" || gameMode !== "vsboss" || index < 0 || index >= ROSTER.length) return;
  if (vsBossPicks.includes(index)) return; // no duplicates across the 3 allies or the boss

  vsBossPicks[vsBossPickStep] = index;
  vsBossPickStep++;
  if (vsBossPickStep >= 4) {
    mode = "battle";
    startVsBossRound();
  }
}

// Boss takes the middle of the arena; the 3 allies fan out to three of its four corners.
function placeVsBoss() {
  boss.x = ARENA.x + ARENA.w / 2;
  boss.y = ARENA.y + ARENA.h / 2;

  allies[0].x = ARENA.x + CORNER_MARGIN + allies[0].size / 2;
  allies[0].y = ARENA.y + CORNER_MARGIN + allies[0].size / 2;

  allies[1].x = ARENA.x + ARENA.w - CORNER_MARGIN - allies[1].size / 2;
  allies[1].y = ARENA.y + CORNER_MARGIN + allies[1].size / 2;

  allies[2].x = ARENA.x + CORNER_MARGIN + allies[2].size / 2;
  allies[2].y = ARENA.y + ARENA.h - CORNER_MARGIN - allies[2].size / 2;
}

function startVsBossRound() {
  vsBossWinner = null;
  allies = vsBossPicks.slice(0, 3).map((idx) => ROSTER[idx].ctor());
  boss = ROSTER[vsBossPicks[3]].ctor();
  boss.maxHp = Math.round(boss.maxHp * BOSS_HP_MULTIPLIER);
  boss.hp = boss.maxHp;

  for (const a of allies) Object.assign(a, randomVelocity(a.speed));
  Object.assign(boss, randomVelocity(boss.speed));
  placeVsBoss();

  matchTitle = `${allies.map((a) => a.name).join(" + ")} vs ${boss.name} (BOSS)`;
  document.title = matchTitle;

  vsBossState = "playing";
  vsBossEndTimer = 0;
  vsBossPendingBlob = null;
  vsBossPromptReady = false;
  vsBossQueuedDecision = null;
  startRecording();
}

function checkVsBossWinner() {
  if (vsBossState !== "playing") return;
  const all = [boss, ...allies];
  if (all.some(hasSelfDestructPending) || all.some(hasBombsPending)) return;

  const bossAlive = boss.alive;
  const anyAllyAlive = allies.some((a) => a.alive);

  if (!bossAlive && !anyAllyAlive) {
    vsBossWinner = "draw";
    playSfx("draw", 0.8);
  } else if (!bossAlive && anyAllyAlive) {
    vsBossWinner = "allies";
  } else if (bossAlive && !anyAllyAlive) {
    vsBossWinner = "boss";
  } else {
    return; // still fighting
  }

  vsBossState = "ended";
  vsBossEndTimer = 0;

  if (vsBossWinner === "allies") {
    for (const a of allies) {
      if (a.alive && typeof a.onVictory === "function") a.onVictory();
    }
  } else if (vsBossWinner === "boss" && typeof boss.onVictory === "function") {
    boss.onVictory();
  }
}

function keepVsBossRecording() {
  if (vsBossPendingBlob) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = vsBossPendingBlob.type.includes("mp4") ? "mp4" : "webm";
    const names = `${allies.map((a) => a.name).join("-")}-vs-${boss.name}-BOSS`;
    downloadBlob(vsBossPendingBlob, `${names}-${ts}.${ext}`.replace(/\s+/g, "-").toLowerCase());
  }
  startVsBossRound();
}

function discardVsBossRecording() {
  startVsBossRound();
}

// ---------------------------------------------------------------------------------------
// Setup overlay — everything settings-related (mode toggle + roster picking, for either
// mode) lives in this one Tab-triggered screen, entirely mouse-driven. The battle screen
// itself stays clean (no tabs/buttons) since it's what gets recorded.
// ---------------------------------------------------------------------------------------

function resetPicks() {
  selectA = null;
  selectB = null;
  vsBossPicks = [null, null, null, null];
  vsBossPickStep = 0;
}

// Swaps the canvas between the 9:16 battle frame and the 16:9 lab frame. The recording
// canvas has to follow, since it mirrors the same frame at a higher resolution.
function applyLayout(name) {
  if (!setArenaLayout(name)) return;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  resizeRecordCanvas();
}

function layoutForMode(m) {
  return m === "lab" ? "lab" : "portrait";
}

function openSetup() {
  if (isRecording) stopRecording(); // abandon whatever take was in progress, same as a manual reset
  resetPicks();
  // The setup overlay's geometry is authored for the portrait frame, so always show it there
  // regardless of which mode is being configured.
  applyLayout("portrait");
  mode = "setup";
}

function closeSetup() {
  applyLayout(layoutForMode(gameMode));
  mode = "battle";
}

function toggleSetup() {
  if (mode === "setup") closeSetup();
  else openSetup();
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

const SETUP_MODE_1V1_RECT = { x: 130, y: 190, w: 140, h: 40 };
const SETUP_MODE_VSBOSS_RECT = { x: 290, y: 190, w: 140, h: 40 };
const SETUP_MODE_LAB_RECT = { x: 450, y: 190, w: 140, h: 40 };
const SETUP_ROSTER_START_Y = 320;
const SETUP_ROSTER_ROW_H = 70;
const SETUP_ROSTER_CARD = { x: 160, w: 400, h: 54 };

canvas.addEventListener("click", (e) => {
  // The battle screens stay clean and unclickable, but the lab is a tool, not a recording —
  // its panel and dummy placement are the whole point.
  if (mode !== "setup" && !(mode === "battle" && gameMode === "lab")) return;

  // The canvas can be displayed smaller than its drawing buffer (see style.css), so a click's
  // page coordinates need to be rescaled into canvas-space before hit-testing.
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  if (mode === "battle") {
    labClick(x, y);
    return;
  }

  if (pointInRect(x, y, SETUP_MODE_1V1_RECT)) {
    if (gameMode !== "1v1") { gameMode = "1v1"; resetPicks(); }
    return;
  }
  if (pointInRect(x, y, SETUP_MODE_VSBOSS_RECT)) {
    if (gameMode !== "vsboss") { gameMode = "vsboss"; resetPicks(); }
    return;
  }
  if (pointInRect(x, y, SETUP_MODE_LAB_RECT)) {
    if (gameMode !== "lab") { gameMode = "lab"; resetPicks(); }
    return;
  }

  for (let i = 0; i < ROSTER.length; i++) {
    const cardRect = {
      x: SETUP_ROSTER_CARD.x,
      y: SETUP_ROSTER_START_Y + i * SETUP_ROSTER_ROW_H - SETUP_ROSTER_CARD.h / 2,
      w: SETUP_ROSTER_CARD.w,
      h: SETUP_ROSTER_CARD.h,
    };
    if (pointInRect(x, y, cardRect)) {
      if (gameMode === "1v1") pickRosterSlot(i);
      else if (gameMode === "vsboss") pickVsBossSlot(i);
      else {
        // Lab: one pick is all it takes. Switch the frame first, since startLab() places the
        // character using the arena's dimensions.
        applyLayout("lab");
        startLab(i);
        mode = "battle";
      }
      return;
    }
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault(); // don't let the browser cycle focus away from the page
    toggleSetup();
    return;
  }

  if (mode === "setup") return; // everything in setup is mouse-driven
  // R/Y/N are meaningless while parked waiting for a Twitch redemption — there's no in-progress
  // recording or fighters those keys are meant to act on. Tab still works (handled above,
  // unconditionally) to drop into the normal setup screen and regain manual control.
  if (mode === "twitchIdle") return;

  if (gameMode === "lab") {
    // The lab has no rounds to keep or discard — R just restarts the run.
    if (e.key === "r" || e.key === "R") restartLab();
    return;
  }

  if (e.key === "y" || e.key === "Y" || e.key === "n" || e.key === "N") {
    const decision = (e.key === "y" || e.key === "Y") ? "keep" : "discard";
    if (gameMode === "1v1") {
      if (roundState === "prompting" && promptReady) {
        decision === "keep" ? keepRecording() : discardRecording();
      } else if (roundState === "ended" || roundState === "prompting") {
        // fight's over but the recording hasn't finished finalizing yet — remember the
        // choice and apply it the moment it's ready, instead of silently dropping the keypress
        queuedDecision = decision;
      }
    } else {
      if (vsBossState === "prompting" && vsBossPromptReady) {
        decision === "keep" ? keepVsBossRecording() : discardVsBossRecording();
      } else if (vsBossState === "ended" || vsBossState === "prompting") {
        vsBossQueuedDecision = decision;
      }
    }
    return;
  }
  if (e.key === "r" || e.key === "R") {
    if (isRecording) stopRecording(); // mid-round manual reset: throw away this take
    if (gameMode === "1v1") startRound();
    else startVsBossRound();
  }
});

function drawPromptOverlay(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 32px Arial";
  ctx.fillText(winner ? `${winner.name} Wins!` : "Draw!", WIDTH / 2, HEIGHT / 2 - 60);

  ctx.fillStyle = "#ffffff";
  ctx.font = "22px Arial";
  ctx.fillText(promptReady ? "Keep this recording?" : "Finalizing recording…", WIDTH / 2, HEIGHT / 2 + 10);

  if (promptReady) {
    ctx.fillStyle = "#64f064";
    ctx.font = "bold 20px Arial";
    ctx.fillText("[Y] Keep", WIDTH / 2 - 80, HEIGHT / 2 + 50);

    ctx.fillStyle = "#ff6464";
    ctx.fillText("[N] Discard", WIDTH / 2 + 80, HEIGHT / 2 + 50);
  }
}

const VS_BOSS_STEP_LABELS = ["pick ALLY 1", "pick ALLY 2", "pick ALLY 3", "pick the BOSS"];

function drawToggleButton(ctx, rect, label, active) {
  ctx.fillStyle = active ? "#ffdc32" : "rgba(255,255,255,0.12)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = active ? "#ffdc32" : "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = active ? "#1a1a1a" : "rgba(255,255,255,0.85)";
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 6);
}

// One unified setup screen: a mode toggle up top, and whichever roster picker matches the
// currently-toggled mode below it — all clickable, entered/exited only via the Tab key.
function drawSetupOverlay(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.88)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 32px Arial";
  ctx.fillText("Game Setup", WIDTH / 2, 130);

  drawToggleButton(ctx, SETUP_MODE_1V1_RECT, "1v1", gameMode === "1v1");
  drawToggleButton(ctx, SETUP_MODE_VSBOSS_RECT, "VS BOSS", gameMode === "vsboss");
  drawToggleButton(ctx, SETUP_MODE_LAB_RECT, "LAB", gameMode === "lab");

  ctx.font = "16px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("Press Tab to close", WIDTH / 2, 255);

  ctx.font = "18px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  if (gameMode === "1v1") {
    ctx.fillText(
      selectA === null ? "Click a fighter to pick the LEFT side" : "Click a fighter to pick the RIGHT side",
      WIDTH / 2,
      290
    );
  } else if (gameMode === "vsboss") {
    const stepLabel = VS_BOSS_STEP_LABELS[Math.min(vsBossPickStep, 3)];
    ctx.fillText(`Click a fighter to ${stepLabel}`, WIDTH / 2, 290);
  } else {
    ctx.fillText("Click a fighter to test it in the lab", WIDTH / 2, 290);
  }

  ROSTER.forEach((entry, i) => {
    const cy = SETUP_ROSTER_START_Y + i * SETUP_ROSTER_ROW_H;
    const cardY = cy - SETUP_ROSTER_CARD.h / 2;

    let tag = "";
    let color = "rgba(255,255,255,0.85)";
    let cardFill = "rgba(255,255,255,0.06)";
    if (gameMode === "1v1") {
      if (selectA === i) { tag = " (Left)"; color = "#64f064"; cardFill = "rgba(100,240,100,0.12)"; }
      else if (selectB === i) { tag = " (Right)"; color = "#64a0ff"; cardFill = "rgba(100,160,255,0.12)"; }
    } else {
      const slotIndex = vsBossPicks.indexOf(i);
      if (slotIndex === 3) { tag = " (BOSS)"; color = "#ff6464"; cardFill = "rgba(255,100,100,0.12)"; }
      else if (slotIndex !== -1) { tag = ` (Ally ${slotIndex + 1})`; color = "#64f064"; cardFill = "rgba(100,240,100,0.12)"; }
    }

    ctx.fillStyle = cardFill;
    ctx.fillRect(SETUP_ROSTER_CARD.x, cardY, SETUP_ROSTER_CARD.w, SETUP_ROSTER_CARD.h);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(SETUP_ROSTER_CARD.x, cardY, SETUP_ROSTER_CARD.w, SETUP_ROSTER_CARD.h);

    ctx.font = "bold 22px Arial";
    ctx.fillStyle = color;
    ctx.fillText(`${entry.label}${tag}`, WIDTH / 2, cy + 8);
  });
}

const VSBOSS_BOSS_HUD_Y = 170;
const VSBOSS_BOSS_HUD_W = 320;
const VSBOSS_ALLY_HUD_Y = 260;
const VSBOSS_ALLY_HUD_W = 200;
const VSBOSS_ALLY_GAP = 20;

// Stacked top-to-bottom instead of one long line — the combined "allies vs BOSS" title
// easily runs wider than the canvas as a single line once there are 3 ally names in it.
function drawVsBossTitle(ctx) {
  ctx.textAlign = "center";

  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 24px Arial";
  ctx.fillText(allies.map((a) => a.name).join(" + "), WIDTH / 2, 68);

  ctx.fillStyle = "#ff6464";
  ctx.font = "bold 22px Arial";
  ctx.fillText("VS", WIDTH / 2, 102);

  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 34px Arial";
  ctx.fillText(boss.name.toUpperCase(), WIDTH / 2, 144);
}

function drawVsBossHud(ctx) {
  boss.drawHud(ctx, WIDTH / 2 - VSBOSS_BOSS_HUD_W / 2, VSBOSS_BOSS_HUD_Y, VSBOSS_BOSS_HUD_W);

  const totalW = allies.length * VSBOSS_ALLY_HUD_W + (allies.length - 1) * VSBOSS_ALLY_GAP;
  let x = WIDTH / 2 - totalW / 2;
  for (const ally of allies) {
    ally.drawHud(ctx, x, VSBOSS_ALLY_HUD_Y, VSBOSS_ALLY_HUD_W);
    x += VSBOSS_ALLY_HUD_W + VSBOSS_ALLY_GAP;
  }
}

function drawVsBossPromptOverlay(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 32px Arial";
  const title =
    vsBossWinner === "allies" ? "Allies Win!" :
    vsBossWinner === "boss" ? `${boss.name} (BOSS) Wins!` :
    "Draw!";
  ctx.fillText(title, WIDTH / 2, HEIGHT / 2 - 60);

  ctx.fillStyle = "#ffffff";
  ctx.font = "22px Arial";
  ctx.fillText(vsBossPromptReady ? "Keep this recording?" : "Finalizing recording…", WIDTH / 2, HEIGHT / 2 + 10);

  if (vsBossPromptReady) {
    ctx.fillStyle = "#64f064";
    ctx.font = "bold 20px Arial";
    ctx.fillText("[Y] Keep", WIDTH / 2 - 80, HEIGHT / 2 + 50);

    ctx.fillStyle = "#ff6464";
    ctx.fillText("[N] Discard", WIDTH / 2 + 80, HEIGHT / 2 + 50);
  }
}

startRound();

let lastTime = 0;
function render(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  // Hit-stop: hold the entire simulation — fighters, collisions, particles, the lot — perfectly
  // still for a few frames after a heavy blow, then let it all resume at once. Everything still
  // DRAWS every frame (the freeze has to be visible, not a dropped frame); only the advancing of
  // time is suspended. The shake and the screen flash deliberately keep running underneath, so
  // the frozen image is a rattling, blown-out one rather than a dead pause.
  const frozen = hitStopTimer > 0;
  if (frozen) hitStopTimer -= dt;

  if (!frozen && gameMode === "1v1" && mode === "battle" && (roundState === "playing" || roundState === "ended")) {
    // A fighter that's currently untrackable (e.g. one hidden in its own smoke) is excluded
    // entirely — their own targeting/aiming already knows how to handle "no opponent" (same
    // path as a dead one), so this alone is enough to make them lose track of it without
    // touching any individual character's code. Extra bodies (e.g. the Ninja's shadow clone)
    // are folded in as equally valid targets — the opponent aims at whichever of the fighter
    // and its extras is nearest. A dead fighter itself is filtered out of its own target list
    // (getExtraBodies() already only returns living extras) so a still-fighting clone doesn't
    // lose the opponent's attention to its dead original's corpse.
    const aExtra = fighterA.getExtraBodies();
    const bExtra = fighterB.getExtraBodies();
    const aTargets = fighterA.isInvisibleToOpponents ? [] : [fighterA, ...aExtra].filter((t) => t.alive);
    const bTargets = fighterB.isInvisibleToOpponents ? [] : [fighterB, ...bExtra].filter((t) => t.alive);

    fighterA.update(dt, bTargets.length ? nearestTo(fighterA, bTargets) : null);
    fighterB.update(dt, aTargets.length ? nearestTo(fighterB, aTargets) : null);

    resolveCollision(fighterA, fighterB);
    for (const extra of aExtra) resolveCollision(fighterB, extra);
    for (const extra of bExtra) resolveCollision(fighterA, extra);

    checkWinner();
    updateParticles(dt);
    updateFlashes(dt);
    updateSmokePuffs(dt);
    updateWallCracks(dt);
    updateDamageNumbers(dt);
  }

  if (!frozen && gameMode === "vsboss" && mode === "battle" && (vsBossState === "playing" || vsBossState === "ended")) {
    // Same "pass null instead" trick as 1v1 — a currently-invisible ally is excluded from the
    // boss's own targeting, and if the boss itself were ever invisible, allies would lose
    // track of it too.
    const targetableAllies = allies.filter((a) => a.alive && !a.isInvisibleToOpponents);
    const target = targetableAllies.length ? nearestTo(boss, targetableAllies) : null;
    boss.update(dt, target);
    const bossTarget = boss.isInvisibleToOpponents ? null : boss;
    for (const ally of allies) ally.update(dt, bossTarget);

    resolveCollision(boss, allies[0]);
    resolveCollision(boss, allies[1]);
    resolveCollision(boss, allies[2]);
    resolveCollision(allies[0], allies[1]);
    resolveCollision(allies[0], allies[2]);
    resolveCollision(allies[1], allies[2]);

    checkVsBossWinner();
    updateParticles(dt);
    updateFlashes(dt);
    updateSmokePuffs(dt);
    updateWallCracks(dt);
    updateDamageNumbers(dt);
  }

  if (!frozen && gameMode === "lab" && mode === "battle") labUpdate(dt);

  // Runs even while frozen — see the hit-stop note above.
  updateSpeedLines(dt);

  let shakeX = 0, shakeY = 0;
  shakeRoll = 0;
  if (shakeTimer > 0) {
    shakeTimer -= dt;
    shakeX = (Math.random() * 2 - 1) * shakeMagnitude;
    shakeY = (Math.random() * 2 - 1) * shakeMagnitude;
    // A slight twist on top of the slide — the frame rocking as well as sliding is what makes
    // a big hit land physically instead of just jittering. Scaled well down from the positional
    // shake so it never reads as the camera spinning.
    shakeRoll = (Math.random() * 2 - 1) * shakeMagnitude * 0.0016;
    shakeMagnitude *= 0.9;
    if (shakeTimer <= 0) shakeMagnitude = 0;
  }

  // The entire visual frame, parameterized over the target context — called once for the
  // on-screen canvas and, while recording, a second time (pre-scaled) onto the higher-res
  // recording canvas, so the saved video isn't just an upscaled blur of the 720x1280 display.
  function drawFrame(c) {
    drawBackground(c);

    const combatants = gameMode === "1v1" ? [fighterA, fighterB] : (boss ? [boss, ...allies] : []);
    // A character celebrating victory can request the whole scene get pushed in on it — a real
    // camera zoom (everything scales together around a focus point), not just itself drawn
    // bigger — see Character.victoryCameraZoom (default null) and Ninja's override.
    let cameraZoom = null;
    for (const f of combatants) {
      if (f.victoryCameraZoom) { cameraZoom = f.victoryCameraZoom; break; }
    }

    const isolate = !!(cameraZoom && cameraZoom.isolate);

    c.save();
    c.translate(shakeX, shakeY);
    if (shakeRoll !== 0) {
      // Rotate about the frame's centre, so the whole picture rocks rather than swinging
      // around some arbitrary corner.
      c.translate(WIDTH / 2, HEIGHT / 2);
      c.rotate(shakeRoll);
      c.translate(-WIDTH / 2, -HEIGHT / 2);
    }
    if (cameraZoom) {
      // Maps world point (anchorX, anchorY) to screen point (panX, panY) at the given scale —
      // NOT just "scale around a fixed point" (that would leave the subject wherever it already
      // was on screen). Letting pan and anchor differ is what lets Ninja's victory camera both
      // center the subject on screen and, later, hold the view still while the subject itself
      // dashes out from under it (see Ninja.victoryCameraZoom).
      c.translate(cameraZoom.panX, cameraZoom.panY);
      c.scale(cameraZoom.scale, cameraZoom.scale);
      c.translate(-cameraZoom.anchorX, -cameraZoom.anchorY);
    }
    if (isolate) {
      // A stark "to be continued" freeze-frame: just the one subject on the background — no
      // arena, no other fighter, no wall cracks/damage numbers cluttering it up. subject can be
      // null (e.g. Ninja's "black" victory phase, once it's dashed off for good) — the isolated
      // dark hold still needs to keep rendering with nothing left to draw in it.
      if (cameraZoom.subject) cameraZoom.subject.draw(c);
      drawParticles(c);
      drawFlashes(c);
      drawSmokePuffs(c);
    } else {
      drawArena(c);
      drawWallCracks(c);
      if (gameMode === "lab") {
        labDraw(c);
      } else if (gameMode === "1v1") {
        fighterA.draw(c);
        fighterB.draw(c);
      } else if (boss) {
        boss.draw(c);
        for (const ally of allies) ally.draw(c);
      }
      drawParticles(c);
      drawFlashes(c);
      drawSmokePuffs(c);
      drawDamageNumbers(c);
    }
    c.restore();

    if (isolate) {
      // Fixed in screen space (drawn after the restore, so the zoom doesn't stretch it) —
      // darkens the edges to pull all the focus onto the subject, cliffhanger-panel style.
      const vignette = c.createRadialGradient(
        WIDTH / 2, HEIGHT / 2, Math.min(WIDTH, HEIGHT) * 0.25,
        WIDTH / 2, HEIGHT / 2, Math.max(WIDTH, HEIGHT) * 0.72
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.75)");
      c.fillStyle = vignette;
      c.fillRect(0, 0, WIDTH, HEIGHT);
    } else {
      if (gameMode === "lab") {
        c.fillStyle = "#ffdc32";
        c.font = "bold 30px Arial";
        c.textAlign = "center";
        c.fillText(`LAB — ${labFighter ? labFighter.name : "-"}`, ARENA.x + ARENA.w / 2, 58);
        labDrawPanel(c);
      } else if (gameMode === "1v1") {
        drawTitle(c, matchTitle);
      } else if (boss) {
        drawVsBossTitle(c);
      }

      if (gameMode === "1v1") {
        fighterA.drawHud(c, HUD_MARGIN, HUD_Y, HUD_W);
        fighterB.drawHud(c, WIDTH - HUD_MARGIN - HUD_W, HUD_Y, HUD_W);
      } else if (gameMode === "vsboss" && boss) {
        drawVsBossHud(c);
      }
    }

    // Some characters (e.g. the Demon) have a fullscreen victory animation — draw it above
    // everything else so far, but still under the keep/discard prompt so that stays usable.
    for (const f of combatants) {
      if (f.celebratingVictory && typeof f.drawVictoryOverlay === "function") f.drawVictoryOverlay(c);
    }

    // Screen-space, over the scene and HUD but under the interactive overlays so those stay
    // readable — see spawnSpeedLines in particles.js.
    drawSpeedLines(c);

    if (gameMode === "1v1" && mode === "battle" && roundState === "prompting") drawPromptOverlay(c);
    if (gameMode === "vsboss" && mode === "battle" && vsBossState === "prompting") drawVsBossPromptOverlay(c);
    if (mode === "setup") drawSetupOverlay(c);
    if (mode === "twitchIdle") drawTwitchIdleOverlay(c);
  }

  drawFrame(ctx);

  if (isRecording) {
    recordCtx.save();
    recordCtx.setTransform(RECORD_SCALE, 0, 0, RECORD_SCALE, 0, 0);
    drawFrame(recordCtx);
    recordCtx.restore();
  }

  if (gameMode === "1v1" && mode === "battle" && roundState === "ended") {
    endTimer += dt;
    if (endTimer >= ROUND_END_GRACE) {
      if (twitchRoundActive) {
        // No recording was ever started for this round (see triggerTwitchBattle), and there's
        // nobody at the keyboard to answer a keep/discard prompt mid-stream — skip "prompting"
        // entirely and drop straight back into the waiting screen for the next redemption.
        twitchRoundActive = false;
        mode = "twitchIdle";
      } else {
        roundState = "prompting";
        stopRecording().then((blob) => {
          pendingBlob = blob;
          promptReady = true;
          if (queuedDecision === "keep") keepRecording();
          else if (queuedDecision === "discard") discardRecording();
        });
      }
    }
  }

  if (gameMode === "vsboss" && mode === "battle" && vsBossState === "ended") {
    vsBossEndTimer += dt;
    if (vsBossEndTimer >= ROUND_END_GRACE) {
      vsBossState = "prompting";
      stopRecording().then((blob) => {
        vsBossPendingBlob = blob;
        vsBossPromptReady = true;
        if (vsBossQueuedDecision === "keep") keepVsBossRecording();
        else if (vsBossQueuedDecision === "discard") discardVsBossRecording();
      });
    }
  }

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
