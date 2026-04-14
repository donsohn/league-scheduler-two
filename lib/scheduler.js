'use strict';

let _matchCounter = 0;
function newId() { return `m${++_matchCounter}_${Date.now()}`; }

/**
 * Add minutes to HH:MM time string. Returns HH:MM.
 */
function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Get all game-day dates between startDate and endDate (YYYY-MM-DD),
 * on the given weekday, excluding blackout dates.
 */
function getGameDates(startDate, endDate, gameDay, blackoutDates = []) {
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = DAYS.indexOf(gameDay.toLowerCase());
  if (targetDay === -1) throw new Error('Invalid game day: ' + gameDay);

  const blackouts = new Set(blackoutDates);
  const start = new Date(startDate + 'T12:00:00Z');
  const end = new Date(endDate + 'T12:00:00Z');
  const dates = [];

  let cur = new Date(start);
  while (cur.getUTCDay() !== targetDay) cur.setUTCDate(cur.getUTCDate() + 1);

  while (cur <= end) {
    const iso = cur.toISOString().split('T')[0];
    if (!blackouts.has(iso)) dates.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return dates;
}

/**
 * Circle-method round-robin. Returns array of rounds;
 * each round is an array of [teamA, teamB] pairs.
 */
function generateRounds(teams) {
  const list = teams.length % 2 === 0 ? [...teams] : [...teams, '__BYE__'];
  const n = list.length;
  const rounds = [];

  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a !== '__BYE__' && b !== '__BYE__') round.push([a, b]);
    }
    rounds.push(round);
    // Rotate: fix position 0, rotate the rest
    const last = list.splice(n - 1, 1)[0];
    list.splice(1, 0, last);
  }
  return rounds;
}

/**
 * Given a list of pairs and court count, split into two slots (back-to-back)
 * such that no team appears in both slot 0 and slot 1 simultaneously.
 * Returns { slot0: [...pairs], slot1: [...pairs], resting: [...teams] }
 */
function splitBackToBack(pairs, courtCount) {
  // Each slot can have up to courtCount matches.
  // We want teams to play in both slots (true back-to-back).
  // Strategy: slot0 gets first min(courtCount, pairs.length/2) pairs,
  //           slot1 gets a different set of pairs using same teams.
  // If pairs come from a single round-robin round, each team appears once.
  // We'll take 2 consecutive rounds and merge them:
  // this function expects pairs already representing 2 rounds combined.

  // Actually this function receives the pairs for one time slot.
  // For back-to-back, the caller passes 2 rounds and we just check no conflict.
  const slot0 = [], slot1 = [];
  const usedSlot0 = new Set();

  for (const pair of pairs) {
    const [a, b] = pair;
    if (slot0.length < courtCount && !usedSlot0.has(a) && !usedSlot0.has(b)) {
      slot0.push(pair);
      usedSlot0.add(a);
      usedSlot0.add(b);
    } else {
      slot1.push(pair);
    }
  }

  // Trim slot1 to courtCount
  const overflow = slot1.splice(courtCount);
  const resting = overflow.flatMap(([a, b]) => [a, b]);

  return { slot0, slot1, resting };
}

/**
 * Build a night of matches from two rounds of round-robin pairs.
 */
function buildNightMatches(round0, round1, date, weekNum, firstGameTime, slotDuration, venues, division = null) {
  const matches = [];
  const allCourts = buildCourtList(venues);

  let courtIdx = 0;
  for (const [teamA, teamB] of round0) {
    const { venue, court } = allCourts[courtIdx % allCourts.length] || { venue: venues[0]?.name || 'Venue 1', court: courtIdx + 1 };
    matches.push({
      id: newId(),
      weekNum,
      date,
      slot: 0,
      time: firstGameTime,
      endTime: addMinutes(firstGameTime, slotDuration),
      venue,
      court,
      teamA,
      teamB,
      scoreA: null,
      scoreB: null,
      set1A: null, set1B: null, set2A: null, set2B: null,
      type: 'REGULAR_SEASON',
      division,
      isExtra: false
    });
    courtIdx++;
  }

  courtIdx = 0;
  for (const [teamA, teamB] of round1) {
    const { venue, court } = allCourts[courtIdx % allCourts.length] || { venue: venues[0]?.name || 'Venue 1', court: courtIdx + 1 };
    matches.push({
      id: newId(),
      weekNum,
      date,
      slot: 1,
      time: addMinutes(firstGameTime, slotDuration),
      endTime: addMinutes(firstGameTime, slotDuration * 2),
      venue,
      court,
      teamA,
      teamB,
      scoreA: null,
      scoreB: null,
      set1A: null, set1B: null, set2A: null, set2B: null,
      type: 'REGULAR_SEASON',
      division,
      isExtra: false
    });
    courtIdx++;
  }

  return matches;
}

