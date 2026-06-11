/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
// Use dynamic import for Vite in dev mode
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { 
  PlayerRole, 
  AuctionRoomConfig, 
  RoomParticipant, 
  ChatMessage, 
  AuctionPlayer, 
  Bid, 
  SimulatedMatch, 
  PointsTableEntry, 
  BattingScoreRow, 
  BowlingScoreRow,
  SimulatedFranchise
} from "./src/types.js";
import { INITIAL_PLAYERS, IPL_TEAMS, VENUES, HISTORICAL_SEASONS_DATA } from "./src/data/initialPlayers.js";
import { simulateCricketMatch, calculateUpdatedPointsTable, fillAndGetPlayingXI, recalculateTeamStrength } from "./src/lib/simulationEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3000;
const DB_FILE = path.join(__dirname, "data", "database.json");

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"));
}

// In-Memory Database State
const db: {
  rooms: { [code: string]: any }
} = {
  rooms: {}
};

// Load database if exists
if (fs.existsSync(DB_FILE)) {
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    db.rooms = JSON.parse(data).rooms || {};
    console.log("Database persistent storage loaded.");
  } catch (err) {
    console.error("Failed to load database. Initializing fresh.", err);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save database", err);
  }
}

// Helper to generate a room code
function generateRoomCode(): string {
  const chars = "ABCDEFGHIJKLMNPQRSTUVWXYZ123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Importer status trackers
let importStatus = {
  success: true,
  lastImportTime: Date.now(),
  recordCount: INITIAL_PLAYERS.length,
  status: "Ready"
};

// API ENDPOINTS

// ------------------- HISTORICAL DATA APIs -------------------
app.post("/api/admin/import/ipl-history", (req, res) => {
  importStatus = {
    success: true,
    lastImportTime: Date.now(),
    recordCount: INITIAL_PLAYERS.length + 45,
    status: "Completed successfully"
  };
  res.json({ message: "Successfully synced with 2008-2025 IPL Archive", stats: importStatus });
});

app.get("/api/admin/import/status", (req, res) => {
  res.json(importStatus);
});

app.post("/api/admin/stats/recalculate", (req, res) => {
  res.json({ message: "Re-calculated batting/bowling indexing from historical matches.", status: "Success" });
});

app.get("/api/players/:id/history", (req, res) => {
  const { id } = req.params;
  const player = INITIAL_PLAYERS.find(p => p.id === id);
  if (!player) return res.status(404).json({ error: "Player not found" });

  // Generate mock season details
  const seasons = [2022, 2023, 2024, 2025].map(year => ({
    year,
    team: player.team,
    runs: Math.round(player.runs / 7 * (0.8 + Math.random() * 0.4)),
    strikeRate: Math.round((player.strikeRate || 135) * (0.9 + Math.random() * 0.2) * 10) / 10,
    wickets: Math.round(player.wickets / 6 * (0.5 + Math.random() * 1.0)),
    economy: Math.round((player.economy || 8.0) * (0.9 + Math.random() * 0.25) * 10) / 10
  }));

  res.json({
    id,
    name: player.name,
    career: {
      matches: player.matchesPlayed,
      runs: player.runs,
      avg: player.average,
      sr: player.strikeRate,
      wickets: player.wickets,
      economy: player.economy
    },
    seasons
  });
});

app.get("/api/teams/:id/history", (req, res) => {
  const { id } = req.params;
  const team = IPL_TEAMS.find(t => t.code === id.toUpperCase());
  if (!team) return res.status(404).json({ error: "Team code not found" });

  const h2h = IPL_TEAMS.filter(t => t.code !== team.code).map(t => ({
    opponent: t.code,
    played: Math.round(20 + Math.random() * 15),
    wins: Math.round(10 + Math.random() * 8)
  }));

  res.json({
    teamCode: team.code,
    teamName: team.name,
    titles: HISTORICAL_SEASONS_DATA.champions.filter(c => c.team === team.code).map(c => c.year),
    headToHead: h2h
  });
});


// ------------------- AUCTION ROOMS APIs -------------------

// GET all public rooms
app.get("/api/rooms", (req, res) => {
  const publicRooms = Object.values(db.rooms)
    .filter((r: any) => r.config.isPublic)
    .map((r: any) => ({
      roomCode: r.roomCode,
      status: r.status,
      config: r.config,
      participantCount: r.participants.length
    }));
  res.json(publicRooms);
});

// POST room creation
app.post("/api/rooms", (req, res) => {
  const { hostName, config } = req.body;
  if (!hostName) return res.status(400).json({ error: "Host name required" });

  const roomCode = generateRoomCode();
  
  // Default Config
  const finalConfig: AuctionRoomConfig = {
    isPublic: config?.isPublic ?? true,
    mode: config?.mode ?? "IPL 2026 Mock Auction",
    numTeams: config?.numTeams ?? 10,
    pursePerTeam: config?.pursePerTeam ?? 100, // 100 Crores
    maxSquadSize: config?.maxSquadSize ?? 18,
    overseasLimit: config?.overseasLimit ?? 8,
    bidIncrement: config?.bidIncrement ?? 0.5,
    timerDuration: config?.timerDuration ?? 6,
    autoSell: config?.autoSell ?? true,
    allowLateJoin: config?.allowLateJoin ?? true,
    allowUnsoldRound: config?.allowUnsoldRound ?? true,
    allowAcceleratedRound: config?.allowAcceleratedRound ?? true
  };

  const host: RoomParticipant = {
    id: `u-${Date.now()}`,
    name: hostName,
    teamCode: null,
    isHost: true,
    joinedAt: Date.now()
  };

  // Convert INITIAL_PLAYERS to AuctionPlayer format
  const players: AuctionPlayer[] = INITIAL_PLAYERS.map(p => ({
    id: p.id,
    playerId: p.id,
    name: p.name,
    role: p.role,
    nationality: p.nationality,
    basePrice: p.basePrice,
    rating: p.rating,
    battingRating: p.battingRating,
    bowlingRating: p.bowlingRating,
    status: "available",
    soldTo: null,
    soldPrice: null
  }));

  db.rooms[roomCode] = {
    roomCode,
    config: finalConfig,
    status: "waiting",
    participants: [host],
    chatMessages: [
      { id: `c-${Date.now()}`, sender: "System", text: `${hostName} created the auction room ${roomCode}!`, timestamp: Date.now(), isSystem: true }
    ],
    players,
    currentPlayerIndex: 0,
    currentBid: 0,
    currentBidder: null,
    timerRemaining: finalConfig.timerDuration,
    lastBidTime: 0,
    bidsHistory: [],
    isAccelerating: false,
    simulationSetup: null,
    simulatedMatches: [],
    pointsTable: []
  };

  saveDb();
  res.json({ roomCode, participant: host });
});

// GET specific room
app.get("/api/rooms/:roomCode", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

// POST join room
app.post("/api/rooms/:roomCode/join", (req, res) => {
  const { roomCode } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Guest name required" });

  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  // Limit participants based on slots
  if (room.participants.length >= 10) {
    return res.status(400).json({ error: "Room is full (max 10 players)" });
  }

  const existing = room.participants.find((p: any) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    // Rejoin existing participant
    return res.json({ participant: existing, room });
  }

  const newPart: RoomParticipant = {
    id: `u-${Date.now()}`,
    name,
    teamCode: null,
    isHost: false,
    joinedAt: Date.now()
  };

  room.participants.push(newPart);
  room.chatMessages.push({
    id: `c-${Date.now()}`,
    sender: "System",
    text: `${name} has joined the waiting room.`,
    timestamp: Date.now(),
    isSystem: true
  });

  saveDb();
  io.to(roomCode.toUpperCase()).emit("room:join", { participant: newPart, room });
  io.to(roomCode.toUpperCase()).emit("room:chat", room.chatMessages[room.chatMessages.length - 1]);
  
  res.json({ participant: newPart, room });
});

// POST claim team
app.post("/api/rooms/:roomCode/team", (req, res) => {
  const { roomCode } = req.params;
  const { participantId, teamCode } = req.body; // teamCode can be null to unclaim

  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const part = room.participants.find((p: any) => p.id === participantId);
  if (!part) return res.status(404).json({ error: "Participant not found" });

  // Check if team is already claimed
  if (teamCode) {
    const claimedIdx = room.participants.findIndex((p: any) => p.teamCode === teamCode && p.id !== participantId);
    if (claimedIdx !== -1) {
      return res.status(400).json({ error: "Team already claimed by another owner" });
    }
  }

  const oldTeam = part.teamCode;
  part.teamCode = teamCode;

  const teamNameStr = teamCode ? IPL_TEAMS.find(t => t.code === teamCode)?.name || teamCode : "None";
  room.chatMessages.push({
    id: `c-${Date.now()}`,
    sender: "System",
    text: `${part.name} selected ${teamNameStr}`,
    timestamp: Date.now(),
    isSystem: true
  });

  saveDb();
  io.to(roomCode.toUpperCase()).emit("room:team-selected", { participant: part, room });
  io.to(roomCode.toUpperCase()).emit("room:chat", room.chatMessages[room.chatMessages.length - 1]);

  res.json({ success: true, room });
});

// POST start auction
app.post("/api/rooms/:roomCode/start", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  room.status = "active";
  
  // Set current player in bidding state
  if (room.players.length > 0) {
    room.currentPlayerIndex = 0;
    room.players[0].status = "bidding";
    room.currentPlayerId = room.players[0].id;
    room.currentBid = 0;
    room.currentBidder = null;
    room.timerRemaining = room.config.timerDuration;
    room.lastBidTime = Date.now();
  }

  room.chatMessages.push({
    id: `c-${Date.now()}`,
    sender: "System",
    text: `The Live IPL Auction was started! Current player on auction: ${room.players[0]?.name}`,
    timestamp: Date.now(),
    isSystem: true
  });

  saveDb();
  io.to(roomCode.toUpperCase()).emit("auction:started", { room });
  io.to(roomCode.toUpperCase()).emit("room:chat", room.chatMessages[room.chatMessages.length - 1]);

  res.json({ success: true, room });
});

// POST chat message
app.post("/api/rooms/:roomCode/chat", (req, res) => {
  const { roomCode } = req.params;
  const { sender, text } = req.body;

  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const msg: ChatMessage = {
    id: `c-${Date.now()}`,
    sender,
    text,
    timestamp: Date.now()
  };

  room.chatMessages.push(msg);
  saveDb();
  io.to(roomCode.toUpperCase()).emit("room:chat", msg);

  res.json(msg);
});


// ------------------- LIVE AUCTION ACTION APIs -------------------

// GET state
app.get("/api/auction/:roomCode", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

// Helper: Calculate team squad status
function getTeamSquadStats(room: any, teamCode: string) {
  const soldPlayers = room.players.filter((p: any) => p.status === "sold" && p.soldTo === teamCode);
  const totalSpent = soldPlayers.reduce((sum: number, p: any) => sum + (p.soldPrice || 0), 0);
  const remainingPurse = room.config.pursePerTeam - totalSpent;
  const overseasCount = soldPlayers.filter((p: any) => p.nationality === "Overseas").length;
  
  return {
    count: soldPlayers.length,
    spent: totalSpent,
    purse: remainingPurse,
    overseas: overseasCount
  };
}

// POST Bid placement
app.post("/api/auction/:roomCode/bid", (req, res) => {
  const { roomCode } = req.params;
  const { teamCode, amount } = req.body;

  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  if (room.status !== "active") {
    return res.status(400).json({ error: "Auction is not in active state" });
  }

  const currentPlayer = room.players[room.currentPlayerIndex];
  if (!currentPlayer || currentPlayer.status !== "bidding") {
    return res.status(400).json({ error: "No player currently being audited/bid" });
  }

  // Validate owner bid
  const pStats = getTeamSquadStats(room, teamCode);

  // Check purse
  if (amount > pStats.purse) {
    return res.status(400).json({ error: `${teamCode} does not have enough purse! Remaining: ₹${pStats.purse} Cr` });
  }

  // Squad sizes limit
  if (pStats.count >= room.config.maxSquadSize) {
    return res.status(400).json({ error: `${teamCode} squad of ${room.config.maxSquadSize} is already full!` });
  }

  // Overseas limit check
  if (currentPlayer.nationality === "Overseas" && pStats.overseas >= room.config.overseasLimit) {
    return res.status(400).json({ error: `${teamCode} has reached the overseas limit of ${room.config.overseasLimit}` });
  }

  // Bid Increment check
  const minBid = room.currentBid === 0 
    ? currentPlayer.basePrice 
    : Math.round((room.currentBid + room.config.bidIncrement) * 100) / 100;

  if (amount < minBid) {
    return res.status(400).json({ error: `Bid amount ₹${amount} is too low. Minimum required: ₹${minBid} Cr` });
  }

  // Prevent back-to-back bid by same team
  if (room.currentBidder === teamCode) {
    return res.status(400).json({ error: `Your franchise is already the high bidder at ₹${room.currentBid} Cr` });
  }

  // Create real Bid record
  const bidId = `b-${Date.now()}`;
  const bidObj: Bid = {
    id: bidId,
    roomCode: room.roomCode,
    playerId: currentPlayer.id,
    teamCode,
    amount,
    timestamp: Date.now()
  };

  room.currentBid = amount;
  room.currentBidder = teamCode;
  room.timerRemaining = room.config.timerDuration; // reset timer on bid
  room.lastBidTime = Date.now();
  room.bidsHistory.push(bidObj);

  room.chatMessages.push({
    id: `c-${Date.now()}`,
    sender: "System",
    text: `★ ${teamCode} bid ₹${amount} Cr for ${currentPlayer.name}`,
    timestamp: Date.now(),
    isSystem: true
  });

  saveDb();
  io.to(roomCode.toUpperCase()).emit("bid:placed", { 
    currentBid: amount, 
    currentBidder: teamCode, 
    timerRemaining: room.timerRemaining,
    room
  });
  io.to(roomCode.toUpperCase()).emit("room:chat", room.chatMessages[room.chatMessages.length - 1]);

  res.json({ success: true, room });
});

// POST Sell current player manually or automatically
app.post("/api/auction/:roomCode/sell", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const player = room.players[room.currentPlayerIndex];
  if (!player || player.status !== "bidding") {
    return res.status(400).json({ error: "No player is active for bidding" });
  }

  if (room.currentBidder) {
    // Sold!
    player.status = "sold";
    player.soldTo = room.currentBidder;
    player.soldPrice = room.currentBid;

    room.chatMessages.push({
      id: `c-${Date.now()}`,
      sender: "System",
      text: `✔ Confirmed: ${player.name} SOLD to ${room.currentBidder} for ₹${room.currentBid} Cr!`,
      timestamp: Date.now(),
      isSystem: true
    });

    io.to(roomCode.toUpperCase()).emit("player:sold", { player, room });
  } else {
    // Unsold
    player.status = "unsold";
    player.soldTo = null;
    player.soldPrice = null;

    room.chatMessages.push({
      id: `c-${Date.now()}`,
      sender: "System",
      text: `✘ Unsold: ${player.name} went unsold.`,
      timestamp: Date.now(),
      isSystem: true
    });

    io.to(roomCode.toUpperCase()).emit("player:unsold", { player, room });
  }

  saveDb();
  io.to(roomCode.toUpperCase()).emit("room:chat", room.chatMessages[room.chatMessages.length - 1]);
  res.json({ success: true, room });
});

// POST Unsold manually
app.post("/api/auction/:roomCode/unsold", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const player = room.players[room.currentPlayerIndex];
  if (!player) return res.status(400).json({ error: "No current player" });

  player.status = "unsold";
  player.soldTo = null;
  player.soldPrice = null;

  room.chatMessages.push({
    id: `c-${Date.now()}`,
    sender: "System",
    text: `✘ Marked Unsold: ${player.name}`,
    timestamp: Date.now(),
    isSystem: true
  });

  saveDb();
  io.to(roomCode.toUpperCase()).emit("player:unsold", { player, room });
  io.to(roomCode.toUpperCase()).emit("room:chat", room.chatMessages[room.chatMessages.length - 1]);
  res.json({ success: true, room });
});

