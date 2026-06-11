/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { 
  Trophy, 
  Users, 
  Settings, 
  Plus, 
  Search, 
  Share2, 
  Copy, 
  Play, 
  Pause, 
  Coins, 
  Clock, 
  UserCheck, 
  History, 
  User, 
  CheckCircle, 
  AlertCircle, 
  Calendar, 
  ChevronRight, 
  Info, 
  Lock, 
  Unlock, 
  Send, 
  Sparkles, 
  RefreshCw, 
  Award,
  BookOpen,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  ChevronDown,
  Activity
} from "lucide-react";
import { PlayerRole, AuctionPlayer, SimulatedMatch, PointsTableEntry, SimulatedFranchise, Bid } from "./types";
import { IPL_TEAMS, VENUES, HISTORICAL_SEASONS_DATA } from "./data/initialPlayers";

// Client socket connection helper
import { io, Socket } from "socket.io-client";

interface ScreenState {
  route: string; // e.g. "landing", "play", "create-room", "rooms", "lobby", "auction", "squad-results", "sim-setup", "sim-live", "sim-results"
  roomCode?: string;
}

export default function App() {
  // Navigation Routing State
  const [screen, setScreen] = useState<ScreenState>({ route: "landing" });
  
  // App Config and Lobby State
  const [guestName, setGuestName] = useState<string>("");
  const [isSavedParticipant, setIsSavedParticipant] = useState<boolean>(false);
  const [participantId, setParticipantId] = useState<string>("");
  const [publicRooms, setPublicRooms] = useState<any[]>([]);
  const [claimedTeam, setClaimedTeam] = useState<string | null>(null);

  // Active Live Room State (fetched from API + synced with Sockets)
  const [roomData, setRoomData] = useState<any | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  // Live Auction View state
  const [customBidAmount, setCustomBidAmount] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"squads" | "feed" | "settings" | "players" | "bids">("squads");
  const [selectedSquadTabTeam, setSelectedSquadTabTeam] = useState<string>("MI");
  const [showSoldSplash, setShowSoldSplash] = useState<boolean>(false);
  const [soldPlayerInfo, setSoldPlayerInfo] = useState<any | null>(null);
  const [chatInput, setChatInput] = useState<string>("");

  // Stats Dashboard state
  const [showStatsModal, setShowStatsModal] = useState<boolean>(false);
  const [statsData, setStatsData] = useState<any | null>(null);
  const [showStrengthAnalysis, setShowStrengthAnalysis] = useState<boolean>(false);

  // Simulating state
  const [simSetup, setSimSetup] = useState({
    format: "IPL league format",
    venueNames: VENUES.map(v => v.name),
    numMatches: 14,
    playoffsEnabled: true,
    impactPlayerRule: true,
    momentumEnabled: true,
    randomVariation: true,
    depth: "quick" as "quick" | "over" | "ball"
  });
  const [simMatches, setSimMatches] = useState<SimulatedMatch[]>([]);
  const [pointsTable, setPointsTable] = useState<PointsTableEntry[]>([]);
  const [simulationSpeed, setSimulationSpeed] = useState<number>(300); // ms per match simulation
  const [isSimulatingAll, setIsSimulatingAll] = useState<boolean>(false);
  const [selectedLiveMatch, setSelectedLiveMatch] = useState<SimulatedMatch | null>(null);
  const [selectedLiveMatchIndex, setSelectedLiveMatchIndex] = useState<number>(0);

  // Awards review state
  const [awards, setAwards] = useState<any | null>(null);
  const [finalResults, setFinalResults] = useState<any | null>(null);

  // Historical data browse states
  const [adminImportLoading, setAdminImportLoading] = useState<boolean>(false);
  const [adminSyncStatus, setAdminSyncStatus] = useState<any>(null);
  const [browsingPlayerId, setBrowsingPlayerId] = useState<string | null>(null);
  const [playerHistoryData, setPlayerHistoryData] = useState<any | null>(null);
  const [teamHistoryData, setTeamHistoryData] = useState<any | null>(null);
  const [browsingTeamCode, setBrowsingTeamCode] = useState<string | null>(null);
  const [aiScoutLoading, setAiScoutLoading] = useState<string | null>(null);
  const [aiReports, setAiReports] = useState<{ [playerId: string]: string }>({});

  // Feedback notifications
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Keep bottom chat logs in view
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Helpers inside client state
  const getTeamSquadStats = (room: any, teamCode: string) => {
    if (!room || !room.players) return { count: 0, spent: 0, purse: 0, overseas: 0 };
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
  };

  const getTeamStrengthInfo = (teamCode: string) => {
    if (!roomData || !roomData.players) return { batting: 50, bowling: 50, overall: 50, ratingLevel: "Unknown", description: "No players drafted.", count: 0 };
    const squad = roomData.players.filter((p: any) => p.status === "sold" && p.soldTo === teamCode);
    if (squad.length === 0) return { batting: 0, bowling: 0, overall: 0, ratingLevel: "Vacant Roster", description: "This club did not draft any players.", count: 0 };

    const totalOverall = squad.reduce((sum: number, p: any) => sum + (p.rating || 50), 0);
    const totalBatting = squad.reduce((sum: number, p: any) => sum + (p.battingRating || 50), 0);
    const totalBowling = squad.reduce((sum: number, p: any) => sum + (p.bowlingRating || 50), 0);

    const overall = Math.round(totalOverall / squad.length);
    const batting = Math.round(totalBatting / squad.length);
    const bowling = Math.round(totalBowling / squad.length);

    let ratingLevel = "Balanced Squad";
    let description = "Strong baseline roster depth with solid distribution.";

    if (batting > bowling + 4) {
      ratingLevel = "Batting Heavy Roster";
      description = "Explosive top-tier batting line-up, but bowling depth could be vulnerable.";
    } else if (bowling > batting + 4) {
      ratingLevel = "Bowling Dominated Squad";
      description = "World-class defensive bowling rotation, but batting line-up might struggle in run-chases.";
    } else if (overall >= 85) {
      ratingLevel = "Championship Elite";
      description = "Fabulous blend of high-performing stars across all positions. Top contender!";
    } else if (squad.length < 11) {
      ratingLevel = "Understaffed";
      description = "Roster relies extensively on backend filler seeds due to low count.";
    }

    return { batting, bowling, overall, ratingLevel, description, count: squad.length };
  };

  // Handlers for Toasts
  const triggerError = (msg: string) => {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 4000);
  };

  const triggerSuccess = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 4000);
  };

  // Sync with URL hash / paths on mount & popped events
  useEffect(() => {
    const handleUrlState = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      
      let pName = guestName;
      if (!pName) {
        const localName = localStorage.getItem("auctionverse_guest_name");
        if (localName) {
          setGuestName(localName);
          pName = localName;
          setIsSavedParticipant(true);
        }
      }

      if (path === "/" || path === "") {
        setScreen({ route: "landing" });
      } else if (path === "/play") {
        setScreen({ route: "play" });
      } else if (path === "/play/create") {
        setScreen({ route: "create-room" });
      } else if (path === "/play/rooms") {
        setScreen({ route: "rooms" });
        fetchPublicRooms();
      } else if (path.startsWith("/play/room/")) {
        const code = path.split("/").pop();
        if (code) {
          setScreen({ route: "lobby", roomCode: code.toUpperCase() });
          if (pName) handleJoinRoomDirectly(code.toUpperCase(), pName);
        }
      } else if (path.startsWith("/play/auction/")) {
        const code = path.split("/").pop();
        if (code) {
          setScreen({ route: "auction", roomCode: code.toUpperCase() });
          if (pName) handleJoinRoomDirectly(code.toUpperCase(), pName);
        }
      } else if (path.startsWith("/play/results/")) {
        const code = path.split("/").pop();
        if (code) {
          setScreen({ route: "squad-results", roomCode: code.toUpperCase() });
          fetchRoomData(code.toUpperCase());
        }
      } else if (path.startsWith("/simulate/") && path.endsWith("/live")) {
        const code = path.split("/")[2];
        if (code) {
          setScreen({ route: "sim-live", roomCode: code.toUpperCase() });
          fetchSimulationData(code.toUpperCase());
        }
      } else if (path.startsWith("/simulate/") && path.endsWith("/results")) {
        const code = path.split("/")[2];
        if (code) {
          setScreen({ route: "sim-results", roomCode: code.toUpperCase() });
          fetchFinalResultsData(code.toUpperCase());
        }
      } else if (path.startsWith("/simulate/")) {
        const code = path.split("/").pop();
        if (code) {
          setScreen({ route: "sim-setup", roomCode: code.toUpperCase() });
          fetchRoomData(code.toUpperCase());
        }
      }
    };

    handleUrlState();
    window.addEventListener("popstate", handleUrlState);
    return () => window.removeEventListener("popstate", handleUrlState);
  }, []);

  // Update real address bar without reload
  const navigateTo = (route: string, roomCode?: string) => {
    let url = "/";
    if (route === "play") url = "/play";
    else if (route === "create-room") url = "/play/create";
    else if (route === "rooms") url = "/play/rooms";
    else if (route === "lobby" && roomCode) url = `/play/room/${roomCode}`;
    else if (route === "auction" && roomCode) url = `/play/auction/${roomCode}`;
    else if (route === "squad-results" && roomCode) url = `/play/results/${roomCode}`;
    else if (route === "sim-setup" && roomCode) url = `/simulate/${roomCode}`;
    else if (route === "sim-live" && roomCode) url = `/simulate/${roomCode}/live`;
    else if (route === "sim-results" && roomCode) url = `/simulate/${roomCode}/results`;

    window.history.pushState(null, "", url);
    setScreen({ route, roomCode });
  };

  // Socket initialization
  useEffect(() => {
    if (roomData?.roomCode) {
      // Connect socket
      const sk = io();
      setSocket(sk);

      sk.emit("room:join", { 
        roomCode: roomData.roomCode, 
        participant: { id: participantId, name: guestName } 
      });

      sk.on("room:join", ({ room }) => {
        setRoomData(room);
      });

      sk.on("room:team-selected", ({ room }) => {
        setRoomData(room);
        const mySelf = room.participants.find((p: any) => p.name === guestName);
        if (mySelf) setClaimedTeam(mySelf.teamCode);
      });

      sk.on("room:chat", (msg: any) => {
        setRoomData((prev: any) => {
          if (!prev) return null;
          // Avoid duplicates
          if (prev.chatMessages.find((m: any) => m.id === msg.id)) return prev;
          return {
            ...prev,
            chatMessages: [...prev.chatMessages, msg]
          };
        });
        setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      });

      sk.on("auction:started", ({ room }) => {
        setRoomData(room);
        navigateTo("auction", room.roomCode);
      });

      sk.on("bid:placed", ({ currentBid, currentBidder, timerRemaining, room }) => {
        setRoomData(room);
        // Soft audio bid notification representation
        const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav");
        audio.volume = 0.3;
        audio.play().catch(() => {});
      });

      sk.on("auction:timer", ({ timerRemaining }) => {
        setRoomData(prev => {
          if (!prev) return null;
          return { ...prev, timerRemaining };
        });
      });

      sk.on("player:sold", ({ player, room }) => {
        setRoomData(room);
        setSoldPlayerInfo({ player, sold: true });
        setShowSoldSplash(true);
        setTimeout(() => setShowSoldSplash(false), 3500);
      });

      sk.on("player:unsold", ({ player, room }) => {
        setRoomData(room);
        setSoldPlayerInfo({ player, sold: false });
        setShowSoldSplash(true);
        setTimeout(() => setShowSoldSplash(false), 3500);
      });

      sk.on("player:next", ({ player, room }) => {
        setRoomData(room);
      });

      sk.on("auction:paused", ({ room }) => {
        setRoomData(room);
      });

      sk.on("auction:resumed", ({ room }) => {
        setRoomData(room);
      });

      sk.on("auction:completed", ({ room }) => {
        setRoomData(room);
        navigateTo("squad-results", room.roomCode);
      });

      return () => {
        sk.disconnect();
      };
    }
  }, [roomData?.roomCode]);

  // Fetch functions

  const fetchPublicRooms = async () => {
    try {
      const res = await fetch("/api/rooms");
      const list = await res.json();
      setPublicRooms(list);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRoomData = async (code: string) => {
    try {
      const res = await fetch(`/api/rooms/${code}`);
      if (res.ok) {
        const room = await res.json();
        setRoomData(room);
        const mySelf = room.participants.find((p: any) => p.name === guestName);
        if (mySelf) {
          setParticipantId(mySelf.id);
          setClaimedTeam(mySelf.teamCode);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSimulationData = async (code: string) => {
    try {
      const resTable = await fetch(`/api/simulation/${code}/points-table`);
      const resMatches = await fetch(`/api/simulation/${code}/matches`);
      if (resTable.ok) setPointsTable(await resTable.json());
      if (resMatches.ok) {
        const matchesList = await resMatches.json();
        setSimMatches(matchesList);
        // Auto select first non-simulated match
        const nextMatch = matchesList.find((m: any) => !m.simulated) || matchesList[0];
        setSelectedLiveMatch(nextMatch);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchFinalResultsData = async (code: string) => {
    try {
      const resAwards = await fetch(`/api/simulation/${code}/awards`);
      const resFin = await fetch(`/api/simulation/${code}/results`);
      if (resAwards.ok) setAwards(await resAwards.json());
      if (resFin.ok) setFinalResults(await resFin.json());
    } catch (err) {
      console.error(err);
    }
  };

  const handleJoinRoomDirectly = async (code: string, name: string) => {
    try {
      const res = await fetch(`/api/rooms/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        const d = await res.json();
        setRoomData(d.room);
        setParticipantId(d.participant.id);
        setClaimedTeam(d.participant.teamCode);
        localStorage.setItem("auctionverse_guest_name", name);
        setIsSavedParticipant(true);
      } else {
        const raw = await res.json();
        triggerError(raw.error || "Failed to join waiting room.");
      }
    } catch (err) {
      triggerError("Network connection error.");
    }
  };

  // Click Actions

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) return triggerError("Please set your manager username first.");

    try {
      const config = {
        isPublic: true,
        mode: "IPL 2026 Mock Auction",
        numTeams: 10,
        pursePerTeam: 100,
        maxSquadSize: 18,
        overseasLimit: 8,
        bidIncrement: 0.5,
        timerDuration: 6,
        autoSell: true,
        allowLateJoin: true,
        allowUnsoldRound: true,
        allowAcceleratedRound: true
      };

      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostName: guestName, config })
      });

      if (res.ok) {
        const d = await res.json();
        setParticipantId(d.participant.id);
        localStorage.setItem("auctionverse_guest_name", guestName);
        setIsSavedParticipant(true);
        fetchRoomData(d.roomCode);
        navigateTo("lobby", d.roomCode);
        triggerSuccess("Success! Lobby configured.");
      } else {
        const raw = await res.json();
        triggerError(raw.error || "Room config creation failed.");
      }
    } catch (err) {
      triggerError("Server offline or network fault.");
    }
  };

  const handleSaveUsername = () => {
    if (!guestName.trim()) return triggerError("Username cannot be empty.");
    localStorage.setItem("auctionverse_guest_name", guestName);
    setIsSavedParticipant(true);
    triggerSuccess(`Logged in as manager @${guestName}`);
  };

  const handleClaimTeam = async (teamCode: string) => {
    if (!screen.roomCode) return;
    const roomCode = screen.roomCode;
    
    // Check if team claiming or unclaiming
    const targetCode = claimedTeam === teamCode ? null : teamCode;

    try {
      const res = await fetch(`/api/rooms/${roomCode}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, teamCode: targetCode })
      });

      if (res.ok) {
        const d = await res.json();
        setRoomData(d.room);
        setClaimedTeam(targetCode);
        if (targetCode) {
          triggerSuccess(`Congrats! You have claimed ${teamCode}!`);
        } else {
          triggerSuccess(`Unclaimed your team sponsorship.`);
        }
      } else {
        const raw = await res.json();
        triggerError(raw.error || "Claim error.");
      }
    } catch {
      triggerError("Command transaction failed.");
    }
  };

  const handleStartAuction = async () => {
    if (!screen.roomCode) return;
    try {
      const res = await fetch(`/api/rooms/${screen.roomCode}/start`, { method: "POST" });
      if (res.ok) {
        triggerSuccess("The Auction Hammer Has Struck! Let the bidding begin!");
      }
    } catch {
      triggerError("Unresolved transmission error.");
    }
  };

  const handlePostChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !screen.roomCode) return;

    try {
      await fetch(`/api/rooms/${screen.roomCode}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: guestName || "Guest Manager", text: chatInput })
      });
      setChatInput("");
    } catch (err) {
      console.error(err);
    }
  };

  // Raise Bid Controls
  const handleRaiseBid = async (amountMultiplier: number = 1) => {
    if (!screen.roomCode || !roomData) return;
    
    const currentPlayer = roomData.players[roomData.currentPlayerIndex];
    if (!currentPlayer) return;

    if (!claimedTeam) {
      return triggerError("Only managers who have claimed an IPL franchise team can bid for players!");
    }

    const increment = roomData.config.bidIncrement;
    const baseMin = roomData.currentBid === 0 
      ? currentPlayer.basePrice 
      : Math.round((roomData.currentBid + increment) * 100) / 100;

    let targetBid = baseMin;
    if (amountMultiplier > 1) {
      targetBid = Math.round((baseMin + (amountMultiplier - 1) * increment) * 100) / 100;
    }

    // Direct submit bid
    try {
      const res = await fetch(`/api/auction/${screen.roomCode}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamCode: claimedTeam, amount: targetBid })
      });

      if (!res.ok) {
        const d = await res.json();
        triggerError(d.error || "Bid rejection.");
      } else {
        setCustomBidAmount("");
      }
    } catch {
      triggerError("Bid action transmission failed.");
    }
  };

  const handleManualCustomBid = async () => {
    if (!customBidAmount || !screen.roomCode) return;
    const parsed = parseFloat(customBidAmount);
    if (isNaN(parsed) || parsed <= 0) return triggerError("Enter a valid amount in Crores");

    if (!claimedTeam) {
      return triggerError("Claim a team first in order to bid!");
    }

    try {
      const res = await fetch(`/api/auction/${screen.roomCode}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamCode: claimedTeam, amount: parsed })
      });

      if (!res.ok) {
        const d = await res.json();
        triggerError(d.error || "Bid unsuccessful.");
      } else {
        setCustomBidAmount("");
      }
    } catch {
      triggerError("Bid transaction error.");
    }
  };

  // Host manual auction override controls
  const handleHostConfirmSell = async () => {
    if (!screen.roomCode) return;
    try {
      await fetch(`/api/auction/${screen.roomCode}/sell`, { method: "POST" });
    } catch {
      triggerError("Sell trigger failed.");
    }
  };

  const handleHostUnsold = async () => {
    if (!screen.roomCode) return;
    try {
      await fetch(`/api/auction/${screen.roomCode}/unsold`, { method: "POST" });
    } catch {
      triggerError("Unsold trigger failed.");
    }
  };

  const handleHostNextPlayer = async () => {
    if (!screen.roomCode) return;
    try {
      await fetch(`/api/auction/${screen.roomCode}/next`, { method: "POST" });
    } catch {
      triggerError("Unsold transition failed.");
    }
  };

  const handleHostPauseAuction = async () => {
    if (!screen.roomCode) return;
    try {
      await fetch(`/api/auction/${screen.roomCode}/pause`, { method: "POST" });
    } catch {
      triggerError("Pause override error.");
    }
  };

  const handleHostResumeAuction = async () => {
    if (!screen.roomCode) return;
    try {
      await fetch(`/api/auction/${screen.roomCode}/resume`, { method: "POST" });
    } catch {
      triggerError("Resume override error.");
    }
  };

  const handleOpenStatsModal = async () => {
    if (!screen.roomCode) return;
    try {
      const res = await fetch(`/api/auction/${screen.roomCode}/stats`);
      if (res.ok) {
        const data = await res.json();
        setStatsData(data);
        setShowStatsModal(true);
      }
    } catch {
      triggerError("Stats metrics query failed.");
    }
  };

  // Sim setup trigger
  const handleSaveSimSetup = async () => {
    if (!screen.roomCode) return;
    try {
      const res = await fetch(`/api/simulation/${screen.roomCode}/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simSetup)
      });
      if (res.ok) {
        // Generate fixtures automatically
        const fixturesRes = await fetch(`/api/simulation/${screen.roomCode}/generate-fixtures`, { method: "POST" });
        if (fixturesRes.ok) {
          triggerSuccess("Simulation Tournament brackets created successfully!");
          navigateTo("sim-live", screen.roomCode);
          fetchSimulationData(screen.roomCode);
        }
      }
    } catch {
      triggerError("Config setup transmission failed.");
    }
  };

  // Sim single match
  const handleSimulateSingleMatch = async (matchId: string) => {
    if (!screen.roomCode) return;
    try {
      const res = await fetch(`/api/simulation/${screen.roomCode}/simulate-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId })
      });
      if (res.ok) {
        const completedMatch = await res.json();
        // Update local points
        fetchSimulationData(screen.roomCode);
        setSelectedLiveMatch(completedMatch);
        triggerSuccess(`Match ${completedMatch.matchNum} fully simulated: ${completedMatch.winner} wins!`);
      }
    } catch {
      triggerError("Simulation run failed.");
    }
  };

  // Sim remaining tournament (auto interval)
  const handleQuickSimulateAll = async () => {
    if (!screen.roomCode) return;
    setIsSimulatingAll(true);
    try {
      const res = await fetch(`/api/simulation/${screen.roomCode}/simulate-tournament`, { method: "POST" });
      if (res.ok) {
        fetchSimulationData(screen.roomCode);
        triggerSuccess("Simulation of standard league phase + championship bracket complete!");
        setTimeout(() => {
          setIsSimulatingAll(false);
          navigateTo("sim-results", screen.roomCode);
          fetchFinalResultsData(screen.roomCode!);
        }, 1500);
      }
    } catch {
      setIsSimulatingAll(false);
      triggerError("Failed during full quick-simulation loop.");
    }
  };

  // Recalculate historical player career timeline
  const handleBrowsePlayerHistory = async (playerId: string) => {
    try {
      const res = await fetch(`/api/players/${playerId}/history`);
      if (res.ok) {
        const stats = await res.json();
        setPlayerHistoryData(stats);
        setBrowsingPlayerId(playerId);
      }
    } catch {
      triggerError("Could not retrieve historical database charts.");
    }
  };

  const handleFetchAiScout = async (player: any) => {
    if (aiReports[player.id]) return;
    setAiScoutLoading(player.id);
    try {
      const res = await fetch("/api/ai/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player })
      });
      if (res.ok) {
        const data = await res.json();
        setAiReports(prev => ({ ...prev, [player.id]: data.report }));
      }
    } catch {
      triggerError("AI Scouting engine connection failure.");
    } finally {
      setAiScoutLoading(null);
    }
  };

  const handleBrowseTeamHistory = async (teamCode: string) => {
    try {
      const res = await fetch(`/api/teams/${teamCode}/history`);
      if (res.ok) {
        const stats = await res.json();
        setTeamHistoryData(stats);
        setBrowsingTeamCode(teamCode);
      }
    } catch {
      triggerError("Could not query team records archive.");
    }
  };

  const handleTriggerHistoryImport = async () => {
    setAdminImportLoading(true);
    try {
      const res = await fetch("/api/admin/import/ipl-history", { method: "POST" });
      const info = await res.json();
      setAdminSyncStatus(info.stats);
      triggerSuccess("Imported complete ball-by-ball matches from 2008-2025 archive database!");
    } catch {
      triggerError("Sync script runtime exception.");
    } finally {
      setAdminImportLoading(false);
    }
  };

  return (
    <div id="root-container" className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans antialiased selection:bg-[#FF8220] selection:text-neutral-900">
      
      {/* Toast Popups */}
      {errorToast && (
        <div className="fixed top-5 right-5 z-50 bg-red-950 border border-red-800 text-red-200 px-5 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-bounce">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" id="icon-error" />
          <p className="font-semibold text-sm">{errorToast}</p>
        </div>
      )}

      {successToast && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-950 border border-emerald-800 text-emerald-200 px-5 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-pulse">
          <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" id="icon-success" />
          <p className="font-semibold text-sm">{successToast}</p>
        </div>
      )}

      {/* Primary Landing Page Header Banner */}
      <header className="sticky top-0 bg-neutral-900/90 backdrop-blur-md border-b border-neutral-800 px-6 py-4 flex items-center justify-between z-40">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigateTo("landing")}>
          <div className="bg-gradient-to-tr from-[#FF8220] to-[#FDD835] p-2.5 rounded-lg flex items-center justify-center shadow-lg shadow-[#FF8220]/20">
            <Trophy className="w-6 h-6 text-neutral-900" id="logo-trophy" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-wider bg-gradient-to-r from-white via-neutral-100 to-[#FF8220] bg-clip-text text-transparent">
              Esala Cup Namde
            </h1>
            <p className="text-xs text-neutral-400 font-mono tracking-tight">IPL LIVE AUCTION ENGINE v2.0</p>
          </div>
        </div>

        {/* Manager Status Profile */}
        <div className="flex items-center gap-4">
          {isSavedParticipant ? (
            <div className="flex items-center gap-2 bg-neutral-950/80 border border-neutral-800 px-4 py-1.5 rounded-full text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span className="text-neutral-400">@</span>
              <span className="font-bold text-[#FF8220]">{guestName}</span>
              {claimedTeam && (
                <span className="bg-neutral-800 text-xs px-2 py-0.5 rounded text-neutral-300 font-bold ml-1">
                  {claimedTeam} OWNER
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Set Manager Name..."
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-neutral-100 focus:outline-none focus:border-[#FF8220]"
              />
              <button 
                onClick={handleSaveUsername}
                className="bg-[#FF8220] hover:bg-[#FF8220]/90 text-neutral-950 font-extrabold text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                Set Name
              </button>
            </div>
          )}
          
          <button 
            onClick={() => {
              handleTriggerHistoryImport();
            }}
            className="text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-3 py-1.5 rounded-lg border border-neutral-700 flex items-center gap-1 transition-all"
            title="Import 2008-2025 Ball-by-ball archive from admin tools"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${adminImportLoading ? 'animate-spin' : ''}`} id="import-refresh" />
            IPL Archive Importer
          </button>
        </div>
      </header>

      {/* CONFETTI & SOLD PANEL SPLASH OVERLAY */}
      {showSoldSplash && soldPlayerInfo && (
        <div className="fixed inset-0 bg-neutral-950/90 z-50 flex items-center justify-center p-6 backdrop-blur-md animate-fade-in">
          {/* Confetti simulation elements (css styled dots) */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {[...Array(40)].map((_, i) => {
              const left = Math.random() * 100;
              const delay = Math.random() * 3;
              const color = ["bg-yellow-400", "bg-red-500", "bg-blue-500", "bg-[#FF8220]", "bg-purple-500"][Math.floor(Math.random() * 5)];
              return (
                <div 
                  key={i} 
                  className={`absolute w-3 h-3 rounded-full ${color} opacity-85 animate-bounce`} 
                  style={{ left: `${left}%`, top: `-10px`, animationDelay: `${delay}s`, animationDuration: `${2 + Math.random() * 2}s` }}
                />
              );
            })}
          </div>
          
          <div className="max-w-md w-full bg-neutral-900 border-2 border-[#FF8220] rounded-3xl p-8 text-center shadow-2xl relative overflow-hidden">
            <div className={`absolute top-0 inset-x-0 h-2 bg-gradient-to-r ${soldPlayerInfo.sold ? 'from-emerald-500 to-teal-400' : 'from-red-500 to-orange-600'}`}></div>
            <Award className="w-16 h-16 mx-auto mb-4 text-[#FDD835] animate-pulse" id="award-splash" />
            
            <h2 className={`text-4xl font-extrabold uppercase tracking-wide mb-2 ${soldPlayerInfo.sold ? 'text-emerald-400' : 'text-rose-400'}`}>
              {soldPlayerInfo.sold ? "HAMMER DOWN! SOLD" : "UNSOLD"}
            </h2>
            <div className="my-6">
              <span className="text-sm uppercase tracking-widest text-neutral-400 font-mono">IPL ACTIVE PLAYER DRAW</span>
              <h3 className="text-3xl font-bold text-white mt-1">{soldPlayerInfo.player.name}</h3>
              <p className="text-neutral-300 font-semibold">{soldPlayerInfo.player.role} • {soldPlayerInfo.player.nationality}</p>
            </div>

            {soldPlayerInfo.sold ? (
              <div className="bg-neutral-950 p-6 rounded-2xl border border-neutral-800 shadow-inner">
                <p className="text-neutral-400 text-xs font-mono uppercase tracking-widest">Franchise Winner</p>
                <div className="flex items-center justify-center gap-3 mt-1.5">
                  <span className="w-4 h-4 rounded-full" style={{ backgroundColor: IPL_TEAMS.find(t => t.code === soldPlayerInfo.player.soldTo)?.color || "#fff" }}></span>
                  <span className="text-2xl font-black text-white">{soldPlayerInfo.player.soldTo}</span>
                </div>
                <div className="mt-3 text-3xl font-black text-[#FDD835]">
                  ₹{soldPlayerInfo.player.soldPrice} Crores
                </div>
              </div>
            ) : (
              <div className="bg-neutral-950 p-6 rounded-2xl border border-neutral-800 text-neutral-400 text-sm">
                Player will return to the active pool during the accelerated auction phase.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------- PRIMARY MAIN ROUTING CONTENT ----------------- */}
      <main className="flex-grow p-4 md:p-8 max-w-7xl w-full mx-auto">
        
        {/* VIEW 1: LANDING SCREEN */}
        {screen.route === "landing" && (
          <div className="space-y-12 animate-fade-in" id="landing-screen">
            
            {/* Title Banner */}
            <div className="relative rounded-3xl bg-neutral-900 border border-neutral-800 p-8 md:p-12 overflow-hidden shadow-2xl flex flex-col md:flex-row items-center gap-8">
              <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-[#FF8220]to-[#FDD835] rounded-full blur-3xl opacity-10 pointer-events-none"></div>
              
              <div className="space-y-6 flex-1 text-center md:text-left relative z-10">
                <div className="inline-flex items-center gap-2 bg-neutral-950 border border-neutral-800 px-4 py-1.5 rounded-full text-[#FF8220] text-xs font-mono">
                  <Sparkles className="w-3.5 h-3.5 text-[#FDD835]" id="sparkles-banner" />
                  REAL-TIME MULTIPLAYER SYSTEM
                </div>
                
                <h2 className="text-4xl md:text-6xl font-black tracking-tight leading-none text-white">
                  OWN THE AUCTION.<br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF8220] via-orange-400 to-[#FDD835]">
                    SIMULATE THE TOURNAMENT.
                  </span>
                </h2>
                
                <p className="text-neutral-400 text-sm md:text-base leading-relaxed max-w-xl">
                  Conduct authentic real-time multiplayer IPL auctions, place strategic bids with friends, complete your squads, and run state-of-the-art match-by-match simulation modules using full historical statistics from 2008 to 2025.
                </p>

                <div className="flex flex-col sm:flex-row items-center gap-4 justify-center md:justify-start">
                  <button 
                    onClick={() => navigateTo("play")}
                    className="w-full sm:w-auto px-8 py-4 rounded-xl bg-gradient-to-r from-[#FF8220] to-orange-500 text-neutral-950 font-black text-sm tracking-widest hover:opacity-90 transform hover:-translate-y-0.5 transition-all shadow-lg shadow-[#FF8220]/20 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    PLAY IPL AUCTION WITH FRIENDS
                    <ArrowRight className="w-4 h-4 ml-1" id="arrow" />
                  </button>
                  <button 
                    onClick={() => {
                      setGuestName("Guest Manager");
                      setIsSavedParticipant(true);
                      handleCreateRoom({ preventDefault: () => {} } as any);
                    }}
                    className="w-full sm:w-auto px-8 py-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-sm tracking-wide border border-neutral-700 transition-all cursor-pointer"
                  >
                    LAUNCH QUICK-PLAY LOBBY
                  </button>
                </div>
              </div>

              {/* Decorative IPL Cup Card */}
              <div className="w-full md:w-80 bg-neutral-950/70 border border-neutral-800 rounded-3xl p-6 relative overflow-hidden backdrop-blur-sm self-stretch flex flex-col justify-between shadow-inner">
                <div>
                  <span className="text-xs font-mono text-[#FF8220] uppercase tracking-wider">IPL PRO CHAMPIONSHIP</span>
                  <h3 className="text-lg font-extrabold text-neutral-100 mt-1">Esala Cup Namde Arena</h3>
                </div>
                <div className="my-6 text-center">
                  <Trophy className="w-24 h-24 mx-auto text-[#FDD835] filter drop-shadow-[0_10px_10px_rgba(253,216,53,0.2)] animate-pulse" id="trophy-gold" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-neutral-400">
                    <span>Database Coverage</span>
                    <span className="text-white">2008 - 2025 Seasons</span>
                  </div>
                  <div className="h-1 w-full bg-neutral-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#FF8220] to-[#FDD835] w-full"></div>
                  </div>
                </div>
              </div>
            </div>

            {/* QUICK FEATURES BENTO */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl flex flex-col justify-between space-y-4">
                <div className="bg-[#FF8220]/10 border border-[#FF8220]/20 p-3 rounded-xl w-fit">
                  <Users className="w-6 h-6 text-[#FF8220]" id="feature-users" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-white">Multiplayer Rooms</h3>
                  <p className="text-neutral-400 text-xs mt-1">Host private or browse public lobbies, invite friends, and claim any of the 10 real IPL franchises to fight for players.</p>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl flex flex-col justify-between space-y-4">
                <div className="bg-[#FDD835]/10 border border-[#FDD835]/20 p-3 rounded-xl w-fit">
                  <Coins className="w-6 h-6 text-[#FDD835]" id="feature-coins" />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-white">Authentic Live Auction</h3>
                  <p className="text-neutral-400 text-xs mt-1">Submit dynamic bids, manage team purses, track squad size counters, handle Indian or Overseas player ratio rules.</p>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl flex flex-col justify-between space-y-4">
                <div className="bg-purple-500/10 border border-purple-500/20 p-3 rounded-xl w-fit">
                  <Play className="w-6 h-6 text-purple-400 animate-spin" id="feature-play" style={{ animationDuration: '6s' }} />
                </div>
                <div>
                  <h3 className="font-extrabold text-lg text-white">Cricket Simulator Engine</h3>
                  <p className="text-neutral-400 text-xs mt-1">Run ball-by-ball simulated matches of your built squad. Features points table trackers, Orange / Purple Cap leaders, and playoff qualifiers.</p>
                </div>
              </div>

            </div>

            {/* WHY PLAY SECTION */}
            <section className="bg-neutral-900/50 p-8 rounded-2xl border border-neutral-800/80 space-y-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#FF8220]" id="book-open" />
                How To Play IPL Auction Experience
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 text-xs text-neutral-400 leading-relaxed">
                <div>
                  <span className="font-mono text-[#FF8220] text-sm font-bold">01. Setup Room</span>
                  <p className="mt-1">Define customized rules: budget size, player timer speed, overseas ratio limits, and private entry toggles.</p>
                </div>
                <div>
                  <span className="font-mono text-[#FF8220] text-sm font-bold">02. Claim Franchise</span>
                  <p className="mt-1">Claim your beloved team (MI, CSK, RCB, etc.). Invite friends to choose opposing rival teams or play raw managing CPU teams.</p>
                </div>
                <div>
                  <span className="font-mono text-[#FF8220] text-sm font-bold">03. Battle Live</span>
                  <p className="mt-1">The server draws star cricketers. Managers click bidding triggers under ticking counters to secure players dynamically.</p>
                </div>
                <div>
                  <span className="font-mono text-[#FF8220] text-sm font-bold">04. Simulate Championship</span>
                  <p className="mt-1">Transition your resulting custom build squads to the simulator. Watch fixtures, match scorecards, and celebrate your champion.</p>
                </div>
              </div>
            </section>

          </div>
        )}

        {/* VIEW 2: PLAY SELECTION MENU */}
        {screen.route === "play" && (
          <div className="space-y-8 animate-fade-in max-w-2xl mx-auto" id="play-screen">
            <div className="text-center space-y-3">
              <h2 className="text-3xl font-black text-white uppercase tracking-wider">IPL Auctionverse Room</h2>
              <p className="text-neutral-400 text-xs">Set up a session to claim your favorite team and recruit a legendary squad.</p>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-6">
              
              {/* Force Username Check */}
              <div className="space-y-3">
                <label className="block text-xs font-mono uppercase text-neutral-400 font-bold">Owner / Manager Name</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Enter your name e.g. DhoniFan"
                    className="flex-grow bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#FF8220]"
                  />
                  <button 
                    onClick={handleSaveUsername}
                    className="px-5 py-3 rounded-xl bg-neutral-800 border border-neutral-700 text-sm font-bold text-neutral-200 hover:bg-neutral-700 transition"
                  >
                    Lock Name
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-neutral-800/80">
                <button
                  type="button"
                  onClick={(e) => {
                    if (!guestName.trim()) return triggerError("Add a manager username first.");
                    navigateTo("create-room");
                  }}
                  className="p-6 rounded-xl bg-neutral-950 hover:bg-[#FF8220]/10 border border-neutral-800 hover:border-[#FF8220]/50 text-left space-y-3 group transition-all"
                >
                  <Plus className="w-8 h-8 text-[#FF8220] group-hover:scale-110 transition-transform" id="icon-plus-room" />
                  <div>
                    <h4 className="font-extrabold text-sm text-neutral-100">CREATE AUCTION ROOM</h4>
                    <p className="text-neutral-400 text-[11px] mt-1">Configure draft timers, purse targets, custom tournament play brackets, and host your private link.</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!guestName.trim()) return triggerError("Add a manager username first.");
                    navigateTo("rooms");
                  }}
                  className="p-6 rounded-xl bg-neutral-950 hover:bg-[#FDD835]/10 border border-neutral-800 hover:border-[#FDD835]/50 text-left space-y-3 group transition-all"
                >
                  <Search className="w-8 h-8 text-[#FDD835] group-hover:scale-110 transition-transform" id="icon-search-room" />
                  <div>
                    <h4 className="font-extrabold text-sm text-neutral-100">BROWSE LIVE ROOMS</h4>
                    <p className="text-neutral-400 text-[11px] mt-1">View available public directories on the server and join an ongoing IPL live match lobby in seconds.</p>
                  </div>
                </button>
              </div>

              <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 flex items-start gap-3">
                <Info className="w-4 h-4 text-[#FF8220] mt-0.5" id="info-icon" />
                <p className="text-[11px] leading-relaxed text-neutral-400">
                  You can play on the same web tab or distribute the URL to up to 10 friends. If friends don't join, Esala Cup Namde automatically seeds high-fidelity CPU managers for real bidding competition!
                </p>
              </div>

            </div>
          </div>
        )}

        {/* VIEW 3: CREATE ROOM DESIGN */}
        {screen.route === "create-room" && (
          <div className="max-w-xl mx-auto space-y-8 animate-fade-in" id="create-room-screen">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-extrabold text-white uppercase tracking-wider">Host Setting Configuration</h2>
              <p className="text-neutral-400 text-xs text-center">Modify bidding rules for the upcoming live draft draft.</p>
            </div>

            <form onSubmit={handleCreateRoom} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-6">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-mono text-neutral-400 font-bold mb-2">Auction Theme Mode</label>
                  <select className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-300 focus:outline-none focus:border-[#FF8220]">
                    <option>IPL 2026 Mock Auction</option>
                    <option>Legends Upgraded</option>
                    <option>IPL Legends Auction</option>
                    <option>Mega Auction</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-mono text-neutral-400 font-bold mb-2">Format Configuration</label>
                  <select className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-300 focus:outline-none focus:border-[#FF8220]">
                    <option>Cricket - 10 Teams</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-mono text-neutral-400 font-bold mb-2">Team Purse Budget (In Crores)</label>
                  <input
                    type="number"
                    defaultValue="100"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-300"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-mono text-neutral-400 font-bold mb-2">Draft Countdown Timer (Sec)</label>
                  <input
                    type="number"
                    defaultValue="15"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-300"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs py-2 border-b border-neutral-800">
                  <span className="text-neutral-300">Allow Late Team Joiners</span>
                  <input type="checkbox" defaultChecked className="accent-[#FF8220] h-4 w-4" />
                </div>
                <div className="flex items-center justify-between text-xs py-2 border-b border-neutral-800">
                  <span className="text-neutral-300">Auto Sell on Timer Reach 0</span>
                  <input type="checkbox" defaultChecked className="accent-[#FF8220] h-4 w-4" />
                </div>
                <div className="flex items-center justify-between text-xs py-2">
                  <span className="text-neutral-300">Allow Unsold Re-entry Round</span>
                  <input type="checkbox" defaultChecked className="accent-[#FF8220] h-4 w-4" />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => navigateTo("play")}
                  className="flex-1 py-3 text-xs font-bold bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300 hover:bg-neutral-750"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 text-xs font-extrabold bg-gradient-to-r from-[#FF8220] to-orange-500 text-neutral-950 rounded-lg hover:opacity-90 transition-all"
                >
                  Create & Open Live Lobby
                </button>
              </div>

            </form>
          </div>
        )}

        {/* VIEW 4: LOBBY LISTINGS */}
        {screen.route === "rooms" && (
          <div className="max-w-2xl mx-auto space-y-6 animate-fade-in" id="rooms-screen">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-white uppercase tracking-wider">Browse Live Draft Rooms</h2>
              <button 
                onClick={fetchPublicRooms}
                className="bg-neutral-900 border border-neutral-800 p-2 text-neutral-300 rounded hover:bg-neutral-850"
              >
                <RefreshCw className="w-4 h-4" id="refresh-icon" />
              </button>
            </div>

            <div className="space-y-3">
              {publicRooms.length === 0 ? (
                <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-2xl text-center text-neutral-400 text-xs">
                  <Search className="w-8 h-8 text-neutral-500 mx-auto mb-2" id="search-nil" />
                  No open public rooms detected. Feel free to host a live lobby with custom rules!
                </div>
              ) : (
                publicRooms.map((r) => (
                  <div key={r.roomCode} className="bg-neutral-900 border border-neutral-800 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm text-neutral-100">{r.config.mode}</h4>
                      <p className="text-xs text-[#FF8220] font-mono">CODE: {r.roomCode}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-neutral-400">{r.participantCount} / 10 Players</span>
                      <button 
                        onClick={() => {
                          navigateTo("lobby", r.roomCode);
                          handleJoinRoomDirectly(r.roomCode, guestName || "Manager");
                        }}
                        className="bg-neutral-800 hover:bg-[#FF8220] hover:text-neutral-950 border border-neutral-750 text-xs text-neutral-200 px-4 py-2 rounded-lg font-bold transition-all cursor-pointer"
                      >
                        Join Room
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <button 
              onClick={() => navigateTo("play")}
              className="text-xs text-[#FF8220] underline block text-center"
            >
              Cancel & Go Back
            </button>
          </div>
        )}

        {/* VIEW 5: WAITING LOBBY */}
        {screen.route === "lobby" && roomData && (
          <div className="space-y-8 animate-fade-in" id="lobby-screen">
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 bg-neutral-950 border border-neutral-800 px-3 py-1 rounded-full text-xs text-[#FDD835]">
                  <Clock className="w-3.5 h-3.5 text-[#FDD835]" id="clock-lobby" />
                  WAITING ROOM LOBBY
                </div>
                <h2 className="text-3xl font-black text-white">{roomData.config.mode}</h2>
                <p className="text-xs text-neutral-400">Invite up to 10 managers. Assign franchises to initiate bidding.</p>
              </div>

              {/* Share Box */}
              <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl space-y-2 w-full md:w-auto">
                <span className="text-[10px] font-mono uppercase text-neutral-400 block font-bold">Manager Invite Code</span>
                <div className="flex items-center gap-2">
                  <span className="bg-neutral-900 border border-neutral-800 px-4 py-1.5 rounded text-lg font-bold text-[#FF8220] tracking-wider font-mono">
                    {roomData.roomCode}
                  </span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.href);
                      triggerSuccess("Lobby invite url copied to clipboard!");
                    }}
                    className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 p-2 rounded border border-neutral-700 transition"
                    title="Copy Link Share Url"
                  >
                    <Copy className="w-4 h-4" id="copy-lobby" />
                  </button>
                </div>
              </div>

            </div>

            {/* Franchise Team claim board */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Claims Column */}
              <div className="lg:col-span-2 space-y-4">
                <h3 className="font-extrabold text-white text-lg flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-[#FF8220]" id="usercheck" />
                  Claim Franchise Ownership
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {IPL_TEAMS.map((team) => {
                    // Check if claimed
                    const claimedBy = roomData.participants.find((p: any) => p.teamCode === team.code);
                    const isMine = claimedTeam === team.code;

                    return (
                      <div 
                        key={team.code} 
                        style={{ borderLeftColor: team.color }}
                        className={`bg-neutral-900 border-l-4 border-y-neutral-800 border-r-neutral-800 border rounded-xl p-4 flex items-center justify-between transition-all ${isMine ? 'ring-2 ring-offset-2 ring-neutral-950 ring-[#FF8220]' : ''}`}
                      >
                        <div>
                          <span className="text-[10px] font-bold text-neutral-400 tracking-wider block font-mono">{team.code}</span>
                          <h4 className="font-extrabold text-sm text-neutral-100">{team.name}</h4>
                          <p className="text-[10px] text-neutral-400 mt-0.5">
                            {claimedBy ? `● Manager @${claimedBy.name}` : "○ Unclaimed Manager Slot"}
                          </p>
                        </div>

                        {claimedBy ? (
                          isMine ? (
                            <button 
                              onClick={() => handleClaimTeam(team.code)}
                              className="text-xs font-bold text-rose-400 border border-rose-950/40 bg-rose-950/20 px-3 py-1 rounded hover:bg-rose-900/60 transition cursor-pointer"
                            >
                              Leave
                            </button>
                          ) : (
                            <span className="text-xs text-neutral-500 italic bg-neutral-950 px-2 py-1 rounded">Taken</span>
                          )
                        ) : (
                          <button 
                            onClick={() => handleClaimTeam(team.code)}
                            className="text-xs font-extrabold text-neutral-950 bg-neutral-100 hover:bg-[#FF8220] hover:text-neutral-950 px-4 py-1.5 rounded transition cursor-pointer"
                          >
                            Claim Sponsor
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Lobby Chat & Active Members Panel */}
              <div className="space-y-4">
                <h3 className="font-extrabold text-white text-lg">Lobby Room Feed</h3>

                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex flex-col h-[320px] justify-between">
                  
                  {/* Chat Message Scroll */}
                  <div className="flex-grow space-y-2.5 overflow-y-auto mb-4 pr-1 text-xs select-text">
                    {roomData.chatMessages.map((msg: any) => (
                      <div key={msg.id} className={`${msg.isSystem ? 'text-amber-400/90 font-semibold italic' : 'text-neutral-300'}`}>
                        {!msg.isSystem && <span className="text-[#FF8220] font-bold">@{msg.sender}: </span>}
                        {msg.text}
                      </div>
                    ))}
                    <div ref={chatBottomRef}></div>
                  </div>

                  <form onSubmit={handlePostChat} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Comment something..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="flex-grow bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FF8220]"
                    />
                    <button 
                      type="submit"
                      className="bg-[#FF8220] text-neutral-950 p-2 rounded-lg hover:opacity-90"
                    >
                      <Send className="w-3.5 h-3.5" id="chat-send" />
                    </button>
                  </form>
                </div>

                {/* Host Starting controls */}
                <div className="bg-neutral-900/40 border border-neutral-800 p-4 rounded-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    <span className="text-xs text-neutral-300 font-bold">Lobby Launch Matrix</span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-neutral-400">
                    If there are fewer than 10 players, the remaining teams are managed by advanced bidding CPU AI algorithms.
                  </p>

                  <button 
                    onClick={handleStartAuction}
                    className="w-full py-3 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-400 text-neutral-950 text-xs font-black hover:opacity-95 transition-all text-center tracking-widest cursor-pointer shadow-lg shadow-emerald-950/20"
                  >
                    START LIVE AUCTION NOW
                  </button>
                </div>

              </div>

            </div>
          </div>
        )}

        {/* VIEW 6: LIVE ACTIVE AUCTION ENGINE */}
        {screen.route === "auction" && roomData && (
          <div className="space-y-6 animate-fade-in" id="live-auction-screen">
            
            {/* Live Progress Bar Header */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-red-500 animate-pulse"></span>
                <div>
                  <span className="text-[10px] font-mono text-[#FF8220] uppercase tracking-wider block">IPL LIVE BROADCAST</span>
                  <p className="text-xs font-bold text-neutral-200">
                    Manager: @{guestName} ({claimedTeam ? `${claimedTeam} OWNER` : "SPECTATOR"})
                  </p>
                </div>
              </div>

              {/* Progress Count */}
              <div className="flex items-center gap-4 text-xs font-mono text-neutral-400">
                <span>Player Index: {roomData.currentPlayerIndex + 1} / {roomData.players.length}</span>
                <button 
                  onClick={handleOpenStatsModal}
                  className="bg-neutral-800 hover:bg-[#FF8220] hover:text-neutral-950 px-3 py-1.5 rounded font-extrabold text-[#FF8220] border border-neutral-700/80 transition-all text-[11px]"
                >
                  DASHBOARD STATISTICS
                </button>
              </div>
            </div>

            {/* Current Player Bid Board Column */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Player Card Display and Interactive Bidding triggers */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Immersive Player Card */}
                {roomData.currentPlayerId ? (
                  (() => {
                    const player = roomData.players[roomData.currentPlayerIndex];
                    return (
                      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl relative">
                        
                        {/* High Impact Sport BG Header */}
                        <div className="h-44 bg-gradient-to-tr from-neutral-950 via-neutral-900 to-amber-950 p-6 flex flex-col justify-between relative">
                          <div className="absolute top-4 right-4 text-xs bg-neutral-950/80 border border-neutral-800 px-3 py-1 rounded-full text-neutral-300 font-mono">
                            OVERALL RAT: <span className="text-[#FDD835] font-bold">{player.rating}</span>
                          </div>

                          <span className="text-xs text-[#FF8220] uppercase tracking-wider font-extrabold font-mono">
                            DRAFT LOT NO. {roomData.currentPlayerIndex + 1}
                          </span>

                          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                            <div>
                              <span className="bg-neutral-800 text-xs px-2.5 py-1 rounded font-bold text-neutral-300">
                                {player.role}
                              </span>
                              <h3 className="text-3xl font-extrabold text-white mt-1.5 flex items-center gap-3">
                                {player.name}
                                <span className="text-xs text-neutral-400 font-normal">({player.nationality})</span>
                              </h3>
                            </div>
                            <button
                              onClick={() => handleFetchAiScout(player)}
                              disabled={aiScoutLoading === player.id}
                              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-900/20 transition-all disabled:opacity-50"
                            >
                              <Sparkles className={`w-3.5 h-3.5 ${aiScoutLoading === player.id ? 'animate-spin' : ''}`} />
                              {aiReports[player.id] ? "REGENERATE SCOUT" : "AI SCOUT ANALYSIS"}
                            </button>
                          </div>
                        </div>

                        {/* AI SCOUT REPORT SECTION */}
                        {aiReports[player.id] && (
                          <div className="px-6 py-4 bg-purple-950/20 border-b border-purple-900/30 animate-fade-in">
                            <div className="flex items-center gap-2 mb-2">
                              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                              <span className="text-[10px] font-mono font-bold text-purple-400 uppercase tracking-widest">GEMINI AI SCOUTING REPORT</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-neutral-300 italic">
                              "{aiReports[player.id]}"
                            </p>
                          </div>
                        )}

                        {/* Player Historical stats banner */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-6 bg-neutral-950 border-y border-neutral-800 text-xs">
                          <div>
                            <span className="text-neutral-400 block uppercase font-mono">Matches</span>
                            <span className="text-neutral-200 font-bold text-sm">₹{player.basePrice} Cr Base</span>
                          </div>
                          <div>
                            <span className="text-neutral-400 block uppercase font-mono">BAT RATING</span>
                            <span className="text-neutral-200 font-bold text-sm">{player.battingRating} / 99</span>
                          </div>
                          <div>
                            <span className="text-neutral-400 block uppercase font-mono">BOWL RATING</span>
                            <span className="text-neutral-200 font-bold text-sm">{player.bowlingRating} / 99</span>
                          </div>
                          <div>
                            <span className="text-neutral-400 block uppercase font-mono">Nationality</span>
                            <span className="text-neutral-200 font-bold text-sm">{player.nationality}</span>
                          </div>
                        </div>

                        {/* Bidding Core Live Section */}
                        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
                          
                          {/* Live Timer Countdown */}
                          <div className="space-y-2 border-r border-neutral-800/80 pr-4">
                            <span className="text-[10px] font-mono text-[#FF8220] uppercase tracking-wider block font-bold">AUCTION TIMER COUNTDOWN</span>
                            
                            <div className="flex items-center gap-4">
                              <div className="bg-neutral-950 border-2 border-neutral-800 h-20 w-20 rounded-2xl flex items-center justify-center relative">
                                <Clock className="absolute top-1 right-1 w-3.5 h-3.5 text-neutral-700" />
                                <span className={`text-4xl font-mono font-black ${roomData.timerRemaining <= 5 ? 'text-red-500 animate-ping' : 'text-white'}`}>
                                  {roomData.timerRemaining}
                                </span>
                              </div>

                              <div className="space-y-1">
                                <span className="text-xs text-neutral-400 font-mono">STATUS STATE</span>
                                <div className="flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                  <span className="text-xs text-neutral-100 font-extrabold uppercase">ACCEPTING BIDS</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Highest Bid Matrix */}
                          <div className="space-y-2">
                            <span className="text-[10px] font-mono text-[#FDD835] uppercase tracking-wider block font-bold">CURRENT HIGHEST BID</span>
                            <div className="bg-neutral-950/80 p-4 rounded-xl border border-neutral-800 shadow-inner">
                              <span className="text-neutral-400 text-xs font-mono">LEADER</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xl font-bold text-white">
                                  {roomData.currentBidder ? roomData.currentBidder : "NO BIDS YET"}
                                </span>
                              </div>
                              <p className="text-2xl font-black text-[#FDD835] mt-1.5">
                                ₹{roomData.currentBid > 0 ? roomData.currentBid : player.basePrice} Crores
                              </p>
                            </div>
                          </div>

                        </div>

                        {/* Interactive Manager Bidding Action Controls */}
                        <div className="p-6 bg-neutral-950 border-t border-neutral-800 space-y-4">
                          
                          {claimedTeam ? (
                            <div className="space-y-3">
                              <p className="text-xs text-neutral-400">
                                Click direct increment shortcuts to submit real-time bid declarations:
                              </p>

                              <div className="grid grid-cols-3 gap-2">
                                <button
                                  onClick={() => handleRaiseBid(1)}
                                  className="py-3 bg-[#FF8220] hover:bg-[#FF8220]/90 text-neutral-950 font-black text-xs rounded-lg transition"
                                >
                                  +₹{roomData.config.bidIncrement} Cr
                                </button>
                                <button
                                  onClick={() => handleRaiseBid(2)}
                                  className="py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs rounded-lg border border-neutral-700 transition"
                                >
                                  +₹{roomData.config.bidIncrement * 2} Cr
                                </button>
                                <button
                                  onClick={() => handleRaiseBid(4)}
                                  className="py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs rounded-lg border border-neutral-700 transition"
                                >
                                  +₹{roomData.config.bidIncrement * 4} Cr
                                </button>
                              </div>

                              {/* Custom bid panel */}
                              <div className="flex gap-2 pt-2">
                                <input
                                  type="number"
                                  placeholder="Or enter custom amount in Crores..."
                                  value={customBidAmount}
                                  onChange={(e) => setCustomBidAmount(e.target.value)}
                                  className="flex-grow bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#FF8220]"
                                />
                                <button
                                  onClick={handleManualCustomBid}
                                  className="bg-neutral-100 hover:bg-[#FDD835] text-neutral-950 px-4 py-2 rounded-lg text-xs font-bold transition"
                                >
                                  Submit Bid
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-neutral-900/50 border border-neutral-800/80 p-4 rounded-xl text-center text-xs text-neutral-400">
                              You are currently spectator mode. Claim an IPL franchise team from the Waiting Lobby to join active bidding!
                            </div>
                          )}

                          {/* Host Overrides tools (Always available in simulated play for user convenience) */}
                          <div className="pt-4 border-t border-neutral-800/80 flex flex-wrap gap-2 text-xs">
                            <span className="text-neutral-400 block w-full mt-2 font-mono uppercase text-[10px]">Host Administration Overrides</span>
                            
                            <button 
                              onClick={handleHostConfirmSell}
                              className="px-3 py-1.5 bg-emerald-950 border border-emerald-800 text-emerald-300 rounded font-bold hover:bg-emerald-900"
                            >
                              Force Sell Player
                            </button>

                            <button
                              onClick={handleHostUnsold}
                              className="px-3 py-1.5 bg-rose-950 border border-rose-800 text-rose-300 rounded font-bold hover:bg-rose-950"
                            >
                              Force Unsold
                            </button>

                            <button 
                              onClick={handleHostNextPlayer}
                              className="px-3 py-1.5 bg-neutral-800 border border-neutral-700 text-neutral-300 rounded font-bold hover:bg-neutral-700"
                            >
                              Advance Next Player
                            </button>

                            {roomData.status === "paused" ? (
                              <button 
                                onClick={handleHostResumeAuction}
                                className="px-3 py-1.5 bg-[#FF8220]/20 border border-[#FF8220]/40 text-[#FF8220] rounded font-bold hover:bg-[#FF8220]/30"
                              >
                                Resume Clock
                              </button>
                            ) : (
                              <button 
                                onClick={handleHostPauseAuction}
                                className="px-3 py-1.5 bg-neutral-950 border border-neutral-850 text-neutral-400 rounded font-bold hover:bg-neutral-900"
                              >
                                Pause Clock
                              </button>
                            )}
                          </div>

                        </div>

                      </div>
                    );
                  })()
                ) : (
                  <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-2xl text-center">
                    <Trophy className="w-12 h-12 text-[#FF8220] mx-auto mb-3 animate-spin" id="spin" />
                    <p className="text-white font-extrabold text-sm">LIVE AUCTION CONCLUDED</p>
                    <button 
                      onClick={() => navigateTo("squad-results", roomData.roomCode)}
                      className="mt-4 bg-[#FF8220] text-neutral-950 px-6 py-2.5 rounded-lg text-xs font-black tracking-wider transition hover:opacity-90 cursor-pointer text-center font-mono"
                    >
                      CONTINUE TO SQUAD HIGHLIGHTS
                    </button>
                  </div>
                )}

                {/* HISTORICAL PLAYER STAT TIMELINE IF SELECTED IN ACTIVE LOBBY */}
                {browsingPlayerId && playerHistoryData && (
                  <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl mt-4 space-y-4">
                    <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                      <div>
                        <h4 className="font-extrabold text-white text-base">{playerHistoryData.name} Season Record Overview</h4>
                        <p className="text-xs text-neutral-400">Visualised statistics from historic seasons (2008 to 2025)</p>
                      </div>
                      <button 
                        onClick={() => {
                          setBrowsingPlayerId(null);
                          setPlayerHistoryData(null);
                        }}
                        className="text-xs text-[#FF8220] hover:underline"
                      >
                        Hide Details
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      {playerHistoryData.seasons.map((s: any) => (
                        <div key={s.year} className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 text-xs">
                          <span className="font-mono text-[#FDD835] font-bold block">{s.year} Season</span>
                          <p className="text-neutral-400 mt-1">Runs Scored: <span className="text-white font-bold">{s.runs}</span></p>
                          <p className="text-neutral-400">Strike Rate: <span className="text-white font-bold">{s.strikeRate}</span></p>
                          <p className="text-neutral-400">Wickets Taken: <span className="text-white font-bold">{s.wickets}</span></p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>

              {/* Live Side Columns Tab Layout */}
              <div className="space-y-6">

                {/* Custom Tab selectors */}
                <div className="bg-neutral-900 border border-neutral-800 p-1 rounded-xl flex gap-1">
                  <button 
                    onClick={() => setActiveTab("squads")}
                    className={`flex-1 py-1 px-1 text-[11px] font-bold rounded-lg transition-all ${activeTab === "squads" ? 'bg-neutral-950 text-[#FF8220]' : 'text-neutral-400'}`}
                  >
                    Squads
                  </button>
                  <button 
                    onClick={() => setActiveTab("feed")}
                    className={`flex-1 py-1 px-1 text-[11px] font-bold rounded-lg transition-all ${activeTab === "feed" ? 'bg-neutral-950 text-[#FF8220]' : 'text-neutral-400'}`}
                  >
                    Feed Logs
                  </button>
                  <button 
                    onClick={() => setActiveTab("players")}
                    className={`flex-1 py-1 px-1 text-[11px] font-bold rounded-lg transition-all ${activeTab === "players" ? 'bg-neutral-950 text-[#FF8220]' : 'text-neutral-400'}`}
                  >
                    Pool
                  </button>
                  <button 
                    onClick={() => setActiveTab("bids")}
                    className={`flex-1 py-1 px-1 text-[11px] font-bold rounded-lg transition-all ${activeTab === "bids" ? 'bg-neutral-950 text-[#FF8220]' : 'text-neutral-400'}`}
                  >
                    Bids
                  </button>
                </div>

                {/* Active tab content 1: Franchise Squads viewer */}
                {activeTab === "squads" && (
                  <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-xl space-y-4">
                    
                    {/* Team selectors inside squads category */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-neutral-800">
                      {IPL_TEAMS.map(t => (
                        <button
                          key={t.code}
                          onClick={() => setSelectedSquadTabTeam(t.code)}
                          className={`px-3 py-1 text-xs rounded font-bold flex-shrink-0 border transition-all ${selectedSquadTabTeam === t.code ? 'bg-[#FF8220] border-[#FF8220] text-neutral-950' : 'bg-neutral-950 border-neutral-800 text-neutral-400'}`}
                        >
                          {t.code}
                        </button>
                      ))}
                    </div>

                    {(() => {
                      const selectedTeamCode = selectedSquadTabTeam;
                      const soldList = roomData.players.filter((p: any) => p.status === "sold" && p.soldTo === selectedTeamCode);
                      const stats = getTeamSquadStats(roomData, selectedTeamCode);

                      return (
                        <div className="space-y-4">
                          
                          {/* Financial Info */}
                          <div className="grid grid-cols-2 gap-2 text-xs bg-neutral-950 p-3 rounded-lg border border-neutral-850">
                            <div>
                              <span className="text-neutral-400">Purse Budget</span>
                              <p className="text-[#FDD835] font-black text-sm">₹{stats.purse.toFixed(1)} Cr Left</p>
                            </div>
                            <div>
                              <span className="text-neutral-400">Squad Count</span>
                              <p className="text-neutral-200 font-bold text-sm">
                                {stats.count} / {roomData.config.maxSquadSize}
                              </p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <span className="text-[10px] uppercase font-mono text-[#FF8220] font-black block tracking-wider">SECURED PLAYER ROSTER</span>
                            {soldList.length === 0 ? (
                              <p className="text-neutral-500 text-xs italic text-center p-6">No players bought by {selectedTeamCode} yet.</p>
                            ) : (
                              <div className="space-y-1.5 overflow-y-auto max-h-[220px]">
                                {soldList.map((p: any) => (
                                  <div 
                                    key={p.id} 
                                    className="bg-neutral-950/80 p-2.5 rounded border border-neutral-850 flex items-center justify-between text-xs cursor-pointer hover:bg-neutral-900 transition-colors"
                                    onClick={() => handleBrowsePlayerHistory(p.id)}
                                  >
                                    <div>
                                      <p className="font-bold text-neutral-200">{p.name}</p>
                                      <span className="text-[10px] text-neutral-400 font-mono">{p.role} • {p.nationality}</span>
                                    </div>
                                    <div className="text-right">
                                      <span className="font-black text-[#FDD835]">₹{p.soldPrice} Cr</span>
                                      <span className="text-[10px] text-neutral-400 block font-mono">Rating: {p.rating}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                        </div>
                      );
                    })()}

                  </div>
                )}

                {/* Active tab content 2: Live Activity / Chat logs */}
                {activeTab === "feed" && (
                  <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-xl flex flex-col h-[340px] justify-between">
                    <div className="flex-grow space-y-2.5 overflow-y-auto mb-4 text-xs pr-1 select-text">
                      {roomData.chatMessages.slice(-25).map((msg: any) => (
                        <div key={msg.id} className={`${msg.isSystem ? 'text-amber-400 font-semibold italic' : 'text-neutral-200'}`}>
                          {!msg.isSystem && <span className="text-[#FF8220] font-bold">@{msg.sender}: </span>}
                          {msg.text}
                        </div>
                      ))}
                    </div>

                    <form onSubmit={handlePostChat} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Say something to room..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        className="flex-grow bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none"
                      />
                      <button type="submit" className="bg-[#FF8220] text-neutral-950 px-3 rounded text-xs font-bold">
                        Send
                      </button>
                    </form>
                  </div>
                )}

                {/* Active tab content 3: Available drawing pool preview */}
                {activeTab === "players" && (
                  <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-xl space-y-3">
                    <span className="text-[10px] uppercase font-mono text-neutral-400 block font-bold">Unsold / Upcoming Drawing Pool</span>
                    
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {roomData.players.filter((p: any) => p.status === "available").map((p: any) => (
                        <div 
                          key={p.id} 
                          className="p-2.5 bg-neutral-950/80 border border-neutral-850 rounded flex items-center justify-between text-xs cursor-pointer hover:bg-neutral-900 transition-colors"
                          onClick={() => handleBrowsePlayerHistory(p.id)}
                        >
                          <div>
                            <p className="font-bold text-neutral-100">{p.name}</p>
                            <span className="text-[10px] text-neutral-400">{p.role}</span>
                          </div>
                          <span className="text-[#FF8220] font-mono">₹{p.basePrice} Cr Base</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active tab content 4: Chronological Bidding Log */}
                {activeTab === "bids" && (
                  <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-xl space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-mono text-neutral-400 block font-bold">Chronological Bidding Log</span>
                      <span className="text-[9px] font-mono bg-neutral-950 px-2 py-0.5 rounded text-[#FF8220] font-semibold">
                        {roomData.bidsHistory ? roomData.bidsHistory.length : 0} bids placed
                      </span>
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto font-sans text-xs">
                      {!roomData.bidsHistory || roomData.bidsHistory.length === 0 ? (
                        <p className="text-neutral-500 italic text-center p-6 text-xs">No bids have been placed in this room yet.</p>
                      ) : (
                        [...roomData.bidsHistory].reverse().map((bid: any, idx: number) => {
                          const player = roomData.players.find((p: any) => p.id === bid.playerId);
                          const team = IPL_TEAMS.find(t => t.code === bid.teamCode);
                          const formattedTime = new Date(bid.timestamp).toLocaleTimeString([], { 
                            hour: '2-digit', 
                            minute: '2-digit', 
                            second: '2-digit' 
                          });

                          return (
                            <div key={bid.id || idx} className="bg-neutral-950 p-2.5 rounded-xl border border-neutral-850 flex items-center justify-between gap-2 hover:border-neutral-705 transition-colors">
                              <div className="flex-grow min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: team?.color || "#555" }}></span>
                                  <span className="font-extrabold text-[#FF8220]">{bid.teamCode}</span>
                                  <span className="text-[10px] text-neutral-400 font-medium">bid on</span>
                                  <span className="text-neutral-100 font-extrabold truncate block max-w-[120px]">{player?.name || "Player"}</span>
                                </div>
                                <span className="text-[9px] text-neutral-500 mt-1 flex items-center gap-1 font-mono">
                                  <Clock className="w-2.5 h-2.5 text-neutral-600" />
                                  {formattedTime}
                                </span>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <span className="text-[#FDD835] font-black text-xs font-mono">₹{bid.amount.toFixed(2)} Cr</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

              </div>

            </div>

          </div>
        )}

        {/* VIEW 7: FINAL AUCTION SQUAD RESULTS & SHOWCASE */}
        {screen.route === "squad-results" && roomData && (
          <div className="space-y-8 animate-fade-in" id="results-screen">
            
            <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl text-center space-y-4">
              <Award className="w-16 h-16 text-[#FDD835] mx-auto animate-bounce" id="results-award" />
              <h2 className="text-3xl md:text-5xl font-black text-white uppercase tracking-wider">
                AUCTION COMPLETED STATS
              </h2>
              <p className="text-neutral-400 text-xs md:text-sm max-w-lg mx-auto">
                Excellent work! All franchises have drawn complete rosters. Browse the final financials, star players, and continue to the Tournament Simulation.
              </p>

              <div className="flex justify-center flex-wrap gap-4 pt-4">
                <button 
                  onClick={() => setShowStrengthAnalysis(true)}
                  className="bg-neutral-800 hover:bg-neutral-700 text-[#FF8220] px-8 py-3.5 rounded-xl font-black text-sm tracking-widest border border-neutral-700 shadow-lg hover:shadow-neutral-800/10 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Activity className="w-4 h-4 text-[#FF8220]" />
                  TEAM STRENGTH ANALYSIS
                </button>
                <button 
                  onClick={() => navigateTo("sim-setup", roomData.roomCode)}
                  className="bg-[#FF8220] hover:bg-[#FF8220]/90 text-neutral-950 px-8 py-3.5 rounded-xl font-black text-sm tracking-widest shadow-lg shadow-[#FF8220]/20 transition-all flex items-center gap-2 cursor-pointer"
                >
                  SIMULATE CHAMPIONSHIP TOURNAMENT
                  <ChevronRight className="w-4 h-4 text-neutral-950" id="results-arrow" />
                </button>
              </div>
            </div>

            {/* Showcase grid columns */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Squad view grouping cards */}
              <div className="lg:col-span-2 space-y-4">
                <h3 className="font-extrabold text-white text-lg">Detailed Franchise Rosters</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {IPL_TEAMS.map((team) => {
                    const squad = roomData.players.filter((p: any) => p.status === "sold" && p.soldTo === team.code);
                    const stats = getTeamSquadStats(roomData, team.code);

                    return (
                      <div key={team.code} className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3 shadow-inner">
                        <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: team.color }}></span>
                            <h4 className="font-extrabold text-sm text-neutral-100">{team.name}</h4>
                          </div>
                          <span className="text-[11px] font-mono text-[#FDD835] font-bold">₹{stats.purse.toFixed(1)} Cr</span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-[10px] text-neutral-400 font-mono">
                          <div>
                            <span>PURCHASED</span>
                            <p className="text-white font-bold">{stats.count} Players</p>
                          </div>
                          <div>
                            <span>OVERSEAS</span>
                            <p className="text-[#FF8220] font-bold">{stats.overseas} Count</p>
                          </div>
                          <div>
                            <span>SPENT BUDGET</span>
                            <p className="text-white font-bold">₹{stats.spent.toFixed(1)} Cr</p>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-neutral-800/60 max-h-[160px] overflow-y-auto space-y-1 text-xs">
                          {squad.map((p: any) => (
                            <div key={p.id} className="flex justify-between p-1 bg-neutral-950/40 rounded text-neutral-300">
                              <span>{p.name} ({p.role.substring(0,3)})</span>
                              <span className="font-bold text-neutral-200">₹{p.soldPrice} Cr</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Leaderboard stats sidebar panel */}
              <div className="space-y-6">
                <h3 className="font-extrabold text-white text-lg">Auction Highlight Metrics</h3>

                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-5">
                  
                  {/* Most Expensive buy */}
                  <div>
                    <span className="text-[10px] font-mono text-[#FF8220] block uppercase tracking-wider font-extrabold">MOST EXPENSIVE DRAFT SIGNING</span>
                    {(() => {
                      const sPlayers = roomData.players.filter((p: any) => p.status === "sold");
                      const top = [...sPlayers].sort((a,b) => (b.soldPrice || 0) - (a.soldPrice || 0))[0];

                      if (!top) return <p className="text-xs text-neutral-500 italic mt-1">No players sold.</p>;

                      return (
                        <div className="mt-2 bg-neutral-950 p-4 rounded-xl border border-neutral-850">
                          <p className="font-extrabold text-sm text-neutral-200">{top.name}</p>
                          <p className="text-xs text-neutral-400 font-semibold">{top.role} • {top.soldTo}</p>
                          <div className="mt-2 text-xl font-black text-[#FDD835]">
                            ₹{top.soldPrice} Crores
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Best value player pick */}
                  <div>
                    <span className="text-[10px] font-mono text-emerald-400 block uppercase tracking-wider font-extrabold">BEST SQUAD VALUE PICKS</span>
                    <div className="mt-2 bg-neutral-950 p-4 rounded-xl border border-neutral-850 text-xs space-y-3">
                      <div>
                        <p className="font-extrabold text-neutral-200">Rinku Singh (KKR)</p>
                        <p className="text-[10px] text-neutral-400">Sold Price: ₹1.00 Cr (Rating: 90/99)</p>
                      </div>
                      <div className="border-t border-neutral-850 pt-2">
                        <p className="font-extrabold text-neutral-200">Devon Conway (CSK)</p>
                        <p className="text-[10px] text-neutral-400">Sold Price: ₹1.50 Cr (Rating: 91/99)</p>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

            </div>

          </div>
        )}

        {/* VIEW 8: TOURNAMENT SIMULATION SETUP */}
        {screen.route === "sim-setup" && roomData && (
          <div className="max-w-xl mx-auto space-y-8 animate-fade-in" id="setup-sim-screen">
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-extrabold text-white uppercase tracking-wider">Tournament Config</h2>
              <p className="text-neutral-400 text-xs">Confirm rules to generate your dynamic league fixtures.</p>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 space-y-6">
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-neutral-400 font-bold mb-2">Championship Play Format</label>
                  <select 
                    value={simSetup.format}
                    onChange={(e) => setSimSetup({ ...simSetup, format: e.target.value })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-300"
                  >
                    <option>IPL Standard League Format</option>
                    <option>Custom Round-Robin (All teams match once)</option>
                    <option>Knockout brackets only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-neutral-400 font-bold mb-2">Number of League Matches</label>
                  <input
                    type="number"
                    value={simSetup.numMatches}
                    onChange={(e) => setSimSetup({ ...simSetup, numMatches: parseInt(e.target.value) || 14 })}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-xs text-neutral-300"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between text-xs py-2">
                    <span className="text-neutral-400">Enable Playoffs Phase</span>
                    <input 
                      type="checkbox" 
                      checked={simSetup.playoffsEnabled}
                      onChange={(e) => setSimSetup({ ...simSetup, playoffsEnabled: e.target.checked })}
                      className="accent-[#FF8220] h-4 w-4" 
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs py-2">
                    <span className="text-neutral-400">Impact Player Sub Rule</span>
                    <input 
                      type="checkbox" 
                      checked={simSetup.impactPlayerRule}
                      onChange={(e) => setSimSetup({ ...simSetup, impactPlayerRule: e.target.checked })}
                      className="accent-[#FF8220] h-4 w-4" 
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between text-xs py-2">
                    <span className="text-neutral-400">Form Momentum Factors</span>
                    <input 
                      type="checkbox" 
                      checked={simSetup.momentumEnabled}
                      onChange={(e) => setSimSetup({ ...simSetup, momentumEnabled: e.target.checked })}
                      className="accent-[#FF8220] h-4 w-4" 
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs py-2">
                    <span className="text-neutral-400">Ball Random Variation</span>
                    <input 
                      type="checkbox" 
                      checked={simSetup.randomVariation}
                      onChange={(e) => setSimSetup({ ...simSetup, randomVariation: e.target.checked })}
                      className="accent-[#FF8220] h-4 w-4" 
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSaveSimSetup}
                className="w-full py-3.5 bg-gradient-to-r from-[#FF8220] to-orange-500 rounded-xl text-neutral-950 font-black text-sm uppercase tracking-wider hover:opacity-90 transition shadow-lg shadow-[#FF8220]/20 cursor-pointer"
              >
                CREATE TOURNAMENT FIXTURES
              </button>

            </div>
          </div>
        )}

        {/* VIEW 9: TOURNAMENT LIVE VIEW SCREEN */}
        {screen.route === "sim-live" && (
          <div className="space-y-6 animate-fade-in" id="simulation-live-screen">
            
            {/* Simulation Header controls */}
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-6 shadow-2xl">
              
              <div>
                <span className="text-[10px] font-mono text-[#FF8220] block uppercase tracking-wider">CHAMPIONSHIP HUB</span>
                <h2 className="text-3xl font-black text-white">IPL TOURNAMENT ARENA</h2>
                <p className="text-xs text-neutral-400 mt-1">Simulate matches consecutively or execute the entire championship instantly.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={handleQuickSimulateAll}
                  disabled={isSimulatingAll}
                  className="bg-[#FF8220] text-neutral-950 font-black text-xs px-5 py-3 rounded-xl hover:opacity-90 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 font-mono tracking-wide"
                >
                  <Play className="w-3.5 h-3.5" />
                  SIMULATE ENTIRE CHAMPS LOBBY
                </button>
              </div>

            </div>

            {/* Simulated Live View Body panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Live Scorecard representation of selected simulated match */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Scorecard Viewer */}
                {selectedLiveMatch ? (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl">
                    
                    <div className="bg-neutral-950/90 p-4 border-b border-neutral-800 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-amber-500 font-mono block">MATCH PLAY CARD {selectedLiveMatch.matchNum} • {selectedLiveMatch.stage}</span>
                        <h4 className="text-xs font-bold text-neutral-300 mt-0.5">{selectedLiveMatch.venue}</h4>
                      </div>
                      <span className="bg-neutral-800 text-[10px] px-2 py-1 rounded text-neutral-400 font-bold uppercase">
                        {selectedLiveMatch.simulated ? "COMPLETED" : "FIXTURES"}
                      </span>
                    </div>

                    {/* Match Result Summary Showcase */}
                    <div className="p-6 text-center space-y-4">
                      
                      <div className="flex items-center justify-around gap-4">
                        {/* Team A Badge */}
                        <div className="space-y-1">
                          <span className="text-3xl font-black text-white">{selectedLiveMatch.teamA}</span>
                          {selectedLiveMatch.scoreCard && (
                            <p className="text-2xl font-mono text-neutral-200 mt-1">
                              {selectedLiveMatch.scoreCard.teamAScore.runs}/{selectedLiveMatch.scoreCard.teamAScore.wickets}
                              <span className="text-xs text-neutral-400 block mt-0.5">({selectedLiveMatch.scoreCard.teamAScore.overs} overs)</span>
                            </p>
                          )}
                        </div>

                        <span className="text-xs font-mono text-neutral-500 italic block">VS</span>

                        {/* Team B Badge */}
                        <div className="space-y-1">
                          <span className="text-3xl font-black text-white">{selectedLiveMatch.teamB}</span>
                          {selectedLiveMatch.scoreCard && (
                            <p className="text-2xl font-mono text-neutral-200 mt-1">
                              {selectedLiveMatch.scoreCard.teamBScore.runs}/{selectedLiveMatch.scoreCard.teamBScore.wickets}
                              <span className="text-xs text-neutral-400 block mt-0.5">({selectedLiveMatch.scoreCard.teamBScore.overs} overs)</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Winner Showcase Banner */}
                      {selectedLiveMatch.simulated && (
                        <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-850 space-y-1">
                          <p className="text-xs text-[#FF8220] font-black uppercase tracking-wider mt-1.5">
                            {selectedLiveMatch.winner} {selectedLiveMatch.margin}
                          </p>
                          <p className="text-[10px] text-neutral-400">
                            ★ POTM Award: <span className="text-neutral-200 font-bold">{selectedLiveMatch.scoreCard?.playerOfTheMatch}</span>
                          </p>
                          <p className="text-[10px] text-neutral-500">
                            Toss: {selectedLiveMatch.scoreCard?.tossWinner} elected to {selectedLiveMatch.scoreCard?.tossDecision} first
                          </p>
                        </div>
                      )}

                      {!selectedLiveMatch.simulated && (
                        <button
                          onClick={() => handleSimulateSingleMatch(selectedLiveMatch.id)}
                          className="w-auto px-6 py-2.5 bg-neutral-800 hover:bg-[#FF8220] hover:text-neutral-950 border border-neutral-750 font-black text-xs rounded-xl tracking-wider transition-all"
                        >
                          RUN INDIVIDUAL SIMULATION
                        </button>
                      )}

                    </div>

                    {/* Detailed scorecard statistics lists */}
                    {selectedLiveMatch.simulated && selectedLiveMatch.scoreCard && (
                      <div className="border-t border-neutral-800">
                        
                        <div className="p-4 bg-neutral-950 border-b border-neutral-800">
                          <span className="text-[10px] uppercase font-mono text-neutral-400 font-black">FIRST INNINGS BATTING SCORECARD</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-[#FF8220]/5 text-neutral-400">
                              <tr>
                                <th className="p-3">Batter</th>
                                <th className="p-3">Runs</th>
                                <th className="p-3">Balls</th>
                                <th className="p-3">4s</th>
                                <th className="p-3">6s</th>
                                <th className="p-3">S/R</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedLiveMatch.scoreCard.firstInningsBatting?.map((row, idx) => (
                                <tr key={idx} className="border-b border-neutral-850 hover:bg-neutral-950/40">
                                  <td className="p-3 font-semibold text-neutral-200">{row.playerName}</td>
                                  <td className="p-3 text-[#FDD835] font-bold">{row.runs}</td>
                                  <td className="p-3 text-neutral-300">{row.balls}</td>
                                  <td className="p-3 text-neutral-400">{row.fours}</td>
                                  <td className="p-3 text-neutral-400">{row.sixes}</td>
                                  <td className="p-3 text-neutral-400 font-mono">{row.strikeRate}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                      </div>
                    )}

                  </div>
                ) : (
                  <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-2xl text-center text-neutral-400 text-xs">
                    Select a fixture card from the sidebar list to inspect simulated commentary & scorecard lists.
                  </div>
                )}

              </div>

              {/* Right Column: Dynamic Points Table and fixtures selection lists */}
              <div className="space-y-6">
                
                {/* Standings table */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3 shadow-inner">
                  <span className="text-[10px] uppercase font-mono text-neutral-400 block font-black tracking-wider">LIVE STANDINGS TABLE</span>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-neutral-500 font-mono">
                        <tr className="border-b border-neutral-850">
                          <th className="py-2">Pos</th>
                          <th className="py-2">Team</th>
                          <th className="py-2">W - L</th>
                          <th className="py-2">Pts</th>
                          <th className="py-2 relative group">
                            <div className="flex items-center gap-1 cursor-help justify-start">
                              NRR
                              <Info className="w-3 h-3 text-neutral-500 hover:text-neutral-300" />
                              <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block w-64 bg-neutral-950 border border-neutral-800 text-neutral-300 p-3.5 rounded-xl text-[10px] leading-relaxed shadow-xl z-50 font-normal select-none pointer-events-none">
                                <p className="font-bold text-white mb-1 font-sans">Net Run Rate (NRR) Formula:</p>
                                <ul className="list-disc pl-3.5 space-y-1 font-mono text-neutral-400">
                                  <li><b className="text-[#FF8220]">Batting First Win:</b> boosts NRR by <span className="text-emerald-400">+(Runs Won/100)*0.5</span></li>
                                  <li><b className="text-[#FF8220]">Chasing (Bowl first) Win:</b> boosts NRR by <span className="text-emerald-400">+(Wickets Left*0.08)</span></li>
                                  <li>Losing team receives the exact equal negative deduction.</li>
                                </ul>
                              </div>
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pointsTable.map((team, idx) => (
                          <tr key={team.teamCode} className="border-b border-neutral-850/60 hover:bg-neutral-950/30">
                            <td className="py-2.5 font-bold font-mono text-neutral-400">{idx + 1}</td>
                            <td className="py-2.5 font-extrabold text-neutral-100">{team.teamCode}</td>
                            <td className="py-2.5 text-neutral-400 font-mono">{team.won} - {team.lost}</td>
                            <td className="py-2.5 text-[#FDD835] font-black">{team.points}</td>
                            <td className={`py-2.5 font-mono text-[11px] ${team.nrr >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {team.nrr >= 0 ? `+${team.nrr.toFixed(3)}` : team.nrr.toFixed(3)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Footnote explanations */}
                  <div className="pt-2.5 border-t border-neutral-800/60 text-[10px] leading-relaxed text-neutral-400 flex items-start gap-1 font-mono">
                    <span className="text-[#FF8220] font-bold flex-shrink-0">ⓘ NRR INFO:</span>
                    <span>Performance margin based. Win by runs boosts NRR relative to exact run score margin. Chase boosts NRR relative to remaining wickets count.</span>
                  </div>
                </div>

                {/* Draw list of matches/fixtures */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
                  <span className="text-[10px] uppercase font-mono text-neutral-400 block font-bold">Match Fixtures Directory</span>
                  
                  <div className="space-y-1.5 overflow-y-auto max-h-[260px] pr-1">
                    {simMatches.map((m, idx) => (
                      <div 
                        key={m.id}
                        onClick={() => setSelectedLiveMatch(m)}
                        className={`p-2.5 text-xs rounded transition-all cursor-pointer border flex items-center justify-between ${selectedLiveMatch?.id === m.id ? 'bg-[#FF8220]/10 border-[#FF8220] text-white' : 'bg-neutral-950 border-neutral-850 text-neutral-400 hover:bg-neutral-900'}`}
                      >
                        <div className="space-y-0.5">
                          <span className="text-[9px] font-mono block">LOT {m.matchNum} • {m.stage}</span>
                          <p className="font-extrabold text-neutral-200">
                            {m.teamA} vs {m.teamB}
                          </p>
                        </div>

                        {m.simulated ? (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/20 px-2 rounded">
                            {m.winner} WIN
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-[#FDD835] bg-yellow-950/20 px-2 rounded">
                            UNPLAYED
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* VIEW 10: TOURNAMENT RESULTS, STANDINGS, AND STAT AWARDS WINNER */}
        {screen.route === "sim-results" && (
          <div className="space-y-8 animate-fade-in" id="results-sim-screen">
            
            <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl text-center space-y-4">
              <Trophy className="w-20 h-20 text-[#FDD835] mx-auto animate-pulse" id="results-sim-trophy" />
              <span className="text-xs uppercase font-mono tracking-widest text-[#FF8220] font-black block">IPL TOURNAMENT FINISHED!</span>
              
              <h2 className="text-4xl md:text-6xl font-black text-white uppercase tracking-wider">
                CHAMPION: {finalResults?.champion || "TBD"}!
              </h2>
              <p className="text-neutral-400 text-xs md:text-sm max-w-lg mx-auto">
                What a spectacular championship! The playoffs finished leaving {finalResults?.champion} crowned as the ultimate franchise of IPL Auctionverse.
              </p>

              <button 
                onClick={() => navigateTo("landing")}
                className="mt-4 bg-neutral-850 hover:bg-neutral-750 text-neutral-300 border border-neutral-700 px-6 py-2.5 rounded-xl font-bold text-xs"
              >
                Back To Main Menu
              </button>
            </div>

            {/* DREAM XI SECTION */}
            {finalResults?.dreamXI && (
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-3xl space-y-6">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-8 h-8 text-[#FDD835]" />
                  <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tight">OFFICIAL TEAM OF THE TOURNAMENT</h3>
                    <p className="text-xs text-neutral-400">The most impactful players of the season across all franchises.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {finalResults.dreamXI.map((p: any, idx: number) => (
                    <div key={idx} className="bg-neutral-950 p-4 rounded-2xl border border-neutral-800 flex flex-col justify-between space-y-3 hover:border-[#FF8220]/50 transition-colors">
                      <div>
                        <div className="flex justify-between items-start">
                          <span className="text-[10px] font-mono text-[#FF8220] font-bold">{p.role.toUpperCase()}</span>
                          <span className="bg-neutral-800 text-[10px] px-2 py-0.5 rounded text-neutral-400 font-bold">{p.team}</span>
                        </div>
                        <h4 className="font-extrabold text-white mt-1">{p.name}</h4>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-neutral-500 pt-2 border-t border-neutral-900">
                        <div>RUNS: <span className="text-white font-bold">{p.runs}</span></div>
                        <div>WKTS: <span className="text-white font-bold">{p.wickets}</span></div>
                        <div>SR: <span className="text-white font-bold">{p.runs > 0 ? (p.runs / p.balls * 100).toFixed(1) : "0.0"}</span></div>
                        <div>MTCH: <span className="text-white font-bold">{p.matches}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Awards listings */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              {/* Category awards list */}
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl space-y-4 shadow-inner">
                <h3 className="font-extrabold text-white text-lg flex items-center gap-2">
                  <Award className="w-5 h-5 text-[#FF8220]" id="results-award-icon" />
                  Individual Stat Leaders
                </h3>

                <div className="space-y-3">
                  {awards?.awardsList.map((a: any) => (
                    <div key={a.id} className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-850 flex items-center justify-between text-xs">
                      <div className="space-y-0.5">
                        <span className="text-[10px] text-neutral-400">{a.title}</span>
                        <h4 className="font-bold text-neutral-200">{a.winner}</h4>
                      </div>
                      <span className="font-extrabold text-[#FDD835]">{a.score}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Orange cap batting top list */}
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl space-y-4">
                <h3 className="font-extrabold text-white text-md flex items-center justify-between">
                  <span>Orange Cap Leaders</span>
                  <span className="h-5 w-5 rounded bg-orange-500 block"></span>
                </h3>

                <div className="space-y-2">
                  {awards?.orangeCap.map((p: any, idx: number) => (
                    <div key={idx} className="bg-neutral-950 p-3 rounded-lg border border-neutral-850 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-mono text-[10px] text-neutral-500 font-bold mr-2">#{idx+1}</span>
                        <span className="font-bold text-neutral-200">{p.playerName} ({p.team})</span>
                      </div>
                      <span className="text-[#FF8220] font-bold">{p.runs} runs</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Purple cap bowling top list */}
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl space-y-4">
                <h3 className="font-extrabold text-white text-md flex items-center justify-between">
                  <span>Purple Cap Leaders</span>
                  <span className="h-5 w-5 rounded bg-purple-500 block"></span>
                </h3>

                <div className="space-y-2">
                  {awards?.purpleCap.map((p: any, idx: number) => (
                    <div key={idx} className="bg-neutral-950 p-3 rounded-lg border border-neutral-850 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-mono text-[10px] text-neutral-500 font-bold mr-2">#{idx+1}</span>
                        <span className="font-bold text-neutral-200">{p.playerName} ({p.team})</span>
                      </div>
                      <span className="text-purple-400 font-bold">{p.wickets} wkts</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="border-t border-neutral-900 bg-neutral-950 py-8 px-6 text-center text-xs text-neutral-500">
        <p>© 2026 Esala Cup Namde Inc. Live full-stack server running on standard port.</p>
        <p className="mt-1 font-mono text-[10px]">A completely professional offline & online simulation prototype.</p>
      </footer>

      {/* DASHBOARD STATISTICS OVERVIEW MODAL */}
      {showStatsModal && statsData && (
        <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-fade-in select-text">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 max-w-3xl w-full max-h-[85vh] overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex justify-between items-start border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-xl font-extrabold text-white">Live Stats Summary Dashboard</h3>
                <p className="text-xs text-neutral-400">Track remaining purse limits, overseas player ratios, and historical draft costs.</p>
              </div>
              <button 
                onClick={() => setShowStatsModal(false)}
                className="text-neutral-400 hover:text-white font-extrabold text-xs bg-neutral-800 px-3 py-1.5 rounded"
              >
                Close View
              </button>
            </div>

            {/* Statistics matrices content */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-850">
                <span className="text-[10px] text-neutral-500 block">TOTAL RECORDED SIGNINGS</span>
                <span className="text-2xl font-black text-white">{statsData.soldCount} Players</span>
              </div>
              <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-850">
                <span className="text-[10px] text-neutral-500 block">UNSOLD POOL</span>
                <span className="text-2xl font-black text-[#FF8220]">{statsData.unsoldCount} Cricketers</span>
              </div>
              <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-850">
                <span className="text-[10px] text-neutral-500 block">TOTAL EXPELLED PURSE</span>
                <span className="text-2xl font-black text-emerald-400">
                  ₹{statsData.teamSpending.reduce((s: number, t: any) => s + t.spent, 0).toFixed(1)} Cr
                </span>
              </div>
            </div>

            {/* Franchise matrix list */}
            <div className="space-y-2">
              <span className="text-xs text-neutral-400 uppercase font-mono font-bold block">Franchise Budget Analytics</span>
              
              <div className="space-y-1.5">
                {statsData.teamSpending.map((t: any) => (
                  <div key={t.teamCode} className="bg-neutral-950 p-3 rounded-xl border border-neutral-850 flex items-center justify-between text-xs">
                    <span className="font-extrabold text-[#FDD835]">{t.teamCode} Franchise</span>
                    <div className="text-right space-y-0.5">
                      <span className="text-neutral-300 font-bold block">₹{t.spent.toFixed(1)} Cr Spent</span>
                      <span className="text-[10px] text-neutral-400 block">{t.playersCount} Players Signed</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* TEAM STRENGTH ANALYSIS DASHBOARD MODAL */}
      {showStrengthAnalysis && roomData && (
        <div className="fixed inset-0 bg-neutral-950/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 z-50 animate-fade-in select-text">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 max-w-4xl w-full max-h-[85vh] overflow-y-auto space-y-6 shadow-2xl">
            <div className="flex justify-between items-start border-b border-neutral-800 pb-4">
              <div>
                <h3 className="text-xl md:text-2xl font-black text-white flex items-center gap-2">
                  <Activity className="w-6 h-6 text-[#FF8220]" id="strength-activity-icon" />
                  TEAM STRENGTH & SQUAD DEPTH ANALYSIS
                </h3>
                <p className="text-xs text-neutral-400 mt-1">
                  Dynamic performance evaluation index based on current draft ratings and roster classifications in <b>{roomData.config.mode}</b>.
                </p>
              </div>
              <button 
                onClick={() => setShowStrengthAnalysis(false)}
                className="text-neutral-400 hover:text-white font-extrabold text-xs bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 rounded transition-colors cursor-pointer"
              >
                Close Analysis
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {IPL_TEAMS.map((team) => {
                const analysis = getTeamStrengthInfo(team.code);
                return (
                  <div key={team.code} className="bg-neutral-950/70 p-4 rounded-2xl border border-neutral-800 hover:border-neutral-700 transition-colors space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }}></span>
                        <span className="font-extrabold text-sm text-neutral-100">{team.name}</span>
                      </div>
                      <span className="text-[10px] uppercase font-mono font-black px-2 py-0.5 rounded bg-[#FF8220]/10 text-[#FF8220]">
                        {analysis.ratingLevel}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 bg-neutral-900/60 p-2.5 rounded-xl border border-neutral-850/60 text-center">
                      <div>
                        <span className="text-[9px] text-neutral-400 block font-mono">BAT RATING</span>
                        <span className="text-sm font-black text-white">{analysis.batting}/99</span>
                        <div className="w-full bg-neutral-805 h-1.5 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${analysis.batting}%` }}></div>
                        </div>
                      </div>
                      <div>
                        <span className="text-[9px] text-neutral-400 block font-mono">BOWL RATING</span>
                        <span className="text-sm font-black text-white">{analysis.bowling}/99</span>
                        <div className="w-full bg-neutral-805 h-1.5 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${analysis.bowling}%` }}></div>
                        </div>
                      </div>
                      <div>
                        <span className="text-[9px] text-neutral-400 block font-mono">OVERALL</span>
                        <span className="text-sm font-black text-[#FDD835]">{analysis.overall}/99</span>
                        <div className="w-full bg-neutral-805 h-1.5 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-[#FDD835] rounded-full" style={{ width: `${analysis.overall}%` }}></div>
                        </div>
                      </div>
                    </div>

                    <p className="text-[11px] leading-relaxed text-neutral-400">
                      {analysis.description} <span className="text-neutral-500 font-mono font-medium">({analysis.count} signings)</span>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
