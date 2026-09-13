const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const CORNER_MARGIN = ARENA_BORDER + 10;
const ROUND_END_GRACE = 3.0; // seconds after a winner is decided before we cut the recording

// The full cast: each entry builds a brand-new instance so every round starts from a clean,
// canonical state (the constructor is the only source of truth — no parallel reset logic to
// keep in sync with it). `excludeFromTwitch: true` keeps an entry pickable in the normal manual
// setup screen while leaving it out of triggerTwitchBattle()'s random draw — for a character
// that's still new/untested and not meant to show up unannounced on someone's stream yet.
// `excludeFromDraw: true` is the separate opt-out for the 5-a-side lineup draw (see team5.js) —
// a character that would simply decide the match on its own rather than one that is untested.
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
  { label: "Fire Mage", ctor: () => new FireMage(0, 0), excludeFromTwitch: true },
  // Out of the 5v5 draw as well: 94% overall and no matchup below 83% (Archer is not balanced
  // against anything). Drawn into a squad it would just be the answer to that whole side.
  { label: "Archer", ctor: () => new Archer(0, 0), excludeFromTwitch: true, excludeFromDraw: true },
  { label: "Troll", ctor: () => new Troll(0, 0) },
  { label: "Earth Mage", ctor: () => new EarthMage(0, 0) },
  // Brand new and not balance-tested yet, so kept out of the Twitch random draw for now —
  // same treatment every character gets until its numbers have been measured.
  { label: "Angel", ctor: () => new Angel(0, 0) },
  // Brand new and not balance-tested yet, so kept out of the Twitch random draw for now.
  { label: "Poop Man", ctor: () => new PoopMan(0, 0), excludeFromTwitch: true },
];

let gameMode = "1v1"; // "1v1" | "vsboss" | "team5" | "lab" — which mode the setup screen has toggled

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

// HUD_Y itself now lives in arena.js (a `let`, updated by setArenaLayout alongside WIDTH/HEIGHT/
// ARENA/TITLE_Y) since the compact "twitch" layout needs its own tighter value — see there.
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
// [P] freezes everything. Deliberately reuses the hit-stop freeze below rather than inventing a
// second suspension path: that gate already stops fighters, collisions, particles and abilities
// while still DRAWING every frame, which is exactly what a pause is — just held open until the
// key is pressed again instead of for a few frames.
//
// Draws NOTHING of its own: no overlay, no dimming, no label. The battlefield simply stops, which
// keeps a paused frame usable as-is for a screenshot or an OBS source.
let paused = false;
let twitchRoundActive = false; // true for the duration of a round started by triggerTwitchBattle() — see that function and the "ended" handling below

let shakeMagnitude = 0;
let shakeTimer = 0;
let shakeRoll = 0; // current rotational kick (radians) — big hits twist the frame, not just slide it
let shakeAngle = 0; // the axis this kick rings along, picked once per shake event
let shakePhase = 0; // advances with TIME, so consecutive frames are points on one continuous path

// The shake used to be white noise: a fresh (Math.random()*2-1) * magnitude offset every frame,
// uncorrelated with the last one. At magnitude 15 that put up to 30px of jump between
// consecutive frames in a random direction, which the eye cannot integrate into motion — it
// reads as the picture stuttering, not as a camera being hit. It rings down along one axis now.
const SHAKE_FREQ  = 38;      // rad/s. Fast enough to rattle, slow enough for the eye to track.
const SHAKE_DECAY = 0.0009;  // per second; pow(SHAKE_DECAY, 1/60) == 0.89, matching the old feel

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