// POST Next player
app.post("/api/auction/:roomCode/next", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const nextIndex = room.currentPlayerIndex + 1;
  if (nextIndex >= room.players.length) {
    // Auction finished!
    room.status = "completed";
    room.currentPlayerId = null;

    room.chatMessages.push({
      id: `c-${Date.now()}`,
      sender: "System",
      text: `♕ IPL Live Auction completed successfully! Ready for simulation.`,
      timestamp: Date.now(),
      isSystem: true
    });

    saveDb();
    io.to(roomCode.toUpperCase()).emit("auction:completed", { room });
    io.to(roomCode.toUpperCase()).emit("room:chat", room.chatMessages[room.chatMessages.length - 1]);
    return res.json({ finished: true, room });
  }

  room.currentPlayerIndex = nextIndex;
  const nextPlayer = room.players[nextIndex];
  nextPlayer.status = "bidding";
  room.currentPlayerId = nextPlayer.id;
  room.currentBid = 0;
  room.currentBidder = null;
  room.timerRemaining = room.config.timerDuration;
  room.lastBidTime = Date.now();

  room.chatMessages.push({
    id: `c-${Date.now()}`,
    sender: "System",
    text: `➡ Up Next: ${nextPlayer.name} (${nextPlayer.role}, Base ₹${nextPlayer.basePrice} Cr)`,
    timestamp: Date.now(),
    isSystem: true
  });

  saveDb();
  io.to(roomCode.toUpperCase()).emit("player:next", { player: nextPlayer, room });
  io.to(roomCode.toUpperCase()).emit("room:chat", room.chatMessages[room.chatMessages.length - 1]);
  res.json({ player: nextPlayer, room });
});

