/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Player, PlayerRole, AuctionPlayer, SimulatedMatch, BattingScoreRow, BowlingScoreRow, PointsTableEntry, SimulatedFranchise } from "../types";
import { VENUES } from "../data/initialPlayers";

// Generate automatic filler player of a certain role
export function generateFillerPlayer(role: PlayerRole, index: number, teamCode: string): AuctionPlayer {
  const isOverseas = index > 8; // Match real squad proportions
  const suffix = `(Filler ${index})`;
  let name = "";
  let basePrice = 0.5;
  let rating = 70;
  let battingRating = 50;
  let bowlingRating = 50;

  switch (role) {
    case PlayerRole.BATSMAN:
      name = `Local Batter ${suffix}`;
      battingRating = 72;
      rating = 71;
      break;
    case PlayerRole.BOWLER:
      name = `Local Bowler ${suffix}`;
      bowlingRating = 72;
      rating = 71;
      break;
    case PlayerRole.WICKETKEEPER:
      name = `Local Keeper ${suffix}`;
      battingRating = 68;
      rating = 70;
      break;
    case PlayerRole.CON_ALLROUNDER:
      name = `Local All-Rounder ${suffix}`;
      battingRating = 65;
      bowlingRating = 65;
      rating = 70;
      break;
  }

  return {
    id: `filler-${teamCode.toLowerCase()}-${role.toLowerCase()}-${index}`,
    playerId: `filler-${role.toLowerCase()}-${index}`,
    name,
    role,
    nationality: isOverseas ? "Overseas" : "Indian",
    basePrice,
    rating,
    battingRating,
    bowlingRating,
    status: "sold",
    soldTo: teamCode,
    soldPrice: basePrice
  };
}

// Ensure franchise has a complete 11-player squad (at least 1 Wicketkeeper, 4 Batsmen, 2 Allrounders, 4 Bowlers)
export function fillAndGetPlayingXI(squad: AuctionPlayer[], teamCode: string): AuctionPlayer[] {
  const finalXI: AuctionPlayer[] = [];
  
  const keepers = squad.filter(p => p.role === PlayerRole.WICKETKEEPER);
  const batsmen = squad.filter(p => p.role === PlayerRole.BATSMAN);
  const allrounders = squad.filter(p => p.role === PlayerRole.CON_ALLROUNDER);
  const bowlers = squad.filter(p => p.role === PlayerRole.BOWLER);

  // 1. Ensure at least 1 WicketKeeper
  if (keepers.length > 0) {
    finalXI.push(keepers[0]);
  } else {
    finalXI.push(generateFillerPlayer(PlayerRole.WICKETKEEPER, 1, teamCode));
  }

  // 2. Ensure 4 Batsmen
  for (let i = 0; i < 4; i++) {
    if (batsmen[i]) {
      finalXI.push(batsmen[i]);
    } else {
      finalXI.push(generateFillerPlayer(PlayerRole.BATSMAN, i + 1, teamCode));
    }
  }

  // 3. Ensure 2 AllRounders
  for (let i = 0; i < 2; i++) {
    if (allrounders[i]) {
      finalXI.push(allrounders[i]);
    } else {
      finalXI.push(generateFillerPlayer(PlayerRole.CON_ALLROUNDER, i + 1, teamCode));
    }
  }

  // 4. Ensure 4 Bowlers
  for (let i = 0; i < 4; i++) {
    if (bowlers[i]) {
      finalXI.push(bowlers[i]);
    } else {
      finalXI.push(generateFillerPlayer(PlayerRole.BOWLER, i + 1, teamCode));
    }
  }

  return finalXI;
}

// Calculate team overall dynamic strengths
export function recalculateTeamStrength(squad: AuctionPlayer[], teamCode: string) {
  const playingXI = fillAndGetPlayingXI(squad, teamCode);
  const totalBatting = playingXI.reduce((sum, p) => sum + (p.battingRating || 50), 0);
  const totalBowling = playingXI.reduce((sum, p) => sum + (p.bowlingRating || 50), 0);
  const totalOverall = playingXI.reduce((sum, p) => sum + (p.rating || 50), 0);

  return {
    batting: Math.round(totalBatting / 11),
    bowling: Math.round(totalBowling / 11),
    overall: Math.round(totalOverall / 11)
  };
}

