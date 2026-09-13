// Sound effects. All loaded from local mp3 files and played through the Web Audio API
// so the same clip can overlap itself (e.g. rapid punches) without cutting off.

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sfxBuffers = {};

// A second output that feeds the recorder (see recorder.js) so captured video
// includes audio, alongside the normal speaker output.
const recordDestination = audioCtx.createMediaStreamDestination();

// Recording keep-alive: an inaudible signal that runs for the life of the page purely so the
// record bus is never digitally silent.
//
// A MediaStreamAudioDestinationNode carrying nothing produces nothing, and MediaRecorder's Opus
// encoder writes no packets for that silence. The video track meanwhile keeps producing frames
// on real time, so the recorded audio track ends up far shorter than the picture and the sound
// runs progressively further ahead of it — which is exactly the drift that shows up over a
// three-minute relay match.
//
// Measured on a 5.01s take with nothing playing: the video track came out at 5.01s and the audio
// track was so empty that decodeAudioData could not open it at all. With this node running, the
// same take gives 4.90s of audio against 5.00s of video.
//
// Connected ONLY to recordDestination, never to audioCtx.destination, so it is inaudible by
// construction rather than merely quiet — it never reaches the speakers at all. 40Hz at -80dB
// is far below anything a decoder will pass through to a listener, but it is not zero, which is
// the only thing the encoder cares about.
const recordKeepAlive = audioCtx.createOscillator();
const recordKeepAliveGain = audioCtx.createGain();
recordKeepAlive.frequency.value = 40;
recordKeepAliveGain.gain.value = 0.0001;
recordKeepAlive.connect(recordKeepAliveGain);
recordKeepAliveGain.connect(recordDestination);
recordKeepAlive.start();

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