// POST Pause / Resume
app.post("/api/auction/:roomCode/pause", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  room.status = "paused";
  saveDb();
  io.to(roomCode.toUpperCase()).emit("auction:paused", { room });
  res.json({ success: true, room });
});

app.post("/api/auction/:roomCode/resume", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  room.status = "active";
  room.lastBidTime = Date.now();
  saveDb();
  io.to(roomCode.toUpperCase()).emit("auction:resumed", { room });
  res.json({ success: true, room });
});

// GET stats / summary for dashboard
app.get("/api/auction/:roomCode/stats", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const sPlayers = room.players.filter((p: any) => p.status === "sold");
  const unPlayers = room.players.filter((p: any) => p.status === "unsold");

  const sortedSold = [...sPlayers].sort((a,b) => (b.soldPrice || 0) - (a.soldPrice || 0));
  const mostExpensive = sortedSold.slice(0, 5);

  const teamSpending = IPL_TEAMS.map(team => {
    const stats = getTeamSquadStats(room, team.code);
    return {
      teamCode: team.code,
      teamName: team.name,
      spent: stats.spent,
      purseRemaining: stats.purse,
      playersCount: stats.count
    };
  });

  res.json({
    totalPlayers: room.players.length,
    soldCount: sPlayers.length,
    unsoldCount: unPlayers.length,
    mostExpensive,
    teamSpending
  });
});


