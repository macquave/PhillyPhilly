/* =========================================================
   March Madness Pick'em — Frontend (vanilla JS)
   ========================================================= */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentUser = null;   // { id, name }
let allGames    = [];     // array of game objects from server
let myPicks     = {};     // keyed by game_id → pick object

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function show(el)  { el?.classList.remove('hidden'); }
function hide(el)  { el?.classList.add('hidden'); }
function toggle(el, force) { el?.classList.toggle('hidden', !force); }

function formatGameTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatSpread(spread, team) {
  if (spread == null) return '';
  const sign = spread > 0 ? '+' : '';
  return `${team} ${sign}${spread}`;
}

function isGameLocked(game) {
  return new Date(game.game_time) <= new Date();
}

// Determine which side covered (for display)
// Returns 'home', 'away', 'push', or null if not final
function coveringSide(game) {
  if (!game.is_final || game.home_score == null) return null;
  const adjusted = game.home_score + (game.spread_home || 0);
  if (adjusted > game.away_score) return 'home';
  if (adjusted < game.away_score) return 'away';
  return 'push';
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#name-input').value.trim();
  if (!name) return;

  const btn = $('#login-form button');
  btn.disabled = true;
  btn.textContent = 'Loading…';

  try {
    const user = await apiPost('/api/login', { name });
    currentUser = user;
    localStorage.setItem('mm_user', JSON.stringify(user));
    enterApp();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Let's Go! 🏆";
  }
});

// Restore session from localStorage
function tryRestoreSession() {
  try {
    const saved = localStorage.getItem('mm_user');
    if (saved) {
      currentUser = JSON.parse(saved);
      enterApp();
      return true;
    }
  } catch (_) {}
  return false;
}

$('#logout-btn').addEventListener('click', () => {
  localStorage.removeItem('mm_user');
  currentUser = null;
  allGames = [];
  myPicks = {};
  hide($('#main-app'));
  show($('#login-screen'));
  $('#name-input').value = '';
});

// ---------------------------------------------------------------------------
// App Entry
// ---------------------------------------------------------------------------
async function enterApp() {
  hide($('#login-screen'));
  show($('#main-app'));
  $('#username-display').textContent = currentUser.name;
  await refreshData();
  renderPicksTab();
}

async function refreshData() {
  try {
    const [games, picks] = await Promise.all([
      apiGet('/api/games'),
      apiGet(`/api/picks/${currentUser.id}`),
    ]);
    allGames = games;
    myPicks = {};
    for (const p of picks) myPicks[p.game_id] = p;
  } catch (err) {
    console.error('refreshData error', err);
  }
}

// Auto-refresh every 2 minutes
setInterval(async () => {
  if (!currentUser) return;
  await refreshData();
  const activeTab = $('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'picks')       renderPicksTab();
  if (activeTab === 'pool')        renderPoolTab();
  if (activeTab === 'leaderboard') renderLeaderboard();
}, 2 * 60 * 1000);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $$('.tab-content').forEach(t => hide(t));
    show($(`#tab-${tab}`));

    if (tab === 'picks')       { await refreshData(); renderPicksTab(); }
    if (tab === 'pool')        renderPoolTab();
    if (tab === 'leaderboard') renderLeaderboard();
  });
});

