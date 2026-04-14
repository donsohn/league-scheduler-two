/* ── League Scheduler — Frontend App ───────────────────────────────────────── */

// ── In-memory state ───────────────────────────────────────────────────────────
let appState = null;

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiCall(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors ? data.errors.join('; ') : (data.error || `HTTP ${res.status}`));
  return data;
}

const apiGet   = (path)       => apiCall('GET',   path);
const apiPost  = (path, body) => apiCall('POST',  path, body);
const apiPatch = (path, body) => apiCall('PATCH', path, body);

// ── HTML escape ───────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = (val == null ? '' : val);
}

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'alert alert-' + (type || 'success');
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
    b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + name);
  });
  if (name === 'schedule')  renderScheduleTab();
  if (name === 'standings') renderStandingsTab();
  if (name === 'playoffs')  renderPlayoffsTab();
  if (name === 'settings')  renderCourtAssignSection();
}

function switchSubTab(name) {
  document.querySelectorAll('.sub-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.subtab === name);
  });
  document.querySelectorAll('.sub-tab-content').forEach(el => {
    el.classList.toggle('hidden', el.id !== 'subtab-' + name);
  });
  if (name === 'byteam') renderByTeamView();
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupTabListeners();
  setupSetupTab();
  setupStandingsListeners();
  setupPlayoffListeners();
  setupSettingsListeners();
  setupEditModal();

  try {
    const data = await apiGet('/api/state/load');
    appState = data;
    if (!appState.weeklyRankings) appState.weeklyRankings = {};
    if (!appState.divisionCourtMap) appState.divisionCourtMap = {};
    if (appState.generateConfig) populateSetupForm(appState.generateConfig);
  } catch (e) {
    console.warn('Could not load saved state:', e.message);
    appState = { generateConfig: null, schedule: [], playoffSchedule: null, finalizedWeeks: [], promotionRules: {}, weeklyRankings: {}, divisionCourtMap: {} };
  }
});

function setupTabListeners() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSubTab(btn.dataset.subtab));
  });
}

// ── Setup Tab ─────────────────────────────────────────────────────────────────
function setupSetupTab() {
  document.querySelectorAll('input[name="format"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isDivisional = getFormat() === 'divisional';
      document.getElementById('rrTeamsSection').classList.toggle('hidden', isDivisional);
      document.getElementById('divisionalSection').classList.toggle('hidden', !isDivisional);
    });
  });
  document.getElementById('addDivisionBtn').addEventListener('click', () => addDivisionRow());
  document.getElementById('addVenueBtn').addEventListener('click', () => addVenueRow());
  document.getElementById('generateBtn').addEventListener('click', handleGenerate);
  document.getElementById('loadStateBtn').addEventListener('click', handleLoadState);
  document.getElementById('saveStateBtn').addEventListener('click', handleSaveState);
  addVenueRow('Main Gym', 2);
}

function getFormat() {
  const radio = document.querySelector('input[name="format"]:checked');
  return radio ? radio.value : 'roundrobin';
}

// ── Division rows ─────────────────────────────────────────────────────────────
function addDivisionRow(data) {
  const list = document.getElementById('divisionsList');
  const div = document.createElement('div');
  div.className = 'division-item';
  div.innerHTML =
    '<div class="division-item-row">' +
      '<input type="text" class="div-name-input" placeholder="Division name" value="' + esc((data && data.name) || '') + '">' +
      '<button type="button" class="btn-danger div-remove-btn">Remove</button>' +
    '</div>' +
    '<textarea class="div-teams-input" rows="4" placeholder="Team A\nTeam B\nTeam C">' +
      esc(((data && data.teams) || []).join('\n')) +
    '</textarea>';
  div.querySelector('.div-remove-btn').addEventListener('click', () => div.remove());
  list.appendChild(div);
}

function getDivisions() {
  return [...document.querySelectorAll('#divisionsList .division-item')].map(el => ({
    name: el.querySelector('.div-name-input').value.trim(),
    teams: el.querySelector('.div-teams-input').value.split('\n').map(s => s.trim()).filter(Boolean)
  })).filter(d => d.name && d.teams.length > 0);
}