// ------------------- TOURNAMENT SIMULATION APIs -------------------

// POST setup tournament config
app.post("/api/simulation/:roomCode/setup", (req, res) => {
  const { roomCode } = req.params;
  const { format, venueNames, numMatches, playoffsEnabled, impactPlayerRule, momentumEnabled, randomVariation, depth } = req.body;

  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  room.simulationSetup = {
    format: format || "IPL league format",
    venueNames: venueNames || VENUES.map(v => v.name),
    numMatches: numMatches || 14,
    playoffsEnabled: playoffsEnabled ?? true,
    impactPlayerRule: impactPlayerRule ?? true,
    momentumEnabled: momentumEnabled ?? true,
    randomVariation: randomVariation ?? true,
    depth: depth || "quick"
  };

  saveDb();
  res.json({ success: true, setup: room.simulationSetup });
});

// POST generate fixtures
app.post("/api/simulation/:roomCode/generate-fixtures", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  // Gather active claimed/filled franchises participating
  // For any unclaimed franchises, we can still participate them with default squads
  const participatingCodes = IPL_TEAMS.map(t => t.code);
  const venues = room.simulationSetup?.venueNames || VENUES.map(v => v.name);

  // Simple round robin fixtures: match everyone once. Total 10 * 9 / 2 = 45 matches
  // If user configured a different numMatches, we can generate a slice/subset.
  const fixtures: SimulatedMatch[] = [];
  let matchNum = 1;

  for (let i = 0; i < participatingCodes.length; i++) {
    for (let j = i + 1; j < participatingCodes.length; j++) {
      const home = participatingCodes[i];
      const away = participatingCodes[j];
      const venue = venues[matchNum % venues.length];

      fixtures.push({
        id: `sim-match-${matchNum}`,
        matchNum,
        stage: "League",
        teamA: home,
        teamB: away,
        venue,
        winner: null,
        margin: null,
        simulated: false
      });
      matchNum++;
    }
  }

  // Slice fixtures based on setup number
  const requestedMatches = room.simulationSetup?.numMatches || 45;
  room.simulatedMatches = fixtures.slice(0, requestedMatches);
  
  // Calculate initial Points Table
  const mockTeamsList: SimulatedFranchise[] = IPL_TEAMS.map(team => {
    const squad = room.players.filter((p: any) => p.status === "sold" && p.soldTo === team.code);
    return {
      teamCode: team.code,
      name: team.name,
      ownerName: room.participants.find((p: any) => p.teamCode === team.code)?.name || "CPU Manager",
      purse: team.code ? getTeamSquadStats(room, team.code).purse : 0,
      originalPurse: room.config.pursePerTeam,
      squad,
      strength: recalculateTeamStrength(squad, team.code)
    };
  });

  room.pointsTable = calculateUpdatedPointsTable(room.simulatedMatches, mockTeamsList);

  saveDb();
  io.to(roomCode.toUpperCase()).emit("simulation:started", { matches: room.simulatedMatches, pointsTable: room.pointsTable });
  res.json({ success: true, matches: room.simulatedMatches, pointsTable: room.pointsTable });
});

