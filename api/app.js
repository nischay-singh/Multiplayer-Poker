const express = require("express");
const http = require("http");
const cors = require("cors");
const socket = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { createDeck, shuffleDeck } = require("./utils");
const PokerEvaluator = require("poker-evaluator");

const app = express();
const PORT = 3000;

app.use(cors());

const server = http.createServer(app);

const io = socket(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.send("Backend is running");
});

app.get("/api/create-lobby", (req, res) => {
  const lobbyID = uuidv4();
  res.json({ lobbyID });
});

const rooms = {};

function dealCards(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const deck = shuffleDeck(createDeck());
  room.deck = deck;

  room.holeCards = room.players.reduce((acc, player) => {
    acc[player] = [deck.pop(), deck.pop()];
    return acc;
  }, {});

  room.communityCards = [
    deck.pop(),
    deck.pop(),
    deck.pop(),
    deck.pop(),
    deck.pop(),
  ];
}

function resetRoomForNewRound(roomCode) {
  const room = rooms[roomCode];
  room.dealer = (room.dealer + 1) % room.players.length;
  room.currentTurn = (room.dealer + 1) % room.players.length;
  room.phase = "pre-flop";
  room.pot = 0;
  room.currentBet = 0;
  room.playerBets = {};
  room.foldedPlayers = [];
  dealCards(roomCode);
  room.lastRaiseAmount = room.bigBlind;
}

function shouldProgressPhase(room) {
  const activePlayers = room.players.filter(
    (player) => !room.foldedPlayers.includes(player)
  );

  return activePlayers.every((player) => {
    const playerBet = room.playerBets[player] || 0;
    return playerBet === (room.currentBet || 0);
  });
}

