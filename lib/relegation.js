'use strict';

const { computeStandings, getCurrentDivisions, matchHasScores } = require('./standings');
const { generateRounds, addMinutes, newId } = require('./scheduler');

/**
 * Finalize a week for divisional format:
 * 1. Compute divisional standings as of this week
 * 2. Record each team's weekly rank in state.weeklyRankings
 * 3. Apply relegation/promotion between adjacent divisions
 * 4. Update _currentDivisions in config
 * 5. Regenerate matches for subsequent weeks based on new division rosters
 * 6. Mark week as finalized
 *
 * Returns summary of movements.
 */
function finalizeWeek(state, weekNum) {
  const week = state.schedule.find(w => w.weekNum === weekNum);
  if (!week) throw new Error(`Week ${weekNum} not found`);
  if (week.finalized) throw new Error(`Week ${weekNum} already finalized`);

  const config = state.generateConfig;
  if (!config) throw new Error('No schedule config found');

  // For all-vs-all format, finalization is just marking the week done
  if (config.format !== 'divisional') {
    week.finalized = true;
    if (!state.finalizedWeeks.includes(weekNum)) state.finalizedWeeks.push(weekNum);
    return { movements: [], weekNum };
  }

  // Get current division state
  const currentDivisions = getCurrentDivisions(state);
  const divOrder = Object.keys(currentDivisions);

  // Compute per-division standings using only matches up to this week
  const weekStandings = computeWeekStandings(state.schedule, weekNum, currentDivisions);

  const movements = [];
  const inactiveDivisions = new Set(week.inactiveDivisions || []);

  // Record weekly rankings for each team
  if (!state.weeklyRankings) state.weeklyRankings = {};
  for (const [divName, teams] of Object.entries(currentDivisions)) {
    const divStats = weekStandings[divName] || [];
    const isActive = !inactiveDivisions.has(divName);
    for (const [idx, teamStat] of divStats.entries()) {
      if (!state.weeklyRankings[teamStat.team]) state.weeklyRankings[teamStat.team] = {};
      state.weeklyRankings[teamStat.team][weekNum] = isActive ? (idx + 1) : null;
    }
  }

  // Track games played per boundary
  if (!week.gamesPlayedPerBoundary) week.gamesPlayedPerBoundary = {};

  // Process boundaries between adjacent divisions
  for (let i = 0; i < divOrder.length - 1; i++) {
    const upperDiv = divOrder[i];
    const lowerDiv = divOrder[i + 1];
    const boundaryKey = `${upperDiv}|${lowerDiv}`;

    // Skip boundary if either adjacent division was inactive this week
    if (inactiveDivisions.has(upperDiv) || inactiveDivisions.has(lowerDiv)) continue;

    // Increment games-played counter for this boundary
    week.gamesPlayedPerBoundary[boundaryKey] = (week.gamesPlayedPerBoundary[boundaryKey] || 0) + 1;

    // Determine how many teams move
    const rule = (state.promotionRules || {})[boundaryKey] || { everyN: 1, teamsX: 1 };
    const gamesPlayed = week.gamesPlayedPerBoundary[boundaryKey];

    // Check if this is a double-move week (every 3 games played at boundary)
    let teamsToMove = rule.teamsX;
    if (gamesPlayed % 3 === 0) teamsToMove = Math.max(teamsToMove, 2);

    // Only move if we've hit the everyN trigger
    if (gamesPlayed % rule.everyN !== 0) continue;

    const upperStandings = weekStandings[upperDiv] || [];
    const lowerStandings = weekStandings[lowerDiv] || [];

    // Bottom of upper division → relegated down
    // Top of lower division → promoted up
    const relegated = upperStandings.slice(-teamsToMove).map(t => t.team);
    const promoted = lowerStandings.slice(0, teamsToMove).map(t => t.team);

    // Apply swaps
    for (let j = 0; j < Math.min(relegated.length, promoted.length); j++) {
      const rel = relegated[j];
      const pro = promoted[j];

      currentDivisions[upperDiv] = currentDivisions[upperDiv].filter(t => t !== rel);
      currentDivisions[upperDiv].push(pro);

      currentDivisions[lowerDiv] = currentDivisions[lowerDiv].filter(t => t !== pro);
      currentDivisions[lowerDiv].push(rel);

      movements.push({ team: rel, from: upperDiv, to: lowerDiv, type: 'relegated' });
      movements.push({ team: pro, from: lowerDiv, to: upperDiv, type: 'promoted' });
    }
  }

  // Persist updated division state
  config._currentDivisions = currentDivisions;

  // Regenerate matches for future weeks with new division assignments
  if (movements.length > 0) {
    regenerateFutureMatches(state, weekNum, currentDivisions);
  }

  // Mark week finalized
  week.finalized = true;
  if (!state.finalizedWeeks.includes(weekNum)) state.finalizedWeeks.push(weekNum);

  return { movements, weekNum };
}

