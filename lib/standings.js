'use strict';

/**
 * Compute standings from state.
 *
 * For all-vs-all: returns { overall: [...teamStats] }
 * For divisional: returns { "Division 1": [...], "Division 2": [...], _divisionOrder: [...] }
 *
 * Scoring is set-based (D1): each set counts independently.
 * Win a set = 2pts, Lose a set = 0pts.
 * GP = 1 per match (when all 4 set scores are present).
 * W/L = sets won/lost across all matches.
 * GF/GA = cumulative scores across all sets.
 */
function computeStandings(state) {
  const { generateConfig, schedule, finalizedWeeks } = state;
  if (!generateConfig || !schedule.length) return {};

  const format = generateConfig.format || 'roundrobin';

  if (format === 'divisional') {
    return computeDivisionalStandings(state);
  }
  return computeRoundRobinStandings(state);
}

function computeRoundRobinStandings(state) {
  const { schedule } = state;
  const stats = {};

  for (const week of schedule) {
    for (const m of week.matches) {
      if (!matchHasScores(m)) continue;
      ensureTeam(stats, m.teamA);
      ensureTeam(stats, m.teamB);
      applyMatchToStats(stats, m);
    }
  }

  const sorted = Object.values(stats).sort(sortByStandings);
  sorted.forEach((t, i) => { t.rank = i + 1; });

  return { overall: sorted };
}

function computeDivisionalStandings(state) {
  const { generateConfig, schedule } = state;
  const divisions = generateConfig.divisions || [];

  const currentDivisions = getCurrentDivisions(state);

  const stats = {};

  for (const week of schedule) {
    for (const m of week.matches) {
      if (!matchHasScores(m)) continue;
      if (!m.division) continue;

      ensureTeam(stats, m.teamA);
      ensureTeam(stats, m.teamB);
      applyMatchToStats(stats, m);
    }
  }

  // Group by current division
  const result = {};
  const divisionOrder = [];

  for (const [divName, teamList] of Object.entries(currentDivisions)) {
    divisionOrder.push(divName);
    const divStats = teamList
      .map(t => stats[t] || emptyTeamStats(t))
      .sort(sortByStandings);
    divStats.forEach((t, i) => { t.rank = i + 1; t.division = divName; });
    result[divName] = divStats;
  }

  result._divisionOrder = divisionOrder;
  result._averageStandings = computeAverageStandings(state, currentDivisions, result);

  return result;
}

/**
 * Returns true if a match has scoreable data.
 * Supports both double-score format (set1A/set1B/set2A/set2B) and legacy (scoreA/scoreB).
 */
function matchHasScores(m) {
  if (m.set1A !== undefined && m.set1A !== null) {
    return m.set1A !== null && m.set1B !== null && m.set2A !== null && m.set2B !== null;
  }
  return m.scoreA !== null && m.scoreA !== undefined &&
         m.scoreB !== null && m.scoreB !== undefined;
}

/**
 * Apply a match's scores to stats for both teams.
 * Supports double-score (set-based) and legacy formats.
 */
function applyMatchToStats(stats, m) {
  const a = stats[m.teamA];
  const b = stats[m.teamB];

  if (m.set1A !== undefined && m.set1A !== null) {
    // Double-score (set-based) format
    a.gp++;
    b.gp++;

    // Set 1
    a.gamesFor += m.set1A;
    a.gamesAgainst += m.set1B;
    b.gamesFor += m.set1B;
    b.gamesAgainst += m.set1A;
    if (m.set1A > m.set1B) { a.w++; b.l++; a.pts += 2; }
    else if (m.set1B > m.set1A) { b.w++; a.l++; b.pts += 2; }

    // Set 2
    a.gamesFor += m.set2A;
    a.gamesAgainst += m.set2B;
    b.gamesFor += m.set2B;
    b.gamesAgainst += m.set2A;
    if (m.set2A > m.set2B) { a.w++; b.l++; a.pts += 2; }
    else if (m.set2B > m.set2A) { b.w++; a.l++; b.pts += 2; }
  } else {
    // Legacy single-score format
    a.gp++;
    b.gp++;
    a.gamesFor += m.scoreA;
    a.gamesAgainst += m.scoreB;
    b.gamesFor += m.scoreB;
    b.gamesAgainst += m.scoreA;

    if (m.scoreA > m.scoreB) { a.w++; b.l++; a.pts += 2; }
    else if (m.scoreB > m.scoreA) { b.w++; a.l++; b.pts += 2; }
    else { a.pts += 1; b.pts += 1; }
  }
}

/**
 * For playoff seeding: average rank per team across finalized weeks.
 * Uses state.weeklyRankings if available; otherwise falls back to current division order.
 * Lower average = better (rank 1 is best within division).
 * Tiebreak by total Pts.
 */
function computeAverageStandings(state, currentDivisions, divisionStandings) {
  const { weeklyRankings = {} } = state;
  const divOrder = Object.keys(currentDivisions);

  const allTeams = [];
  for (const [divName, teamList] of Object.entries(currentDivisions)) {
    const divIdx = divOrder.indexOf(divName);
    for (const t of teamList) {
      const teamRankings = weeklyRankings[t];
      let avgRank = null;
      if (teamRankings && Object.keys(teamRankings).length > 0) {
        const validRanks = Object.values(teamRankings).filter(r => r !== null);
        if (validRanks.length > 0) {
          avgRank = validRanks.reduce((s, r) => s + r, 0) / validRanks.length;
        }
      }

      const divStats = (divisionStandings[divName] || []).find(s => s.team === t);
      const pts = divStats ? (divStats.pts || 0) : 0;

      allTeams.push({ team: t, divisionIdx: divIdx, avgRank, pts });
    }
  }

  // Sort: teams with avgRank first (lower avg = better seed).
  // Teams without avgRank use divisionIdx * 100 as proxy.
  allTeams.sort((a, b) => {
    const aR = a.avgRank !== null ? a.avgRank : (a.divisionIdx * 100 + 50);
    const bR = b.avgRank !== null ? b.avgRank : (b.divisionIdx * 100 + 50);
    if (aR !== bR) return aR - bR;
    return (b.pts || 0) - (a.pts || 0);
  });

  allTeams.forEach((t, i) => { t.seed = i + 1; });
  return allTeams;
}

/**
 * Get current division team lists (possibly updated by relegation).
 */
function getCurrentDivisions(state) {
  const { generateConfig } = state;
  const divisions = generateConfig.divisions || [];

  if (generateConfig._currentDivisions) {
    return generateConfig._currentDivisions;
  }

  const result = {};
  for (const d of divisions) {
    result[d.name] = [...d.teams];
  }
  return result;
}

function ensureTeam(stats, team) {
  if (!stats[team]) {
    stats[team] = emptyTeamStats(team);
  }
}

function emptyTeamStats(team) {
  return { team, gp: 0, w: 0, l: 0, pts: 0, gamesFor: 0, gamesAgainst: 0, rank: 0 };
}

function sortByStandings(a, b) {
  if (b.pts !== a.pts) return b.pts - a.pts;
  if (b.w !== a.w) return b.w - a.w;
  const diffA = a.gamesFor - a.gamesAgainst;
  const diffB = b.gamesFor - b.gamesAgainst;
  return diffB - diffA;
}

module.exports = { computeStandings, getCurrentDivisions, matchHasScores, applyMatchToStats };
