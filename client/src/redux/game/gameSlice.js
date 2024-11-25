import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  dealer: null,
  currentTurn: 0,
  communityCards: [],
  currentPhase: "pre-flop",
  pot: 0,
  currentBet: 0,
};

const gameSlice = createSlice({
  name: "game",
  initialState,
  reducers: {
    setDealer: (state, action) => {
      state.dealer = action.payload;
    },
    setTurn: (state, action) => {
      state.currentTurn = action.payload;
    },
    resetTurn: (state) => {
      state.currentTurn = 0;
    },
    shiftDealer: (state, action) => {
      const totalPlayers = action.payload;
      const currentDealerIndex = state.dealer ? state.dealer : 0;
      state.dealer = (currentDealerIndex + 1) % totalPlayers;
      state.currentTurn = (state.dealer + 1) % totalPlayers;
    },
    setCommunityCards: (state, action) => {
      state.communityCards = action.payload;
    },
    resetCommunityCards: (state) => {
      state.communityCards = [];
    },
    setCurrentPhase: (state, action) => {
      state.currentPhase = action.payload;
    },
    resetGamePhase: (state) => {
      state.currentPhase = "pre-flop";
    },
    setPot: (state, action) => {
      state.pot   = action.payload;
    },
    resetPot: (state) => {
      state.pot = 0;
    },
    setCurrentBet: (state, action) => {
      state.currentBet = action.payload;
    },
    resetCurrentBet: (state) => {
      state.currentBet = 0;
    },
  },
});

export const {
  setDealer,
  resetTurn,
  shiftDealer,
  setTurn,
  setCommunityCards,
  resetCommunityCards,
  setCurrentPhase,
  resetGamePhase,
  setPot,
  resetPot,
  setCurrentBet,
  resetCurrentBet,
} = gameSlice.actions;
export default gameSlice.reducer;