function evaluateHands(room) {
  const activePlayers = room.players.filter(
    (player) => !room.foldedPlayers.includes(player)
  );

  let bestHandRank = -1;
  let winners = [];
  let handDetails = {};

  activePlayers.forEach((player) => {
    const playerCards = [...room.holeCards[player], ...room.communityCards];

    for (let i = 0; i < playerCards.length; i++) {
      let card = playerCards[i];
      let l = card.length;
      if (l === 3) {
        // handle 10s
        playerCards[i] = "T" + card[l - 1].toLowerCase();
      } else {
        playerCards[i] = card[0] + card[1].toLowerCase();
      }
    }

    const evaluation = PokerEvaluator.evalHand(playerCards);

    handDetails[player] = evaluation; // Store details for debugging or display

    if (evaluation.value > bestHandRank) {
      bestHandRank = evaluation.value;
      winners = [player];
    } else if (evaluation.value === bestHandRank) {
      winners.push(player); // Handle ties
    }
  });

  return { winners, handDetails };
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("joinRoom", (roomCode) => {
    socket.join(roomCode);
    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        players: [],
        dealer: 0,
        currentTurn: 0,
        deck: [],
        holeCards: {},
        communityCards: [],
        phase: "pre-flop",
        pot: 0,
        currentBet: 0,
        playerBets: {},
        playerChips: {},
        foldedPlayers: [],
        bigBlind: 20,
        lastRaise: 0,
      };
    }
    const room = rooms[roomCode];
    room.players.push(socket.id);
    room.playerChips[socket.id] = 1000;

    io.to(roomCode).emit("updatePlayerList", {
      players: room.players,
      dealer: room.dealer,
      currentTurn: room.currentTurn,
      playerChips: room.playerChips,
    });
  });

  socket.on("startNewRound", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) {
      return;
    }

    resetRoomForNewRound(roomCode);

    const totalPlayers = room.players.length;
    const sbIndex = (room.dealer + 1) % totalPlayers;
    const bbIndex = (room.dealer + 2) % totalPlayers;

    const sbAmount = 10; // Default Small Blind
    const bbAmount = 20; // Default Big Blind

    room.playerBets[room.players[sbIndex]] = sbAmount;
    room.playerChips[room.players[sbIndex]] -= sbAmount;

    room.playerBets[room.players[bbIndex]] = bbAmount;
    room.playerChips[room.players[bbIndex]] -= bbAmount;

    room.currentBet = bbAmount;
    room.currentTurn = (bbIndex + 1) % totalPlayers;

    io.to(roomCode).emit("gameStarted", {
      holeCards: room.holeCards,
      communityCards: [],
      dealer: room.dealer,
      currentTurn: room.currentTurn,
      phase: room.phase,
    });

    io.to(roomCode).emit("updateBets", {
      playerBets: room.playerBets,
      playerChips: room.playerChips,
      currentTurn: room.currentTurn,
      currentBet: room.currentBet,
      pot: room.pot,
      lastRaise: 20, // big blind
    });
  });

  socket.on("raise", (roomCode, totalBet) => {
    const room = rooms[roomCode];
    if (!room) {
      return;
    }

    const player = socket.id;

    const raiseAmount = totalBet - room.currentBet;
    const minRaise = room.lastRaise || 20;

    if (
      totalBet > room.currentBet &&
      raiseAmount >= minRaise &&
      room.playerChips[player] >= raiseAmount
    ) {
      room.playerChips[player] -= totalBet - room.playerBets[player];
      room.playerBets[player] = totalBet;

      room.lastRaise = totalBet - room.playerBets[player];
      room.currentBet = totalBet;

      room.currentTurn = (room.currentTurn + 1) % room.players.length;

      io.to(roomCode).emit("updateBets", {
        playerBets: room.playerBets,
        playerChips: room.playerChips,
        currentTurn: room.currentTurn,
        currentBet: room.currentBet,
        pot: room.pot,
        lastRaise: room.lastRaise,
      });
    } else {
      socket.emit("raiseError", {
        message: `Raise must be at least ${minRaise} and you must have enough chips.`,
      });
    }
  });

  socket.on("call", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) {
      return;
    }

    const player = socket.id;
    const callAmount = room.currentBet - (room.playerBets[player] || 0);

    if (room.playerChips[player] >= callAmount) {
      room.playerChips[player] -= callAmount;
      room.playerBets[player] = room.currentBet;

      room.currentTurn = (room.currentTurn + 1) % room.players.length;

      const activePlayers = room.players.filter(
        (p) => !room.foldedPlayers.includes(p)
      );
      const shouldProgress = activePlayers.every(
        (p) => room.playerBets[p] === (room.currentBet || 0)
      );

      if (shouldProgress) {
        for (const playerID of activePlayers) {
          room.pot += room.playerBets[playerID] || 0;
          room.playerBets[playerID] = 0;
        }
        room.currentBet = 0;

        if (room.phase === "river") {
          io.to(roomCode).emit("handEnded", { pot: room.pot });
        } else {
          let cardsToReveal = 0;
          if (room.phase === "pre-flop") {
            room.phase = "flop";
            cardsToReveal = 3;
          } else if (room.phase === "flop") {
            room.phase = "turn";
            cardsToReveal = 4;
          } else if (room.phase === "turn") {
            room.phase = "river";
            cardsToReveal = 5;
          }

          io.to(roomCode).emit("phaseUpdate", {
            communityCards: room.communityCards.slice(0, cardsToReveal),
            phase: room.phase,
          });
        }
      }

      io.to(roomCode).emit("updateBets", {
        playerBets: room.playerBets,
        playerChips: room.playerChips,
        pot: room.pot,
        currentTurn: room.currentTurn,
        currentBet: room.currentBet,
      });
    }
  });

  socket.on("fold", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) {
      return;
    }

    const player = socket.id;
    if (!room.foldedPlayers.includes(player)) {
      room.foldedPlayers.push(player);
    }

    io.to(roomCode).emit("playerFolded", {
      player,
      foldedPlayers: room.foldedPlayers,
    });

    const activePlayers = room.players.filter(
      (id) => !room.foldedPlayers.includes(id)
    );

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];

      // calculate pot
      Object.entries(room.playerBets).forEach(([key, value]) => {
        room.pot += value;
        room.playerBets[key] = 0;
      });

      room.playerChips[winner] += room.pot;
      room.pot = 0;

      io.to(roomCode).emit("gameEnded", {
        winners: [winner],
      });

      io.to(roomCode).emit("updateBets", {
        playerBets: room.playerBets,
        playerChips: room.playerChips,
        pot: room.pot,
        currentTurn: room.currentTurn,
        currentBet: room.currentBet,
      });
    } else {
      room.currentTurn = (room.currentTurn + 1) % room.players.length;

      while (room.foldedPlayers.includes(room.players[room.currentTurn])) {
        room.currentTurn = (room.currentTurn + 1) % room.players.length;
      }

      io.to(roomCode).emit("turnChanged", {
        currentTurn: room.currentTurn,
      });
    }
  });

  socket.on("check", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) {
      return;
    }

    const player = room.players[room.currentTurn];

    if (player === socket.id) {
      if (room.currentTurn === room.dealer && shouldProgressPhase(room)) {
        if (room.phase === "river") {
          const { winners, handDetails } = evaluateHands(room);

          const splitPot = Math.floor(room.pot / winners.length);
          winners.forEach((winner) => {
            room.playerChips[winner] += splitPot;
          });

          room.pot = 0;

          io.to(roomCode).emit("gameEnded", {
            winners,
            handDetails,
            playerChips: room.playerChips,
          });

          io.to(roomCode).emit("updateBets", {
            playerBets: room.playerBets,
            playerChips: room.playerChips,
            pot: room.pot,
            currentTurn: room.currentTurn,
            currentBet: room.currentBet,
          });
        } else {
          let cardsToReveal = 0;
          if (room.phase === "pre-flop") {
            room.phase = "flop";
            cardsToReveal = 3;
          } else if (room.phase === "flop") {
            room.phase = "turn";
            cardsToReveal = 4;
          } else if (room.phase === "turn") {
            room.phase = "river";
            cardsToReveal = 5;
          }

          io.to(roomCode).emit("phaseUpdate", {
            communityCards: room.communityCards.slice(0, cardsToReveal),
            phase: room.phase,
          });
        }
      }
      room.currentTurn = (room.currentTurn + 1) % room.players.length;

      io.to(roomCode).emit("turnChanged", { currentTurn: room.currentTurn });
    }
  });

  socket.on("determineWinner", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) {
      return;
    }

    const { winners, handDetails } = evaluateHands(room);

    const splitPot = Math.floor(room.pot / winners.length);
    winners.forEach((winner) => {
      room.playerChips[winner] += splitPot;
    });

    io.to(roomCode).emit("gameEnded", {
      winners,
      handDetails,
      playerChips: room.playerChips,
    });

    io.to(roomCode).emit("updateBets", {
      playerBets: room.playerBets,
      playerChips: room.playerChips,
      pot: room.pot,
      currentTurn: room.currentTurn,
      currentBet: room.currentBet,
    });
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      rooms[roomCode].players = rooms[roomCode].players.filter(
        (id) => id !== socket.id
      );

      delete rooms[roomCode].playerChips[socket.id];

      if (rooms[roomCode].players.length === 0) {
        delete rooms[roomCode];
      } else {
        io.to(roomCode).emit("updatePlayerList", {
          players: rooms[roomCode].players,
          dealer: rooms[roomCode].dealer,
          currentTurn: rooms[roomCode].currentTurn,
          playerChips: rooms[roomCode].playerChips,
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
