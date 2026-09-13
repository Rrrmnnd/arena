// Arena setup and rendering.
// Same layout ratio as the old test3/test5 prototypes: a portrait canvas with a
// centered square arena.

const ARENA_MARGIN = 60;
const ARENA_BORDER  = 14;

// Three canvas layouts. The battle modes use the 9:16 portrait frame with a centered square
// arena; the lab uses a 16:9 frame with a wide arena and a control panel down the right; twitch
// is the same portrait shape as normal battle but squashed noticeably shorter (title/HUD sit
// right on top of the arena, almost no dead space below it) for looking dense as an OBS overlay,
// used only while parked waiting for/showing a Channel Points-triggered fight — see
// twitch.js's enterTwitchIdle() and main.js's triggerTwitchBattle(). Deliberately NOT just a
// smaller version of "portrait" globally: the character-select screen's own roster-picker
// layout (SETUP_ROSTER_START_Y etc. in main.js) needs the full portrait height to fit the whole
// cast — see setupRowPitch, which tightens the row spacing as the roster grows — and openSetup()
// always forces the canvas back to "portrait" before showing it
// regardless of whichever of these was active, so that screen is unaffected either way.
// WIDTH/HEIGHT/ARENA (and TITLE_Y/HUD_Y, for whichever layouts actually use those) are read
// fresh on every use across the codebase, so swapping them here re-lays-out everything — the
// callers just need to resize the canvases (see applyLayout).
const ARENA_LAYOUTS = {
  portrait: { w: 720,  h: 1280, arena: { x: ARENA_MARGIN, y: 370, w: 600, h: 600 }, titleY: 100, hudY: 190 },
  lab:      { w: 1280, h: 720,  arena: { x: 24, y: 92, w: 892, h: 604 } }, // no titleY/hudY — lab draws its own title/panel independently of drawTitle()/HUD_Y
  twitch:   { w: 720,  h: 850,  arena: { x: ARENA_MARGIN, y: 220, w: 600, h: 600 }, titleY: 40, hudY: 75 },
  // 16:9 for ordinary (non-Shorts) video, used by the 5-a-side relay. Authored at full
  // 1920x1080 and recorded 1:1 (recordScale 1) rather than at 1280x720 doubled, because the
  // height is what everything else hangs off:
  //
  //   - the arena keeps its 600x600, so every number ever tuned against it carries over,
  //   - and with 240px of clear frame above and below it, the Angel's pentagram fits at its
  //     authored 348x390 — the exact ring the 9:16 frame uses. At 1280x720 there was only 60px
  //     of vertical room, which forced the ring flat and 534 wide, straight through both squad
  //     columns. See Angel.pentaRadii.
  //
  // The ring then spans x 612..1308 against an arena at 660..1260, so a column narrower than
  // 612 never covers any of it. No hudY — the fighters' HUDs live inside those columns rather
  // than in a band across the top.
  // The relay frame, and the one layout that draws at a zoom.
  //
  // w/h here are LOGICAL units — the coordinate space every piece of drawing and every piece of
  // simulation works in. The canvas is 1920x1080 and the whole frame is drawn through a single
  // scale(zoom) (see applyLayout/render in main.js), so 1371x771 logical fills it exactly.
  //
  // The point of the zoom is that it scales EVERYTHING spatial at once: bodies, the Fire Mage's
  // lava pools, its tentacle reach, blast radii, projectile speeds, pillar heights, the lot.
  // There are ~100 named spatial constants across the character files plus a great many inline
  // literals, and scaling them by hand would be both enormous and permanently fragile. A zoom
  // gets all of them, exactly, for free — and cannot drift.
  //
  // So the arena is 690x490 in the units the game was tuned in — 0.94x the area of the 600x600
  // it was balanced against, rather than the 1.92x that a literal 960x720 arena was — while
  // measuring 966x686 on screen with every fighter and every effect drawn 1.4x bigger.
  //
  // 690x490 is near the ceiling: the Angel's ring is 1.16/1.30 of the arena's half-width/height
  // and a spirit overhangs its own vertex by 84 logical units, which caps the ON-SCREEN arena at
  // about 1000x700 whatever zoom is chosen. See Angel.pentaRadii.
  //
  // TWO arenas. The squad boards are only up during the lineup draw, and they take a 300px
  // column off each side; the moment the draw hands over they go away and the arena opens out
  // into the space they were using. `boardArena` is the narrow one that fits beside them,
  // `arena` is the one the match is actually fought in. See team5SetArena.
  //
  // 900 rather than the 1100 the ring would still allow: widening costs balance quickly once the
  // arena stops resembling the 600x600 everything was tuned against — measured average win-rate
  // shift is 3.8 at 690, 7.9 at 900, 11.5 at 1000 and 11.2 at 1100. 900 buys 30% more width on
  // screen for the smallest real cost.
  landscape: { w: 1920 / 1.4, h: 1080 / 1.4, zoom: 1.4,
               arena: { x: (1920 / 1.4 - 900) / 2, y: 195, w: 900, h: 490 },
               boardArena: { x: (1920 / 1.4 - 690) / 2, y: 195, w: 690, h: 490 },
               titleY: 32, recordScale: 1 },
};

let WIDTH  = ARENA_LAYOUTS.portrait.w;
let HEIGHT = ARENA_LAYOUTS.portrait.h;
let ARENA  = { ...ARENA_LAYOUTS.portrait.arena };
let TITLE_Y = ARENA_LAYOUTS.portrait.titleY;
let HUD_Y = ARENA_LAYOUTS.portrait.hudY;
let arenaLayout = "portrait";