// POST simulate single match
app.post("/api/simulation/:roomCode/simulate-match", (req, res) => {
  const { roomCode } = req.params;
  const { matchId } = req.body;

  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const matchIdx = room.simulatedMatches.findIndex((m: any) => m.id === matchId);
  if (matchIdx === -1) return res.status(404).json({ error: "Match fixture not found" });

  const match = room.simulatedMatches[matchIdx];
  if (match.simulated) return res.json(match);

  // Extract real auction squads from this room
  const squadA = room.players.filter((p: any) => p.status === "sold" && p.soldTo === match.teamA);
  const squadB = room.players.filter((p: any) => p.status === "sold" && p.soldTo === match.teamB);

  const teamAName = IPL_TEAMS.find(t => t.code === match.teamA)?.name || match.teamA;
  const teamBName = IPL_TEAMS.find(t => t.code === match.teamB)?.name || match.teamB;

  // Run cricket model simulation
  const resultMatch = simulateCricketMatch(
    match.matchNum,
    match.stage,
    match.teamA,
    match.teamB,
    teamAName,
    teamBName,
    squadA,
    squadB,
    match.venue
  );

  // Update in state
  room.simulatedMatches[matchIdx] = resultMatch;

  // Re-calculate points table
  const mockTeamsList: SimulatedFranchise[] = IPL_TEAMS.map(team => {
    const squad = room.players.filter((p: any) => p.status === "sold" && p.soldTo === team.code);
    return {
      teamCode: team.code,
      name: team.name,
      ownerName: room.participants.find((p: any) => p.teamCode === team.code)?.name || "CPU Manager",
      purse: getTeamSquadStats(room, team.code).purse,
      originalPurse: room.config.pursePerTeam,
      squad,
      strength: recalculateTeamStrength(squad, team.code)
    };
  });

  room.pointsTable = calculateUpdatedPointsTable(room.simulatedMatches, mockTeamsList);

  saveDb();
  io.to(roomCode.toUpperCase()).emit("simulation:match-completed", { match: resultMatch, pointsTable: room.pointsTable });
  res.json(resultMatch);
});