// ---------------------------------------------------------------------------
// Game Card Builder
// ---------------------------------------------------------------------------
function buildGameCard(game, opts = {}) {
  const { showMyPick = true } = opts;
  const pick  = myPicks[game.id];
  const locked = isGameLocked(game);
  const covers = coveringSide(game);

  // Card class
  let cardClass = 'game-card';
  if (locked) cardClass += ' locked';
  if (pick && pick.is_correct === 1) cardClass += ' correct';
  if (pick && pick.is_correct === 0) cardClass += ' wrong';
  if (pick && pick.is_correct === -1) cardClass += ' push';

  // Status badge
  let badgeHtml = '';
  if (game.is_final) {
    badgeHtml = `<span class="game-status-badge badge-final">Final</span>`;
  } else if (locked) {
    badgeHtml = `<span class="game-status-badge badge-locked">In Progress / Locked</span>`;
  } else {
    badgeHtml = `<span class="game-status-badge badge-open">Open</span>`;
  }

  // Spread labels
  const homeSpreadDisplay = game.spread_home != null
    ? `<span class="team-spread">${game.spread_home > 0 ? '+' : ''}${game.spread_home}</span>` : '';
  const awaySpread = game.spread_home != null ? -game.spread_home : null;
  const awaySpreadDisplay = awaySpread != null
    ? `<span class="team-spread">${awaySpread > 0 ? '+' : ''}${awaySpread}</span>` : '';

  // Score display (only if final or locked)
  const homeScoreHtml = (locked && game.home_score != null)
    ? `<span class="team-score">${game.home_score}</span>` : '';
  const awayScoreHtml = (locked && game.away_score != null)
    ? `<span class="team-score">${game.away_score}</span>` : '';

  // Pick indicator
  function pickIndicator(side) {
    if (!showMyPick || !pick || pick.picked_team !== side) return '';
    if (pick.is_correct === null) return `<span class="pick-indicator ind-your-pick">Your Pick</span>`;
    if (pick.is_correct === 1)    return `<span class="pick-indicator ind-correct">✓ Correct</span>`;
    if (pick.is_correct === 0)    return `<span class="pick-indicator ind-wrong">✗ Wrong</span>`;
    if (pick.is_correct === -1)   return `<span class="pick-indicator ind-push">Push</span>`;
    return '';
  }

  // Button extra classes
  function btnClass(side) {
    let cls = 'pick-btn';
    if (pick && pick.picked_team === side) {
      cls += ' selected';
      if (pick.is_correct === 1)  cls += ' correct-pick';
      if (pick.is_correct === 0)  cls += ' wrong-pick';
      if (pick.is_correct === -1) cls += ' push-pick';
    }
    if (covers === side && pick && pick.picked_team !== side) cls += ' covered';
    if (locked) cls += '';  // disabled via attribute
    return cls;
  }

  const disabledAttr = locked ? 'disabled' : '';

  const card = document.createElement('div');
  card.className = cardClass;
  card.dataset.gameId = game.id;
  card.innerHTML = `
    <div class="game-meta">
      <span class="round-badge">${game.round || 'NCAA Tournament'}</span>
      <span class="text-muted">${formatGameTime(game.game_time)}</span>
      ${badgeHtml}
    </div>
    <div class="game-matchup">
      <div class="team-row">
        <button class="${btnClass('away')}" data-side="away" data-game-id="${game.id}" ${disabledAttr}>
          <span class="team-name">${game.away_team}</span>
          ${awaySpreadDisplay}
          ${awayScoreHtml}
          ${pickIndicator('away')}
        </button>
      </div>
      <div class="team-row">
        <button class="${btnClass('home')}" data-side="home" data-game-id="${game.id}" ${disabledAttr}>
          <span class="team-name">${game.home_team}</span>
          ${homeSpreadDisplay}
          ${homeScoreHtml}
          ${pickIndicator('home')}
        </button>
      </div>
      ${game.spread_home == null && !locked ? '<p class="text-muted" style="font-size:.78rem;padding-top:8px;">Spread not yet available</p>' : ''}
    </div>
  `;

  // Attach pick handler
  card.querySelectorAll('.pick-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => handlePick(game.id, btn.dataset.side, card));
  });

  return card;
}

// ---------------------------------------------------------------------------
// Handle a pick click
// ---------------------------------------------------------------------------
async function handlePick(gameId, side, cardEl) {
  if (!currentUser) return;

  // Optimistic update
  myPicks[gameId] = { ...(myPicks[gameId] || {}), game_id: gameId, picked_team: side, is_correct: null };

  // Re-render just this card
  const game = allGames.find(g => g.id === gameId);
  if (!game) return;
  const newCard = buildGameCard(game);
  cardEl.replaceWith(newCard);

  try {
    const pick = await apiPost('/api/picks', {
      userId: currentUser.id,
      gameId,
      pickedTeam: side,
    });
    myPicks[gameId] = pick;
    // Re-render again with server response
    const updatedCard = buildGameCard(game);
    newCard.replaceWith(updatedCard);
    updatePicksStats();
  } catch (err) {
    alert(err.message);
    // Revert optimistic update
    delete myPicks[gameId];
    const revertCard = buildGameCard(game);
    newCard.replaceWith(revertCard);
  }
}

