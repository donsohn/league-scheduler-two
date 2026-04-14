'use strict';

const express = require('express');
const path = require('path');
const PDFDocument = require('pdfkit');

const { generateSchedule, rescheduleNight } = require('./lib/scheduler');
const { computeStandings } = require('./lib/standings');
const { finalizeWeek } = require('./lib/relegation');
const { generatePlayoffs } = require('./lib/playoffs');
const { loadState, saveState, defaultState } = require('./lib/storage');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let state = loadState();

// Helper: convert YYYY-MM-DD to MM/DD/YYYY
function formatDateMDY(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y}`;
}

// Helper: find a match across all weeks and playoff rounds
function findMatch(matchId) {
  for (const week of (state.schedule || [])) {
    const match = (week.matches || []).find(m => m.id === matchId);
    if (match) return { week, match };
  }
  if (state.playoffSchedule && state.playoffSchedule.rounds) {
    for (const round of state.playoffSchedule.rounds) {
      const match = (round.matches || []).find(m => m.id === matchId);
      if (match) return { round, match };
    }
  }
  return null;
}

// POST /api/generate
app.post('/api/generate', (req, res) => {
  const config = req.body;

  // Pass divisionCourtMap from state to scheduler as divisionVenueConfig
  const existingCourtMap = state.divisionCourtMap || {};
  if (Object.keys(existingCourtMap).length > 0) {
    const divisionVenueConfig = {};
    for (const [div, cfg] of Object.entries(existingCourtMap)) {
      divisionVenueConfig[div] = { venue: cfg.venue, court: cfg.court, session: cfg.timeBlock || 'early' };
    }
    config.divisionVenueConfig = divisionVenueConfig;
  }

  const { schedule, errors } = generateSchedule(config);
  if (errors && errors.length > 0) {
    return res.status(400).json({ errors });
  }
  const fresh = defaultState();
  fresh.generateConfig = config;
  fresh.schedule = schedule;
  fresh.divisionCourtMap = existingCourtMap; // preserve court map across regenerations
  state = fresh;
  saveState(state);
  return res.json({ schedule, config });
});

// GET /api/state/load
app.get('/api/state/load', (req, res) => {
  state = loadState();
  return res.json(state);
});

// POST /api/state/save
app.post('/api/state/save', (req, res) => {
  saveState(state);
  return res.json({ ok: true });
});

// POST /api/scores
app.post('/api/scores', (req, res) => {
  const { matchId, scoreA, scoreB, set1A, set1B, set2A, set2B } = req.body;
  const found = findMatch(matchId);
  if (!found) return res.status(404).json({ error: 'Match not found' });

  if (set1A !== undefined || set1B !== undefined || set2A !== undefined || set2B !== undefined) {
    // Double-score (set-based) format
    found.match.set1A = (set1A !== undefined && set1A !== '') ? Number(set1A) : null;
    found.match.set1B = (set1B !== undefined && set1B !== '') ? Number(set1B) : null;
    found.match.set2A = (set2A !== undefined && set2A !== '') ? Number(set2A) : null;
    found.match.set2B = (set2B !== undefined && set2B !== '') ? Number(set2B) : null;
    // Clear legacy fields
    found.match.scoreA = null;
    found.match.scoreB = null;
  } else {
    // Legacy single-score format
    found.match.scoreA = (scoreA !== undefined && scoreA !== '') ? Number(scoreA) : null;
    found.match.scoreB = (scoreB !== undefined && scoreB !== '') ? Number(scoreB) : null;
  }

  saveState(state);
  return res.json({ ok: true });
});

// POST /api/division-court-map
app.post('/api/division-court-map', (req, res) => {
  const { division, venue, court, timeBlock } = req.body;
  if (!division) return res.status(400).json({ error: 'division required' });
  if (!state.divisionCourtMap) state.divisionCourtMap = {};
  state.divisionCourtMap[division] = { venue, court: Number(court) || 1, timeBlock: timeBlock || 'early' };
  saveState(state);
  return res.json({ ok: true });
});

// GET /api/standings
app.get('/api/standings', (req, res) => {
  try {
    const standings = computeStandings(state);
    return res.json(standings);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/finalize-week
app.post('/api/finalize-week', (req, res) => {
  const { weekNum } = req.body;
  try {
    const result = finalizeWeek(state, weekNum);
    // weeklyRankings are recorded inside finalizeWeek
    saveState(state);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/reschedule-night
app.post('/api/reschedule-night', (req, res) => {
  const { weekNum, courtCount } = req.body;
  const week = (state.schedule || []).find(w => w.weekNum === weekNum);
  if (!week) return res.status(404).json({ error: 'Week not found' });
  try {
    const { matches, warnings } = rescheduleNight(week, courtCount, state.generateConfig);
    week.matches = matches;
    saveState(state);
    return res.json({ week, warnings });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /api/edit-match
app.patch('/api/edit-match', (req, res) => {
  const { matchId, ...updates } = req.body;
  const found = findMatch(matchId);
  if (!found) return res.status(404).json({ error: 'Match not found' });
  Object.assign(found.match, updates);
  saveState(state);
  return res.json({ ok: true });
});

// POST /api/toggle-division
app.post('/api/toggle-division', (req, res) => {
  const { weekNum, division, active } = req.body;
  const week = (state.schedule || []).find(w => w.weekNum === weekNum);
  if (!week) return res.status(404).json({ error: 'Week not found' });
  if (!week.inactiveDivisions) week.inactiveDivisions = [];
  if (active) {
    week.inactiveDivisions = week.inactiveDivisions.filter(d => d !== division);
  } else {
    if (!week.inactiveDivisions.includes(division)) {
      week.inactiveDivisions.push(division);
    }
  }
  saveState(state);
  return res.json({ week });
});

// POST /api/set-promotion-rule
app.post('/api/set-promotion-rule', (req, res) => {
  const { boundary, everyN, teamsX } = req.body;
  if (!state.promotionRules) state.promotionRules = {};
  state.promotionRules[boundary] = { everyN: Number(everyN), teamsX: Number(teamsX) };
  saveState(state);
  return res.json({ ok: true });
});

// POST /api/playoffs/generate
app.post('/api/playoffs/generate', (req, res) => {
  try {
    const standings = computeStandings(state);
    const playoffSchedule = generatePlayoffs(state, standings);
    state.playoffSchedule = playoffSchedule;
    saveState(state);
    return res.json(playoffSchedule);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/export/csv
app.get('/api/export/csv', (req, res) => {
  const leagueName = (state.generateConfig && state.generateConfig.leagueName) || 'League';

  function quoteField(v) {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return `"${s}"`;
  }

  const header = ['SUB_PROGRAM', 'HOME_TEAM', 'AWAY_TEAM', 'DATE', 'START_TIME', 'END_TIME', 'LOCATION', 'SUB_LOCATION', 'TYPE', 'NOTES'];
  const rows = [header.map(quoteField).join(',')];

  for (const week of (state.schedule || [])) {
    for (const m of (week.matches || [])) {
      const row = [
        leagueName,
        m.teamA || '',
        m.teamB || '',
        formatDateMDY(m.date),
        m.time || '',
        m.endTime || '',
        m.venue || '',
        m.court ? `Court ${m.court}` : '',
        m.type || 'REGULAR_SEASON',
        ''
      ];
      rows.push(row.map(quoteField).join(','));
    }
  }

  if (state.playoffSchedule && state.playoffSchedule.rounds) {
    for (const round of state.playoffSchedule.rounds) {
      for (const m of (round.matches || [])) {
        const row = [
          leagueName,
          m.teamA || 'TBD',
          m.teamB || 'TBD',
          formatDateMDY(m.date),
          m.time || '',
          m.endTime || '',
          m.venue || '',
          m.court ? `Court ${m.court}` : '',
          'PLAYOFF',
          round.name || ''
        ];
        rows.push(row.map(quoteField).join(','));
      }
    }
  }

  const csv = rows.join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="schedule.csv"');
  return res.send(csv);
});

// ── PDF helpers ───────────────────────────────────────────────────────────────

function drawTableHeader(doc, tableLeft, colWidths, colHeaders) {
  const y = doc.y;
  doc.fontSize(10).font('Helvetica-Bold');
  let x = tableLeft;
  colHeaders.forEach((h, i) => {
    doc.text(h, x, y, { width: colWidths[i], lineBreak: false });
    x += colWidths[i];
  });
  doc.moveDown(0.4);
  const lineY = doc.y;
  doc.moveTo(tableLeft, lineY)
     .lineTo(tableLeft + colWidths.reduce((a, b) => a + b, 0), lineY)
     .stroke();
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10);
}

function drawMatchRow(doc, tableLeft, colWidths, cells, pageBreakY) {
  if (doc.y > (pageBreakY || 680)) {
    doc.addPage();
  }
  const y = doc.y;
  let x = tableLeft;
  cells.forEach((c, i) => {
    doc.text(String(c == null ? '' : c), x, y, { width: colWidths[i], lineBreak: false });
    x += colWidths[i];
  });
  doc.moveDown(0.55);
}

function drawNotesBox(doc) {
  doc.moveDown(0.5);
  const notesY = doc.y + 6;
  doc.fontSize(10).font('Helvetica-Bold').text('Notes / Marketing:', 50, notesY);
  doc.rect(50, notesY + 14, 510, 80).stroke();
}

// IMPORTANT: register /playoff/:night BEFORE /:weekNum so "playoff" is not parsed as weekNum
// GET /api/export/pdf/playoff/:night
app.get('/api/export/pdf/playoff/:night', (req, res) => {
  const night = parseInt(req.params.night, 10);
  if (isNaN(night) || (night !== 1 && night !== 2)) {
    return res.status(400).json({ error: 'Night must be 1 or 2' });
  }
  const ps = state.playoffSchedule;
  if (!ps) return res.status(404).json({ error: 'No playoff schedule generated' });

  const nightDate = night === 1 ? ps.night1Date : ps.night2Date;
  const rounds = (ps.rounds || []).filter(r => r.date === nightDate);

  const leagueName = (state.generateConfig && state.generateConfig.leagueName) || 'League';

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="playoffs-night${night}.pdf"`);
  doc.pipe(res);

  doc.fontSize(20).font('Helvetica-Bold').text(leagueName, { align: 'center' });
  doc.fontSize(14).font('Helvetica').text(
    `Playoff Night ${night} \u2014 ${formatDateMDY(nightDate)}`,
    { align: 'center' }
  );
  doc.moveDown(1);

  const tableLeft = 50;
  const colWidths = [70, 150, 150, 100, 60];
  const colHeaders = ['Time', 'Home', 'Away', 'Score', 'Court'];

  for (const round of rounds) {
    doc.fontSize(13).font('Helvetica-Bold').text(round.name || 'Round', { underline: true });
    doc.moveDown(0.4);
    drawTableHeader(doc, tableLeft, colWidths, colHeaders);

    for (const m of (round.matches || [])) {
      const cells = [
        m.time || '',
        m.teamA || 'TBD',
        m.teamB || 'TBD',
        '_____ - _____',
        m.court ? String(m.court) : ''
      ];
      drawMatchRow(doc, tableLeft, colWidths, cells);
    }
    doc.moveDown(0.8);
  }

  drawNotesBox(doc);
  doc.end();
});