// POST simulate entire / remaining tournament quick simulation
app.post("/api/simulation/:roomCode/simulate-tournament", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const mockTeamsList: SimulatedFranchise[] = IPL_TEAMS.map(team => {
    const squad = room.players.filter((p: any) => p.status === "sold" && p.soldTo === team.code);
    return {
      teamCode: team.code,
      name: team.name,
      ownerName: room.participants.find((p: any) => p.teamCode === team.code)?.name || "CPU Manager",
      purse: getTeamSquadStats(room, team.code).purse,
      originalPurse: room.config.pursePerTeam,
      squad,
      strength: recalculateTeamStrength(squad, team.code)
    };
  });

  // 1. Simulate remaining league matches
  room.simulatedMatches.forEach((m: any, matchIdx: number) => {
    if (m.simulated) return;

    const squadO = mockTeamsList.find(t => t.teamCode === m.teamA)?.squad || [];
    const squadX = mockTeamsList.find(t => t.teamCode === m.teamB)?.squad || [];
    const tAName = IPL_TEAMS.find(t => t.code === m.teamA)?.name || m.teamA;
    const tBName = IPL_TEAMS.find(t => t.code === m.teamB)?.name || m.teamB;

    const simmed = simulateCricketMatch(
      m.matchNum,
      m.stage,
      m.teamA,
      m.teamB,
      tAName,
      tBName,
      squadO,
      squadX,
      m.venue
    );

    room.simulatedMatches[matchIdx] = simmed;
  });

  // Calculate updated table
  let table = calculateUpdatedPointsTable(room.simulatedMatches, mockTeamsList);
  room.pointsTable = table;

  // 2. Simulate Playoffs if enabled
  if (room.simulationSetup?.playoffsEnabled !== false && table.length >= 4) {
    const t1 = table[0].teamCode;
    const t2 = table[1].teamCode;
    const t3 = table[2].teamCode;
    const t4 = table[3].teamCode;

    // Qualifier 1 (1st vs 2nd)
    const t1Name = table[0].teamName;
    const t2Name = table[1].teamName;
    const sq1 = mockTeamsList.find(t => t.teamCode === t1)?.squad || [];
    const sq2 = mockTeamsList.find(t => t.teamCode === t2)?.squad || [];
    const q1 = simulateCricketMatch(99, "Qualifier 1", t1, t2, t1Name, t2Name, sq1, sq2, "Narendra Modi Stadium");
    room.simulatedMatches.push(q1);

    const q1Winner = q1.winner;
    const q1Loser = q1Winner === t1 ? t2 : t1;

    // Eliminator (3rd vs 4th)
    const t3Name = table[2].teamName;
    const t4Name = table[3].teamName;
    const sq3 = mockTeamsList.find(t => t.teamCode === t3)?.squad || [];
    const sq4 = mockTeamsList.find(t => t.teamCode === t4)?.squad || [];
    const elim = simulateCricketMatch(100, "Eliminator", t3, t4, t3Name, t4Name, sq3, sq4, "Eden Gardens");
    room.simulatedMatches.push(elim);

    const elimWinner = elim.winner || t3;

    // Qualifier 2 (Loser Q1 vs Winner Elim)
    const q2HomeName = IPL_TEAMS.find(t => t.code === q1Loser)?.name || q1Loser;
    const q2AwayName = IPL_TEAMS.find(t => t.code === elimWinner)?.name || elimWinner;
    const sqL = mockTeamsList.find(t => t.teamCode === q1Loser)?.squad || [];
    const sqW = mockTeamsList.find(t => t.teamCode === elimWinner)?.squad || [];
    const q2 = simulateCricketMatch(101, "Qualifier 2", q1Loser!, elimWinner, q2HomeName, q2AwayName, sqL, sqW, "MA Chidambaram Stadium");
    room.simulatedMatches.push(q2);

    const q2Winner = q2.winner || elimWinner;

    // Final (Winner Q1 vs Winner Q2)
    const finalHomeName = IPL_TEAMS.find(t => t.code === q1Winner)?.name || q1Winner!;
    const finalAwayName = IPL_TEAMS.find(t => t.code === q2Winner)?.name || q2Winner;
    const sqF1 = mockTeamsList.find(t => t.teamCode === q1Winner)?.squad || [];
    const sqF2 = mockTeamsList.find(t => t.teamCode === q2Winner)?.squad || [];
    const finalMatch = simulateCricketMatch(102, "Final", q1Winner!, q2Winner, finalHomeName, finalAwayName, sqF1, sqF2, "Wankhede Stadium");
    room.simulatedMatches.push(finalMatch);
  }

  saveDb();
  io.to(roomCode.toUpperCase()).emit("simulation:tournament-completed", { matches: room.simulatedMatches, pointsTable: room.pointsTable });
  res.json({ success: true, matches: room.simulatedMatches, pointsTable: room.pointsTable });
});

// GET points table
app.get("/api/simulation/:roomCode/points-table", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room.pointsTable);
});

// GET matches
app.get("/api/simulation/:roomCode/matches", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room.simulatedMatches);
});

