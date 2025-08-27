// server.js
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// --- Static assets (client) ---
app.use(express.static(path.join(__dirname, "public"), {
  // modest caching for static files
  maxAge: "1h",
  etag: true
}));

// Simple health endpoint for uptime checks
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const server = http.createServer(app);

// Allow setting allowed origins via env, e.g.
// ORIGIN="https://my-site.netlify.app,https://myapp.com"
const allowedOrigins = process.env.ORIGIN
  ? process.env.ORIGIN.split(",").map(s => s.trim())
  : "*";

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 20000,
});

// ---- In-memory room store ----
const rooms = new Map();
// rooms.set(roomCode, {
//   players: Map<socketId, { name, ready: boolean }>
//   moves:   Map<socketId, "rock"|"paper"|"scissors">
//   score:   { [socketId]: { wins:0, losses:0, ties:0 } }
// });

function computeOutcome(a, b) {
  if (a === b) return "tie";
  if (
    (a === "rock"     && b === "scissors") ||
    (a === "paper"    && b === "rock")     ||
    (a === "scissors" && b === "paper")
  ) return "win";
  return "lose";
}

function roomState(room) {
  return {
    players: [...room.players.entries()].map(([id, p]) => ({
      id, name: p.name, ready: !!p.ready
    })),
    scores: room.score
  };
}

// ---- Socket handlers ----
io.on("connection", (socket) => {
  let joinedRoom = null;

  socket.on("join_room", ({ roomCode, name }) => {
    roomCode = String(roomCode || "").trim().toUpperCase();
    if (!roomCode) {
      socket.emit("error_msg", "Room code required.");
      return;
    }

    // create/get room
    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, { players: new Map(), moves: new Map(), score: {} });
    }
    const room = rooms.get(roomCode);

    if (room.players.size >= 2) {
      socket.emit("error_msg", "Room is full (2 players max).");
      return;
    }

    joinedRoom = roomCode;
    socket.join(roomCode);

    room.players.set(socket.id, { name: name || "Player", ready: false });
    room.score[socket.id] = room.score[socket.id] || { wins: 0, losses: 0, ties: 0 };

    io.to(roomCode).emit("room_state", roomState(room));
  });

  // Optional: allow renaming after join (not required by UI, but handy)
  socket.on("rename", (newName) => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.name = String(newName || "Player").slice(0, 40);
    io.to(joinedRoom).emit("room_state", roomState(room));
  });

  socket.on("player_ready", () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.ready = true;
    io.to(joinedRoom).emit("room_state", roomState(room));
  });

  socket.on("make_move", (choice) => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    if (!["rock", "paper", "scissors"].includes(choice)) return;

    room.moves.set(socket.id, choice);

    // Wait until both players have moved
    if (room.players.size === 2 && room.moves.size === 2) {
      const [p1, p2] = [...room.players.keys()];
      const m1 = room.moves.get(p1);
      const m2 = room.moves.get(p2);

      const o1 = computeOutcome(m1, m2);
      const o2 = computeOutcome(m2, m1);

      // Update scores
      if (o1 === "win")  { room.score[p1].wins++;  room.score[p2].losses++; }
      if (o1 === "lose") { room.score[p1].losses++; room.score[p2].wins++;   }
      if (o1 === "tie")  { room.score[p1].ties++;   room.score[p2].ties++;   }

      io.to(joinedRoom).emit("round_result", {
        moves: { [p1]: m1, [p2]: m2 },
        outcomes: { [p1]: o1, [p2]: o2 },
        scores: room.score,
      });

      room.moves.clear();
      // reset ready flags so players click "ready" again
      for (const [, p] of room.players) p.ready = false;
    } else {
      // Let everyone know who has locked a move (without revealing it)
      io.to(joinedRoom).emit("move_locked", { playerId: socket.id });
    }
  });

  socket.on("reset_scores", () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    for (const pid of Object.keys(room.score)) {
      room.score[pid] = { wins: 0, losses: 0, ties: 0 };
    }
    // keep readiness & moves the same? we'll clear moves + ready for clarity
    room.moves.clear();
    for (const [, p] of room.players) p.ready = false;

    io.to(joinedRoom).emit("room_state", roomState(room));
  });

  socket.on("disconnect", () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;

    room.players.delete(socket.id);
    delete room.score[socket.id];
    room.moves.delete(socket.id);

    if (room.players.size === 0) {
      rooms.delete(joinedRoom);
    } else {
      io.to(joinedRoom).emit("room_state", roomState(room));
    }
  });
});

// ---- Start server ----
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log("RPS realtime server listening on http://localhost:" + PORT);
});