// ── Venue rows ────────────────────────────────────────────────────────────────
function addVenueRow(name, courts, earlyTime, lateTime) {
  name      = name      !== undefined ? name      : '';
  courts    = courts    !== undefined ? courts    : 2;
  earlyTime = earlyTime !== undefined ? earlyTime : '18:30';
  lateTime  = lateTime  !== undefined ? lateTime  : '20:15';
  const list = document.getElementById('venuesList');
  const row = document.createElement('div');
  row.className = 'venue-row';
  row.innerHTML =
    '<input type="text" placeholder="Venue name" value="' + esc(name) + '" style="flex:2">' +
    '<label>Courts:</label>' +
    '<input type="number" value="' + Number(courts) + '" min="1" max="30" style="width:70px">' +
    '<label>Early:</label>' +
    '<input type="time" class="venue-early" value="' + esc(earlyTime) + '" style="width:90px">' +
    '<label>Late:</label>' +
    '<input type="time" class="venue-late" value="' + esc(lateTime) + '" style="width:90px">' +
    '<button type="button" class="btn-danger">Remove</button>';
  row.querySelector('.btn-danger').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

function getVenues() {
  return [...document.querySelectorAll('#venuesList .venue-row')].map(row => {
    const inputs = row.querySelectorAll('input[type="text"], input[type="number"]');
    const earlyEl = row.querySelector('.venue-early');
    const lateEl  = row.querySelector('.venue-late');
    return {
      name:      inputs[0].value.trim(),
      courts:    parseInt(inputs[1].value) || 2,
      earlyTime: earlyEl ? earlyEl.value : '18:30',
      lateTime:  lateEl  ? lateEl.value  : '20:15'
    };
  }).filter(v => v.name);
}

// ── Build config from form ────────────────────────────────────────────────────
function buildConfig() {
  const format        = getFormat();
  const leagueName    = document.getElementById('leagueName').value.trim();
  const startDate     = document.getElementById('startDate').value;
  const endDate       = document.getElementById('endDate').value;
  const gameDay       = document.getElementById('gameDay').value;
  const firstGameTime = document.getElementById('firstGameTime').value;
  const slotDuration  = parseInt(document.getElementById('slotDuration').value) || 60;
  const extraMatches  = document.getElementById('extraMatches').checked;
  const venues        = getVenues();
  const blackoutDates = document.getElementById('blackoutDates').value
    .split('\n').map(s => s.trim()).filter(Boolean);
  const playoffNight1 = document.getElementById('playoffNight1').value;
  const playoffNight2 = document.getElementById('playoffNight2').value;
  const playoffDates  = [playoffNight1, playoffNight2].filter(Boolean);

  const config = {
    leagueName, format, startDate, endDate, gameDay, firstGameTime,
    slotDuration, extraMatches, venues, blackoutDates, playoffDates
  };

  if (format === 'divisional') {
    config.divisions = getDivisions();
    config.teams = config.divisions.flatMap(d => d.teams);
  } else {
    config.teams = document.getElementById('teamsTextarea').value
      .split('\n').map(s => s.trim()).filter(Boolean);
  }
  return config;
}

function populateSetupForm(config) {
  if (!config) return;
  setVal('leagueName',    config.leagueName);
  setVal('startDate',     config.startDate);
  setVal('endDate',       config.endDate);
  setVal('gameDay',       config.gameDay);
  setVal('firstGameTime', config.firstGameTime);
  setVal('slotDuration',  config.slotDuration);
  document.getElementById('extraMatches').checked = !!config.extraMatches;

  const fmt = config.format || 'roundrobin';
  const radio = document.querySelector('input[name="format"][value="' + fmt + '"]');
  if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }

  if (fmt === 'roundrobin' && config.teams) setVal('teamsTextarea', config.teams.join('\n'));

  if (fmt === 'divisional' && config.divisions) {
    document.getElementById('divisionsList').innerHTML = '';
    config.divisions.forEach(d => addDivisionRow(d));
  }

  document.getElementById('venuesList').innerHTML = '';
  (config.venues || []).forEach(v => addVenueRow(v.name, v.courts, v.earlyTime, v.lateTime));
  if (!config.venues || !config.venues.length) addVenueRow('Main Gym', 2);

  const dates = config.playoffDates || [];
  setVal('playoffNight1', dates[0] || '');
  setVal('playoffNight2', dates[1] || '');
  if (config.blackoutDates) setVal('blackoutDates', config.blackoutDates.join('\n'));
}

async function handleGenerate() {
  const statusEl = document.getElementById('setupStatus');
  statusEl.textContent = 'Generating...';
  statusEl.className = 'status-msg';
  const config = buildConfig();
  try {
    const result = await apiPost('/api/generate', config);
    appState = Object.assign({}, appState, {
      schedule: result.schedule, generateConfig: result.config,
      playoffSchedule: null, finalizedWeeks: [],
      weeklyRankings: {}, divisionCourtMap: appState.divisionCourtMap || {}
    });
    statusEl.textContent = 'Schedule generated: ' + result.schedule.length + ' weeks.';
    switchTab('schedule');
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.className = 'status-msg error';
  }
}

async function handleLoadState() {
  try {
    appState = await apiGet('/api/state/load');
    if (!appState.weeklyRankings) appState.weeklyRankings = {};
    if (!appState.divisionCourtMap) appState.divisionCourtMap = {};
    if (appState.generateConfig) populateSetupForm(appState.generateConfig);
    document.getElementById('setupStatus').textContent = 'State loaded.';
    document.getElementById('setupStatus').className = 'status-msg';
  } catch (e) {
    document.getElementById('setupStatus').textContent = 'Load failed: ' + e.message;
    document.getElementById('setupStatus').className = 'status-msg error';
  }
}