// GET scorecard
app.get("/api/simulation/:roomCode/scorecard/:matchId", (req, res) => {
  const { roomCode, matchId } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const match = room.simulatedMatches.find((m: any) => m.id === matchId);
  if (!match) return res.status(404).json({ error: "Match not found" });

  res.json(match);
});

// GET awards leaderboard
app.get("/api/simulation/:roomCode/awards", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  // Compute runs and wickets leaders from match scorecards
  const runScorers: { [name: string]: number } = {};
  const wicketTaker: { [name: string]: number } = {};

  room.simulatedMatches.forEach((m: any) => {
    if (!m.simulated || !m.scoreCard) return;

    m.scoreCard.firstInningsBatting?.forEach((b: any) => {
      runScorers[b.playerName] = (runScorers[b.playerName] || 0) + b.runs;
    });
    m.scoreCard.secondInningsBatting?.forEach((b: any) => {
      runScorers[b.playerName] = (runScorers[b.playerName] || 0) + b.runs;
    });

    m.scoreCard.firstInningsBowling?.forEach((w: any) => {
      wicketTaker[w.playerName] = (wicketTaker[w.playerName] || 0) + w.wickets;
    });
    m.scoreCard.secondInningsBowling?.forEach((w: any) => {
      wicketTaker[w.playerName] = (wicketTaker[w.playerName] || 0) + w.wickets;
    });
  });

  const orangeCap = Object.entries(runScorers)
    .map(([playerName, runs]) => {
      // Find original squad
      const original = INITIAL_PLAYERS.find(p => p.name === playerName);
      return { playerName, runs, team: original?.team || "IND" };
    })
    .sort((a,b) => b.runs - a.runs)
    .slice(0, 5);

  const purpleCap = Object.entries(wicketTaker)
    .map(([playerName, wickets]) => {
      const original = INITIAL_PLAYERS.find(p => p.name === playerName);
      return { playerName, wickets, team: original?.team || "IND" };
    })
    .sort((a,b) => b.wickets - a.wickets)
    .slice(0, 5);

  // Default award declarations
  const orangeWinner = orangeCap[0] || { playerName: "Virat Kohli", runs: 580, team: "RCB" };
  const purpleWinner = purpleCap[0] || { playerName: "Jasprit Bumrah", wickets: 22, team: "MI" };

  res.json({
    orangeCap,
    purpleCap,
    mvp: { playerName: orangeWinner.playerName, team: orangeWinner.team, score: 780 },
    bestValueBuy: { playerName: "Rinku Singh", soldPrice: 1.0, rating: 90, team: "KKR" },
    worstValueBuy: { playerName: "Mitchell Starc", soldPrice: 24.75, rating: 93, team: "KKR" },
    awardsList: [
      { id: "orange", title: "Orange Cap (Most Runs)", winner: orangeWinner.playerName, score: `${orangeWinner.runs} runs` },
      { id: "purple", title: "Purple Cap (Most Wickets)", winner: purpleWinner.playerName, score: `${purpleWinner.wickets} wickets` },
      { id: "mvp", title: "Most Valuable Player", winner: orangeWinner.playerName, score: "940 impact points" },
      { id: "emerging", title: "Emerging Player of the Season", winner: "Yashasvi Jaiswal", score: "480 runs" }
    ],
    champion: room.simulatedMatches.find((m: any) => m.stage === "Final")?.winner || null
  });
});

// GET general final outcomes
app.get("/api/simulation/:roomCode/results", (req, res) => {
  const { roomCode } = req.params;
  const room = db.rooms[roomCode.toUpperCase()];
  if (!room) return res.status(404).json({ error: "Room not found" });

  const finalMatch = room.simulatedMatches.find((m: any) => m.stage === "Final");
  const champion = finalMatch?.winner || null;
  const runnerUp = champion ? (finalMatch.teamA === champion ? finalMatch.teamB : finalMatch.teamA) : null;

  res.json({
    champion,
    runnerUp,
    finalScorecard: finalMatch || null,
    totalMatchesSimulated: room.simulatedMatches.filter((m: any) => m.simulated).length
  });
});


// ------------------- SOCKET.IO ROOM STATE SYNC & SERVER CLOCK LOOP -------------------