/**
 * Build flat list of { venue, court } from venues config.
 */
function buildCourtList(venues) {
  const list = [];
  for (const v of venues) {
    for (let c = 1; c <= v.courts; c++) {
      list.push({ venue: v.name, court: c });
    }
  }
  return list;
}

/**
 * Generate All-vs-All Round Robin schedule.
 */
function generateAllVsAll(config) {
  const {
    teams, startDate, endDate, gameDay, firstGameTime, slotDuration,
    venues, blackoutDates = [], extraMatches = false
  } = config;

  _matchCounter = 0;

  const gameDates = getGameDates(startDate, endDate, gameDay, blackoutDates);
  const totalCourts = venues.reduce((sum, v) => sum + v.courts, 0);
  const rrRounds = generateRounds(teams);

  // Build extended round sequence: repeat until we have enough for all nights × 2 slots
  const neededRounds = gameDates.length * 2;
  const extRounds = [];
  for (let i = 0; i < neededRounds; i++) {
    extRounds.push(rrRounds[i % rrRounds.length]);
  }

  // Track rest fairness
  const restCount = {};
  teams.forEach(t => { restCount[t] = 0; });

  const schedule = [];

  for (let w = 0; w < gameDates.length; w++) {
    const date = gameDates[w];
    const weekNum = w + 1;

    let round0 = [...(extRounds[w * 2] || [])];
    let round1 = [...(extRounds[w * 2 + 1] || [])];

    // Limit to available courts (choose matches prioritizing most-rested teams)
    if (round0.length > totalCourts) {
      round0 = selectByRest(round0, totalCourts, restCount);
    }
    if (round1.length > totalCourts) {
      round1 = selectByRest(round1, totalCourts, restCount);
    }

    // Ensure back-to-back: remove slot1 matches for teams not in slot0
    // (teams that play slot0 should also play slot1 and vice versa)
    const slot0Teams = new Set(round0.flatMap(([a, b]) => [a, b]));
    const slot1Teams = new Set(round1.flatMap(([a, b]) => [a, b]));

    // Filter round1 to only include teams from round0 (back-to-back)
    const backToBackRound1 = round1.filter(([a, b]) => slot0Teams.has(a) && slot0Teams.has(b));
    const useRound1 = backToBackRound1.length > 0 ? backToBackRound1 : round1;

    const weekMatches = buildNightMatches(round0, useRound1, date, weekNum, firstGameTime, slotDuration, venues);

    // Update rest counts
    const playingTeams = new Set(weekMatches.flatMap(m => [m.teamA, m.teamB]));
    teams.forEach(t => { if (!playingTeams.has(t)) restCount[t]++; });

    // Extra matches: fill spare courts
    if (extraMatches) {
      const extras = generateExtras(weekMatches, teams, totalCourts, date, weekNum, firstGameTime, slotDuration, venues);
      weekMatches.push(...extras);
    }

    schedule.push({
      weekNum,
      date,
      matches: weekMatches,
      inactiveDivisions: [],
      finalized: false,
      gamesPlayedPerBoundary: {}
    });
  }

  return schedule;
}

/**
 * Select up to limit pairs prioritizing teams with most rest.
 */
function selectByRest(pairs, limit, restCount) {
  const scored = pairs.map(([a, b]) => ({ pair: [a, b], score: (restCount[a] || 0) + (restCount[b] || 0) }));
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map(x => x.pair);
}

/**
 * Generate extra bonus matches to fill spare courts.
 */
