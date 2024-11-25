import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import { setPlayerChips, setPlayers } from "../redux/player/playerSlice.js";
import { setDealer, setTurn } from "../redux/game/gameSlice.js";
import GameTable from "./GameTable.jsx";

export default function Game({ socket }) {
  const { lobbyID } = useParams();
  const dispatch = useDispatch();

  useEffect(() => {
    socket.emit("joinRoom", lobbyID);

    socket.on("updatePlayerList", (info) => {
      dispatch(setPlayers(info.players));
      dispatch(setDealer(info.dealer));
      dispatch(setTurn(info.currentTurn));
      dispatch(setPlayerChips(info.playerChips));
    });

    return () => {
      socket.off("updatePlayerList");
      socket.off("playerJoined");
    };
  }, [lobbyID, socket]);

  return (
    <div className="game-container">
      <GameTable socket={socket} />
    </div>
  );
}
