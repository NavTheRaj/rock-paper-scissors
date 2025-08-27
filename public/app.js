// public/app.js
const socket = io();

// ----- DOM refs -----
const qs = (sel) => document.querySelector(sel);
const roomInput  = qs("#room");
const nameInput  = qs("#name");
const statusEl   = qs("#status");
const playersEl  = qs("#players");
const youHand    = qs("#youHand");
const oppHand    = qs("#oppHand");
const resultEl   = qs("#result");
const scoresEl   = qs("#scores");

const btnJoin  = qs("#btnJoin");
const btnGen   = qs("#btnGen");
const btnReady = qs("#btnReady");
const btnReset = qs("#btnReset");
const choiceBtns = [...document.querySelectorAll(".choice")];

// Topbar elements
const topYou   = qs("#top-you");
const topOpp   = qs("#top-opp");
const topTies  = qs("#top-ties");
const chipYou  = qs("#chip-you");
const chipOpp  = qs("#chip-opp");

const bestofPreset   = qs("#bestofPreset");
const bestofCustom   = qs("#bestofCustom");
const applyBestofBtn = qs("#applyBestof");
const matchBanner    = qs("#matchBanner");

// ----- State -----
let myId = null;
let roomCode = null;
let players = [];
let scores = {};
let lockedMoves = new Set();
let readyState = false;

let matchTarget = 5; // "Best of N" rounds (first to ceil(N/2) wins)
let matchOver   = false;

const EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };

// ----- Socket wiring -----
socket.on("connect", () => {
  myId = socket.id;
  statusEl.textContent = "Connected. Enter a room code to join.";
});

socket.on("disconnect", () => {
  statusEl.textContent = "Disconnected.";
});

socket.on("error_msg", (msg) => {
  resultEl.className = "result";
  resultEl.textContent = "⚠️ " + msg;
});

socket.on("room_state", (state) => {
  if (!roomCode) return;
  players = state.players || [];
  scores  = state.scores  || {};
  renderPlayers();
  renderScores();

  if (players.length < 2) {
    resultEl.className = "result";
    resultEl.textContent = "Waiting for an opponent to join…";
    oppHand.textContent = "❔";
  }
});

socket.on("move_locked", ({ playerId }) => {
  lockedMoves.add(playerId);
  renderPlayers();
});

socket.on("round_result", ({ moves, outcomes, scores: newScores }) => {
  scores = newScores;

  const meMove  = moves[myId];
  const oppId   = Object.keys(moves).find((id) => id !== myId);
  const oppMove = oppId ? moves[oppId] : null;

  youHand.textContent = meMove  ? EMOJI[meMove]  : "❔";
  oppHand.textContent = oppMove ? EMOJI[oppMove] : "❔";

  const myOutcome = outcomes[myId];
  resultEl.className = "result " + (myOutcome || "");
  if (myOutcome === "win")  resultEl.textContent = "You win this round!";
  if (myOutcome === "lose") resultEl.textContent = "You lose this round.";
  if (myOutcome === "tie")  resultEl.textContent = "Tie.";

  lockedMoves.clear();
  readyState = false;

  renderPlayers();
  renderScores();

  // ---- Best-of completion check ----
  const me  = players.find(p => p.id === myId);
  const opp = players.find(p => p.id !== myId);
  const ms  = (me  && scores[me.id])  || { wins:0, losses:0, ties:0 };
  const os  = (opp && scores[opp.id]) || { wins:0, losses:0, ties:0 };
  const need = targetWinsFor(matchTarget);

  if (!matchOver && (ms.wins >= need || os.wins >= need)) {
    matchOver = true;
    const iWon = ms.wins > os.wins;
    const winnerName = iWon ? (me?.name  || "You")      : (opp?.name || "Opponent");
    const loserName  = iWon ? (opp?.name || "Opponent") : (me?.name  || "You");

    showBanner({ winnerName, loserName, youWon: iWon });

    resultEl.className = "result " + (iWon ? "win" : "lose");
    resultEl.textContent = iWon
      ? "Match complete: You are the KING 👑!"
      : "Match complete: You get the toilet bowl 🚽… better luck next time!";
  }
});

// ----- UI events -----
btnJoin.addEventListener("click", () => {
  const name = nameInput.value.trim() || "Player";
  const code = (roomInput.value || "").trim().toUpperCase();
  if (!code) return;

  roomCode = code;
  socket.emit("join_room", { roomCode: code, name });

  resultEl.className = "result";
  resultEl.textContent = `Joined room ${code}. Share this code with your friend.`;
  statusEl.textContent = `In room ${code}`;
});

btnGen.addEventListener("click", () => {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  roomInput.value = rand;
});