// ---------------------------------------------------------------------------
// Render: My Picks Tab
// ---------------------------------------------------------------------------
function renderPicksTab() {
  const container = $('#picks-games-list');
  container.innerHTML = '';

  if (allGames.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="big-icon">🏀</span>No games loaded yet.<br>Check back soon!</div>`;
    return;
  }

  // Show stats bar
  updatePicksStats();
  show($('#picks-summary'));

  // Group by round
  const rounds = groupByRound(allGames);
  for (const [round, games] of rounds) {
    const hdr = document.createElement('div');
    hdr.className = 'round-header';
    hdr.textContent = round;
    container.appendChild(hdr);
    for (const game of games) {
      container.appendChild(buildGameCard(game, { showMyPick: true }));
    }
  }
}

function updatePicksStats() {
  const picks = Object.values(myPicks);
  const correct = picks.filter(p => p.is_correct === 1).length;
  const wrong   = picks.filter(p => p.is_correct === 0).length;
  const pending = picks.filter(p => p.is_correct === null).length;
  const graded  = correct + wrong;
  const pct     = graded > 0 ? Math.round((correct / graded) * 100) + '%' : '—';

  $('#stat-correct').textContent = correct;
  $('#stat-wrong').textContent   = wrong;
  $('#stat-pending').textContent = pending;
  $('#stat-pct').textContent     = pct;
}

// ---------------------------------------------------------------------------
// Render: The Pool Tab
// ---------------------------------------------------------------------------
async function renderPoolTab() {
  const container = $('#pool-list');
  container.innerHTML = '<div class="loading">Loading pool…</div>';

  try {
    const poolGames = await apiGet('/api/pool');
    container.innerHTML = '';

    if (poolGames.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="big-icon">🏀</span>No games loaded yet.</div>`;
      return;
    }

    const rounds = groupByRound(poolGames);
    for (const [round, games] of rounds) {
      const hdr = document.createElement('div');
      hdr.className = 'round-header';
      hdr.textContent = round;
      container.appendChild(hdr);
      for (const game of games) {
        container.appendChild(buildPoolCard(game));
      }
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load pool data</div>`;
  }
}

function buildPoolCard(game) {
  const locked   = new Date(game.game_time) <= new Date();
  const covering = coveringSide(game);

  // Spread labels
  const homeSpread = game.spread_home;
  const awaySpread = homeSpread != null ? -homeSpread : null;
  const fmtSpread  = v => v == null ? '' : (v > 0 ? `+${v}` : `${v}`);

  // Winner/loser classes applied to each side panel
  const awaySideClass = covering === 'away' ? 'pool-side--winner'
                      : covering === 'home' ? 'pool-side--loser' : '';
  const homeSideClass = covering === 'home' ? 'pool-side--winner'
                      : covering === 'away' ? 'pool-side--loser' : '';

  function chipsHtml(picks) {
    if (picks.length === 0) return `<span class="pool-no-picks">No picks yet</span>`;
    return picks.map(p => {
      const isYou = currentUser && p.user_id === currentUser.id;
      let cls = 'pool-chip';
      if      (p.is_correct === 1)  cls += ' pool-chip--correct';
      else if (p.is_correct === 0)  cls += ' pool-chip--wrong';
      else if (p.is_correct === -1) cls += ' pool-chip--push';
      else if (locked)              cls += ' pool-chip--pending';
      if (isYou) cls += ' pool-chip--you';
      const icon = p.is_correct === 1 ? ' ✓' : p.is_correct === 0 ? ' ✗' : p.is_correct === -1 ? ' ~' : '';
      return `<span class="${cls}">${p.user_name}${icon}</span>`;
    }).join('');
  }

  const scoreRow = game.is_final
    ? `<div class="pool-score">
        <span class="pool-score-team ${covering === 'away' ? 'pool-score--cover' : ''}">${game.away_team} ${game.away_score}</span>
        <span class="pool-score-sep">–</span>
        <span class="pool-score-team ${covering === 'home' ? 'pool-score--cover' : ''}">${game.home_team} ${game.home_score}</span>
        <span class="final-tag">Final</span>
       </div>`
    : locked
    ? `<div class="pool-inprogress">🔒 In Progress</div>`
    : '';

  const card = document.createElement('div');
  card.className = 'pool-card';
  card.innerHTML = `
    <div class="pool-card-header">
      <span class="pool-game-time">${formatGameTime(game.game_time)}</span>
    </div>
    ${scoreRow}
    <div class="pool-sides">
      <div class="pool-side ${awaySideClass}">
        <div class="pool-side-label">Away</div>
        <div class="pool-side-team">${game.away_team}</div>
        ${awaySpread != null ? `<div class="pool-side-spread">${fmtSpread(awaySpread)}</div>` : ''}
        <div class="pool-chips">${chipsHtml(game.away_picks)}</div>
        <div class="pool-side-count">${game.away_picks.length} pick${game.away_picks.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="pool-divider"></div>
      <div class="pool-side ${homeSideClass}">
        <div class="pool-side-label">Home</div>
        <div class="pool-side-team">${game.home_team}</div>
        ${homeSpread != null ? `<div class="pool-side-spread">${fmtSpread(homeSpread)}</div>` : ''}
        <div class="pool-chips">${chipsHtml(game.home_picks)}</div>
        <div class="pool-side-count">${game.home_picks.length} pick${game.home_picks.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
  `;
  return card;
}

// ---------------------------------------------------------------------------
// Render: Leaderboard
// ---------------------------------------------------------------------------
async function renderLeaderboard() {
  const container = $('#leaderboard-list');
  container.innerHTML = '<div class="loading">Loading standings…</div>';

  try {
    const standings = await apiGet('/api/leaderboard');
    container.innerHTML = '';

    if (standings.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="big-icon">🏆</span>No picks yet!</div>`;
      return;
    }

    standings.forEach((entry, i) => {
      const rank = i + 1;
      const isYou = entry.id === currentUser?.id;
      const graded = (entry.correct || 0) + (entry.wrong || 0);
      const pct = graded > 0 ? Math.round((entry.correct / graded) * 100) + '%' : '—';

      let rankClass = '';
      let rankBadgeClass = 'rank-badge';
      let rankDisplay = rank;
      if (rank === 1) { rankClass = 'rank-1'; rankBadgeClass += ' gold';   rankDisplay = '🥇'; }
      if (rank === 2) { rankClass = 'rank-2'; rankBadgeClass += ' silver'; rankDisplay = '🥈'; }
      if (rank === 3) { rankClass = 'rank-3'; rankBadgeClass += ' bronze'; rankDisplay = '🥉'; }

      const card = document.createElement('div');
      card.className = `leaderboard-card ${rankClass} ${isYou ? 'is-you' : ''}`;
      card.innerHTML = `
        <div class="${rankBadgeClass}">${rankDisplay}</div>
        <div class="lb-info">
          <div class="lb-name">
            ${entry.name}
            ${isYou ? '<span class="you-tag">YOU</span>' : ''}
          </div>
          <div class="lb-stats">
            ${entry.correct || 0}W &nbsp;${entry.wrong || 0}L
            ${entry.pushes ? `&nbsp;${entry.pushes}P` : ''}
            &nbsp;·&nbsp;${pct} ATS
            &nbsp;·&nbsp;${entry.total_picks || 0} picks total
          </div>
        </div>
        <div class="lb-correct">
          <span class="num">${entry.correct || 0}</span>
          <span class="label">Correct</span>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Failed to load standings</div>`;
  }
}

// ---------------------------------------------------------------------------
// Group games by round (preserving round order)
// ---------------------------------------------------------------------------
const ROUND_ORDER = ['First Four', 'Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship', 'NCAA Tournament'];

function groupByRound(games) {
  const map = new Map();
  for (const g of games) {
    const r = g.round || 'NCAA Tournament';
    if (!map.has(r)) map.set(r, []);
    map.get(r).push(g);
  }
  // Sort rounds by known order
  const sorted = new Map([...map.entries()].sort((a, b) => {
    return (ROUND_ORDER.indexOf(a[0]) ?? 99) - (ROUND_ORDER.indexOf(b[0]) ?? 99);
  }));
  return sorted;
}

// ---------------------------------------------------------------------------
// Admin Panel
// ---------------------------------------------------------------------------
let adminTapCount = 0;
let adminTapTimer = null;

// Secret: tap the header logo 5 times quickly
$('.header-logo')?.addEventListener('click', () => {
  adminTapCount++;
  clearTimeout(adminTapTimer);
  adminTapTimer = setTimeout(() => { adminTapCount = 0; }, 2000);
  if (adminTapCount >= 5) {
    adminTapCount = 0;
    openAdminPanel();
  }
});

// Also accessible via URL hash
if (location.hash === '#admin') openAdminPanel();

function openAdminPanel() {
  show($('#admin-modal'));
  populateAdminGameSelect();
  populateAdminPicksGameSelect();
}

$('#admin-close')?.addEventListener('click', () => hide($('#admin-modal')));
$('#admin-overlay')?.addEventListener('click', () => hide($('#admin-modal')));

function getAdminPw() {
  return $('#admin-pw')?.value?.trim() || '';
}

function showResult(elId, msg, isOk) {
  const el = $(`#${elId}`);
  if (!el) return;
  el.textContent = msg;
  el.className = `result-msg ${isOk ? 'ok' : 'err'}`;
}

// Sync
$('#admin-sync-btn')?.addEventListener('click', async () => {
  const btn = $('#admin-sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    await fetch('/api/admin/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': getAdminPw() },
    }).then(r => { if (!r.ok) throw new Error('Unauthorized or sync failed'); return r.json(); });
    showResult('admin-sync-result', 'Sync complete! Games updated.', true);
    await refreshData();
    renderPicksTab();
    renderPoolTab();
  } catch (err) {
    showResult('admin-sync-result', err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync Now';
  }
});

// Populate game selector
async function populateAdminGameSelect() {
  const sel = $('#admin-game-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— select a game —</option>';
  // reload games
  try {
    const games = await apiGet('/api/games');
    allGames = games;
    const unfinished = games.filter(g => !g.is_final);
    for (const g of unfinished) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.dataset.home = g.home_team;
      opt.dataset.away = g.away_team;
      opt.textContent = `${g.away_team} @ ${g.home_team} — ${formatGameTime(g.game_time)}`;
      sel.appendChild(opt);
    }
  } catch (_) {}
}

$('#admin-game-select')?.addEventListener('change', () => {
  const sel = $('#admin-game-select');
  const opt = sel.options[sel.selectedIndex];
  if (opt?.dataset.home) {
    $('#admin-home-label').textContent = `${opt.dataset.home} Score`;
    $('#admin-away-label').textContent = `${opt.dataset.away} Score`;
  }
});

// Save result
$('#admin-result-btn')?.addEventListener('click', async () => {
  const gameId    = $('#admin-game-select')?.value;
  const homeScore = $('#admin-home-score')?.value;
  const awayScore = $('#admin-away-score')?.value;

  if (!gameId || homeScore === '' || awayScore === '') {
    showResult('admin-result-msg', 'Please select a game and enter both scores.', false);
    return;
  }
  try {
    await fetch('/api/admin/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': getAdminPw() },
      body: JSON.stringify({ gameId, homeScore, awayScore }),
    }).then(r => { if (!r.ok) throw new Error('Unauthorized or failed'); return r.json(); });
    showResult('admin-result-msg', 'Result saved and picks graded!', true);
    $('#admin-home-score').value = '';
    $('#admin-away-score').value = '';
    await refreshData();
    renderPicksTab();
    renderPoolTab();
    await populateAdminGameSelect();
  } catch (err) {
    showResult('admin-result-msg', err.message, false);
  }
});

