import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import {
  setPlayerChips,
  setPlayers,
  setPlayerNames,
  setPlayerIdx,
} from "../redux/player/playerSlice.js";
import {
  setDealer,
  setTurn,
  setBigBlind,
  setSmallBlind,
  setHost,
} from "../redux/game/gameSlice.js";
import GameTable from "./GameTable.jsx";

export default function Game({ socket }) {
  const { lobbyID } = useParams();

  const host = useSelector((state) => state.game.host);
  const smallBlind = useSelector((state) => state.game.smallBlind);
  const bigBlind = useSelector((state) => state.game.bigBlind);

  const [playerName, setPlayerName] = useState("");
  const [startingChips, setStartingChips] = useState(1000);
  const [hasJoined, setHasJoined] = useState(false);
  const [curSmallBlind, setCurSmallBlind] = useState(10);
  const [curBigBlind, setCurBigBlind] = useState(20);
  const [haveStarted, setHaveStarted] = useState(false);

  const dispatch = useDispatch();

  useEffect(() => {
    socket.on("updatePlayerList", (info) => {
      dispatch(setPlayers(info.players));
      dispatch(setDealer(info.dealer));
      dispatch(setTurn(info.currentTurn));
      dispatch(setPlayerChips(info.playerChips));
      dispatch(setPlayerNames(info.playerNames));
      dispatch(setHost(info.host));
      dispatch(setBigBlind(info.bigBlind));
      dispatch(setSmallBlind(info.smallBlind));

      for (let i = 0; i < info.players.length; i++) {
        if (info.players[i] === socket.id) {
          dispatch(setPlayerIdx(i));
          break;
        }
      }

      if (info.host !== socket.id) {
        setHaveStarted(true);
      }
    });

    socket.on("blindsUpdated", (info) => {
      dispatch(setSmallBlind(info.smallBlind));
      dispatch(setBigBlind(info.bigBlind));
    });

    return () => {
      socket.off("updatePlayerList");
      socket.off("playerJoined");
    };
  }, [lobbyID, socket, dispatch]);

  const handleJoin = () => {
    if (playerName.trim() && startingChips > 0) {
      setHasJoined(true);
      socket.emit("joinRoom", lobbyID, playerName, startingChips);
    } else {
      alert("Please enter a valid name and starting chips!");
    }
  };

  const handleStartGame = () => {
    if (smallBlind > 0 && bigBlind > smallBlind) {
      socket.emit("setBlinds", lobbyID, curSmallBlind, curBigBlind);
      setHaveStarted(true);
    } else {
      alert("Big blind must be greater than small blind.");
    }
  };

  if (!hasJoined) {
    return (
      <div className="game-container">
        <div className="flex justify-center items-center min-h-screen bg-gray-800">
          <div className="bg-gray-900 text-white p-6 rounded shadow-lg">
            <h2 className="text-xl font-bold mb-4">Set Your Name and Chips</h2>
            <div className="mb-4">
              <label className="block mb-1">Name:</label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full px-2 py-1 rounded text-black"
                placeholder="Enter your name"
              />
            </div>
            <div className="mb-4">
              <label className="block mb-1">Starting Chips:</label>
              <input
                type="number"
                value={startingChips}
                onChange={(e) => setStartingChips(parseInt(e.target.value))}
                className="w-full px-2 py-1 rounded text-black"
                placeholder="Enter starting chips"
              />
            </div>
            <button
              onClick={handleJoin}
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
            >
              Join Game
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (host == socket.id && !haveStarted) {
    return (
      <div className="game-container">
        <div className="flex justify-center items-center min-h-screen bg-gray-800">
          <div className="bg-gray-900 text-white p-6 rounded shadow-lg">
            <h2 className="text-2xl font-bold mb-4">Host Controls</h2>
            <div className="flex gap-4">
              <div>
                <label>Small Blind:</label>
                <input
                  type="number"
                  value={curSmallBlind}
                  onChange={(e) => setCurSmallBlind(parseInt(e.target.value))}
                  className="w-full px-2 py-1 rounded text-black"
                />
              </div>
              <div>
                <label>Big Blind:</label>
                <input
                  type="number"
                  value={curBigBlind}
                  onChange={(e) => setCurBigBlind(parseInt(e.target.value))}
                  className="w-full px-2 py-1 rounded text-black"
                />
              </div>
            </div>
            <button
              onClick={handleStartGame}
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded mt-4"
            >
              Start Game
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (haveStarted) {
    return (
      <div className="game-container">
        <GameTable socket={socket} />
      </div>
    );
  }
}
