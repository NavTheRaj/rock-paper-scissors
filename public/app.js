// public/app.js
const socket = io();

const qs = (sel) => document.querySelector(sel);
const roomInput = qs("#room");
const nameInput = qs("#name");
const statusEl = qs("#status");
const playersEl = qs("#players");
const youHand = qs("#youHand");
const oppHand = qs("#oppHand");
const resultEl = qs("#result");
const scoresEl = qs("#scores");

const btnJoin = qs("#btnJoin");
const btnGen = qs("#btnGen");
const btnReady = qs("#btnReady");
const btnReset = qs("#btnReset");
const choiceBtns = [...document.querySelectorAll(".choice")];

let myId = null;
let roomCode = null;
let players = [];
let scores = {};
let lockedMoves = new Set();
let readyState = false;

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
  scores = state.scores || {};
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
  const meMove = moves[myId];
  const oppId = Object.keys(moves).find((id) => id !== myId);
  const oppMove = oppId ? moves[oppId] : null;

  const emoji = { rock: "✊", paper: "✋", scissors: "✌️" };
  youHand.textContent = meMove ? emoji[meMove] : "❔";
  oppHand.textContent = oppMove ? emoji[oppMove] : "❔";

  const myOutcome = outcomes[myId];
  resultEl.className = "result " + (myOutcome || "");
  if (myOutcome === "win") resultEl.textContent = "You win this round!";
  if (myOutcome === "lose") resultEl.textContent = "You lose this round.";
  if (myOutcome === "tie") resultEl.textContent = "Tie.";

  lockedMoves.clear();
  readyState = false;
  renderPlayers();
  renderScores();
});

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
});

choiceBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!roomCode) return;
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

function renderPlayers() {
  const pill = (name, me, locked, ready) =>
    `<div class="pill">${me ? "🫵" : "👤"} ${name}${ready ? " • ✅" : ""}${
      locked ? " • 🔒" : ""
    }</div>`;

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

  // disable controls if not in room
  const playing = !!roomCode;
  [...choiceBtns, btnReady, btnReset].forEach((b) => (b.disabled = !playing));
}

function renderScores() {
  if (!players.length) {
    scoresEl.textContent = "";
    return;
  }
  const row = (p) => {
    const s = scores[p.id] || { wins: 0, losses: 0, ties: 0 };
    const marker = p.id === myId ? " (you)" : "";
    return `${p.name}${marker}: ${s.wins}W ${s.losses}L ${s.ties}T`;
  };
  scoresEl.textContent = players.map(row).join("  •  ");
}

// initial UI
renderPlayers();
renderScores();
