import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Lobby() {
  const [joinCode, setJoinCode] = useState("");
  const navigate = useNavigate();

  const createLobby = async () => {
    const response = await fetch("/api/create-lobby");
    if (!response) {
      console.log("Error in reading json");
      return;
    }
    const data = await response.json();
    if (!data) {
      console.log("Error in reading json");
      return;
    }
    navigate(`/game/${data.lobbyID}`);
  };

  const joinLobby = () => {
    navigate(`/game/${joinCode}`);
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-900 text-white">
      {/* <div className="flex flex-col items-center justify-center flex-grow space-y-8"> */}
      <header className="w-full py-8 text-center">
        <h1 className="text-7xl font-bold text-yellow-400">Poker Night</h1>
        <p className="text-xl mt-4 text-gray-300">
          Play with Friends Anytime, Anywhere
        </p>
      </header>

      <main className="flex flex-col items-center mt-8">
        <button
          onClick={createLobby}
          className="w-48 py-2 mt-4 text-xl font-semibold bg-green-500 rounded-lg hover:bg-green-600 focus:outline-none"
        >
          Create Lobby
        </button>

        <h2 className="pt-8 font-bold text-2xl">OR</h2>

        <div className="flex flex-col items-center mt-6">
          <input
            type="text"
            placeholder="Enter Lobby Code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            className="w-48 px-4 py-2 text-center bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={joinLobby}
            className="w-48 py-2 mt-4 text-xl font-semibold bg-blue-500 rounded-lg hover:bg-blue-600 focus:outline-none"
          >
            Join Lobby
          </button>
        </div>
      </main>

      <footer className="mt-auto py-4 text-center text-gray-400">
        <p className="text-sm">© Nischay Singh 2024</p>
      </footer>
    </div>
  );
}