// GET /api/export/pdf/:weekNum
app.get('/api/export/pdf/:weekNum', (req, res) => {
  const weekNum = parseInt(req.params.weekNum, 10);
  if (isNaN(weekNum)) return res.status(400).json({ error: 'Invalid weekNum' });

  const week = (state.schedule || []).find(w => w.weekNum === weekNum);
  if (!week) return res.status(404).json({ error: 'Week not found' });

  const leagueName = (state.generateConfig && state.generateConfig.leagueName) || 'League';
  const venueSet = [...new Set((week.matches || []).map(m => m.venue).filter(Boolean))];
  const venueStr = venueSet.join(', ');

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="gamesheet-week${weekNum}.pdf"`);
  doc.pipe(res);

  doc.fontSize(22).font('Helvetica-Bold').text(leagueName, { align: 'center' });
  doc.fontSize(14).font('Helvetica').text(
    `Game Sheet \u2014 Week ${weekNum} \u2014 ${formatDateMDY(week.date)}`,
    { align: 'center' }
  );
  if (venueStr) {
    doc.fontSize(11).text(`Venue: ${venueStr}`, { align: 'center' });
  }
  doc.moveDown(1);

  const tableLeft = 50;
  const colWidths = [60, 140, 140, 100, 55, 55];
  const colHeaders = ['Time', 'Home', 'Away', 'Score', 'Court', 'Div'];

  drawTableHeader(doc, tableLeft, colWidths, colHeaders);

  for (const m of (week.matches || [])) {
    const cells = [
      m.time || '',
      m.teamA || '',
      m.teamB || '',
      '_____ - _____',
      m.court ? String(m.court) : '',
      m.division || ''
    ];
    drawMatchRow(doc, tableLeft, colWidths, cells, 680);
  }

  drawNotesBox(doc);
  doc.end();
});

app.listen(PORT, () => {
  console.log(`League Scheduler #2 running on http://localhost:${PORT}`);
});

module.exports = app;
