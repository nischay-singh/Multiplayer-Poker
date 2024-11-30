import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  players: [],
  playerChips: {},
  playerBets: {},
  foldedPlayers: [],
  playerNames: {},
  playerIdx: 0,
};

const playerSlice = createSlice({
  name: "players",
  initialState,
  reducers: {
    setPlayers: (state, action) => {
      state.players = action.payload;
    },
    setPlayerChips: (state, action) => {
      state.playerChips = action.payload;
    },
    setPlayerNames: (state, action) => {
      state.playerNames = action.payload;
    },
    setPlayerBet: (state, action) => {
      state.playerBets = action.payload;
    },
    addFoldedPlayer: (state, action) => {
      const playerId = action.payload;
      if (!state.foldedPlayers.includes(playerId)) {
        state.foldedPlayers.push(playerId);
      }
    },
    resetPlayerBets: (state) => {
      state.playerBets = {};
    },
    resetFoldedPlayers: (state) => {
      state.foldedPlayers = [];
    },
    setPlayerIdx: (state, action) => {
      state.playerIdx = action.payload;
    },
  },
});

export const {
  setPlayers,
  setPlayerChips,
  setPlayerBet,
  addFoldedPlayer,
  resetPlayerBets,
  resetFoldedPlayers,
  setPlayerNames,
  setPlayerIdx,
} = playerSlice.actions;
export default playerSlice.reducer;
