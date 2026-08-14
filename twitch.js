// Twitch integration: a viewer redeems a Channel Points reward and the page automatically kicks
// off a random 1v1 battle — meant to be added as an OBS Browser Source so it plays out live on
// stream. Runs entirely client-side (no backend server): OAuth login via the Implicit Grant
// flow, then Twitch's EventSub over WebSocket to hear about redemptions in real time. See
// main.js's triggerTwitchBattle()/twitchRoundActive for the actual "start a fight" side of this
// — everything in this file is just "notice a matching redemption happened."
//
// Setup (one-time, by whoever owns the channel): register an app at dev.twitch.tv, add this
// page's own URL as an OAuth Redirect URL, then click "Connect Twitch" once inside the OBS
// Browser Source itself (right-click it -> Interact) to authorize. Type the exact Channel Points
// reward title into the reward-name box so redemptions of anything else are ignored.

const TWITCH_CLIENT_ID = "dja2s96ae7sab7cc10w5afluelemo5";
const TWITCH_SCOPE = "channel:read:redemptions";
const TWITCH_TOKEN_KEY = "twitchAccessToken";
const TWITCH_REWARD_KEY = "twitchRewardName";
// Re-checks the token's still valid periodically so an expiry (Twitch user tokens are generally
// good for only a few hours) gets caught and turned into a visible "please log in again" state
// instead of the integration just silently going deaf to redemptions.
const TWITCH_REVALIDATE_INTERVAL_MS = 30 * 60 * 1000;

let twitchToken = null;
let twitchUserId = null;
let twitchLogin = null;
let twitchSocket = null;
let twitchKeepaliveTimer = null;
let twitchReconnectPending = false;

function twitchRedirectUri() {
  return window.location.origin + window.location.pathname;
}

function twitchAuthorizeUrl() {
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: twitchRedirectUri(),
    response_type: "token",
    scope: TWITCH_SCOPE,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

function twitchRewardName() {
  return (localStorage.getItem(TWITCH_REWARD_KEY) || "").trim();
}

function setTwitchStatus(text, isError = false) {
  const el = document.getElementById("twitchStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("twitch-error", isError);
}

function showTwitchLoginButton() {
  const btn = document.getElementById("twitchLoginBtn");
  if (btn) btn.classList.remove("hidden");
}

function hideTwitchLoginButton() {
  const btn = document.getElementById("twitchLoginBtn");
  if (btn) btn.classList.add("hidden");
}

// The Implicit Grant flow hands the token back in the URL FRAGMENT (after a #), not a query
// param — pulls it out, stashes it, and scrubs the fragment so a page refresh doesn't try to
// re-consume the same (by then stale) value out of history.
function consumeTwitchRedirect() {
  if (!location.hash.includes("access_token")) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("access_token");
  if (token) {
    localStorage.setItem(TWITCH_TOKEN_KEY, token);
    history.replaceState(null, "", location.pathname + location.search);
  }
  return token;
}

async function validateTwitchToken(token) {
  const res = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!res.ok) return null;
  return res.json(); // { client_id, login, scopes, user_id, expires_in }
}

async function subscribeToRedemptions(token, userId, sessionId) {
  const res = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
    method: "POST",
    headers: {
      "Client-Id": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "channel.channel_points_custom_reward_redemption.add",
      version: "1",
      condition: { broadcaster_user_id: userId },
      transport: { method: "websocket", session_id: sessionId },
    }),
  });
  if (!res.ok) throw new Error(`subscribe failed (${res.status}): ${await res.text()}`);
}

// Twitch expects a message at least every `keepalive_timeout_seconds` (welcome/keepalive/
// notification all count) or the session is considered dead. Gives it 10s of slack past whatever
// Twitch itself negotiated before deciding the socket is actually gone and reconnecting.
function armTwitchKeepalive(seconds) {
  clearTimeout(twitchKeepaliveTimer);
  twitchKeepaliveTimer = setTimeout(() => {
    setTwitchStatus("連線逾時，重新連線中…");
    reconnectTwitchSocket();
  }, (seconds + 10) * 1000);
}

function openTwitchSocket(url) {
  const socket = new WebSocket(url || "wss://eventsub.wss.twitch.tv/ws");
  twitchSocket = socket;

  socket.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const type = msg.metadata && msg.metadata.message_type;

    if (type === "session_welcome") {
      armTwitchKeepalive(msg.payload.session.keepalive_timeout_seconds || 10);
      subscribeToRedemptions(twitchToken, twitchUserId, msg.payload.session.id)
        .then(() => setTwitchStatus(`已連線：${twitchLogin}　監聽兌換：「${twitchRewardName() || "(尚未設定)"}」`))
        .catch((e) => setTwitchStatus("訂閱失敗：" + e.message, true));
      return;
    }
    if (type === "session_keepalive") {
      armTwitchKeepalive(10);
      return;
    }
    if (type === "session_reconnect") {
      // Twitch-initiated migration to a new edge server — hand off to the URL it gives us rather
      // than reconnecting to the default endpoint from scratch.
      const newUrl = msg.payload.session.reconnect_url;
      socket.close();
      openTwitchSocket(newUrl);
      return;
    }
    if (type === "notification") {
      armTwitchKeepalive(10);
      const event = msg.payload.event;
      const wanted = twitchRewardName();
      const title = (event.reward && event.reward.title || "").trim();
      if (!wanted || title.toLowerCase() === wanted.toLowerCase()) {
        triggerTwitchBattle();
      }
      return;
    }
  };

  socket.onclose = () => {
    if (twitchSocket !== socket) return; // this socket was already superseded by a reconnect
    if (!twitchReconnectPending) reconnectTwitchSocket();
  };
  socket.onerror = () => socket.close();
}