// `sustained` marks a CONTINUOUS tremor — something that calls this every frame for as long as
// it lasts (the Archer's sun falling, its five-second draw, PM2's victory windup) rather than a
// one-off blow. Those must not arm hit-stop. triggerHitStop takes the max of the current and
// new timers, so a per-frame caller re-armed the freeze every single frame: the freeze blocks
// the simulation, the frozen frame therefore never calls triggerShake again, the timer drains,
// one frame of simulation runs, and it re-arms. Measured on the sun's descent, that advanced
// the game on roughly one frame in six and stretched a 1.7s phase to nine real seconds.
// Everything else about the shake — magnitude, duration, the speed lines — is unchanged.
function triggerShake(magnitude, duration, sustained = false) {
  // A fresh axis only when nothing is still ringing. Deliberately NOT keyed off the incoming
  // magnitude: the per-frame callers (the Archer's sun, PM2's victory windup) pass the same
  // value every frame, and since the magnitude decays between frames any "is this bigger?" test
  // is true every frame — which would re-randomise the axis every frame and put the white noise
  // straight back. Blows landing inside an existing shake just top up its magnitude, which is
  // what gives them their punch, and the oscillation stays continuous.
  if (shakeTimer <= 0) {
    shakeAngle = Math.random() * Math.PI * 2;
    shakePhase = Math.PI / 2; // start at full deflection — an impact snaps, it doesn't ease in
  }
  shakeMagnitude = Math.max(shakeMagnitude, magnitude);
  shakeTimer = Math.max(shakeTimer, duration);
  // Scales in from nothing at the threshold up to the cap at magnitude ~20 (the heaviest
  // finishers in the game: PM2's wall slam, the Ninja's third slash).
  if (!sustained && magnitude >= HITSTOP_MIN_MAGNITUDE) {
    const k = Math.min(1, (magnitude - HITSTOP_MIN_MAGNITUDE) / 14);
    triggerHitStop(0.03 + k * (HITSTOP_MAX_SECONDS - 0.03));
    // Finisher weight only (ultimates, wall slams) — not ordinary trades. There is deliberately
    // no full-screen flash here: washing the whole frame white on every heavy hit was harsh to
    // watch over a full match. The freeze, the shake and the local impact effects carry it.
    if (magnitude >= 14) spawnSpeedLines();
  }
}

// Painter's-algorithm order for everything that stands on the arena floor: whatever is LOWER on
// screen is nearer the camera, so it is drawn last and occludes what is behind it.
//
// This takes the fighters AND every upright prop they own (see Character.getDepthItems — the
// Bomber's bombs, the Earth Mage's pillars) and puts them all in ONE sorted pass. Three fixed
// layers cannot express this: anything solid standing on the floor has to be able to land either
// side of a fighter depending on where it actually is, and pinning it to a layer guarantees it
// looks wrong from one side. Flat floor decals are the exception and stay in the pass underneath
// (drawGroundEffects) — you stand ON lava, so it is always under you.
function collectDepthItems(fighters) {
  const items = [];
  for (const f of fighters) {
    if (!f) continue;
    items.push({ depthY: f.y, draw: (c) => f.draw(c) });
    if (typeof f.getDepthItems === "function") {
      for (const it of f.getDepthItems()) items.push(it);
    }
  }
  return items.sort((a, b) => a.depthY - b.depthY);
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
  if (fighterA.blocksRoundEnd || fighterB.blocksRoundEnd) return;

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
  // Stone pillars are registered globally so projectiles can be blocked by them without knowing
  // who put them there (see combat.js). They belong to the round that made them.
  clearWorldObstacles();
  // Fire Mage's lava ambience is a looping audio node owned outside any one character (see
  // firemage.js). The mage that started it is about to be thrown away, and if the new round
  // doesn't happen to include a Fire Mage there'd be nothing left that could ever stop it.
  stopFiremageLavaLoop();
  // Same idea for any of THIS Demon's tridents still whooshing through the air — see
  // Demon.stopAllTridentSounds. Optional per-character hook, so this no-ops for anyone else.
  if (typeof fighterA.stopAllTridentSounds === "function") fighterA.stopAllTridentSounds();
  if (typeof fighterB.stopAllTridentSounds === "function") fighterB.stopAllTridentSounds();
  // Same idea for an Earth Mage pillar caught mid-rise — its rockslide loop is owned by a pillar
  // on a mage that is about to be discarded, so nothing else could ever stop it.
  if (typeof fighterA.stopAllPillarSounds === "function") fighterA.stopAllPillarSounds();
  if (typeof fighterB.stopAllPillarSounds === "function") fighterB.stopAllPillarSounds();
  // And the Angel's rite, which loops for as long as its five spirits are walking the ring.
  if (typeof fighterA.stopAllRiteSounds === "function") fighterA.stopAllRiteSounds();
  if (typeof fighterB.stopAllRiteSounds === "function") fighterB.stopAllRiteSounds();
  // Poop Man's spray voice is 3.29s long and a round can easily end in the middle of one.
  if (typeof fighterA.stopAllPoopSounds === "function") fighterA.stopAllPoopSounds();
  if (typeof fighterB.stopAllPoopSounds === "function") fighterB.stopAllPoopSounds();
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
  const eligible = ROSTER.map((r, i) => i).filter((i) => !ROSTER[i].excludeFromTwitch);
  let a = eligible[Math.floor(Math.random() * eligible.length)];
  let b;
  do { b = eligible[Math.floor(Math.random() * eligible.length)]; } while (b === a);
  pickA = a;
  pickB = b;

  twitchRoundActive = true;
  mode = "battle";
  applyLayout("twitch"); // defensive — should already be set by enterTwitchIdle(), the only path here
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
  // Same wipe 1v1's reset() does, and for the same reason: pillars left registered by the last
  // round's Earth Mage would go on blocking projectiles in this one with nothing on screen to
  // explain it. See clearWorldObstacles in combat.js.
  clearWorldObstacles();
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
  if (all.some((f) => f.blocksRoundEnd)) return;

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
  // Prefilled with a random ten rather than blanked, so the relay is one click away from
  // running — picking all ten by hand is optional, not a toll gate. See team5.js.
  resetTeam5Picks();
}