function generateExtras(existingMatches, teams, totalCourts, date, weekNum, firstGameTime, slotDuration, venues) {
  const extras = [];
  const allCourts = buildCourtList(venues);

  for (let slot = 0; slot <= 1; slot++) {
    const slotMatches = existingMatches.filter(m => m.slot === slot && !m.isExtra);
    const usedCourts = slotMatches.length;
    const spare = totalCourts - usedCourts;
    if (spare <= 0) continue;

    const playing = new Set(slotMatches.flatMap(m => [m.teamA, m.teamB]));

    // Find teams not playing this slot
    const idle = teams.filter(t => !playing.has(t));

    // Make pairs from idle teams
    const idlePairs = [];
    for (let i = 0; i + 1 < idle.length; i += 2) {
      idlePairs.push([idle[i], idle[i + 1]]);
    }

    const toAdd = idlePairs.slice(0, spare);
    toAdd.forEach(([teamA, teamB], i) => {
      const ci = usedCourts + i;
      const { venue, court } = allCourts[ci % allCourts.length] || { venue: venues[0]?.name || 'Venue 1', court: ci + 1 };
      extras.push({
        id: newId(),
        weekNum,
        date,
        slot,
        time: slot === 0 ? firstGameTime : addMinutes(firstGameTime, slotDuration),
        endTime: slot === 0 ? addMinutes(firstGameTime, slotDuration) : addMinutes(firstGameTime, slotDuration * 2),
        venue,
        court,
        teamA,
        teamB,
        scoreA: null,
        scoreB: null,
        set1A: null, set1B: null, set2A: null, set2B: null,
        type: 'REGULAR_SEASON',
        division: null,
        isExtra: true
      });
    });
  }

  return extras;
}

/**
 * Generate Divisional schedule.
 * divisions: [{ name, teams }]
 * Each division independently runs round-robin.
 * divisionVenueConfig: { "Division 1": { venue, court, session/timeBlock } }
 * venues: [{ name, courts, earlyTime, lateTime }] — earlyTime/lateTime are per-venue start times
 */
function generateDivisional(config) {
  const {
    teams: allTeams,
    divisions,
    startDate, endDate, gameDay,
    firstGameTime, slotDuration,
    venues,
    blackoutDates = [],
    extraMatches = false,
    divisionVenueConfig = {}
  } = config;

  _matchCounter = 0;

  const gameDates = getGameDates(startDate, endDate, gameDay, blackoutDates);
  const allCourts = buildCourtList(venues);

  // Build per-venue time lookup (earlyTime / lateTime per venue name)
  const venueTimeMap = {};
  for (const v of venues) {
    venueTimeMap[v.name] = {
      earlyTime: v.earlyTime || firstGameTime,
      lateTime: v.lateTime || addMinutes(firstGameTime, 2 * slotDuration)
    };
  }

  // Build per-division state: teams list + round-robin rounds + round pointer
  const divStates = divisions.map(d => ({
    name: d.name,
    teams: [...d.teams],
    rounds: generateRounds(d.teams),
    roundIdx: 0
  }));

  // Court assignment: sequential across divisions if not in config
  const divCourtAssignment = {};
  let courtCursor = 0;
  for (const d of divStates) {
    const cfg = divisionVenueConfig[d.name];
    if (cfg) {
      divCourtAssignment[d.name] = {
        venue: cfg.venue,
        court: cfg.court,
        session: cfg.timeBlock || cfg.session || 'early'
      };
    } else {
      const ci = courtCursor % allCourts.length;
      divCourtAssignment[d.name] = {
        venue: allCourts[ci]?.venue || venues[0]?.name,
        court: allCourts[ci]?.court || ci + 1,
        session: courtCursor % 2 === 0 ? 'early' : 'late'
      };
      courtCursor++;
    }
  }

  const schedule = [];

  for (let w = 0; w < gameDates.length; w++) {
    const date = gameDates[w];
    const weekNum = w + 1;
    const weekMatches = [];

    for (const divState of divStates) {
      const { name, teams: divTeams, rounds, roundIdx } = divState;

      if (divTeams.length < 2) { divState.roundIdx++; continue; }

      const { venue, court, session } = divCourtAssignment[name];

      // Alternate early/late per week
      const actualSession = alternateSession(session, w);
      const sessionOffset = actualSession === 'late' ? 2 : 0;

      // Look up per-venue start times
      const vt = venueTimeMap[venue] || { earlyTime: firstGameTime, lateTime: addMinutes(firstGameTime, 2 * slotDuration) };
      const sessionStart = actualSession === 'early' ? vt.earlyTime : vt.lateTime;

      // Get two consecutive rounds for this division (slot0 and slot1 within session)
      const r0 = rounds[roundIdx % rounds.length];
      const r1 = rounds[(roundIdx + 1) % rounds.length];
      divState.roundIdx += 2;

      // Each division plays on its assigned court
      // Slot 0 of session: first round
      for (const [teamA, teamB] of r0.slice(0, 1)) { // 1 match per court per slot
        weekMatches.push({
          id: newId(),
          weekNum, date,
          slot: sessionOffset,
          time: sessionStart,
          endTime: addMinutes(sessionStart, slotDuration),
          venue, court,
          teamA, teamB,
          scoreA: null, scoreB: null,
          set1A: null, set1B: null, set2A: null, set2B: null,
          type: 'REGULAR_SEASON',
          division: name,
          isExtra: false
        });
      }

      // Slot 1 of session: second round
      for (const [teamA, teamB] of r1.slice(0, 1)) {
        weekMatches.push({
          id: newId(),
          weekNum, date,
          slot: sessionOffset + 1,
          time: addMinutes(sessionStart, slotDuration),
          endTime: addMinutes(sessionStart, slotDuration * 2),
          venue, court,
          teamA, teamB,
          scoreA: null, scoreB: null,
          set1A: null, set1B: null, set2A: null, set2B: null,
          type: 'REGULAR_SEASON',
          division: name,
          isExtra: false
        });
      }
    }

    // Validate: no team on two courts simultaneously
    const errors = validateNight(weekMatches, weekNum);
    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    schedule.push({
      weekNum,
      date,
      matches: weekMatches,
      inactiveDivisions: [],
      finalized: false,
      gamesPlayedPerBoundary: {}
    });
  }

  // Store initial division team lists in config for relegation use
  config._divisionStates = divStates.map(d => ({
    name: d.name,
    teams: divisions.find(x => x.name === d.name)?.teams || []
  }));

  return schedule;
}

