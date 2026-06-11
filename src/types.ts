/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum PlayerRole {
  BATSMAN = "Batsman",
  BOWLER = "Bowler",
  CON_ALLROUNDER = "All-Rounder",
  WICKETKEEPER = "Wicket-Keeper"
}

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  nationality: "Indian" | "Overseas";
  team: string; // Original default historical team
  basePrice: number; // in Crores
  rating: number; // Overall Rating (1-99)
  battingRating: number;
  bowlingRating: number;
  fieldingRating: number;
  
  // Historical stats
  runs: number;
  strikeRate: number;
  average: number;
  wickets: number;
  economy: number;
  bowlingAverage: number;
  matchesPlayed: number;
  recentForm: number; // 1-10
}

export interface AuctionRoomConfig {
  isPublic: boolean;
  mode: "IPL 2026 Mock Auction" | "Legends Upgraded" | "IPL Legends Auction" | "Mega Auction";
  numTeams: number;
  pursePerTeam: number; // in Crores
  maxSquadSize: number;
  overseasLimit: number;
  bidIncrement: number; // in Crores, e.g., 0.2, 0.5
  timerDuration: number; // in seconds, e.g., 15
  autoSell: boolean;
  allowLateJoin: boolean;
  allowUnsoldRound: boolean;
  allowAcceleratedRound: boolean;
}

export interface RoomParticipant {
  id: string;
  name: string;
  teamCode: string | null; // claimed team short code, e.g. MI, CSK, etc.
  isHost: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface AuctionPlayer {
  id: string;
  playerId: string;
  name: string;
  role: PlayerRole;
  nationality: "Indian" | "Overseas";
  basePrice: number;
  rating: number;
  battingRating: number;
  bowlingRating: number;
  avatar?: string;
  
  // Auction specific status
  status: "unsold" | "sold" | "available" | "bidding";
  soldTo: string | null; // Team Code
  soldPrice: number | null; // in Crores
}

export interface Bid {
  id: string;
  roomCode: string;
  playerId: string;
  teamCode: string;
  amount: number; // in Crores
  timestamp: number;
}

export interface AuctionState {
  roomCode: string;
  status: "waiting" | "active" | "paused" | "completed";
  currentPlayerIndex: number;
  currentPlayerId: string | null;
  currentBid: number; // in Crores
  currentBidder: string | null; // Team Code
  timerRemaining: number;
  bidsHistory: Bid[];
  isAccelerating: boolean;
}

// Simulated Tournament Types
export interface SimulatedFranchise {
  teamCode: string;
  name: string;
  ownerName: string;
  purse: number; // Current purse remaining
  originalPurse: number;
  squad: AuctionPlayer[];
  strength: {
    batting: number;
    bowling: number;
    overall: number;
  };
}

export interface SimulatedMatch {
  id: string;
  matchNum: number;
  stage: "League" | "Qualifier 1" | "Eliminator" | "Qualifier 2" | "Final";
  teamA: string; // TeamCode
  teamB: string; // TeamCode
  venue: string;
  winner: string | null; // TeamCode
  margin: string | null;
  scoreCard?: {
    teamAScore: { runs: number; wickets: number; overs: number };
    teamBScore: { runs: number; wickets: number; overs: number };
    firstInningsBatting: BattingScoreRow[];
    firstInningsBowling: BowlingScoreRow[];
    secondInningsBatting: BattingScoreRow[];
    secondInningsBowling: BowlingScoreRow[];
    winnerCode: string;
    playerOfTheMatch: string;
    tossWinner: string;
    tossDecision: "bat" | "bowl";
  };
  simulated: boolean;
}

export interface BattingScoreRow {
  playerName: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: number;
  howOut: string;
}

export interface BowlingScoreRow {
  playerName: string;
  overs: number;
  maidens: number;
  runs: number;
  wickets: number;
  economy: number;
}

export interface PointsTableEntry {
  teamCode: string;
  teamName: string;
  played: number;
  won: number;
  lost: number;
  points: number;
  nrr: number; // Net Run Rate
}

export interface HistoricalStats {
  years: number[];
  champions: { year: number; team: string }[];
  topScorers: { year: number; player: string; runs: number }[];
  topWicketTakers: { year: number; player: string; wickets: number }[];
}