// Match simulator engine
export function simulateCricketMatch(
  matchNum: number,
  stage: SimulatedMatch["stage"],
  teamACode: string,
  teamBCode: string,
  teamAName: string,
  teamBName: string,
  squadA: AuctionPlayer[],
  squadB: AuctionPlayer[],
  venueName: string
): SimulatedMatch {
  
  const venue = VENUES.find(v => v.name === venueName) || VENUES[0];
  const xiA = fillAndGetPlayingXI(squadA, teamACode);
  const xiB = fillAndGetPlayingXI(squadB, teamBCode);
  
  // Dynamic strength checks
  const strA = recalculateTeamStrength(squadA, teamACode);
  const strB = recalculateTeamStrength(squadB, teamBCode);

  // Toss Simulation
  const tossWinner = Math.random() > 0.5 ? teamACode : teamBCode;
  const tossDecision = Math.random() > 0.4 ? "bowl" : "bat"; // preferring chase

  const battingFirst = tossWinner === teamACode 
    ? (tossDecision === "bat" ? teamACode : teamBCode)
    : (tossDecision === "bat" ? teamBCode : teamACode);
  
  const battingSecond = battingFirst === teamACode ? teamBCode : teamACode;

  const firstXI = battingFirst === teamACode ? xiA : xiB;
  const secondXI = battingSecond === teamACode ? xiA : xiB;

  const firstBatingStr = battingFirst === teamACode ? strA.batting : strB.batting;
  const secondBowlingStr = battingSecond === teamACode ? strA.bowling : strB.bowling;

  const secondBattingStr = battingSecond === teamACode ? strA.batting : strB.batting;
  const firstBowlingStr = battingFirst === teamACode ? strA.bowling : strB.bowling;

  // Innings 1 Simulation
  const innings1 = simulateInnings(firstXI, secondXI, venue.factor, false, 0);
  
  // Innings 2 Simulation (chasing target)
  const innings2 = simulateInnings(secondXI, firstXI, venue.factor, true, innings1.totalRuns + 1);

  // Match Result
  let winner = "";
  let margin = "";

  if (innings2.totalRuns >= innings1.totalRuns + 1) {
    winner = battingSecond;
    const wicketsLeft = 10 - innings2.totalWickets;
    const ballsRemaining = 120 - innings2.totalBalls;
    margin = `won by ${wicketsLeft} wickets (${ballsRemaining} balls remaining)`;
  } else {
    winner = battingFirst;
    const runDiff = innings1.totalRuns - innings2.totalRuns;
    margin = `won by ${runDiff} runs`;
  }

  // Select Player of the Match based on comprehensive performance rating
  const playerRatings: { [name: string]: { rating: number; teamCode: string } } = {};

  // Initialize with all players from both XIs to handle zero stats scenarios
  xiA.forEach(p => { playerRatings[p.name] = { rating: 0, teamCode: teamACode }; });
  xiB.forEach(p => { playerRatings[p.name] = { rating: 0, teamCode: teamBCode }; });

  const processBattingRow = (b: BattingScoreRow, teamCode: string) => {
    if (!playerRatings[b.playerName]) {
      playerRatings[b.playerName] = { rating: 0, teamCode };
    }
    let batPoints = b.runs * 1.1;
    batPoints += (b.fours || 0) * 1.5;
    batPoints += (b.sixes || 0) * 2.5;
    
    if (b.runs >= 100) batPoints += 50;
    else if (b.runs >= 50) batPoints += 25;
    else if (b.runs >= 30) batPoints += 10;

    if (b.balls > 5) {
      if (b.strikeRate >= 200) batPoints += 20;
      else if (b.strikeRate >= 150) batPoints += 10;
      else if (b.strikeRate < 100) batPoints -= 10;
    }
    playerRatings[b.playerName].rating += batPoints;
  };

  const processBowlingRow = (bowler: BowlingScoreRow, teamCode: string) => {
    if (!playerRatings[bowler.playerName]) {
      playerRatings[bowler.playerName] = { rating: 0, teamCode };
    }
    let bowlPoints = bowler.wickets * 35;
    bowlPoints += (bowler.maidens || 0) * 15;
    
    if (bowler.wickets >= 5) bowlPoints += 45;
    else if (bowler.wickets >= 3) bowlPoints += 25;

    if (bowler.overs > 0) {
      if (bowler.economy <= 6.0) bowlPoints += 15;
      else if (bowler.economy <= 7.5) bowlPoints += 8;
      else if (bowler.economy > 10.0) bowlPoints -= 12;
    }
    bowlPoints -= bowler.runs * 0.1;
    playerRatings[bowler.playerName].rating += bowlPoints;
  };

  innings1.battingScore.forEach(b => processBattingRow(b, battingFirst));
  innings2.battingScore.forEach(b => processBattingRow(b, battingSecond));
  innings1.bowlingScore.forEach(bowler => processBowlingRow(bowler, battingSecond));
  innings2.bowlingScore.forEach(bowler => processBowlingRow(bowler, battingFirst));

  // Find absolute highest performance rating, adding a minor balance bump (+15) for players of the winning team
  let bestPlayerName = xiA[0].name;
  let maxPerfScore = -9999;

  Object.entries(playerRatings).forEach(([name, data]) => {
    let finalScore = data.rating;
    if (data.teamCode === winner) {
      finalScore += 15; // standard bonus for being on the winning side
    }
    if (finalScore > maxPerfScore) {
      maxPerfScore = finalScore;
      bestPlayerName = name;
    }
  });

  return {
    id: `sim-match-${matchNum}`,
    matchNum,
    stage,
    teamA: teamACode,
    teamB: teamBCode,
    venue: venueName,
    winner,
    margin,
    simulated: true,
    scoreCard: {
      teamAScore: {
        runs: battingFirst === teamACode ? innings1.totalRuns : innings2.totalRuns,
        wickets: battingFirst === teamACode ? innings1.totalWickets : innings2.totalWickets,
        overs: battingFirst === teamACode ? innings1.oversPlayed : innings2.oversPlayed
      },
      teamBScore: {
        runs: battingFirst === teamBCode ? innings1.totalRuns : innings2.totalRuns,
        wickets: battingFirst === teamBCode ? innings1.totalWickets : innings2.totalWickets,
        overs: battingFirst === teamBCode ? innings1.oversPlayed : innings2.oversPlayed
      },
      firstInningsBatting: innings1.battingScore,
      firstInningsBowling: innings1.bowlingScore,
      secondInningsBatting: innings2.battingScore,
      secondInningsBowling: innings2.bowlingScore,
      winnerCode: winner,
      playerOfTheMatch: bestPlayerName,
      tossWinner: tossWinner,
      tossDecision: tossDecision as "bat" | "bowl"
    }
  };
}