/**
 * Compute standings per division using only matches from weeks <= weekNum.
 * Supports both double-score (set-based) and legacy formats.
 */
function computeWeekStandings(schedule, weekNum, currentDivisions) {
  const stats = {};

  for (const week of schedule) {
    if (week.weekNum > weekNum) continue;
    for (const m of week.matches) {
      if (!matchHasScores(m)) continue;
      if (!m.division) continue;
      if (!currentDivisions[m.division]) continue;

      ensureTeam(stats, m.teamA, m.division);
      ensureTeam(stats, m.teamB, m.division);

      const a = stats[`${m.division}:${m.teamA}`];
      const b = stats[`${m.division}:${m.teamB}`];

      if (m.set1A !== undefined && m.set1A !== null) {
        // Set-based scoring
        a.gp++; b.gp++;
        if (m.set1A > m.set1B) { a.w++; b.l++; a.pts += 2; }
        else if (m.set1B > m.set1A) { b.w++; a.l++; b.pts += 2; }
        if (m.set2A > m.set2B) { a.w++; b.l++; a.pts += 2; }
        else if (m.set2B > m.set2A) { b.w++; a.l++; b.pts += 2; }
      } else {
        // Legacy scoring
        a.gp++; b.gp++;
        if (m.scoreA > m.scoreB) { a.w++; b.l++; a.pts += 2; }
        else if (m.scoreB > m.scoreA) { b.w++; a.l++; b.pts += 2; }
        else { a.pts++; b.pts++; }
      }
    }
  }

  // Group by division and sort
  const result = {};
  for (const [divName, teams] of Object.entries(currentDivisions)) {
    result[divName] = teams
      .map(t => stats[`${divName}:${t}`] || { team: t, gp: 0, w: 0, l: 0, pts: 0 })
      .sort((a, b) => b.pts - a.pts || b.w - a.w);
  }
  return result;
}

function ensureTeam(stats, team, division) {
  const key = `${division}:${team}`;
  if (!stats[key]) stats[key] = { team, gp: 0, w: 0, l: 0, pts: 0 };
}

/**
 * Regenerate match pairs for weeks after weekNum based on updated division rosters.
 * Keeps dates/courts/slots intact; only swaps teamA/teamB per division.
 */
function regenerateFutureMatches(state, fromWeekNum, currentDivisions) {
  const config = state.generateConfig;

  // Build new round-robin rounds per division
  const divRounds = {};
  for (const [divName, teams] of Object.entries(currentDivisions)) {
    divRounds[divName] = { teams, rounds: generateRounds(teams), roundIdx: 0 };
  }

  for (const week of state.schedule) {
    if (week.weekNum <= fromWeekNum) continue;
    if (week.finalized) continue;
    if (week.inactiveDivisions?.length === Object.keys(currentDivisions).length) continue;

    const nonDivMatches = week.matches.filter(m => !m.division || !currentDivisions[m.division]);
    const newMatches = [...nonDivMatches];

    // Group existing match slots by division to preserve court/time assignments
    const byDivSlot = {};
    for (const m of week.matches) {
      if (!m.division || !currentDivisions[m.division]) continue;
      const key = `${m.division}:${m.slot}`;
      if (!byDivSlot[key]) byDivSlot[key] = m;
    }

    for (const [divName, dr] of Object.entries(divRounds)) {
      if (week.inactiveDivisions?.includes(divName)) continue;

      const r0 = dr.rounds[dr.roundIdx % dr.rounds.length];
      const r1 = dr.rounds[(dr.roundIdx + 1) % dr.rounds.length];
      dr.roundIdx += 2;

      const template0 = byDivSlot[`${divName}:0`] || byDivSlot[`${divName}:2`];
      const template1 = byDivSlot[`${divName}:1`] || byDivSlot[`${divName}:3`];

      if (r0.length > 0 && template0) {
        const [teamA, teamB] = r0[0];
        newMatches.push({ ...template0, id: newId(), teamA, teamB, scoreA: null, scoreB: null, set1A: null, set1B: null, set2A: null, set2B: null });
      }
      if (r1.length > 0 && template1) {
        const [teamA, teamB] = r1[0];
        newMatches.push({ ...template1, id: newId(), teamA, teamB, scoreA: null, scoreB: null, set1A: null, set1B: null, set2A: null, set2B: null });
      }
    }

    week.matches = newMatches;
  }
}

module.exports = { finalizeWeek };
