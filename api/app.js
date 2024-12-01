const express = require("express");
const http = require("http");
const cors = require("cors");
const socket = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { createDeck, shuffleDeck } = require("./utils");
const PokerEvaluator = require("poker-evaluator");
const path = require("path");

const dirname = path.resolve();
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

app.use(express.static(path.join(dirname, "/client/dist")));

app.get("/", (req, res) => {
  res.send("Backend is running");
});

app.get("/api/create-lobby", (req, res) => {
  const lobbyID = uuidv4();
  res.json({ lobbyID });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "dist", "index.html"));
});

const rooms = {};

function dealCards(roomCode) {
  const room = rooms[roomCode];
  if (!room) {
    return;
  }

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

  let ret = activePlayers.every((player) => {
    const playerBet = room.playerBets[player] || 0;
    return (
      playerBet === (room.currentBet || 0) || room.playerChips[player] === 0 // handle all-in case
    );
  });

  return ret;
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

function getNextActivePlayer(room) {
  let nextTurn = (room.currentTurn + 1) % room.players.length;

  while (room.foldedPlayers.includes(room.players[nextTurn])) {
    nextTurn = (nextTurn + 1) % room.players.length;
  }

  return nextTurn;
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("joinRoom", (roomCode, playerName, startingChips) => {
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
        playerNames: {},
        foldedPlayers: [],
        bigBlind: 20,
        smallBlind: 10,
        lastRaise: 0,
        host: socket.id,
      };
    }
    const room = rooms[roomCode];
    room.players.push(socket.id);
    room.playerChips[socket.id] = startingChips;
    room.playerNames[socket.id] = playerName;

    io.to(roomCode).emit("updatePlayerList", {
      players: room.players,
      dealer: room.dealer,
      currentTurn: room.currentTurn,
      playerChips: room.playerChips,
      playerNames: room.playerNames,
      host: room.host,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
    });
  });

  socket.on("setBlinds", (roomCode, smallBlind, bigBlind) => {
    const room = rooms[roomCode];
    if (room && room.host === socket.id) {
      room.smallBlind = smallBlind;
      room.bigBlind = bigBlind;

      io.to(roomCode).emit("blindsUpdated", {
        smallBlind: room.smallBlind,
        bigBlind: room.bigBlind,
      });
    } else {
      socket.emit("error", { message: "Only the host can set the blinds." });
    }
  });

  socket.on("startNewRound", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) {
      return;
    }

    if (room.host !== socket.id) {
      socket.emit("error", { message: "Only the host can start the round." });
      return;
    }

    resetRoomForNewRound(roomCode);

    const totalPlayers = room.players.length;
    const sbIndex = (room.dealer + 1) % totalPlayers;
    const bbIndex = (room.dealer + 2) % totalPlayers;

    room.playerBets[room.players[sbIndex]] = room.smallBlind;
    room.playerChips[room.players[sbIndex]] -= room.smallBlind;

    room.playerBets[room.players[bbIndex]] = room.bigBlind;
    room.playerChips[room.players[bbIndex]] -= room.bigBlind;

    room.currentBet = room.bigBlind;
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
      lastRaise: room.bigBlind,
    });
  });

  socket.on("raise", (roomCode, totalBet) => {
    const room = rooms[roomCode];
    if (!room) {
      return;
    }

    const player = socket.id;

    const raiseAmount = totalBet - room.currentBet;
    const minRaise = room.lastRaise || room.bigBlind;

    if (
      totalBet > room.currentBet &&
      raiseAmount >= minRaise &&
      room.playerChips[player] >= raiseAmount
    ) {
      room.playerChips[player] -= totalBet - room.playerBets[player];
      room.playerBets[player] = totalBet;

      room.lastRaise = totalBet - room.playerBets[player];
      room.currentBet = totalBet;

      room.currentTurn = getNextActivePlayer(room);

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
      if (
        shouldProgressPhase(room) &&
        !(
          room.phase === "pre-flop" &&
          room.currentTurn === (room.dealer + 1) % room.players.length &&
          room.currentBet === room.bigBlind
        ) // dont progress if small blind flat calls
      ) {
        const activePlayers = room.players.filter(
          (player) => !room.foldedPlayers.includes(player)
        );

        for (const playerID of activePlayers) {
          room.pot += room.playerBets[playerID] || 0;
          room.playerBets[playerID] = 0;
        }
        room.currentBet = 0;

        if (room.phase === "river") {
          const { winners } = evaluateHands(room);

          const splitPot = Math.floor(room.pot / winners.length);
          winners.forEach((winner) => {
            room.playerChips[winner] += splitPot;
          });

          room.pot = 0;

          io.to(roomCode).emit("gameEnded", {
            winners,
            playerChips: room.playerChips,
            holeCards: room.holeCards,
          });

          io.to(roomCode).emit("updateBets", {
            playerBets: room.playerBets,
            playerChips: room.playerChips,
            pot: room.pot,
            currentTurn: room.currentTurn,
            currentBet: room.currentBet,
          });

          room.currentTurn = room.dealer;
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

          room.currentTurn = room.dealer;

          io.to(roomCode).emit("phaseUpdate", {
            communityCards: room.communityCards.slice(0, cardsToReveal),
            phase: room.phase,
            currentTurn: room.currentTurn,
          });
        }
      }
      room.currentTurn = getNextActivePlayer(room);

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

    const activePlayers = room.players.filter(
      (id) => !room.foldedPlayers.includes(id)
    );

    if (activePlayers.length === 2) {
      const player = socket.id;
      if (!room.foldedPlayers.includes(player)) {
        room.foldedPlayers.push(player);
      }

      io.to(roomCode).emit("playerFolded", {
        player,
        foldedPlayers: room.foldedPlayers,
      });

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
        playerChips: room.playerChips,
        holeCards: room.holeCards,
      });

      io.to(roomCode).emit("updateBets", {
        playerBets: room.playerBets,
        playerChips: room.playerChips,
        pot: room.pot,
        currentTurn: room.currentTurn,
        currentBet: room.currentBet,
      });
    } else {
      const tempTurn = room.currentTurn;
      room.currentTurn = room.dealer;
      const firstTurn = getNextActivePlayer(room);
      room.currentTurn = tempTurn;
      const nextTurn = getNextActivePlayer(room);

      if (nextTurn === firstTurn && shouldProgressPhase(room)) {
        const activePlayers = room.players.filter(
          (player) => !room.foldedPlayers.includes(player)
        );

        for (const playerID of activePlayers) {
          room.pot += room.playerBets[playerID] || 0;
          room.playerBets[playerID] = 0;
        }
        room.currentBet = 0;

        if (room.phase === "river") {
          const { winners } = evaluateHands(room);

          const splitPot = Math.floor(room.pot / winners.length);
          winners.forEach((winner) => {
            room.playerChips[winner] += splitPot;
          });

          room.pot = 0;

          io.to(roomCode).emit("gameEnded", {
            winners,
            playerChips: room.playerChips,
            holeCards: room.holeCards,
          });

          io.to(roomCode).emit("updateBets", {
            playerBets: room.playerBets,
            playerChips: room.playerChips,
            pot: room.pot,
            currentTurn: room.currentTurn,
            currentBet: room.currentBet,
          });

          room.currentTurn = room.dealer;
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

          room.currentTurn = room.dealer;

          io.to(roomCode).emit("phaseUpdate", {
            communityCards: room.communityCards.slice(0, cardsToReveal),
            phase: room.phase,
            currentTurn: room.currentTurn,
          });
        }
      }
      const player = socket.id;
      if (!room.foldedPlayers.includes(player)) {
        room.foldedPlayers.push(player);
      }

      io.to(roomCode).emit("playerFolded", {
        player,
        foldedPlayers: room.foldedPlayers,
      });

      room.currentTurn = getNextActivePlayer(room);

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

    const tempTurn = room.currentTurn;
    room.currentTurn = room.dealer;
    const firstTurn = getNextActivePlayer(room);
    room.currentTurn = tempTurn;
    const nextTurn = getNextActivePlayer(room);

    if (player === socket.id) {
      if (
        (nextTurn === firstTurn && shouldProgressPhase(room)) ||
        (room.phase === "pre-flop" &&
          room.currentTurn === (room.dealer + 2) % room.players.length &&
          room.currentBet === room.playerBets[room.players[room.currentTurn]])
      ) {
        if (room.phase === "river") {
          const { winners } = evaluateHands(room);

          const splitPot = Math.floor(room.pot / winners.length);
          winners.forEach((winner) => {
            room.playerChips[winner] += splitPot;
          });

          room.pot = 0;

          io.to(roomCode).emit("gameEnded", {
            winners,
            playerChips: room.playerChips,
            holeCards: room.holeCards,
          });

          io.to(roomCode).emit("updateBets", {
            playerBets: room.playerBets,
            playerChips: room.playerChips,
            pot: room.pot,
            currentTurn: room.currentTurn,
            currentBet: room.currentBet,
          });

          room.currentTurn = room.dealer;
        } else {
          let cardsToReveal = 0;
          if (room.phase === "pre-flop") {
            Object.entries(room.playerBets).forEach(([key, value]) => {
              room.pot += value;
              room.playerBets[key] = 0;
            });

            room.phase = "flop";
            cardsToReveal = 3;
            room.currentBet = 0;

            io.to(roomCode).emit("updateBets", {
              playerBets: room.playerBets,
              playerChips: room.playerChips,
              pot: room.pot,
              currentTurn: room.currentTurn,
              currentBet: room.currentBet,
            });
          } else if (room.phase === "flop") {
            room.phase = "turn";
            cardsToReveal = 4;
          } else if (room.phase === "turn") {
            room.phase = "river";
            cardsToReveal = 5;
          }
          room.currentTurn = room.dealer;

          io.to(roomCode).emit("phaseUpdate", {
            communityCards: room.communityCards.slice(0, cardsToReveal),
            phase: room.phase,
            currentTurn: room.currentTurn,
          });
        }
      }
      room.currentTurn = getNextActivePlayer(room);

      io.to(roomCode).emit("turnChanged", { currentTurn: room.currentTurn });
    }
  });

  socket.on("allIn", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) {
      return;
    }

    const player = socket.id;

    const allInAmount = room.playerChips[player];
    if (allInAmount <= 0) {
      return;
    }

    room.playerBets[player] = (room.playerBets[player] || 0) + allInAmount;
    room.playerChips[player] = 0;

    if (room.playerBets[player] > room.currentBet) {
      room.lastRaise = room.playerBets[player] - room.currentBet;
      room.currentBet = room.playerBets[player];
    }

    room.currentTurn = getNextActivePlayer(room);

    io.to(roomCode).emit("updateBets", {
      playerBets: room.playerBets,
      playerChips: room.playerChips,
      currentTurn: room.currentTurn,
      currentBet: room.currentBet,
      pot: room.pot,
      lastRaise: room.lastRaise,
    });

    if (shouldProgressPhase(room)) {
      const activePlayers = room.players.filter(
        (p) => !room.foldedPlayers.includes(p)
      );

      for (const playerID of activePlayers) {
        room.pot += room.playerBets[playerID] || 0;
        room.playerBets[playerID] = 0;
      }
      room.currentBet = 0;

      const { winners } = evaluateHands(room);

      const splitPot = Math.floor(room.pot / winners.length);
      winners.forEach((winner) => {
        room.playerChips[winner] += splitPot;
      });

      room.pot = 0;

      io.to(roomCode).emit("phaseUpdate", {
        communityCards: room.communityCards.slice(0, 5),
        phase: room.phase,
        currentTurn: room.currentTurn,
      });

      io.to(roomCode).emit("gameEnded", {
        winners,
        playerChips: room.playerChips,
        holeCards: room.holeCards,
      });

      io.to(roomCode).emit("updateBets", {
        playerBets: room.playerBets,
        playerChips: room.playerChips,
        pot: room.pot,
        currentTurn: room.currentTurn,
        currentBet: room.currentBet,
      });

      room.currentTurn = room.dealer;
    }
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
        if (rooms[roomCode].host === socket.id) {
          rooms[roomCode].host = rooms[roomCode].players[0];
        }

        io.to(roomCode).emit("updatePlayerList", {
          players: rooms[roomCode].players,
          dealer: rooms[roomCode].dealer,
          currentTurn: rooms[roomCode].currentTurn,
          playerChips: rooms[roomCode].playerChips,
          playerNames: rooms[roomCode].playerNames,
          host: rooms[roomCode].host,
          smallBlind: rooms[roomCode].smallBlind,
          bigBlind: rooms[roomCode].bigBlind,
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
