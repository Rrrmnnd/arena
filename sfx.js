// Sound effects. All loaded from local mp3 files and played through the Web Audio API
// so the same clip can overlap itself (e.g. rapid punches) without cutting off.

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sfxBuffers = {};

// A second output that feeds the recorder (see recorder.js) so captured video
// includes audio, alongside the normal speaker output.
const recordDestination = audioCtx.createMediaStreamDestination();

async function loadSfx(name, url) {
  try {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    sfxBuffers[name] = await audioCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    console.warn(`[SFX] Failed to load ${name} (${url}): ${e.message}`);
  }
}

// Returns the BufferSource node so callers that need to stop a long clip early (or resume it
// from partway through via `offset`) can hang onto it — most callers just ignore the result.
// `loop`: for sounds meant to be cut off exactly when some variable-length action ends (rather
// than just playing the clip once to its natural end) — the caller is responsible for calling
// `.stop()` on the returned node itself when that action actually ends.
function playSfx(name, volume = 1.0, pitchVariance = 0.08, offset = 0, loop = false) {
  const buffer = sfxBuffers[name];
  if (!buffer) return null;

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitchVariance; // slight variation so rapid repeats don't sound robotic
  source.loop = loop;

  const gain = audioCtx.createGain();
  gain.gain.value = volume;

  source.connect(gain);
  gain.connect(audioCtx.destination);
  gain.connect(recordDestination);
  source.start(0, Math.min(offset, buffer.duration));
  return source;
}

loadSfx("punch", "sfx_punch.mp3");
loadSfx("collision", "sfx_collision.mp3");
loadSfx("wallHit", "sfx_wallhit.mp3");
loadSfx("absorb", "sfx_absorb.mp3");
loadSfx("giantBurst", "sfx_giant_burst.mp3");
loadSfx("giantWin", "sfx_giant_win.mp3");
loadSfx("giantChargeHit", "sfx_giant_charge_hit.mp3");
loadSfx("wallSlam", "sfx_wall_slam.mp3");
loadSfx("punchmanUltimate", "sfx_punchman_ultimate.mp3");
loadSfx("demonThrow", "sfx_demon_throw.mp3");
loadSfx("demonUltimate", "sfx_demon_ultimate.mp3");
loadSfx("demonHit", "sfx_demon_hit.mp3");
loadSfx("bomberPlant", "sfx_bomber_plant.mp3");
loadSfx("bomberExplode", "sfx_bomber_explode.mp3");
loadSfx("bomberUltimate", "sfx_bomber_ultimate.mp3");
loadSfx("demonLaugh", "sfx_demon_laugh.mp3");
loadSfx("demonWings", "sfx_demon_wings.mp3");
loadSfx("draw", "sfx_draw.mp3");
loadSfx("gunnerPistol", "sfx_gunner_pistol.mp3");
loadSfx("gunnerSmg", "sfx_gunner_smg.mp3");
loadSfx("gunnerRifle", "sfx_gunner_rifle.mp3");
loadSfx("gunnerRocketFire", "sfx_gunner_rocket_fire.mp3");
loadSfx("gunnerRocketExplode", "sfx_gunner_rocket_explode.mp3");
loadSfx("gunnerLaser", "sfx_gunner_laser.mp3");
loadSfx("gunnerUltimate", "sfx_gunner_ultimate.mp3");
loadSfx("gunnerWin", "sfx_gunner_win.mp3");
loadSfx("knightSpearHit", "sfx_knight_spear_hit.mp3");
loadSfx("knightHorse", "sfx_knight_horse.mp3");
loadSfx("knightSpearReady", "sfx_knight_spear_ready.mp3");
loadSfx("pm2ThirdPunch", "sfx_pm2_third_punch.mp3"); // every third punch in normal combat
loadSfx("pm2UltFinal", "sfx_pm2_heavy.mp3");    // the ultimate's sixth and final blow
loadSfx("pm2Blitz", "sfx_pm2_blitz.mp3");       // the ultimate's first five blows
loadSfx("pm2Teleport", "sfx_pm2_teleport.mp3"); // blinking in for a blow, and the lunge
loadSfx("pm2Jump", "sfx_pm2_jump.mp3"); // the victory windup's launch
loadSfx("pm2GlassBreak", "sfx_pm2_glass_break.mp3"); // the victory fist punching through the screen
loadSfx("ninjaShuriken", "sfx_ninja_shuriken.mp3");
loadSfx("ninjaDagger", "sfx_ninja_dagger.mp3");
loadSfx("ninjaSmokeThrow", "sfx_ninja_smoke_throw.mp3"); // the little puff pop, layered under ninjaClone
loadSfx("ninjaClone", "sfx_ninja_clone.mp3"); // summoning a Shadow Clone
loadSfx("ninjaVictory", "sfx_ninja_victory.mp3"); // fires once, right as the victory sequence begins
loadSfx("ninjaTeleport", "sfx_ninja_teleport.mp3"); // layered under ninjaSmokeThrow at every teleport: Three-Slash's teleport-in, and the victory ending's teleport-out
loadSfx("virusSaliva", "sfx_virus_saliva.mp3"); // the spike-throw normal attack
loadSfx("virusSwim", "sfx_virus_swim.mp3"); // looped for however long the "traveling"/"returning" liquid phases actually last, then cut off — see virus.js
loadSfx("virusPossess", "sfx_virus_possess.mp3"); // plays once for the "attached" hold, whose duration is set to match this clip exactly — see VIRUS_PARASITE_ATTACH_DURATION
loadSfx("virusWin", "sfx_virus_win.mp3"); // fires once, right as the victory-overlay bake kicks off — see Virus.onVictory
loadSfx("firemageThrow", "sfx_firemage_throw.mp3");     // released at the peak of the staff swing
loadSfx("firemageExplode", "sfx_firemage_explode.mp3"); // the fireball detonating, on a body or a wall
loadSfx("firemageTentacle", "sfx_firemage_tentacle.mp3"); // one play per eruption, not per arm
loadSfx("firemageWhip", "sfx_firemage_whip.mp3");         // a tentacle's slam landing
loadSfx("firemageLava", "sfx_firemage_lava.mp3");         // looped for exactly as long as any lava is burning — see firemage.js
loadSfx("firemageOnLava", "sfx_firemage_onlava.mp3");     // one per lava damage tick, so 5x/sec while someone stands in it
loadSfx("firemageFireworks", "sfx_firemage_fireworks.mp3"); // the victory display; its length sets how long the fireworks run

// Browsers suspend AudioContext until a user gesture unlocks it
function unlockAudio() {
  if (audioCtx.state === "suspended") audioCtx.resume();
  window.removeEventListener("click", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("click", unlockAudio);
window.addEventListener("keydown", unlockAudio);