function pickTeam5Slot(index) {
  if (mode !== "setup" || gameMode !== "team5" || index < 0 || index >= ROSTER.length) return;
  // A fighter already sitting in another slot is moved, not duplicated — clicking through the
  // ten slots with the random prefill in place would otherwise stall on every repeat.
  const existing = team5Picks.indexOf(index);
  if (existing !== -1 && existing !== team5PickStep) {
    team5Picks[existing] = team5Picks[team5PickStep];
  }
  team5Picks[team5PickStep] = index;
  team5PickStep++;
  if (team5PickStep >= TEAM5_SIZE * 2) {
    team5PickStep = 0;
    closeSetup();          // NOT a bare mode = "battle": the relay needs the 16:9 canvas
    // Reveal, but do NOT reroll: these are the ten that were just picked by hand, and they get
    // the same walk-onto-the-boards opening a random draw gets.
    startTeam5Round(true, false);
  }
}

// Swaps the canvas between the 9:16 battle frame and the 16:9 lab frame. The recording
// canvas has to follow, since it mirrors the same frame at a higher resolution.
function applyLayout(name) {
  if (!setArenaLayout(name)) return;
  // WIDTH/HEIGHT are LOGICAL; the backing store is that times the layout's zoom, and render()
  // puts a matching scale() on the context so every drawing call stays in logical units.
  const z = layoutZoom();
  canvas.width = WIDTH * z;
  canvas.height = HEIGHT * z;
  resizeRecordCanvas();
}