// Which language the game DRAWS in. The Twitch overlay is for viewers and is written in
// Traditional Chinese; everything else — the manual setup screen, ordinary 1v1, the lab — stays
// English, because that is the language the project itself is written in.
//
// Keyed on the layout rather than on a separate setting because the layout IS the distinction:
// "twitch" is only ever active while an OBS source is showing the arena to an audience (see
// enterTwitchIdle in twitch.js), and no other mode uses it.
//
// Every drawn string that differs goes through here, so there is exactly one place that decides.
function L(en, zh) {
  return arenaLayout === "twitch" ? zh : en;
}

// The scale the whole frame is drawn at. 1 everywhere except the relay layout, so the 9:16
// battle, the Twitch overlay and the lab are all untouched and pixel-identical.
function layoutZoom() {
  const L = ARENA_LAYOUTS[arenaLayout];
  return (L && L.zoom) || 1;
}

function setArenaLayout(name) {
  const L = ARENA_LAYOUTS[name];
  if (!L || name === arenaLayout) return false;
  WIDTH = L.w;
  HEIGHT = L.h;
  ARENA = { ...L.arena };
  if (L.titleY !== undefined) TITLE_Y = L.titleY;
  if (L.hudY !== undefined) HUD_Y = L.hudY;
  arenaLayout = name;
  return true;
}

// A slow cool-to-warm wash behind everything with the arena sitting in a pool of light, rather
// than one flat fill — gives the frame depth and keeps the eye pulled toward the centre.
function drawBackground(ctx) {
  ctx.fillStyle = "#07070f";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const cx = ARENA.x + ARENA.w / 2;
  const cy = ARENA.y + ARENA.h / 2;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(WIDTH, HEIGHT) * 0.72);
  glow.addColorStop(0, "rgba(52,52,104,0.5)");
  glow.addColorStop(0.45, "rgba(28,28,58,0.28)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawArena(ctx) {
  const t = performance.now() / 1000;

  // Floor: lit from the centre and falling off toward the walls
  const cx = ARENA.x + ARENA.w / 2;
  const cy = ARENA.y + ARENA.h / 2;
  const floor = ctx.createRadialGradient(cx, cy, 0, cx, cy, ARENA.w * 0.78);
  floor.addColorStop(0, "#22223d");
  floor.addColorStop(0.62, "#191930");
  floor.addColorStop(1, "#101020");
  ctx.fillStyle = floor;
  ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

  // A faint grid, so movement across an otherwise featureless floor has something to read
  // against — and the arena feels like a built stage rather than empty space.
  ctx.save();
  ctx.beginPath();
  ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
  ctx.clip();
  ctx.strokeStyle = "rgba(120,120,190,0.075)";
  ctx.lineWidth = 1;
  const step = 60;
  ctx.beginPath();
  for (let gx = ARENA.x + step; gx < ARENA.x + ARENA.w; gx += step) {
    ctx.moveTo(gx, ARENA.y); ctx.lineTo(gx, ARENA.y + ARENA.h);
  }
  for (let gy = ARENA.y + step; gy < ARENA.y + ARENA.h; gy += step) {
    ctx.moveTo(ARENA.x, gy); ctx.lineTo(ARENA.x + ARENA.w, gy);
  }
  ctx.stroke();
  ctx.restore();

  // Border: a solid base with a slow breathing glow riding on top, so the frame is never
  // completely static even in a lull between exchanges.
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
  const bx = ARENA.x + ARENA_BORDER / 2;
  const by = ARENA.y + ARENA_BORDER / 2;
  const bw = ARENA.w - ARENA_BORDER;
  const bh = ARENA.h - ARENA_BORDER;

  ctx.strokeStyle = "#5a5a96";
  ctx.lineWidth = ARENA_BORDER;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.16 + pulse * 0.16;
  ctx.strokeStyle = "#8f8fe8";
  ctx.lineWidth = 3;
  ctx.strokeRect(bx, by, bw, bh);
  // Inner lip, catching the floor light
  ctx.globalAlpha = 0.1 + pulse * 0.08;
  ctx.lineWidth = 2;
  ctx.strokeRect(ARENA.x + ARENA_BORDER, ARENA.y + ARENA_BORDER, ARENA.w - ARENA_BORDER * 2, ARENA.h - ARENA_BORDER * 2);
  ctx.restore();
}

function drawTitle(ctx, text = "Battle Arena") {
  ctx.fillStyle = "#ffdc32";
  ctx.font = "bold 40px Arial";
  ctx.textAlign = "center";
  ctx.fillText(text, WIDTH / 2, TITLE_Y);
}

// The twitch overlay skips drawTitle() entirely (see main.js's render) — there's no separate
// "vs" banner up top for that layout, just the two fighters' own names sitting bigger in their
// HUD panels. Character.drawHud() and Demon's override (which can't call the base method — see
// there) both read this so the two stay in lockstep.
function hudNameFont() {
  // Logical units, so the relay layout's value is what 22px looks like once the frame's 1.4x
  // zoom is applied — the same size on screen as everywhere else, in a narrower column.
  if (arenaLayout === "twitch") return "bold 30px Arial";
  if (arenaLayout === "landscape") return "bold 16px Arial";
  return "bold 22px Arial";
}