// Add game manually
$('#mg-add-btn')?.addEventListener('click', async () => {
  const homeTeam  = $('#mg-home')?.value?.trim();
  const awayTeam  = $('#mg-away')?.value?.trim();
  const spreadHome = $('#mg-spread')?.value;
  const gameTime  = $('#mg-time')?.value;
  const round     = $('#mg-round')?.value;

  if (!homeTeam || !awayTeam || !gameTime) {
    showResult('mg-result-msg', 'Home team, away team, and game time are required.', false);
    return;
  }
  try {
    // Convert local datetime-local value to ISO string
    const isoTime = new Date($('#mg-time').value).toISOString();
    await fetch('/api/admin/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': getAdminPw() },
      body: JSON.stringify({ homeTeam, awayTeam, spreadHome: spreadHome || null, gameTime: isoTime, round }),
    }).then(r => { if (!r.ok) throw new Error('Unauthorized or failed'); return r.json(); });
    showResult('mg-result-msg', 'Game added!', true);
    $('#mg-home').value = '';
    $('#mg-away').value = '';
    $('#mg-spread').value = '';
    $('#mg-time').value = '';
    await refreshData();
    renderPicksTab();
    renderPoolTab();
    await populateAdminGameSelect();
  } catch (err) {
    showResult('mg-result-msg', err.message, false);
  }
});