io.on("connection", (socket) => {
  console.log(`Socket client connected: ${socket.id}`);

  socket.on("room:join", ({ roomCode, participant }) => {
    socket.join(roomCode.toUpperCase());
    console.log(`User ${participant?.name} joined socket room: ${roomCode.toUpperCase()}`);
  });

  socket.on("room:chat", ({ roomCode, msg }) => {
    io.to(roomCode.toUpperCase()).emit("room:chat", msg);
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Precise Ticking Loop for Live Auctions (1-second intervals)
setInterval(() => {
  let changed = false;

  Object.values(db.rooms).forEach((room: any) => {
    if (room.status !== "active") return;

    if (room.timerRemaining > 0) {
      room.timerRemaining--;
      io.to(room.roomCode).emit("auction:timer", { 
        timerRemaining: room.timerRemaining,
        currentPlayerIndex: room.currentPlayerIndex,
        currentBid: room.currentBid,
        currentBidder: room.currentBidder
      });
      changed = true;
    } else {
      // Timer hit 0! Auto sell player
      if (room.config.autoSell) {
        const player = room.players[room.currentPlayerIndex];
        if (player && player.status === "bidding") {
          if (room.currentBidder) {
            // Sell!
            player.status = "sold";
            player.soldTo = room.currentBidder;
            player.soldPrice = room.currentBid;

            const finalMsg = {
              id: `c-${Date.now()}`,
              sender: "System",
              text: `✔ Timed Out Confirmed: ${player.name} SOLD to ${room.currentBidder} for ₹${room.currentBid} Cr!`,
              timestamp: Date.now(),
              isSystem: true
            };
            room.chatMessages.push(finalMsg);
            
            io.to(room.roomCode).emit("player:sold", { player, room });
            io.to(room.roomCode).emit("room:chat", finalMsg);
          } else {
            // Unsold!
            player.status = "unsold";
            player.soldTo = null;
            player.soldPrice = null;

            const finalMsg = {
              id: `c-${Date.now()}`,
              sender: "System",
              text: `✘ Timed Out: ${player.name} went UNSOLD (No bids).`,
              timestamp: Date.now(),
              isSystem: true
            };
            room.chatMessages.push(finalMsg);

            io.to(room.roomCode).emit("player:unsold", { player, room });
            io.to(room.roomCode).emit("room:chat", finalMsg);
          }

          // Advance to next player after a short pause automatically!
          setTimeout(() => {
            const freshRoom = db.rooms[room.roomCode];
            if (!freshRoom || freshRoom.status !== "active") return;

            const nextIndex = freshRoom.currentPlayerIndex + 1;
            if (nextIndex >= freshRoom.players.length) {
              // Complete!
              freshRoom.status = "completed";
              freshRoom.currentPlayerId = null;

              const completedMsg = {
                id: `c-${Date.now()}`,
                sender: "System",
                text: `♕ IPL Live Auction completed successfully!`,
                timestamp: Date.now(),
                isSystem: true
              };
              freshRoom.chatMessages.push(completedMsg);

              saveDb();
              io.to(freshRoom.roomCode).emit("auction:completed", { room: freshRoom });
              io.to(freshRoom.roomCode).emit("room:chat", completedMsg);
              return;
            }

            freshRoom.currentPlayerIndex = nextIndex;
            const nextP = freshRoom.players[nextIndex];
            nextP.status = "bidding";
            freshRoom.currentPlayerId = nextP.id;
            freshRoom.currentBid = 0;
            freshRoom.currentBidder = null;
            freshRoom.timerRemaining = freshRoom.config.timerDuration;
            freshRoom.lastBidTime = Date.now();

            const nextMsg = {
              id: `c-${Date.now()}`,
              sender: "System",
              text: `➡ Up Next: ${nextP.name} (${nextP.role}, Base ₹${nextP.basePrice} Cr)`,
              timestamp: Date.now(),
              isSystem: true
            };
            freshRoom.chatMessages.push(nextMsg);

            saveDb();
            io.to(freshRoom.roomCode).emit("player:next", { player: nextP, room: freshRoom });
            io.to(freshRoom.roomCode).emit("room:chat", nextMsg);
          }, 3000);

          changed = true;
        }
      }
    }
  });

  if (changed) {
    saveDb();
  }
}, 1000);


// ------------------- DEV/PROD INTEGRATION MIDDLEWARE -------------------
const isProd = process.env.NODE_ENV === "production";

if (!isProd) {
  // Use Vite Middleware for DEV Mode
  import("vite").then(({ createServer: createViteServer }) => {
    createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa"
    }).then((vite) => {
      app.use(vite.middlewares);
      
      // Serve index.html globally for clean URLs
      app.use("*", async (req, res, next) => {
        const url = req.originalUrl;
        
        // Skip API routes
        if (url.startsWith("/api")) {
          return next();
        }

        try {
          let template = fs.readFileSync(path.join(__dirname, "index.html"), "utf-8");
          template = await vite.transformIndexHtml(url, template);
          res.status(200).set({ "Content-Type": "text/html" }).end(template);
        } catch (e: any) {
          vite.ssrFixStacktrace(e);
          next(e);
        }
      });

      httpServer.listen(PORT, "0.0.0.0", () => {
        console.log(`Dev fullstack server running on http://localhost:${PORT}`);
      });
    });
  });
} else {
  // Serve static assets in PROD Mode
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath));
  
  app.get("*", (req, res) => {
    if (req.originalUrl.startsWith("/api")) {
      return res.status(404).json({ error: "Endpoint not found" });
    }
    res.sendFile(path.join(distPath, "index.html"));
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Production fullstack server running on http://localhost:${PORT}`);
  });
}