// Dynamic ball-by-ball innings simulation
function simulateInnings(
  battingXI: AuctionPlayer[],
  bowlingXI: AuctionPlayer[],
  venueFactor: { batting: number; bowling: number },
  isChasing: boolean,
  target: number
): {
  totalRuns: number;
  totalWickets: number;
  oversPlayed: number;
  battingScore: BattingScoreRow[];
  bowlingScore: BowlingScoreRow[];
  totalBalls: number;
} {
  let runs = 0;
  let wickets = 0;
  let ballsBowled = 0;

  // Initialize Scorecards
  const battingScores: BattingScoreRow[] = battingXI.map(p => ({
    playerName: p.name,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    strikeRate: 0,
    howOut: "not out"
  }));

  const bowlers = bowlingXI.filter(p => p.role === PlayerRole.BOWLER || p.role === PlayerRole.CON_ALLROUNDER);
  if (bowlers.length === 0) {
    bowlers.push(...bowlingXI.slice(5)); // emergency bowlers
  }

  const bowlingScores: BowlingScoreRow[] = bowlers.map(p => ({
    playerName: p.name,
    overs: 0,
    maidens: 0,
    runs: 0,
    wickets: 0,
    economy: 0
  }));

  let currentBatIndex = 0;
  let strikerIndex = 0;
  let nonStrikerIndex = 1;

  // Track who has batted
  let nextBatIndex = 2;

  // overs loop (max 20 overs = 120 balls)
  for (let over = 0; over < 20; over++) {
    if (wickets >= 10) break;
    if (isChasing && runs >= target) break;

    // Pick bowler for this over
    const bowlerIndex = over % bowlingScores.length;
    const currentBowlerRow = bowlingScores[bowlerIndex];
    let bowlerRunsThisOver = 0;
    let bowlerWicketsThisOver = 0;

    // 6 legal balls in an over
    for (let ball = 0; ball < 6; ball++) {
      if (wickets >= 10) break;
      if (isChasing && runs >= target) break;

      ballsBowled++;
      
      const striker = battingScores[strikerIndex];
      const strikerPlayerObj = battingXI[strikerIndex] || battingXI[0];
      const bowlerPlayerObj = bowlers[bowlerIndex] || bowlers[0];

      striker.balls++;

      // Decide probability weights based on ratings & venue
      const batRating = strikerPlayerObj.battingRating || 50;
      const bowlRating = bowlerPlayerObj.bowlingRating || 50;

      // Base run weights
      let wicketWeight = 3.5 * (bowlRating / batRating) * venueFactor.bowling;
      let dotWeight = 32 * (bowlRating / batRating);
      let singleWeight = 38 * (batRating / bowlRating);
      let boundaryWeight = 18 * (batRating / bowlRating) * venueFactor.batting;

      // Match phase factors
      if (over < 6) {
        // Powerplay: higher boundaries and wickets
        boundaryWeight *= 1.25;
        wicketWeight *= 1.1;
      } else if (over >= 16) {
        // Death overs: high variance
        boundaryWeight *= 1.5;
        wicketWeight *= 1.4;
      }

      const totalWeight = wicketWeight + dotWeight + singleWeight + boundaryWeight;
      const roll = Math.random() * totalWeight;

      if (roll < wicketWeight) {
        // Wicket!
        wickets++;
        bowlerWicketsThisOver++;
        
        const ways = ["caught", "bowled", "lbw", "run out", "stumped"];
        const decision = ways[Math.floor(Math.random() * ways.length)];
        striker.howOut = decision === "caught" 
          ? `c & b ${currentBowlerRow.playerName}` 
          : `${decision} b ${currentBowlerRow.playerName}`;
        
        // Bring in next batter
        if (nextBatIndex < 11) {
          strikerIndex = nextBatIndex;
          nextBatIndex++;
        } else {
          // No more batters
          break;
        }
      } else if (roll < wicketWeight + dotWeight) {
        // Dot Ball
        // 0 runs
      } else if (roll < wicketWeight + dotWeight + singleWeight) {
        // 1, 2 or 3 runs
        const randRun = Math.random();
        let scored = 1;
        if (randRun > 0.85) scored = 3;
        else if (randRun > 0.65) scored = 2;

        runs += scored;
        striker.runs += scored;
        bowlerRunsThisOver += scored;

        // Switch strike on singles or triples
        if (scored === 1 || scored === 3) {
          const temp = strikerIndex;
          strikerIndex = nonStrikerIndex;
          nonStrikerIndex = temp;
        }
      } else {
        // Boundary! (4 or 6)
        const isSix = Math.random() > 0.7;
        const scored = isSix ? 6 : 4;

        runs += scored;
        striker.runs += scored;
        bowlerRunsThisOver += scored;

        if (scored === 4) striker.fours++;
        else striker.sixes++;
      }
    }

    // Update bowler stats
    currentBowlerRow.overs += 1;
    currentBowlerRow.runs += bowlerRunsThisOver;
    currentBowlerRow.wickets += bowlerWicketsThisOver;
  }

  // Finalize stats structures
  battingScores.forEach(b => {
    if (b.balls > 0) {
      b.strikeRate = Math.round((b.runs / b.balls) * 1000) / 10;
    }
  });

  bowlingScores.forEach(bowler => {
    if (bowler.overs > 0) {
      bowler.economy = Math.round((bowler.runs / bowler.overs) * 10) / 10;
    }
  });

  const exactOvers = Math.floor(ballsBowled / 6) + (ballsBowled % 6) / 10;

  return {
    totalRuns: runs,
    totalWickets: wickets,
    oversPlayed: exactOvers,
    battingScore: battingScores.filter(b => b.balls > 0),
    bowlingScore: bowlingScores,
    totalBalls: ballsBowled
  };
}