// ---------------------------------------------------------------------------
// Admin: Manage Picks
// ---------------------------------------------------------------------------
async function populateAdminPicksGameSelect() {
  const sel = $('#admin-picks-game-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— select a game —</option>';
  try {
    const games = await apiGet('/api/games');
    for (const g of games) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.away_team} @ ${g.home_team} — ${formatGameTime(g.game_time)}`;
      sel.appendChild(opt);
    }
  } catch (_) {}
}

$('#admin-load-picks-btn')?.addEventListener('click', async () => {
  const gameId = $('#admin-picks-game-select')?.value;
  if (!gameId) { alert('Select a game first.'); return; }
  const container = $('#admin-picks-list');
  container.innerHTML = '<div class="loading">Loading picks…</div>';

  try {
    const allPicks = await adminFetch('GET', '/api/admin/picks');
    const gamePicks = allPicks.filter(p => String(p.game_id) === String(gameId));

    container.innerHTML = '';
    if (gamePicks.length === 0) {
      container.innerHTML = '<p class="hint">No picks for this game yet.</p>';
      return;
    }

    for (const p of gamePicks) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.dataset.pickId = p.id;
      const otherTeam = p.picked_team === 'home' ? 'away' : 'home';
      row.innerHTML = `
        <span class="admin-row-name">${p.user_name}</span>
        <span class="admin-row-pick picked-${p.picked_team}">${p.picked_team === 'home' ? p.home_team : p.away_team}</span>
        <div class="admin-row-actions">
          <button class="btn-small btn-override" data-pick-id="${p.id}" data-other="${otherTeam}" data-home="${p.home_team}" data-away="${p.away_team}">Switch</button>
          <button class="btn-small btn-danger btn-del-pick" data-pick-id="${p.id}">Delete</button>
        </div>
      `;
      container.appendChild(row);
    }

    // Wire up buttons
    container.querySelectorAll('.btn-del-pick').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this pick?')) return;
        try {
          await adminFetch('DELETE', `/api/admin/picks/${btn.dataset.pickId}`);
          btn.closest('.admin-row').remove();
        } catch (err) { alert(err.message); }
      });
    });

    container.querySelectorAll('.btn-override').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newTeam = btn.dataset.other; // switch to the other side
        const teamName = newTeam === 'home' ? btn.dataset.home : btn.dataset.away;
        if (!confirm(`Switch this pick to ${teamName}?`)) return;
        try {
          await adminFetch('PUT', `/api/admin/picks/${btn.dataset.pickId}`, { pickedTeam: newTeam });
          // Reload the list
          $('#admin-load-picks-btn').click();
        } catch (err) { alert(err.message); }
      });
    });

  } catch (err) {
    container.innerHTML = `<p class="hint err">Error: ${err.message}</p>`;
  }
});

// ---------------------------------------------------------------------------
// Admin: Manage Users
// ---------------------------------------------------------------------------
$('#admin-load-users-btn')?.addEventListener('click', async () => {
  const container = $('#admin-users-list');
  container.innerHTML = '<div class="loading">Loading users…</div>';

  try {
    const users = await adminFetch('GET', '/api/admin/users');
    container.innerHTML = '';

    if (users.length === 0) {
      container.innerHTML = '<p class="hint">No users yet.</p>';
      return;
    }

    for (const u of users) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.dataset.userId = u.id;
      row.innerHTML = `
        <span class="admin-row-name" id="uname-${u.id}">${u.name}</span>
        <div class="admin-row-actions">
          <button class="btn-small btn-rename" data-user-id="${u.id}">Rename</button>
          <button class="btn-small btn-danger btn-del-user" data-user-id="${u.id}">Delete</button>
        </div>
      `;
      container.appendChild(row);
    }

    // Rename
    container.querySelectorAll('.btn-rename').forEach(btn => {
      btn.addEventListener('click', async () => {
        const current = $(`#uname-${btn.dataset.userId}`)?.textContent || '';
        const newName = prompt('Enter new name:', current)?.trim();
        if (!newName || newName === current) return;
        try {
          await adminFetch('PUT', `/api/admin/users/${btn.dataset.userId}`, { name: newName });
          const nameEl = $(`#uname-${btn.dataset.userId}`);
          if (nameEl) nameEl.textContent = newName;
        } catch (err) { alert(err.message); }
      });
    });

    // Delete
    container.querySelectorAll('.btn-del-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = $(`#uname-${btn.dataset.userId}`)?.textContent || 'this user';
        if (!confirm(`Delete ${name} and ALL their picks? This cannot be undone.`)) return;
        try {
          await adminFetch('DELETE', `/api/admin/users/${btn.dataset.userId}`);
          btn.closest('.admin-row').remove();
        } catch (err) { alert(err.message); }
      });
    });

  } catch (err) {
    container.innerHTML = `<p class="hint err">Error: ${err.message}</p>`;
  }
});

