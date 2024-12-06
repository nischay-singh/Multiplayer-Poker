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

app.get("/api", (req, res) => {
  res.send("Backend is running");
});

app.get("/api/create-lobby", (req, res) => {
  const lobbyID = uuidv4();
  res.json({ lobbyID });
});

app.use(express.static(path.join(dirname, "/client/dist")));

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

function calculatePots(playerBets, existingPot = 0) {
  const sortedBets = Object.entries(playerBets).sort((a, b) => a[1] - b[1]);
  const pots = [];
  let previousBet = 0;

  let currentPot = existingPot;

  sortedBets.forEach(([player, bet], index) => {
    const eligiblePlayers = sortedBets.slice(index).map(([p]) => p);
    const potSize = (bet - previousBet) * eligiblePlayers.length;
    currentPot += potSize;
    pots.push({ amount: currentPot, players: eligiblePlayers });
    previousBet = bet;
    currentPot = 0; // Reset the pot for subsequent iterations
  });

  return pots;
}

function distributeWinnings(room, pots, winners) {
  pots.forEach((pot) => {
    const potWinners = pot.players.filter((player) => winners.includes(player));
    const splitAmount = Math.floor(pot.amount / potWinners.length);
    potWinners.forEach((winner) => {
      room.playerChips[winner] += splitAmount;
    });
  });

  room.pot = 0; // Reset the pot after distributing winnings
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
      // Check if everyone is all-in
      const activePlayers = room.players.filter(
        (p) => !room.foldedPlayers.includes(p)
      );
      const allInPlayers = activePlayers.filter(
        (p) => room.playerChips[p] === 0
      );

      if (allInPlayers.length > 0) {
        // Move directly to the river phase
        room.phase = "river";

        // Collect all remaining bets into the pot
        activePlayers.forEach((p) => {
          room.pot += room.playerBets[p] || 0;
          room.playerBets[p] = 0;
        });

        // Evaluate hands and determine winners
        const { winners } = evaluateHands(room);

        // Distribute the pot
        const pots = calculatePots(room.playerBets, room.pot);

        distributeWinnings(room, pots, winners);

        room.currentBet = 0;
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

        return;
      }

      // If phase should progress and it's not a special case like small blind call
      if (
        shouldProgressPhase(room) &&
        !(
          room.phase === "pre-flop" &&
          room.currentTurn === (room.dealer + 1) % room.players.length &&
          room.currentBet === room.bigBlind
        )
      ) {
        activePlayers.forEach((p) => {
          room.pot += room.playerBets[p] || 0;
          room.playerBets[p] = 0;
        });

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

      const leftPlayers = activePlayers.filter(
        (id) => !room.foldedPlayers.includes(id)
      );

      const winner = leftPlayers[0];

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
    if (!room) return;

    const player = socket.id;
    const allInAmount = room.playerChips[player];

    if (allInAmount <= 0) {
      return;
    } // Player has no chips left to go all-in

    room.playerBets[player] = (room.playerBets[player] || 0) + allInAmount;
    room.playerChips[player] = 0; // Set chips to 0 for all-in

    if (room.playerBets[player] > room.currentBet) {
      room.lastRaise = room.playerBets[player] - room.currentBet;
      room.currentBet = room.playerBets[player];
    }

    const activePlayers = room.players.filter(
      (p) => !room.foldedPlayers.includes(p) && room.playerChips[p] > 0
    );

    room.currentTurn = getNextActivePlayer(room);

    io.to(roomCode).emit("updateBets", {
      playerBets: room.playerBets,
      playerChips: room.playerChips,
      currentTurn: room.currentTurn,
      currentBet: room.currentBet,
      pot: room.pot,
      lastRaise: room.lastRaise,
    });

    if (activePlayers.length <= 1 && shouldProgressPhase(room)) {
      // If all players are all-in, move straight to the river
      room.phase = "river";
      const activePlayersWithBets = room.players.filter(
        (p) => !room.foldedPlayers.includes(p)
      );

      activePlayersWithBets.forEach((p) => {
        room.pot += room.playerBets[p] || 0;
        room.playerBets[p] = 0;
      });

      const { winners } = evaluateHands(room);

      distributeWinnings(room, calculatePots(room.playerBets), winners);

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

      return;
    }

    if (shouldProgressPhase(room)) {
      // Progress only one phase
      const activePlayersWithBets = room.players.filter(
        (p) => !room.foldedPlayers.includes(p)
      );

      activePlayersWithBets.forEach((p) => {
        room.pot += room.playerBets[p] || 0;
        room.playerBets[p] = 0;
      });

      room.currentBet = 0;

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
        currentTurn: room.currentTurn,
      });
    }
  });

  socket.on("checkChips", (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;

    room.players.forEach((playerID) => {
      if (room.playerChips[playerID] <= 0) {
        // Emit event to the player with 0 chips
        io.to(playerID).emit("outOfChips", {
          message: "You are out of chips!",
        });

        // Remove player from the room
        room.players = room.players.filter((id) => id !== playerID);
        delete room.playerChips[playerID];
        delete room.playerBets[playerID];
        delete room.holeCards[playerID];

        // If the host is removed, reassign host to another player
        if (room.host === playerID && room.players.length > 0) {
          room.host = room.players[0];
        }

        // Update remaining players
        io.to(roomCode).emit("updatePlayerList", {
          players: room.players,
          dealer: room.dealer,
          currentTurn: room.currentTurn,
          playerChips: room.playerChips,
          playerNames: room.playerNames,
          host: room.host,
        });
      }
    });
  });

  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      rooms[roomCode].players = rooms[roomCode].players.filter(
        (id) => id !== socket.id
      );

      delete rooms[roomCode].playerChips[socket.id];

      delete rooms[roomCode].playerBets[socket.id];
      delete rooms[roomCode].holeCards[socket.id];

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