async function handleSaveState() {
  try {
    await apiPost('/api/state/save');
    document.getElementById('setupStatus').textContent = 'State saved.';
    document.getElementById('setupStatus').className = 'status-msg';
  } catch (e) {
    document.getElementById('setupStatus').textContent = 'Save failed: ' + e.message;
    document.getElementById('setupStatus').className = 'status-msg error';
  }
}

// ── Schedule Tab ──────────────────────────────────────────────────────────────
function renderScheduleTab() {
  if (!appState || !appState.schedule || !appState.schedule.length) {
    document.getElementById('scheduleWeeks').innerHTML =
      '<div class="empty-state">No schedule generated yet. Go to Setup to configure and generate.</div>';
    return;
  }
  renderByNightView();
}

function renderByNightView() {
  const container = document.getElementById('scheduleWeeks');
  const isDivisional = appState.generateConfig && appState.generateConfig.format === 'divisional';
  const finalizedSet = new Set(appState.finalizedWeeks || []);
  container.innerHTML = '';

  for (const week of appState.schedule) {
    const isFinalized = week.finalized || finalizedSet.has(week.weekNum);
    const card = document.createElement('div');
    card.className = 'week-card';
    card.dataset.weeknum = week.weekNum;

    const finalizeBtn = isFinalized
      ? '<button class="btn-finalized" disabled>Finalized</button>'
      : '<button class="btn-finalize" data-weeknum="' + week.weekNum + '">Finalize Week</button>';

    const headerHTML =
      '<div class="week-card-header">' +
        '<span class="week-card-title">Week ' + week.weekNum + ' &mdash; ' + esc(week.date) +
          (isFinalized ? ' <span class="badge badge-final">Finalized</span>' : '') +
        '</span>' +
        '<div class="week-card-actions">' +
          finalizeBtn +
          '<a class="btn-print" href="/api/export/pdf/' + week.weekNum + '" target="_blank">Print Game Sheet</a>' +
        '</div>' +
      '</div>';

    const courtReduceHTML =
      '<div class="week-court-reduce">' +
        '<label>Reduce to courts:</label>' +
        '<input type="number" class="court-count-input" value="2" min="1" max="20">' +
        '<button type="button" class="btn-small reschedule-btn" data-weeknum="' + week.weekNum + '">Reschedule Night</button>' +
      '</div>';

    let divTogglesHTML = '';
    if (isDivisional && appState.generateConfig && appState.generateConfig.divisions) {
      const inactive = new Set(week.inactiveDivisions || []);
      const toggleItems = appState.generateConfig.divisions.map(d =>
        '<label class="div-toggle-label">' +
          '<input type="checkbox" class="div-toggle" data-weeknum="' + week.weekNum + '" data-division="' + esc(d.name) + '" ' + (!inactive.has(d.name) ? 'checked' : '') + '> ' +
          esc(d.name) +
          (inactive.has(d.name) ? ' <span class="badge badge-inactive">Off</span>' : '') +
        '</label>'
      ).join('');
      divTogglesHTML = '<div class="div-toggles-bar"><span>Divisions this night:</span>' + toggleItems + '</div>';
    }

    const tableHTML = buildMatchTable(week, isFinalized, isDivisional);
    card.innerHTML = headerHTML + courtReduceHTML + divTogglesHTML + '<div class="table-wrap">' + tableHTML + '</div>';
    container.appendChild(card);

    // Finalize
    const finalizeEl = card.querySelector('.btn-finalize');
    if (finalizeEl) {
      finalizeEl.addEventListener('click', () => {
        const wn = parseInt(finalizeEl.dataset.weeknum);
        handleFinalizeWeek(wn);
      });
    }

    // Reschedule
    const rescheduleEl = card.querySelector('.reschedule-btn');
    if (rescheduleEl) {
      rescheduleEl.addEventListener('click', () => {
        const wn = parseInt(rescheduleEl.dataset.weeknum);
        const input = card.querySelector('.court-count-input');
        const courtCount = parseInt(input ? input.value : '2') || 2;
        handleRescheduleNight(wn, courtCount);
      });
    }

    // Division toggles
    card.querySelectorAll('.div-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        handleToggleDivision(parseInt(cb.dataset.weeknum), cb.dataset.division, cb.checked);
      });
    });

    // Score save (double-score format)
    card.querySelectorAll('.score-save-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const matchId = btn.dataset.matchid;
        const row = btn.closest('tr');
        const s1a = row.querySelector('.si-1a');
        const s1b = row.querySelector('.si-1b');
        const s2a = row.querySelector('.si-2a');
        const s2b = row.querySelector('.si-2b');
        const scores = {
          set1A: s1a && s1a.value !== '' ? Number(s1a.value) : null,
          set1B: s1b && s1b.value !== '' ? Number(s1b.value) : null,
          set2A: s2a && s2a.value !== '' ? Number(s2a.value) : null,
          set2B: s2b && s2b.value !== '' ? Number(s2b.value) : null
        };
        handleSaveScore(matchId, scores, btn);
      });
    });

    // Edit match
    card.querySelectorAll('.edit-match-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset));
    });
  }
}