function reconnectTwitchSocket() {
  twitchReconnectPending = true;
  clearTimeout(twitchKeepaliveTimer);
  setTimeout(() => {
    twitchReconnectPending = false;
    openTwitchSocket();
  }, 2000);
}

async function connectTwitch(token) {
  setTwitchStatus("驗證中…");
  const info = await validateTwitchToken(token).catch(() => null);
  if (!info) {
    localStorage.removeItem(TWITCH_TOKEN_KEY);
    setTwitchStatus("登入已過期，請重新登入", true);
    showTwitchLoginButton();
    return;
  }
  if (!info.scopes || !info.scopes.includes(TWITCH_SCOPE)) {
    setTwitchStatus("授權缺少必要權限，請重新登入", true);
    showTwitchLoginButton();
    return;
  }
  twitchToken = token;
  twitchUserId = info.user_id;
  twitchLogin = info.login;
  hideTwitchLoginButton();
  setTwitchStatus(`已連線：${info.login}　建立監聽中…`);
  openTwitchSocket();
  // Drops straight into the waiting screen — connecting is a deliberate one-time setup action
  // (done once inside the OBS Browser Source itself), so it's fine for it to take over from
  // whatever manual screen happened to be showing.
  mode = "twitchIdle";
}

function initTwitchPanel() {
  const btn = document.getElementById("twitchLoginBtn");
  if (btn) btn.addEventListener("click", () => { window.location.href = twitchAuthorizeUrl(); });

  const rewardInput = document.getElementById("twitchRewardInput");
  if (rewardInput) {
    rewardInput.value = twitchRewardName();
    rewardInput.addEventListener("change", () => {
      localStorage.setItem(TWITCH_REWARD_KEY, rewardInput.value.trim());
    });
  }

  // Fires a battle without needing an actual live redemption — for checking the reward-name
  // filter and the whole idle<->battle<->idle cycle actually works before going live with it.
  const testBtn = document.getElementById("twitchTestBtn");
  if (testBtn) testBtn.addEventListener("click", () => triggerTwitchBattle());

  // If the streamer Tabs out into the normal manual setup screen (or a manual round is still
  // sitting on its keep/discard prompt) the subscription/socket stays alive underneath the whole
  // time — redemptions just get silently dropped by triggerTwitchBattle's own mode check while
  // not actually idle. This is the manual way back in, since nothing else re-arms it on its own.
  const resumeBtn = document.getElementById("twitchResumeBtn");
  if (resumeBtn) resumeBtn.addEventListener("click", () => { mode = "twitchIdle"; });
  setInterval(() => {
    if (resumeBtn) resumeBtn.classList.toggle("hidden", !twitchToken || mode === "twitchIdle");
  }, 500);

  const redirectedToken = consumeTwitchRedirect();
  const token = redirectedToken || localStorage.getItem(TWITCH_TOKEN_KEY);
  if (token) connectTwitch(token);
  else setTwitchStatus("尚未連接");

  setInterval(() => {
    if (!twitchToken) return;
    validateTwitchToken(twitchToken).then((info) => {
      if (!info) {
        setTwitchStatus("登入已過期，請重新登入", true);
        showTwitchLoginButton();
        twitchToken = null;
      }
    });
  }, TWITCH_REVALIDATE_INTERVAL_MS);
}

initTwitchPanel();

// The idle screen between redemptions. Just status text — the actual login button / reward-name
// input are plain HTML (see index.html), not canvas-drawn, so they stay simple, keyboard/mouse
// accessible, and independent of whatever layout/scaling the game canvas itself is using.
function drawTwitchIdleOverlay(ctx) {
  ctx.fillStyle = "rgba(5,5,12,0.92)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = "center";
  ctx.fillStyle = "#9146ff"; // Twitch's own brand purple
  ctx.font = "bold 28px Arial";
  ctx.fillText("Waiting for a Channel Points redemption…", WIDTH / 2, HEIGHT / 2 - 20);

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "18px Arial";
  const reward = twitchRewardName();
  ctx.fillText(reward ? `Reward: "${reward}"` : "No reward name configured yet — set one in the panel", WIDTH / 2, HEIGHT / 2 + 24);
}
