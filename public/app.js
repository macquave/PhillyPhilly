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
  renderAllGamesTab();
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
  if (activeTab === 'picks')      renderPicksTab();
  if (activeTab === 'all-games')  renderAllGamesTab();
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
    if (tab === 'all-games')   { await refreshData(); renderAllGamesTab(); }
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
// Render: All Games Tab
// ---------------------------------------------------------------------------
function renderAllGamesTab() {
  const container = $('#all-games-list');
  container.innerHTML = '';

  if (allGames.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="big-icon">🏀</span>No games loaded yet.</div>`;
    return;
  }

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
    renderAllGamesTab();
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
    renderAllGamesTab();
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
    renderAllGamesTab();
    await populateAdminGameSelect();
  } catch (err) {
    showResult('mg-result-msg', err.message, false);
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (!tryRestoreSession()) {
  show($('#login-screen'));
}