// ---------------------------------------------------------------------------
// Admin: Export CSV
// ---------------------------------------------------------------------------
$('#admin-export-btn')?.addEventListener('click', () => {
  const pw = getAdminPw();
  if (!pw) {
    showResult('admin-export-msg', 'Enter the admin password first.', false);
    return;
  }
  // Trigger a direct browser download by navigating to the export URL
  const url = `/api/admin/export?pw=${encodeURIComponent(pw)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showResult('admin-export-msg', 'Download started!', true);
});

// ---------------------------------------------------------------------------
// Admin fetch helper (includes password header)
// ---------------------------------------------------------------------------
async function adminFetch(method, url, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-password': getAdminPw() },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (!tryRestoreSession()) {
  show($('#login-screen'));
}

// Register service worker for PWA (Add to Home Screen support)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// ---------------------------------------------------------------------------
// Install / Add to Home Screen
// ---------------------------------------------------------------------------
(function () {
  // Don't show if already running as installed PWA
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return;

  const banner   = $('#install-banner');
  const btn      = $('#install-btn');
  const iosTip   = $('#ios-tip');

  const isIos    = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = /safari/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);

  let deferredPrompt = null; // Android/Chrome install prompt

  // Android: capture the browser's install prompt so we can replay it
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    show(banner);
  });

  // iOS Safari: show the banner immediately with the tip toggle
  if (isIos && isSafari) {
    show(banner);
  }

  btn.addEventListener('click', () => {
    if (deferredPrompt) {
      // Android — fire the native prompt
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => {
        deferredPrompt = null;
        hide(banner);
      });
    } else if (isIos) {
      // iOS — toggle the instruction tip
      iosTip.classList.toggle('hidden');
    }
  });

  // Hide banner once app is installed
  window.addEventListener('appinstalled', () => hide(banner));
})();