// A continuous loop for something physically PRESENT for a variable length of time, as opposed
// to playSfx's loop flag, which is right for a bed that can start and stop dead (the Fire Mage's
// lava, the Troll's snore).
//
// Three things here that a raw `loop = true` does not give:
//
//  1. It loops only the SUSTAIN. Measured on sfx_poopman_ult_roll (0.784s): the first 60ms is
//     1.8x the RMS of the middle and the last 60ms is 0.15x it — an attack at the head and a
//     decay to near-silence at the tail, because it was recorded as a one-shot. Wrapped whole,
//     every cycle dips to nothing and then thumps, which over an eight-second boulder is ten
//     audible thumps. loopStart/loopEnd cut both ends off the looped region.
//  2. It runs the loop on more than one voice, staggered in phase and slightly apart in playback
//     rate. One voice repeating a half-second sustain sixteen times is still a half-second
//     pattern the ear locks onto; two decorrelated copies read as one continuous rumble, and each
//     one's seam lands where the other is mid-sustain.
//  3. It owns its own gain, so both ends can be ramped and the level can be ridden while it runs
//     — a roll that snaps to full the instant the boulder appears and is cut mid-rumble when it
//     expires is the very seam the loop exists to hide.
//
// Returns a handle, or null if the clip never loaded. Every method on the handle is safe to call
// after it has been stopped.
function playSfxLoop(name, opts = {}) {
  const buffer = sfxBuffers[name];
  if (!buffer) return null;

  const volume = opts.volume !== undefined ? opts.volume : 1;
  const rate = opts.rate !== undefined ? opts.rate : 1;
  const fadeIn = opts.fadeIn !== undefined ? opts.fadeIn : 0.15;
  // Three, measured. Rendering 4s of sfx_poopman_ult_roll offline and taking the RMS envelope
  // in 20ms windows: the naive whole-clip loop swings with a coefficient of variation of 0.856
  // and hits absolute silence 46 times; one voice on the trimmed sustain fixes the worst of it,
  // two gets to cv 0.501 with 8 near-silent windows, three to cv 0.361 with 1. A fourth only
  // reaches cv 0.304 and buys back a dip, so it is not worth the extra source.
  const voices = opts.voices !== undefined ? opts.voices : 3;
  const spread = opts.spread !== undefined ? opts.spread : 0.13;
  // Fractions of the clip trimmed off each end before looping. Defaults sized for a one-shot
  // recording: enough off the front to clear an attack, more off the back to clear a decay.
  const headCut = (opts.headCut !== undefined ? opts.headCut : 0.12) * buffer.duration;
  const tailCut = (opts.tailCut !== undefined ? opts.tailCut : 0.25) * buffer.duration;

  const loopStart = Math.min(headCut, buffer.duration * 0.4);
  const loopEnd = Math.max(loopStart + 0.05, buffer.duration - tailCut);
  const loopLen = loopEnd - loopStart;

  const master = audioCtx.createGain();
  const now = audioCtx.currentTime;
  // Exponential ramps cannot touch zero, hence the floor on both ends.
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + Math.max(0.01, fadeIn));
  master.connect(audioCtx.destination);
  master.connect(recordDestination);

  const sources = [];
  for (let i = 0; i < voices; i++) {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = loopStart;
    src.loopEnd = loopEnd;
    // Centred on `rate`, so the pair sits either side of the intended pitch rather than above it.
    const off = voices > 1 ? (i / (voices - 1) - 0.5) * spread : 0;
    src.playbackRate.value = rate * (1 + off);
    const vg = audioCtx.createGain();
    // Equal-power-ish, so two voices are not twice as loud as one.
    vg.gain.value = 1 / Math.sqrt(voices);
    src.connect(vg);
    vg.connect(master);
    // Staggered entry points, so the voices' wrap points never coincide.
    src.start(0, loopStart + (loopLen * i) / voices);
    sources.push({ src, vg });
  }

  let stopped = false;
  return {
    get stopped() { return stopped; },
    setVolume(v, ramp = 0.12) {
      if (stopped) return;
      const t = audioCtx.currentTime;
      try {
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
        master.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + Math.max(0.01, ramp));
      } catch (e) { /* the context can refuse while suspended */ }
    },
    setRate(r, ramp = 0.12) {
      if (stopped) return;
      const t = audioCtx.currentTime;
      for (let i = 0; i < sources.length; i++) {
        const off = sources.length > 1 ? (i / (sources.length - 1) - 0.5) * spread : 0;
        try {
          const p = sources[i].src.playbackRate;
          p.cancelScheduledValues(t);
          p.setValueAtTime(p.value, t);
          p.linearRampToValueAtTime(Math.max(0.05, r * (1 + off)), t + Math.max(0.01, ramp));
        } catch (e) {}
      }
    },
    stop(fadeOut = 0.22) {
      if (stopped) return;
      stopped = true;
      const t = audioCtx.currentTime;
      try {
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
        master.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.01, fadeOut));
      } catch (e) {}
      for (const v of sources) {
        try { v.src.stop(t + Math.max(0.01, fadeOut) + 0.03); } catch (e) {}
      }
    },
  };
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
loadSfx("demonTridentWoosh", "sfx_demon_trident_woosh.mp3"); // Recall only, not an ordinary throw — looped per trident for exactly as long as IT is flying home; see Demon.updateTridents
loadSfx("demonThrow", "sfx_demon_throw.mp3");
loadSfx("earthmageSand", "sfx_earthmage_sand.mp3"); // the sand bolt firing — see EarthMage.throwSand
loadSfx("earthmageHit", "sfx_earthmage_hit.mp3");   // and the sand bolt landing on a body — see EarthMage.updateBolts
loadSfx("earthmageRise", "sfx_earthmage_rise.mp3"); // looped for exactly as long as a pillar takes to rise — see EarthMage.summonPillar
loadSfx("earthmageCollapse", "sfx_earthmage_collapse.mp3"); // the moment a toppled column lands — see EarthMage.resolveToppledPillar
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
loadSfx("angelShoot", "sfx_angel_shoot.mp3");           // the Angel's bolt leaving her hand
loadSfx("angelHit", "sfx_angel_hit.mp3");               // and that bolt landing on a body
loadSfx("angelSword", "sfx_angel_sword.mp3");           // the judgement blade forging over a marked head
loadSfx("angelSwordHit", "sfx_angel_sword_hit.mp3");    // and that blade coming down
loadSfx("angelUlt", "sfx_angel_ult.mp3");               // looped for exactly as long as the rite runs — see Angel.beginUltimate
loadSfx("angelUltLaser", "sfx_angel_ult_laser.mp3");    // one per volley, not one per beam
loadSfx("angelVictory", "sfx_angel_victory.mp3");       // the deluge
loadSfx("archerBow", "sfx_archer_bow.mp3");             // an ordinary arrow leaving the bow
loadSfx("archerBowHit", "sfx_archer_bowhit.mp3");       // an arrow landing on a body
loadSfx("archerUltCharge", "sfx_archer_arcultcharge.mp3"); // the five-second Sun Shot draw
loadSfx("archerBowShotSun", "sfx_archer_bowshotsun.mp3");  // the ultimate's arrow going up
loadSfx("archerSundown", "sfx_archer_sundown.mp3");     // the sun falling — see archer.js for how it's timed
loadSfx("archerSunCrash", "sfx_archer_suncrash.mp3");   // the sun landing
loadSfx("trollRoar", "sfx_troll_roar.mp3");   // RAMPAGE: the 4.96s clip outlives the 1.3s rooted roar and plays on over the start of the rampage
loadSfx("trollWave", "sfx_troll_wave.mp3");         // the club starting to move, both the ordinary sweep and the rampage overhead
loadSfx("trollHit", "sfx_troll_hit.mp3");           // the sweep connecting with a target
loadSfx("trollUltHit", "sfx_troll_ult_hit.mp3");    // the rampage's overhead driving into the ground
loadSfx("trollSnore", "sfx_troll_snore.mp3");       // looped for the whole of the post-rampage sleep — see Troll.updateUltimate
loadSfx("trollPullout", "sfx_troll_pullout.mp3");   // the club coming back out of the floor at the end of the "stuck" phase
loadSfx("poopmanShot", "sfx_poopman_shot.mp3");     // 0.31s — one per ordinary shot, well inside the 1.7s reload
loadSfx("poopmanSpray", "sfx_poopman_spray.mp3");   // 3.29s — cut to the 3.0s spray, with a little tail left over
loadSfx("poopmanUlt", "sfx_poopman_ult.mp3");       // 1.65s — fires on the launch, not the strain
loadSfx("poopmanHit", "sfx_poopman_hit.mp3");       // an ordinary shot landing on a body
loadSfx("poopmanUltHit", "sfx_poopman_ult_hit.mp3");   // the boulder running somebody over
loadSfx("poopmanRoll", "sfx_poopman_ult_roll.mp3");    // looped under the boulder for as long as it rolls — see playSfxLoop
loadSfx("poopmanWin", "sfx_poopman_win.mp3");          // the victory

// Browsers suspend AudioContext until a user gesture unlocks it
function unlockAudio() {
  if (audioCtx.state === "suspended") audioCtx.resume();
  window.removeEventListener("click", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("click", unlockAudio);
window.addEventListener("keydown", unlockAudio);
