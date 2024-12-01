import React, { useEffect } from "react";
import io from "socket.io-client";
import Lobby from "./components/Lobby";
import ScrollToTop from "./components/ScrollToTop";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Game from "./components/Game";

const socket = io({ forceNew: true });

export default function App() {
  useEffect(() => {
    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/game/:lobbyID" element={<Game socket={socket} />} />
      </Routes>
    </BrowserRouter>
  );
}
