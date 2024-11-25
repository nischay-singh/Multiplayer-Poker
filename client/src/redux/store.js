import { configureStore } from "@reduxjs/toolkit";
import playerReducer from "./player/playerSlice";
import gameReducer from "./game/gameSlice";

const store = configureStore({
  reducer: {
    players: playerReducer,
    game: gameReducer,
  },
});

export default store;