function buildMatchTable(week, isFinalized, isDivisional) {
  const sorted = [...(week.matches || [])].sort((a, b) => {
    const t = (a.time || '').localeCompare(b.time || '');
    return t !== 0 ? t : (a.court || 0) - (b.court || 0);
  });

  const divTh = isDivisional ? '<th>Div</th>' : '';
  const rows = sorted.map(m => {
    const isExtra    = m.isExtra;
    const rowClass   = isExtra ? 'match-extra' : '';
    const extraBadge = isExtra ? '<span class="badge badge-extra">Bonus</span>' : '';
    const divTd      = isDivisional ? '<td>' + esc(m.division || '') + '</td>' : '';
    const disabled   = isFinalized ? 'disabled' : '';

    // Determine score display / input
    const hasSetScores = m.set1A !== null && m.set1A !== undefined;
    let scoreCell;

    if (isFinalized) {
      if (hasSetScores) {
        // Show "25-20, 22-25" style
        const s1 = m.set1A + '-' + m.set1B;
        const s2 = m.set2A + '-' + m.set2B;
        scoreCell = '<td class="score-cell-dbl">' + esc(s1) + '<br>' + esc(s2) + '</td>';
      } else if (m.scoreA !== null && m.scoreA !== undefined) {
        scoreCell = '<td class="score-cell-dbl">' + esc(m.scoreA) + '-' + esc(m.scoreB) + '</td>';
      } else {
        scoreCell = '<td class="score-cell-dbl">&mdash;</td>';
      }
    } else {
      // Editable double-score inputs
      const s1a = (m.set1A !== null && m.set1A !== undefined) ? m.set1A : '';
      const s1b = (m.set1B !== null && m.set1B !== undefined) ? m.set1B : '';
      const s2a = (m.set2A !== null && m.set2A !== undefined) ? m.set2A : '';
      const s2b = (m.set2B !== null && m.set2B !== undefined) ? m.set2B : '';
      scoreCell =
        '<td class="score-cell-dbl">' +
          '<div class="set-row"><span class="set-label">S1</span>' +
            '<input class="si-1a score-input-sm" type="number" min="0" value="' + s1a + '" placeholder="A">' +
            '<span class="score-sep">-</span>' +
            '<input class="si-1b score-input-sm" type="number" min="0" value="' + s1b + '" placeholder="B">' +
          '</div>' +
          '<div class="set-row"><span class="set-label">S2</span>' +
            '<input class="si-2a score-input-sm" type="number" min="0" value="' + s2a + '" placeholder="A">' +
            '<span class="score-sep">-</span>' +
            '<input class="si-2b score-input-sm" type="number" min="0" value="' + s2b + '" placeholder="B">' +
          '</div>' +
        '</td>';
    }

    const actionsTd = !isFinalized
      ? '<td class="td-actions">' +
          '<button class="score-save-btn btn-small" data-matchid="' + esc(m.id) + '">Save</button> ' +
          '<button class="edit-match-btn btn-edit"' +
            ' data-matchid="' + esc(m.id) + '"' +
            ' data-time="'    + esc(m.time   || '') + '"' +
            ' data-venue="'   + esc(m.venue  || '') + '"' +
            ' data-court="'   + esc(String(m.court || '')) + '"' +
            ' data-teama="'   + esc(m.teamA  || '') + '"' +
            ' data-teamb="'   + esc(m.teamB  || '') + '">Edit</button>' +
        '</td>'
      : '<td></td>';

    return '<tr class="' + rowClass + '">' +
      '<td>' + esc(m.time  || '') + '</td>' +
      '<td>' + esc(m.venue || '') + '</td>' +
      '<td>' + esc(String(m.court || '')) + '</td>' +
      divTd +
      '<td><strong>' + esc(m.teamA || '') + '</strong></td>' +
      '<td><strong>' + esc(m.teamB || '') + '</strong>' + extraBadge + '</td>' +
      scoreCell +
      actionsTd +
    '</tr>';
  }).join('');

  return '<table><thead><tr>' +
    '<th>Time</th><th>Venue</th><th>Court</th>' + divTh +
    '<th>Home</th><th>Away</th><th>Scores</th><th></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

async function handleFinalizeWeek(weekNum) {
  if (!confirm('Finalize Week ' + weekNum + '? Scores will be locked and relegation applied.')) return;
  try {
    const result = await apiPost('/api/finalize-week', { weekNum });
    const w = appState.schedule.find(x => x.weekNum === weekNum);
    if (w) w.finalized = true;
    if (appState.finalizedWeeks && !appState.finalizedWeeks.includes(weekNum)) {
      appState.finalizedWeeks.push(weekNum);
    }
    // Refresh full state to get updated weeklyRankings
    const freshState = await apiGet('/api/state/load');
    if (freshState.weeklyRankings) appState.weeklyRankings = freshState.weeklyRankings;
    if (freshState.generateConfig) appState.generateConfig = freshState.generateConfig;
    let msg = 'Week ' + weekNum + ' finalized.';
    if (result.movements && result.movements.length) {
      msg += '\nMovements: ' + result.movements.map(m => m.team + ': ' + m.from + ' -> ' + m.to).join(', ');
    }
    alert(msg);
    renderByNightView();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function handleRescheduleNight(weekNum, courtCount) {
  try {
    const result = await apiPost('/api/reschedule-night', { weekNum, courtCount });
    const w = appState.schedule.find(x => x.weekNum === weekNum);
    if (w) w.matches = result.week.matches;
    if (result.warnings && result.warnings.length) alert('Warnings:\n' + result.warnings.join('\n'));
    renderByNightView();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function handleToggleDivision(weekNum, division, active) {
  try {
    await apiPost('/api/toggle-division', { weekNum, division, active });
    const w = appState.schedule.find(x => x.weekNum === weekNum);
    if (w) {
      if (!w.inactiveDivisions) w.inactiveDivisions = [];
      if (active) {
        w.inactiveDivisions = w.inactiveDivisions.filter(d => d !== division);
      } else {
        if (!w.inactiveDivisions.includes(division)) w.inactiveDivisions.push(division);
      }
    }
    renderByNightView();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function handleSaveScore(matchId, scores, btn) {
  try {
    await apiPost('/api/scores', Object.assign({ matchId }, scores));
    for (const week of (appState.schedule || [])) {
      const m = week.matches.find(x => x.id === matchId);
      if (m) { Object.assign(m, scores); break; }
    }
    btn.textContent = 'Saved';
    setTimeout(() => { btn.textContent = 'Save'; }, 1500);
  } catch (err) {
    alert('Error saving score: ' + err.message);
  }
}

// ── By Team view ──────────────────────────────────────────────────────────────
function renderByTeamView() {
  if (!appState || !appState.schedule || !appState.schedule.length) {
    document.getElementById('teamMatchesContainer').innerHTML =
      '<div class="empty-state">No schedule generated yet.</div>';
    return;
  }

  const config = appState.generateConfig;
  let teams = [];
  if (config && config.format === 'divisional' && config.divisions) {
    teams = config.divisions.flatMap(d => d.teams);
  } else if (config && config.teams) {
    teams = config.teams;
  }
  teams = [...new Set(teams)];

  const sel = document.getElementById('teamSelect');
  const prev = sel.value;
  sel.innerHTML = '<option value="">-- Select a team --</option>' +
    teams.map(t => '<option value="' + esc(t) + '"' + (t === prev ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
  sel.onchange = () => showTeamMatches(sel.value);

  if (prev && teams.includes(prev)) {
    showTeamMatches(prev);
  } else if (teams.length > 0) {
    sel.value = teams[0];
    showTeamMatches(teams[0]);
  }
}

function showTeamMatches(team) {
  const container = document.getElementById('teamMatchesContainer');
  if (!team) { container.innerHTML = ''; return; }

  const isDivisional = appState.generateConfig && appState.generateConfig.format === 'divisional';
  const allMatches = [];
  for (const week of (appState.schedule || [])) {
    for (const m of (week.matches || [])) {
      if (m.teamA === team || m.teamB === team) {
        allMatches.push(Object.assign({}, m, { weekNum: week.weekNum }));
      }
    }
  }

  if (!allMatches.length) {
    container.innerHTML = '<div class="empty-state">No matches found for ' + esc(team) + '.</div>';
    return;
  }

  const divTh = isDivisional ? '<th>Division</th>' : '';
  const rows = allMatches.map(m => {
    const isHome = m.teamA === team;
    const opp    = isHome ? m.teamB : m.teamA;
    let result   = '&mdash;';
    let scoreStr = '&mdash;';

    const hasSetScores = m.set1A !== null && m.set1A !== undefined &&
                         m.set1B !== null && m.set1B !== undefined &&
                         m.set2A !== null && m.set2A !== undefined &&
                         m.set2B !== null && m.set2B !== undefined;

    if (hasSetScores) {
      const myS1 = isHome ? m.set1A : m.set1B, oppS1 = isHome ? m.set1B : m.set1A;
      const myS2 = isHome ? m.set2A : m.set2B, oppS2 = isHome ? m.set2B : m.set2A;
      scoreStr = myS1 + '-' + oppS1 + ', ' + myS2 + '-' + oppS2;
      const mySetsWon  = (myS1 > oppS1 ? 1 : 0) + (myS2 > oppS2 ? 1 : 0);
      const oppSetsWon = (oppS1 > myS1 ? 1 : 0) + (oppS2 > myS2 ? 1 : 0);
      if (mySetsWon > oppSetsWon)       result = '<span style="color:var(--color-success);font-weight:700">W</span>';
      else if (mySetsWon < oppSetsWon)  result = '<span style="color:var(--color-error);font-weight:700">L</span>';
      else                              result = '<span style="font-weight:600">D</span>';
    } else if (m.scoreA !== null && m.scoreA !== undefined && m.scoreB !== null && m.scoreB !== undefined) {
      const myScore  = isHome ? m.scoreA : m.scoreB;
      const oppScore = isHome ? m.scoreB : m.scoreA;
      scoreStr = myScore + '-' + oppScore;
      if (myScore > oppScore)      result = '<span style="color:var(--color-success);font-weight:700">W</span>';
      else if (myScore < oppScore) result = '<span style="color:var(--color-error);font-weight:700">L</span>';
      else                         result = '<span style="font-weight:600">D</span>';
    }

    const divTd = isDivisional ? '<td>' + esc(m.division || '') + '</td>' : '';
    return '<tr>' +
      '<td>Week ' + m.weekNum + '</td>' +
      '<td>' + esc(m.date  || '') + '</td>' +
      '<td>' + esc(m.time  || '') + '</td>' +
      '<td>' + esc(m.venue || '') + (m.court ? ' C' + m.court : '') + '</td>' +
      divTd +
      '<td>vs <strong>' + esc(opp || '') + '</strong></td>' +
      '<td>' + scoreStr + '</td>' +
      '<td>' + result + '</td>' +
    '</tr>';
  }).join('');

  container.innerHTML =
    '<h3 style="margin-bottom:12px">' + esc(team) + ' &mdash; Full Season</h3>' +
    '<div class="table-wrap"><table><thead><tr>' +
      '<th>Week</th><th>Date</th><th>Time</th><th>Court</th>' + divTh +
      '<th>Opponent</th><th>Score</th><th>Result</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// ── Standings Tab ─────────────────────────────────────────────────────────────
function setupStandingsListeners() {
  document.getElementById('refreshStandingsBtn').addEventListener('click', renderStandingsTab);
}

async function renderStandingsTab() {
  const container = document.getElementById('standingsContainer');
  container.innerHTML = '<p style="color:var(--color-text-muted)">Loading standings...</p>';
  try {
    const standings = await apiGet('/api/standings');
    renderStandingsTables(standings, container);
    renderSeasonStandingsSection(standings);
    renderPromotionRulesSection();
  } catch (e) {
    container.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>';
  }
}

function renderStandingsTables(standings, container) {
  if (!standings) { container.innerHTML = '<div class="empty-state">No standings available.</div>'; return; }
  const keys = Object.keys(standings).filter(k => !k.startsWith('_'));
  if (!keys.length) { container.innerHTML = '<div class="empty-state">Enter scores to see standings.</div>'; return; }

  let html = '';
  for (const key of keys) {
    const rows = standings[key];
    if (!Array.isArray(rows)) continue;
    const title = key === 'overall' ? 'Overall Standings' : key;
    html += '<div class="standings-division"><h3>' + esc(title) + '</h3>' +
      '<div class="table-wrap"><table>' +
      '<thead><tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>PTS</th><th>GF</th><th>GA</th><th>+/-</th></tr></thead>' +
      '<tbody>' +
      rows.map((t, i) => {
        const diff = (t.gamesFor || 0) - (t.gamesAgainst || 0);
        const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
        return '<tr class="' + rankClass + '">' +
          '<td>' + (i + 1) + '</td><td>' + esc(t.team) + '</td>' +
          '<td>' + (t.gp || 0) + '</td><td>' + (t.w || 0) + '</td><td>' + (t.l || 0) + '</td>' +
          '<td><strong>' + (t.pts || 0) + '</strong></td>' +
          '<td>' + (t.gamesFor || 0) + '</td><td>' + (t.gamesAgainst || 0) + '</td>' +
          '<td>' + (diff > 0 ? '+' : '') + diff + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div></div>';
  }
  container.innerHTML = html;
}

function renderPromotionRulesSection() {
  const section = document.getElementById('promotionRulesSection');
  const config  = appState && appState.generateConfig;
  if (!config || config.format !== 'divisional' || !config.divisions || !config.divisions.length) {
    section.classList.add('hidden'); return;
  }
  section.classList.remove('hidden');
  const list = document.getElementById('promotionRulesList');
  list.innerHTML = '';
  const divisions = config.divisions;

  for (let i = 0; i < divisions.length - 1; i++) {
    const upper    = divisions[i].name;
    const lower    = divisions[i + 1].name;
    const boundary = upper + '|' + lower;
    const rule     = ((appState.promotionRules || {})[boundary]) || { everyN: 1, teamsX: 1 };

    const row = document.createElement('div');
    row.className = 'promo-rule-row';
    row.innerHTML =
      '<span class="promo-boundary">' + esc(upper) + ' &harr; ' + esc(lower) + '</span>' +
      '<label>Move</label>' +
      '<input type="number" class="promo-teams" min="1" max="4" value="' + rule.teamsX + '">' +
      '<label>team(s) every</label>' +
      '<input type="number" class="promo-every" min="1" value="' + rule.everyN + '">' +
      '<label>week(s)</label>' +
      '<button type="button" class="btn-small promo-save-btn">Save Rule</button>';

    const capturedBoundary = boundary;
    row.querySelector('.promo-save-btn').addEventListener('click', async () => {
      const teamsX = parseInt(row.querySelector('.promo-teams').value) || 1;
      const everyN = parseInt(row.querySelector('.promo-every').value) || 1;
      try {
        await apiPost('/api/set-promotion-rule', { boundary: capturedBoundary, everyN, teamsX });
        if (!appState.promotionRules) appState.promotionRules = {};
        appState.promotionRules[capturedBoundary] = { everyN, teamsX };
        const btn = row.querySelector('.promo-save-btn');
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.textContent = 'Save Rule'; }, 1500);
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
    list.appendChild(row);
  }
}

function renderSeasonStandingsSection(standings) {
  const section = document.getElementById('seasonStandingsSection');
  if (!section) return;
  const avgStandings = standings && standings._averageStandings;
  const config = appState && appState.generateConfig;
  if (!config || config.format !== 'divisional' || !avgStandings || !avgStandings.length) {
    section.classList.add('hidden'); return;
  }
  section.classList.remove('hidden');
  const container = document.getElementById('seasonStandingsContainer');

  const rows = avgStandings.map(s => {
    const teamRankings = appState.weeklyRankings && appState.weeklyRankings[s.team];
    const avgDisplay = s.avgRank !== null && s.avgRank !== undefined
      ? s.avgRank.toFixed(2) : '&mdash;';
    const weeksPlayed = teamRankings ? Object.values(teamRankings).filter(r => r !== null).length : 0;
    return '<tr>' +
      '<td>' + s.seed + '</td>' +
      '<td>' + esc(s.team) + '</td>' +
      '<td>' + avgDisplay + '</td>' +
      '<td>' + weeksPlayed + '</td>' +
      '<td>' + (s.pts || 0) + '</td>' +
    '</tr>';
  }).join('');

  container.innerHTML =
    '<div class="table-wrap"><table>' +
    '<thead><tr><th>Playoff Seed</th><th>Team</th><th>Avg Rank</th><th>Weeks Played</th><th>PTS</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

// ── Playoffs Tab ──────────────────────────────────────────────────────────────
function setupPlayoffListeners() {
  document.getElementById('generatePlayoffsBtn').addEventListener('click', handleGeneratePlayoffs);
  document.getElementById('printNight1Btn').addEventListener('click', () => window.open('/api/export/pdf/playoff/1', '_blank'));
  document.getElementById('printNight2Btn').addEventListener('click', () => window.open('/api/export/pdf/playoff/2', '_blank'));
}

function renderPlayoffsTab() {
  const container = document.getElementById('playoffRoundsContainer');
  const errEl     = document.getElementById('playoffsError');
  errEl.classList.add('hidden');
  const ps = appState && appState.playoffSchedule;
  if (!ps || !ps.rounds || !ps.rounds.length) {
    container.innerHTML = '<div class="empty-state">No playoff schedule yet. Click "Generate Playoffs" to create one.</div>';
    return;
  }
  renderPlayoffBracket(ps, container);
}

async function handleGeneratePlayoffs() {
  const errEl = document.getElementById('playoffsError');
  errEl.classList.add('hidden');
  try {
    const result = await apiPost('/api/playoffs/generate', {});
    appState.playoffSchedule = result;
    renderPlayoffBracket(result, document.getElementById('playoffRoundsContainer'));
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.classList.remove('hidden');
  }
}

function renderPlayoffBracket(ps, container) {
  if (!ps || !ps.rounds || !ps.rounds.length) {
    container.innerHTML = '<div class="empty-state">No playoff rounds available.</div>'; return;
  }

  const meta = '<p style="margin-bottom:14px"><strong>Night 1:</strong> ' + esc(ps.night1Date || 'TBD') +
    ' &nbsp;|&nbsp; <strong>Night 2:</strong> ' + esc(ps.night2Date || 'TBD') + '</p>';

  const rounds = ps.rounds.map(round => {
    const matches = (round.matches || []).map(m => {
      const aWin  = m.scoreA !== null && m.scoreA !== undefined && m.scoreA > m.scoreB;
      const bWin  = m.scoreB !== null && m.scoreB !== undefined && m.scoreB > m.scoreA;
      const scoreA = (m.scoreA !== null && m.scoreA !== undefined) ? m.scoreA : '';
      const scoreB = (m.scoreB !== null && m.scoreB !== undefined) ? m.scoreB : '';
      return '<div class="playoff-match">' +
        '<div class="playoff-team' + (aWin ? ' winner' : '') + '"><span>' + esc(m.teamA || 'TBD') + '</span><span>' + scoreA + '</span></div>' +
        '<div class="playoff-team' + (bWin ? ' winner' : '') + '"><span>' + esc(m.teamB || 'TBD') + '</span><span>' + scoreB + '</span></div>' +
        '<div class="playoff-match-meta">' + esc(m.time || '') + ' ' + esc(m.venue || '') + (m.court ? ' Court ' + m.court : '') + '</div>' +
      '</div>';
    }).join('');
    return '<div class="playoff-round">' +
      '<div class="playoff-round-title">' + esc(round.name || 'Round') + '</div>' +
      '<div class="playoff-round-date">'  + esc(round.date || '')       + '</div>' +
      matches +
    '</div>';
  }).join('');

  container.innerHTML = meta + '<div class="playoff-bracket">' + rounds + '</div>';
}

// ── Division Court Assignment Panel ───────────────────────────────────────────
function renderCourtAssignSection() {
  const section = document.getElementById('courtAssignSection');
  if (!section) return;
  const config = appState && appState.generateConfig;
  if (!config || config.format !== 'divisional' || !config.divisions || !config.divisions.length) {
    section.classList.add('hidden'); return;
  }
  section.classList.remove('hidden');

  const venues = (config.venues || []).map(v => v.name).filter(Boolean);
  const courtMap = (appState && appState.divisionCourtMap) || {};
  const list = document.getElementById('courtAssignList');
  list.innerHTML = '';

  for (const div of config.divisions) {
    const existing = courtMap[div.name] || {};
    const venueOptions = venues.map(v =>
      '<option value="' + esc(v) + '"' + (existing.venue === v ? ' selected' : '') + '>' + esc(v) + '</option>'
    ).join('');

    const row = document.createElement('div');
    row.className = 'court-assign-row';
    row.innerHTML =
      '<span class="ca-div-name">' + esc(div.name) + '</span>' +
      '<label>Venue:</label>' +
      '<select class="ca-venue">' + venueOptions + '</select>' +
      '<label>Court:</label>' +
      '<input type="number" class="ca-court" min="1" value="' + (existing.court || 1) + '" style="width:60px">' +
      '<label>Time Block:</label>' +
      '<select class="ca-timeblock">' +
        '<option value="early"' + (existing.timeBlock !== 'late' ? ' selected' : '') + '>Early</option>' +
        '<option value="late"'  + (existing.timeBlock === 'late'  ? ' selected' : '') + '>Late</option>' +
      '</select>' +
      '<button type="button" class="btn-small ca-save-btn">Save</button>';

    const divName = div.name;
    row.querySelector('.ca-save-btn').addEventListener('click', async () => {
      const venue     = row.querySelector('.ca-venue').value;
      const court     = parseInt(row.querySelector('.ca-court').value) || 1;
      const timeBlock = row.querySelector('.ca-timeblock').value;
      try {
        await apiPost('/api/division-court-map', { division: divName, venue, court, timeBlock });
        if (!appState.divisionCourtMap) appState.divisionCourtMap = {};
        appState.divisionCourtMap[divName] = { venue, court, timeBlock };
        const btn = row.querySelector('.ca-save-btn');
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.textContent = 'Save'; }, 1500);
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });

    list.appendChild(row);
  }
}

// ── Settings Tab ──────────────────────────────────────────────────────────────
function setupSettingsListeners() {
  document.getElementById('exportCsvBtn').addEventListener('click', () => { window.location = '/api/export/csv'; });

  document.getElementById('settingsLoadBtn').addEventListener('click', async () => {
    try {
      appState = await apiGet('/api/state/load');
      if (!appState.weeklyRankings) appState.weeklyRankings = {};
      if (!appState.divisionCourtMap) appState.divisionCourtMap = {};
      if (appState.generateConfig) populateSetupForm(appState.generateConfig);
      renderCourtAssignSection();
      showMsg('settingsMsg', 'State loaded from disk.', 'success');
    } catch (e) {
      showMsg('settingsMsg', 'Load failed: ' + e.message, 'error');
    }
  });

  document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
    try {
      await apiPost('/api/state/save');
      showMsg('settingsMsg', 'State saved to disk.', 'success');
    } catch (e) {
      showMsg('settingsMsg', 'Save failed: ' + e.message, 'error');
    }
  });
}

// ── Edit Match Modal ──────────────────────────────────────────────────────────
function setupEditModal() {
  document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);
  document.getElementById('editModalBackdrop').addEventListener('click', closeEditModal);
  document.getElementById('saveEditBtn').addEventListener('click', handleSaveEdit);
}

function openEditModal(data) {
  setVal('editMatchId', data.matchid || data.id || '');
  setVal('editTime',   data.time   || '');
  setVal('editVenue',  data.venue  || '');
  setVal('editCourt',  data.court  || '');
  setVal('editTeamA',  data.teama  || '');
  setVal('editTeamB',  data.teamb  || '');
  document.getElementById('editModalError').classList.add('hidden');
  document.getElementById('editModal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
}

async function handleSaveEdit() {
  const matchId = document.getElementById('editMatchId').value;
  const updates = {
    time:  document.getElementById('editTime').value,
    venue: document.getElementById('editVenue').value,
    court: parseInt(document.getElementById('editCourt').value) || null,
    teamA: document.getElementById('editTeamA').value.trim(),
    teamB: document.getElementById('editTeamB').value.trim()
  };
  const errEl = document.getElementById('editModalError');
  try {
    await apiPatch('/api/edit-match', Object.assign({ matchId }, updates));
    for (const week of (appState.schedule || [])) {
      const m = week.matches.find(x => x.id === matchId);
      if (m) { Object.assign(m, updates); break; }
    }
    closeEditModal();
    renderByNightView();
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.classList.remove('hidden');
  }
}