function alternateSession(baseSession, weekIndex) {
  if (weekIndex % 2 === 0) return baseSession;
  return baseSession === 'early' ? 'late' : 'early';
}

/**
 * Validate that no team appears in two matches at the same slot on the same night.
 */
function validateNight(matches, weekNum) {
  const errors = [];
  const bySlot = {};
  for (const m of matches) {
    const key = `${m.date}_${m.slot}`;
    if (!bySlot[key]) bySlot[key] = new Set();
    if (bySlot[key].has(m.teamA)) errors.push(`Week ${weekNum}: ${m.teamA} double-booked in slot ${m.slot}`);
    if (bySlot[key].has(m.teamB)) errors.push(`Week ${weekNum}: ${m.teamB} double-booked in slot ${m.slot}`);
    bySlot[key].add(m.teamA);
    bySlot[key].add(m.teamB);
  }
  return errors;
}

/**
 * Validate entire schedule for double-booking.
 */
function validateSchedule(schedule) {
  const errors = [];
  for (const week of schedule) {
    errors.push(...validateNight(week.matches, week.weekNum));
  }
  return errors;
}

/**
 * Reschedule a night with a new court count.
 * Takes week object, newCourtCount, and config.
 * Returns { matches, warnings } — caller is responsible for assigning to week.matches.
 */
function rescheduleNight(week, newCourtCount, config) {
  const { firstGameTime = '18:30', slotDuration = 35, venues = [{ name: 'Venue 1', courts: newCourtCount }] } = config || {};
  const allCourts = buildCourtList(venues);

  const regularMatches = week.matches.filter(m => !m.isExtra);
  const warnings = [];
  const newMatches = [];

  let slotIdx = 0, courtIdxInSlot = 0;
  for (const m of regularMatches) {
    if (slotIdx > 1) {
      warnings.push(`${m.teamA} vs ${m.teamB} could not be accommodated (rest assigned)`);
      continue;
    }
    const ci = allCourts[courtIdxInSlot % allCourts.length] || { venue: venues[0]?.name || 'Venue 1', court: courtIdxInSlot + 1 };
    newMatches.push({
      ...m,
      id: newId(),
      slot: slotIdx,
      time: addMinutes(firstGameTime, slotIdx * slotDuration),
      endTime: addMinutes(firstGameTime, (slotIdx + 1) * slotDuration),
      venue: ci.venue,
      court: ci.court,
      scoreA: null,
      scoreB: null
    });
    courtIdxInSlot++;
    if (courtIdxInSlot >= newCourtCount) {
      courtIdxInSlot = 0;
      slotIdx++;
    }
  }

  return { matches: newMatches, warnings };
}

/**
 * Main schedule generation entry point.
 */
function generateSchedule(config) {
  _matchCounter = 0;
  let schedule;

  if (config.format === 'divisional') {
    schedule = generateDivisional(config);
  } else {
    schedule = generateAllVsAll(config);
  }

  const errors = validateSchedule(schedule);
  return { schedule, errors };
}

module.exports = {
  generateSchedule,
  generateRounds,
  getGameDates,
  addMinutes,
  buildCourtList,
  rescheduleNight,
  validateNight,
  newId
};