btnReady.addEventListener("click", () => {
  if (!roomCode) return;
  if (matchOver) {
    resultEl.className = "result";
    resultEl.textContent = "Match is over. Hit Reset Scores for a rematch.";
    return;
  }
  if (players.length < 2) {
    resultEl.className = "result";
    resultEl.textContent = "You need an opponent to start.";
    return;
  }
  readyState = true;
  youHand.textContent = "❔";
  oppHand.textContent = "❔";
  resultEl.className = "result";
  resultEl.textContent = "Ready! Lock your move.";
  socket.emit("player_ready");
});

btnReset.addEventListener("click", () => {
  if (!roomCode) return;
  socket.emit("reset_scores");
  youHand.textContent = "❔";
  oppHand.textContent = "❔";
  resultEl.className = "result";
  resultEl.textContent = "Scores reset.";
  matchOver = false;
  hideBanner();
});

choiceBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!roomCode) return;
    if (matchOver) {
      resultEl.className = "result";
      resultEl.textContent = "Match is over. Hit Reset Scores for a rematch.";
      return;
    }
    if (!readyState) {
      resultEl.className = "result";
      resultEl.textContent = "Click “I’m Ready” before making a move.";
      return;
    }
    const c = btn.dataset.c;
    socket.emit("make_move", c);
    resultEl.className = "result";
    resultEl.textContent = "Move locked. Waiting for opponent…";
    // Mark yourself as locked (without revealing)
    lockedMoves.add(myId);
    renderPlayers();
  });
});

// Best-of controls
bestofPreset.addEventListener("change", () => {
  const isCustom = bestofPreset.value === "custom";
  bestofCustom.style.display = isCustom ? "inline-block" : "none";
});

applyBestofBtn.addEventListener("click", () => {
  let val = bestofPreset.value === "custom"
    ? parseInt(bestofCustom.value, 10)
    : parseInt(bestofPreset.value, 10);

  if (!Number.isFinite(val) || val < 1) val = 5;
  matchTarget = val;         // best of N
  hideBanner();
  matchOver = false;
  resultEl.className = "result";
  resultEl.textContent = `Best of ${matchTarget} set. Click “I’m Ready” to start a round.`;
});

// Keyboard shortcuts R/P/S
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "r") pick("rock");
  if (key === "p") pick("paper");
  if (key === "s") pick("scissors");
});
function pick(c) {
  const btn = choiceBtns.find((b) => b.dataset.c === c);
  if (btn) btn.click();
}

// ----- Render helpers -----
function renderPlayers() {
  const pill = (name, me, locked, ready) =>
    `<div class="pill">${me ? "🫵" : "👤"} ${name}${ready ? " • ✅" : ""}${locked ? " • 🔒" : ""}</div>`;

  playersEl.innerHTML = players
    .map((p) =>
      pill(
        p.name + (p.id === myId ? " (you)" : ""),
        p.id === myId,
        lockedMoves.has(p.id),
        p.ready
      )
    )
    .join(" ");

  const playing = !!roomCode;
  [...choiceBtns, btnReady, btnReset].forEach((b) => (b.disabled = !playing));
}

function renderScores() {
  if (!players.length) {
    scoresEl.textContent = "";
    // also clear topbar numbers
    topYou.textContent = "0";
    topOpp.textContent = "0";
    topTies.textContent = "0";
    chipYou.classList.add("glow");
    chipOpp.classList.remove("glow");
    return;
  }

  const row = (p) => {
    const s = scores[p.id] || { wins: 0, losses: 0, ties: 0 };
    const marker = p.id === myId ? " (you)" : "";
    return `${p.name}${marker}: ${s.wins}W ${s.losses}L ${s.ties}T`;
  };
  scoresEl.textContent = players.map(row).join("  •  ");

  // Topbar chips
  const me  = players.find(p => p.id === myId);
  const opp = players.find(p => p.id !== myId);

  const ms = (me  && scores[me.id])  || { wins:0, losses:0, ties:0 };
  const os = (opp && scores[opp.id]) || { wins:0, losses:0, ties:0 };

  topYou.textContent = ms.wins;
  topOpp.textContent = os.wins;

  // Show your own ties (avoids double-count confusion when both increment ties)
  topTies.textContent = ms.ties;

  // Glow the leading chip (tie -> your chip glows)
  chipYou.classList.toggle("glow", ms.wins >= os.wins);
  chipOpp.classList.toggle("glow", os.wins > ms.wins);
}

// ----- Match utils -----
function targetWinsFor(bestOf) {
  // First to ceil(N/2)
  return Math.floor(bestOf / 2) + 1;
}

function showBanner({ winnerName, loserName, youWon }) {
  matchBanner.style.display = "block";
  matchBanner.className = "banner " + (youWon ? "win" : "lose");
  const winSticker = "👑";
  const loseSticker = "🚽";
  matchBanner.textContent =
    `${winSticker} ${winnerName} wins the match — ${loserName} gets a ${loseSticker}!`;
}

function hideBanner() {
  matchBanner.style.display = "none";
  matchBanner.className = "banner";
  matchBanner.textContent = "";
}

// ----- Init -----
renderPlayers();
renderScores();