// Points Table calculator
export function calculateUpdatedPointsTable(matches: SimulatedMatch[], teams: SimulatedFranchise[]): PointsTableEntry[] {
  const table: { [code: string]: PointsTableEntry } = {};

  teams.forEach(t => {
    table[t.teamCode] = {
      teamCode: t.teamCode,
      teamName: t.name,
      played: 0,
      won: 0,
      lost: 0,
      points: 0,
      nrr: 0
    };
  });

  matches.forEach(m => {
    if (!m.simulated || !m.winner || !m.scoreCard) return;

    const codeA = m.teamA;
    const codeB = m.teamB;

    if (!table[codeA]) return;
    if (!table[codeB]) return;

    table[codeA].played++;
    table[codeB].played++;

    if (m.winner === codeA) {
      table[codeA].won++;
      table[codeA].points += 2;
      table[codeB].lost++;
    } else {
      table[codeB].won++;
      table[codeB].points += 2;
      table[codeA].lost++;
    }

    // Rough approximate for Net Run Rate (NRR) based on win margin
    const isWickets = m.margin?.includes("wickets");
    const mult = m.winner === codeA ? 1 : -1;
    let nrrDiff = 0.1;
    if (m.margin) {
      const matchDigits = m.margin.match(/\d+/);
      const digit = matchDigits ? parseInt(matchDigits[0]) : 10;
      if (isWickets) {
        nrrDiff = digit * 0.08; // 8 wickets left -> higher NRR
      } else {
        nrrDiff = (digit / 100) * 0.5; // 50 runs -> higher NRR
      }
    }

    table[codeA].nrr += nrrDiff * mult;
    table[codeB].nrr -= nrrDiff * mult;
  });

  // Round NRR
  const resultList = Object.values(table);
  resultList.forEach(entry => {
    entry.nrr = Math.round(entry.nrr * 1000) / 1000;
  });

  // Sort: points desc, nrr desc, wins desc
  return resultList.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.nrr - a.nrr;
  });
}
