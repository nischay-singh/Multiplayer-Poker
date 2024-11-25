import React, { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  setDealer,
  setTurn,
  setCommunityCards,
  setCurrentPhase,
  setPot,
  setCurrentBet,
} from "../redux/game/gameSlice";
import {
  setPlayers,
  setPlayerChips,
  setPlayerBet,
  addFoldedPlayer,
  resetFoldedPlayers,
} from "../redux/player/playerSlice";
import { useParams } from "react-router-dom";

export default function GameTable({ socket }) {
  const players = useSelector((state) => state.players.players);
  const playerChips = useSelector((state) => state.players.playerChips);
  const playerBets = useSelector((state) => state.players.playerBets);
  const foldedPlayers = useSelector((state) => state.players.foldedPlayers);

  const dealer = useSelector((state) => state.game.dealer);
  const currentTurn = useSelector((state) => state.game.currentTurn);
  const communityCards = useSelector((state) => state.game.communityCards);
  const pot = useSelector((state) => state.game.pot);
  const currentPhase = useSelector((state) => state.game.currentPhase);
  const currentBet = useSelector((state) => state.game.currentBet);

  const { lobbyID } = useParams();
  const dispatch = useDispatch();

  const [holeCards, setHoleCards] = useState({});
  const [isRaising, setIsRaising] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState("");
  const [minRaise, setMinRaise] = useState(20); // min raise is initially the big blind
  const [hasGameEnded, setHasGameEnded] = useState(false);
  const [gameWinner, setGameWinner] = useState(null);
  // const [winningHands, setWinningHands] = useState({});

  useEffect(() => {
    socket.on("updatePlayerList", (info) => {
      dispatch(setPlayers(info.players));
      dispatch(setDealer(info.dealer));
      dispatch(setTurn(info.currentTurn));
      dispatch(setPlayerChips(info.playerChips));
    });

    socket.on("turnChanged", (info) => {
      dispatch(setTurn(info.currentTurn));
    });

    socket.on("updateDealerTurn", (info) => {
      dispatch(setDealer(info.dealer));
      dispatch(setTurn(info.currentTurn));
    });

    socket.on("gameStarted", (info) => {
      setHoleCards(info.holeCards);
      dispatch(setCommunityCards([]));
      dispatch(setCurrentPhase(info.phase));
      dispatch(setTurn(info.currentTurn));
      dispatch(setDealer(info.dealer));
      dispatch(resetFoldedPlayers());
      setHasGameEnded(false); // Reset game end state
      setGameWinner(null);
    });

    socket.on("phaseUpdate", (info) => {
      dispatch(setCommunityCards(info.communityCards));
      dispatch(setCurrentPhase(info.phase));
      setMinRaise(20); // set to big blind
    });

    socket.on("updateBets", (info) => {
      dispatch(setPlayerBet(info.playerBets));
      dispatch(setPlayerChips(info.playerChips));
      dispatch(setTurn(info.currentTurn));
      dispatch(setCurrentBet(info.currentBet));
      dispatch(setPot(info.pot));

      let curMinRaise = info.currentBet - (info.lastRaise || 20);
      if (curMinRaise < 20) {
        curMinRaise = 20;
      }
      setMinRaise(curMinRaise);
    });

    socket.on("updatePot", (info) => {
      dispatch(updatePot(info.pot));
      dispatch(setPlayerChips(info.playerChips));
    });

    socket.on("playerFolded", (info) => {
      dispatch(addFoldedPlayer(info.player));
    });

    socket.on("gameEnded", (info) => {
      setGameWinner(info.winners);
      setHasGameEnded(true);
    });

    return () => {
      socket.off("updatePlayerList");
      socket.off("turnChanged");
      socket.off("updateDealerTurn");
      socket.off("gameStarted");
      socket.off("phaseUpdate");
      socket.off("updateBets");
      socket.off("setPot");
      socket.off("playerFolded");
      socket.off("gameEnded");
    };
  }, [dispatch]);

  const handleCheck = () => {
    if (socket.id === players[currentTurn] && currentBet === 0) {
      socket.emit("check", lobbyID);
    }
  };

  const handleRaiseConfirm = () => {
    const playerChipsAvailable = playerChips[socket.id] || 0;

    if (!raiseAmount || isNaN(raiseAmount)) {
      alert("Please enter a valid raise amount.");
      return;
    }

    const totalRaiseAmount = parseInt(raiseAmount);

    console.log(totalRaiseAmount, minRaise);

    if (totalRaiseAmount <= currentBet) {
      alert("Raise amount must be greater than the current bet.");
    } else if (totalRaiseAmount > playerChipsAvailable) {
      alert("You do not have enough chips to make this raise.");
    } else if (totalRaiseAmount - currentBet < minRaise) {
      alert(
        `Raise amount must be at least ${minRaise} more than the current bet.`
      );
    } else {
      socket.emit("raise", lobbyID, totalRaiseAmount);
      setIsRaising(false);
      setRaiseAmount("");
    }
  };

  const handleCall = () => {
    const callAmount = currentBet - (playerBets[socket.id] || 0);
    if (
      socket.id === players[currentTurn] &&
      currentBet > 0 &&
      playerChips[socket.id] >= callAmount
    ) {
      socket.emit("call", lobbyID);
    }
  };

  const handleFold = () => {
    if (socket.id === players[currentTurn]) {
      socket.emit("fold", lobbyID);
    }
  };

  const handleNewRound = () => {
    socket.emit("startNewRound", lobbyID);
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-800">
      <div className="bg-green-700 w-3/4 md:h-[65vh] h-[45vh] border-8 border-yellow-950 rounded-full relative flex items-center justify-center">
        <div className="text-white text-lg font-bold absolute bottom-2/3 transform -translate-y-1/2 text-center">
          <p>Pot: {pot}</p>
          <p>Phase: {currentPhase}</p>
        </div>

        <div className="flex gap-4 absolute">
          {communityCards.map((card, index) => (
            <div
              key={index}
              className="card bg-white rounded-md flex items-center justify-center shadow-md w-[50px] md:w-[70px] xl:w-[100px]"
            >
              <img
                src={`/cards/${card}.svg`}
                alt={card}
                className="w-full h-full object-contain"
              />
            </div>
          ))}
        </div>

        {players.map((playerID, index) => (
          <div
            key={playerID}
            className={`text-center text-white absolute seat-${index + 1} ${
              foldedPlayers.includes(playerID) ||
              (hasGameEnded && !gameWinner.includes(playerID))
                ? "opacity-50"
                : ""
            }`}
          >
            <div className="flex gap-1 mt-2">
              {holeCards[playerID]?.map((card, i) => (
                <div
                  key={i}
                  className={`bg-white rounded-md shadow-md w-[40px] md:w-[40px] xl:w-[60px] ${
                    i === 0 ? "-rotate-6" : "rotate-6"
                  }`}
                >
                  <img
                    src={`/cards/${
                      playerID === socket.id ? card : "RED_BACK"
                    }.svg`}
                    alt="Card"
                    className="w-full h-full object-contain"
                  />
                </div>
              ))}
            </div>

            <p>
              Player {index + 1}
              {index === dealer ? " (D)" : ""}
              {index === (dealer + 1) % players.length ? " (SB)" : ""}
              {index === (dealer + 2) % players.length ? " (BB)" : ""}
              {index === currentTurn ? " (T)" : ""}
            </p>

            <p>Bet: {playerBets[playerID] || 0}</p>
            <p>Chips: {playerChips[playerID] || 0}</p>
          </div>
        ))}

        {hasGameEnded && gameWinner && (
          <div className="absolute top-4 left-4 bg-gray-900 text-white p-4 rounded shadow-md">
            <h3 className="font-bold">Game Ended!</h3>
            <p>
              Winner(s): {gameWinner.join(", ")}
              {/* <br /> Hand Details: {JSON.stringify(gameWinner.handDetails)} */}
            </p>
          </div>
        )}

        <div className="absolute action-button">
          {socket.id === players[currentTurn] && (
            <div className="flex gap-2">
              <button
                onClick={handleCheck}
                disabled={socket.id !== players[currentTurn] || currentBet > 0}
                className={`${
                  socket.id !== players[currentTurn] || currentBet > 0
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-blue-500 hover:bg-blue-700"
                } text-white font-bold py-2 px-4 rounded`}
              >
                Check
              </button>

              <button
                onClick={handleCall}
                disabled={
                  socket.id !== players[currentTurn] ||
                  currentBet === 0 ||
                  playerChips[socket.id] <
                    currentBet - (playerBets[socket.id] || 0) ||
                  hasGameEnded
                }
                className={`${
                  socket.id !== players[currentTurn] ||
                  currentBet === 0 ||
                  playerChips[socket.id] <
                    currentBet - (playerBets[socket.id] || 0)
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-yellow-500 hover:bg-yellow-700"
                } text-white font-bold py-2 px-4 rounded`}
              >
                Call
              </button>

              {isRaising ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={raiseAmount}
                    onChange={(e) => setRaiseAmount(e.target.value)}
                    className="px-2 py-1 rounded border border-gray-400 absolute raising-input"
                    placeholder="Enter amount"
                    disabled={hasGameEnded}
                  />
                  <button
                    onClick={handleRaiseConfirm}
                    className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setIsRaising(false)}
                    className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsRaising(true)}
                  disabled={socket.id !== players[currentTurn] || hasGameEnded}
                  className={`${
                    socket.id !== players[currentTurn]
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-green-500 hover:bg-green-700"
                  } text-white font-bold py-2 px-4 rounded`}
                >
                  Raise
                </button>
              )}

              <button
                onClick={handleFold}
                disabled={socket.id !== players[currentTurn] || hasGameEnded}
                className={`${
                  socket.id !== players[currentTurn]
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-red-500 hover:bg-red-700"
                } text-white font-bold py-2 px-4 rounded`}
              >
                Fold
              </button>
            </div>
          )}
        </div>

        {players.length > 1 && (
          <button
            onClick={handleNewRound}
            className="absolute bg-yellow-500 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded round-button md:text-md lg:text-lg"
          >
            Start New Round
          </button>
        )}
      </div>
    </div>
  );
}