function layoutForMode(m) {
  if (m === "lab") return "lab";
  // The relay is the one battle mode authored for a 16:9 frame — see team5.js. The royale wants
  // the same floor for a different reason: fifteen bodies at once need the room.
  if (m === "team5") return "landscape";
  if (m === "royale") return "landscape";
  return "portrait";
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

// Six buttons across a 720-wide frame, narrowed again to keep them on one row: 6 x 96 plus
// five 4px gaps is 596, centred leaves 62 either side. "GAUNTLET" is the longest label and
// measures about 80px at the 16px bold the buttons use, so it still clears 96.
const SETUP_MODE_1V1_RECT = { x: 62, y: 190, w: 96, h: 40 };
const SETUP_MODE_VSBOSS_RECT = { x: 162, y: 190, w: 96, h: 40 };
const SETUP_MODE_TEAM5_RECT = { x: 262, y: 190, w: 96, h: 40 };
const SETUP_MODE_GAUNTLET_RECT = { x: 362, y: 190, w: 96, h: 40 };
const SETUP_MODE_ROYALE_RECT = { x: 462, y: 190, w: 96, h: 40 };
const SETUP_MODE_LAB_RECT = { x: 562, y: 190, w: 96, h: 40 };
// 5v5 only: skips the ten-slot picker entirely and runs the lineup draw on screen — see team5.js.
// Bottom edge at 272, clearing the picker hint that follows at baseline 292 (which itself has
// to stay clear of the first roster card's top edge at 293).
const SETUP_DRAW_RECT = { x: 210, y: 240, w: 300, h: 32 };
const SETUP_ROSTER_START_Y = 320;
const SETUP_ROSTER_ROW_H = 70;      // the pitch it PREFERS — see setupRowPitch
const SETUP_ROSTER_CARD = { x: 160, w: 400, h: 54 };
const SETUP_ROSTER_BOTTOM_PAD = 24;

// The picker's pitch, tightened as far as it has to be to fit the whole cast on the 9:16 setup
// screen. It used to be a flat 70, which was fine for the roster this screen was written for and
// silently stopped working as characters were added: the 15th sat at y=1300 on a 1280-tall
// canvas, so it was drawn off the bottom edge AND hit-tested there, which is why it could not be
// clicked. Deriving it means the next character to be added cannot fall off the same way.
function setupRowPitch() {
  const avail = HEIGHT - SETUP_ROSTER_START_Y - SETUP_ROSTER_BOTTOM_PAD;
  return Math.min(SETUP_ROSTER_ROW_H, avail / Math.max(1, ROSTER.length));
}

function setupRowY(i) {
  return SETUP_ROSTER_START_Y + i * setupRowPitch();
}

// Shrinks with the pitch so the cards never overlap once the list is tight.
function setupCardH() {
  return Math.min(SETUP_ROSTER_CARD.h, setupRowPitch() - 8);
}

canvas.addEventListener("click", (e) => {
  // The battle screens stay clean and unclickable, but the lab is a tool, not a recording —
  // its panel and dummy placement are the whole point.
  if (mode !== "setup" && !(mode === "battle" && gameMode === "lab")) return;

  // The canvas can be displayed smaller than its drawing buffer (see style.css), so a click's
  // page coordinates need to be rescaled into canvas-space before hit-testing.
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  // ...and then back out of the layout zoom, since every rect below is in logical units.
  const z = layoutZoom();
  const x = (e.clientX - rect.left) * scaleX / z;
  const y = (e.clientY - rect.top) * scaleY / z;

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
  if (gameMode === "team5" && pointInRect(x, y, SETUP_DRAW_RECT)) {
    closeSetup();          // NOT a bare mode = "battle": the relay needs the 16:9 canvas
    startTeam5Round(true);
    return;
  }
  if (pointInRect(x, y, SETUP_MODE_TEAM5_RECT)) {
    if (gameMode !== "team5") { gameMode = "team5"; resetPicks(); }
    return;
  }
  if (pointInRect(x, y, SETUP_MODE_ROYALE_RECT)) {
    // Nothing to pick — everybody is in it. Selecting the mode IS the setup.
    gameMode = "royale";
    resetPicks();
    closeSetup();
    startRoyaleRound();
    return;
  }
  if (pointInRect(x, y, SETUP_MODE_GAUNTLET_RECT)) {
    if (gameMode !== "gauntlet") { gameMode = "gauntlet"; resetPicks(); }
    return;
  }
  if (pointInRect(x, y, SETUP_MODE_LAB_RECT)) {
    if (gameMode !== "lab") { gameMode = "lab"; resetPicks(); }
    return;
  }

  for (let i = 0; i < ROSTER.length; i++) {
    const cardRect = {
      x: SETUP_ROSTER_CARD.x,
      y: setupRowY(i) - setupCardH() / 2,
      w: SETUP_ROSTER_CARD.w,
      h: setupCardH(),
    };
    if (pointInRect(x, y, cardRect)) {
      if (gameMode === "1v1") pickRosterSlot(i);
      else if (gameMode === "vsboss") pickVsBossSlot(i);
      else if (gameMode === "team5") pickTeam5Slot(i);
      else if (gameMode === "gauntlet") {
        // One pick is the whole setup: everybody else IS the opposition.
        closeSetup();
        startGauntletRun(i);
      }
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

  // Before the mode guards below, so it works in 1v1, VS BOSS and the lab alike. Not while
  // parked on the Twitch idle screen or in setup — there is no action there to pause.
  if (e.key === "p" || e.key === "P") {
    if (mode === "battle") paused = !paused;
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
    if (gameMode === "team5") {
      if (team5State === "prompting" && team5PromptReady) {
        decision === "keep" ? keepTeam5Recording() : discardTeam5Recording();
      } else if (team5State === "ended" || team5State === "prompting") {
        team5QueuedDecision = decision;
      }
    } else if (gameMode === "royale") {
      if (royaleState === "prompting" && royalePromptReady) {
        decision === "keep" ? keepRoyaleRecording() : discardRoyaleRecording();
      } else if (royaleState === "ended" || royaleState === "prompting") {
        royaleQueuedDecision = decision;
      }
    } else if (gameMode === "gauntlet") {
      if (gauntletState === "prompting" && gauntletPromptReady) {
        decision === "keep" ? keepGauntletRecording() : discardGauntletRecording();
      } else if (gauntletState === "ended" || gauntletState === "prompting") {
        gauntletQueuedDecision = decision;
      }
    } else if (gameMode === "1v1") {
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
    else if (gameMode === "team5") startTeam5Round(true, false);   // same ten, revealed again
    else if (gameMode === "gauntlet") startGauntletRun(gauntletHeroIdx);  // same challenger, fresh order
    else if (gameMode === "royale") startRoyaleRound();
    else startVsBossRound();
  }
  // A fresh lineup draw, without going back through the setup screen.
  if ((e.key === "d" || e.key === "D") && gameMode === "team5") {
    if (isRecording) stopRecording();
    startTeam5Round(true);
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
  drawToggleButton(ctx, SETUP_MODE_TEAM5_RECT, "5v5", gameMode === "team5");
  drawToggleButton(ctx, SETUP_MODE_GAUNTLET_RECT, "GAUNTLET", gameMode === "gauntlet");
  drawToggleButton(ctx, SETUP_MODE_ROYALE_RECT, "ROYALE", gameMode === "royale");
  drawToggleButton(ctx, SETUP_MODE_LAB_RECT, "LAB", gameMode === "lab");

  if (gameMode === "team5") {
    drawToggleButton(ctx, SETUP_DRAW_RECT, "AUTO-DRAW BOTH SQUADS", false);
  } else {
    ctx.font = "16px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("Press Tab to close", WIDTH / 2, 255);
  }

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
  } else if (gameMode === "team5") {
    const team = team5PickStep < TEAM5_SIZE ? "A" : "B";
    const slot = (team5PickStep % TEAM5_SIZE) + 1;
    ctx.fillText(`…or click a fighter for TEAM ${team} slot ${slot}`, WIDTH / 2, 292);
  } else if (gameMode === "royale") {
    ctx.fillText("Everyone is in — pick ROYALE again to re-roll", WIDTH / 2, 290);
  } else if (gameMode === "gauntlet") {
    ctx.fillText("Click a fighter to send it against the whole roster", WIDTH / 2, 290);
  } else {
    ctx.fillText("Click a fighter to test it in the lab", WIDTH / 2, 290);
  }

  ROSTER.forEach((entry, i) => {
    const cy = setupRowY(i);
    const cardH = setupCardH();
    const cardY = cy - cardH / 2;

    let tag = "";
    let color = "rgba(255,255,255,0.85)";
    let cardFill = "rgba(255,255,255,0.06)";
    if (gameMode === "1v1") {
      if (selectA === i) { tag = " (Left)"; color = "#64f064"; cardFill = "rgba(100,240,100,0.12)"; }
      else if (selectB === i) { tag = " (Right)"; color = "#64a0ff"; cardFill = "rgba(100,160,255,0.12)"; }
    } else if (gameMode === "team5") {
      const slotIndex = team5Picks.indexOf(i);
      if (slotIndex !== -1) {
        const teamA = slotIndex < TEAM5_SIZE;
        tag = ` (${teamA ? "A" : "B"}${(slotIndex % TEAM5_SIZE) + 1})`;
        color = teamA ? TEAM5_A_COLOR : TEAM5_B_COLOR;
        cardFill = teamA ? "rgba(100,240,100,0.12)" : "rgba(100,160,255,0.12)";
      }
    } else {
      const slotIndex = vsBossPicks.indexOf(i);
      if (slotIndex === 3) { tag = " (BOSS)"; color = "#ff6464"; cardFill = "rgba(255,100,100,0.12)"; }
      else if (slotIndex !== -1) { tag = ` (Ally ${slotIndex + 1})`; color = "#64f064"; cardFill = "rgba(100,240,100,0.12)"; }
    }

    ctx.fillStyle = cardFill;
    ctx.fillRect(SETUP_ROSTER_CARD.x, cardY, SETUP_ROSTER_CARD.w, cardH);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(SETUP_ROSTER_CARD.x, cardY, SETUP_ROSTER_CARD.w, cardH);

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

  // Keeps the page's own background in sync with `mode` every frame — cheap, and correct
  // regardless of which of the several places mode can flip into/out of "twitchIdle" actually
  // did it, rather than needing that toggle sprinkled at every one of those call sites. Paired
  // with drawFrame()'s early-out for "twitchIdle" (clears the canvas instead of drawing anything)
  // so an OBS Browser Source is genuinely transparent — showing the stream underneath — while
  // idle, and only opaque while an actual battle is on screen. See style.css.
  document.documentElement.classList.toggle("twitch-transparent", mode === "twitchIdle");

  // Hit-stop: hold the entire simulation — fighters, collisions, particles, the lot — perfectly
  // still for a few frames after a heavy blow, then let it all resume at once. Everything still
  // DRAWS every frame (the freeze has to be visible, not a dropped frame); only the advancing of
  // time is suspended. The shake and the screen flash deliberately keep running underneath, so
  // the frozen image is a rattling, blown-out one rather than a dead pause.
  const frozen = paused || hitStopTimer > 0;
  // A pause must not eat the hit-stop it was pressed during — the freeze picks up where it left
  // off on unpause, rather than having quietly drained while nothing was moving.
  if (!paused && hitStopTimer > 0) hitStopTimer -= dt;

  if (!frozen && gameMode === "team5" && mode === "battle" && team5State === "drawing") {
    team5UpdateDraw(dt);
    updateParticles(dt);
    updateFlashes(dt);
    updateSmokePuffs(dt);
  }

  // The relay runs on this same block on purpose — it is two fighters in an arena, exactly
  // like 1v1, and only the question of who gets sent in next differs. See team5.js.
  const relaySim = gameMode === "team5"
    && (team5State === "playing" || team5State === "swapping" || team5State === "ended");
  // ...and so does the gauntlet, for the same reason: one challenger and one opponent in an
  // arena is a duel, and only who arrives next differs. See gauntlet.js.
  const gauntletSim = gameMode === "gauntlet"
    && (gauntletState === "playing" || gauntletState === "swapping" || gauntletState === "ended");
  if (!frozen && (relaySim || gauntletSim
                  || (gameMode === "1v1" && (roundState === "playing" || roundState === "ended")))
      && mode === "battle") {
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

    // Solid bodies owned by a character — currently only Poop Man's boulder — separate everyone
    // AFTER every body has finished moving for the frame. Doing it inside the owner's own update
    // is too early: the opponent has not moved yet at that point, and it walks straight back into
    // the thing in the same frame, so the separation is invisible and the overlap is real.
    // Optional hook, so this no-ops for the other fourteen characters.
    const allBodies = [fighterA, fighterB, ...aExtra, ...bExtra];
    for (const f of [fighterA, fighterB]) {
      if (typeof f.resolveSolids === "function") f.resolveSolids(dt, allBodies);
    }

    if (relaySim) team5Tick(dt);
    else if (gauntletSim) gauntletTick(dt);
    else checkWinner();
    updateParticles(dt);
    updateFlashes(dt);
    updateSmokePuffs(dt);
    updateWallCracks(dt);
    updateDamageNumbers(dt);
  }

  if (!frozen && gameMode === "royale" && mode === "battle"
      && (royaleState === "playing" || royaleState === "ended")) {
    royaleUpdate(dt);
    royaleTick();
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

    // Solid bodies owned by a character — currently only Poop Man's boulder — separate everyone
    // AFTER every body has finished moving for the frame. Doing it inside the owner's own update
    // is too early: the opponent has not moved yet at that point, and it walks straight back into
    // the thing in the same frame, so the separation is invisible and the overlap is real.
    // Optional hook, so this no-ops for the other fourteen characters.
    const bossBodies = [boss, ...allies];
    for (const f of bossBodies) {
      if (typeof f.resolveSolids === "function") f.resolveSolids(dt, bossBodies);
    }

    checkVsBossWinner();
    updateParticles(dt);
    updateFlashes(dt);
    updateSmokePuffs(dt);
    updateWallCracks(dt);
    updateDamageNumbers(dt);
  }

  if (!frozen && gameMode === "lab" && mode === "battle") labUpdate(dt);

  // Runs even while frozen — see the hit-stop note above.
  if (!paused) updateSpeedLines(dt);

  let shakeX = 0, shakeY = 0;
  shakeRoll = 0;
  // Frozen with everything else: a screen still rattling over a stopped fight reads as a bug,
  // not as a pause. (Hit-stop deliberately does the opposite and keeps shaking — see above.)
  if (shakeTimer > 0 && !paused) {
    shakeTimer -= dt;
    shakePhase += dt * SHAKE_FREQ;
    // A damped oscillation along shakeAngle, with a slower wobble across it so it isn't a dead
    // straight line. Consecutive frames are now neighbouring points on one path instead of two
    // unrelated random offsets.
    const swing = Math.sin(shakePhase);
    const cross = Math.sin(shakePhase * 0.63 + 1.1) * 0.42;
    const ca = Math.cos(shakeAngle), sa = Math.sin(shakeAngle);
    shakeX = (ca * swing - sa * cross) * shakeMagnitude;
    shakeY = (sa * swing + ca * cross) * shakeMagnitude;
    // A slight twist on top of the slide — the frame rocking as well as sliding is what makes
    // a big hit land physically instead of just jittering. Scaled well down from the positional
    // shake so it never reads as the camera spinning, and tied to the same swing so the roll and
    // the slide move together rather than fighting each other.
    shakeRoll = swing * shakeMagnitude * 0.0016;
    // Time-based, so a shake lasts the same wall-clock time regardless of refresh rate. The old
    // per-frame `*= 0.9` decayed 2.4x faster on a 144Hz display than on a 60Hz one, and lingered
    // whenever the frame rate dipped — the shake's own duration wobbled with the frame rate.
    shakeMagnitude *= Math.pow(SHAKE_DECAY, dt);
    if (shakeTimer <= 0) shakeMagnitude = 0;
  }

  // The entire visual frame, parameterized over the target context — called once for the
  // on-screen canvas and, while recording, a second time (pre-scaled) onto the higher-res
  // recording canvas, so the saved video isn't just an upscaled blur of the 720x1280 display.
  function drawFrame(c) {
    // Parked waiting for a Twitch redemption: draw nothing at all (not even the arena/HUD from
    // whatever was last on screen) and leave the canvas genuinely transparent — see the
    // html.twitch-transparent CSS rule this pairs with — so an OBS Browser Source shows straight
    // through to the stream underneath until a redemption actually starts a battle.
    if (mode === "twitchIdle") {
      c.clearRect(0, 0, WIDTH, HEIGHT);
      return;
    }

    drawBackground(c);

    // Nobody is on the field during the lineup draw — the arena is deliberately empty behind it.
    // The gauntlet counts too: it is one challenger and one opponent in the arena, and this flag
    // is what decides whether the two of them are drawn at all, whether their ground effects go
    // down, and who is eligible for a victory overlay. Leaving it out drew an empty arena with a
    // working HUD over it.
    const twoUp = gameMode === "1v1" || gameMode === "gauntlet"
                  || (gameMode === "team5" && team5State !== "drawing");
    const combatants = gameMode === "royale" ? royaleFighters
                     : twoUp ? [fighterA, fighterB]
                     : (boss ? [boss, ...allies] : []);
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
      } else if (twoUp) {
        // Ground effects all go down first regardless of order — they are floor decals, and
        // every one of them belongs under every fighter.
        fighterA.drawGroundEffects(c);
        fighterB.drawGroundEffects(c);
        for (const it of collectDepthItems([fighterA, fighterB])) it.draw(c);
      } else if (gameMode === "royale") {
        for (const f of royaleFighters) f.drawGroundEffects(c);
        for (const it of collectDepthItems(royaleFighters)) it.draw(c);
      } else if (boss) {
        boss.drawGroundEffects(c);
        for (const ally of allies) ally.drawGroundEffects(c);
        for (const it of collectDepthItems([boss, ...allies])) it.draw(c);
      }
      // The waiting squads, standing in line outside their own side of the arena. After the
      // depth pass so they sit above the Angel's ring, which sweeps through that same margin.
      if (gameMode === "team5") drawTeam5Bench(c);
      drawParticles(c);
      drawFlashes(c);
      drawSmokePuffs(c);
      drawDamageNumbers(c);
      // The mirror of drawGroundEffects: anything a character puts OVER the whole scene rather
      // than under it, while the round is still being fought (Archer's falling sun). Distinct
      // from drawVictoryOverlay, which only runs once someone has already won.
      if (twoUp) {
        fighterA.drawOverlayEffects(c);
        fighterB.drawOverlayEffects(c);
      } else if (gameMode === "royale") {
        for (const f of royaleFighters) f.drawOverlayEffects(c);
      } else if (boss) {
        boss.drawOverlayEffects(c);
        for (const ally of allies) ally.drawOverlayEffects(c);
      }
    }
    c.restore();

    // Opaque, and after every last thing drawn in world space, so effects authored against the
    // portrait frame that legitimately overhang the arena — the Angel's ring is 534px wide in
    // this layout and reaches deep into both columns — pass BEHIND the squad lists rather than
    // over them. Cheaper and far less risky than clipping the whole world render.
    // Guarded on the LAYOUT, not just the mode: openSetup() forces the canvas back to portrait
    // while the setup screen is up, and two 340px columns authored for a 1280-wide frame would
    // take up 680 of the 720 available and crowd the picker showing over them.
    // The squad columns exist only for the lineup draw — see team5SetArena. Once the draw hands
    // over they come down and the arena has already opened out into their space.
    if (gameMode === "team5" && arenaLayout === "landscape" && team5Draw) {
      drawTeam5DrawStage(c);   // inside the arena, so it goes under the columns
      drawTeam5Panels(c);
    }

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
      } else if (gameMode === "team5") {
        if (arenaLayout === "landscape") drawTeam5Title(c);
      } else if (gameMode === "1v1") {
        // The twitch overlay skips the "X vs Y" banner — see hudNameFont() in arena.js, which is
        // what puts the size back into the fighters' own HUD names instead.
        if (arenaLayout !== "twitch") drawTitle(c, matchTitle);
      } else if (boss) {
        drawVsBossTitle(c);
      }

      if (gameMode === "1v1") {
        fighterA.drawHud(c, HUD_MARGIN, HUD_Y, HUD_W);
        fighterB.drawHud(c, WIDTH - HUD_MARGIN - HUD_W, HUD_Y, HUD_W);
      } else if (gameMode === "royale") {
        drawRoyaleHud(c);
      } else if (gameMode === "gauntlet") {
        drawGauntletHud(c);
        drawGauntletProgress(c);
      } else if (gameMode === "team5" && arenaLayout === "landscape") {
        drawTeam5MatchHud(c);
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

    if (gameMode === "royale" && mode === "battle" && royaleState === "prompting") drawRoyalePromptOverlay(c);
    if (gameMode === "gauntlet" && mode === "battle" && gauntletState === "prompting") drawGauntletPromptOverlay(c);
    if (gameMode === "1v1" && mode === "battle" && roundState === "prompting") drawPromptOverlay(c);
    if (gameMode === "vsboss" && mode === "battle" && vsBossState === "prompting") drawVsBossPromptOverlay(c);
    if (gameMode === "team5" && mode === "battle" && team5State === "prompting") drawTeam5PromptOverlay(c);
    if (mode === "setup") drawSetupOverlay(c);
  }

  // One scale() for the whole frame — world and HUD alike — so every drawing call in the
  // codebase keeps working in logical units and the relay layout simply comes out 1.4x bigger.
  // See layoutZoom in arena.js.
  const z = layoutZoom();
  ctx.setTransform(z, 0, 0, z, 0, 0);
  drawFrame(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (isRecording) {
    recordCtx.save();
    const rs = recordScale() * z;   // per-layout record scale, times the layout zoom
    recordCtx.setTransform(rs, 0, 0, rs, 0, 0);
    drawFrame(recordCtx);
    recordCtx.restore();
  }

  if (!paused && gameMode === "royale" && mode === "battle" && royaleState === "ended") {
    royaleEndTimer += dt;
    if (royaleEndTimer >= ROUND_END_GRACE) {
      royaleState = "prompting";
      stopRecording().then((blob) => {
        royalePendingBlob = blob;
        royalePromptReady = true;
        if (royaleQueuedDecision === "keep") keepRoyaleRecording();
        else if (royaleQueuedDecision === "discard") discardRoyaleRecording();
      });
    }
  }

  if (!paused && gameMode === "gauntlet" && mode === "battle" && gauntletState === "ended") {
    gauntletEndTimer += dt;
    if (gauntletEndTimer >= ROUND_END_GRACE) {
      gauntletState = "prompting";
      stopRecording().then((blob) => {
        gauntletPendingBlob = blob;
        gauntletPromptReady = true;
        if (gauntletQueuedDecision === "keep") keepGauntletRecording();
        else if (gauntletQueuedDecision === "discard") discardGauntletRecording();
      });
    }
  }

  if (!paused && gameMode === "1v1" && mode === "battle" && roundState === "ended") {
    endTimer += dt;
    if (endTimer >= ROUND_END_GRACE) {
      if (twitchRoundActive) {
        // No recording was ever started for this round (see triggerTwitchBattle), and there's
        // nobody at the keyboard to answer a keep/discard prompt mid-stream — skip "prompting"
        // entirely and drop straight back into the waiting screen for the next redemption.
        // stopRecording() here is just defensive (isRecording should already be false) — see
        // enterTwitchIdle() in twitch.js, which guards the other two ways into this mode.
        if (isRecording) stopRecording();
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

  if (!paused && gameMode === "team5" && mode === "battle" && team5State === "ended") {
    team5EndTimer += dt;
    if (team5EndTimer >= ROUND_END_GRACE) {
      team5State = "prompting";
      stopRecording().then((blob) => {
        team5PendingBlob = blob;
        team5PromptReady = true;
        if (team5QueuedDecision === "keep") keepTeam5Recording();
        else if (team5QueuedDecision === "discard") discardTeam5Recording();
      });
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
