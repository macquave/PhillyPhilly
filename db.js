/**
 * Simple JSON file database — no native dependencies needed.
 * Stores all data in picks.json next to this file.
 *
 * Write queue: all functions that modify the file are serialized through
 * withLock() so concurrent requests always read the latest saved state
 * before writing, preventing any pick from being silently dropped.
 */
const fs   = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'picks.json');

// Ensure the directory exists
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Write queue — serializes all read-modify-write operations
// ---------------------------------------------------------------------------
let _writeChain = Promise.resolve();

// Runs fn() after all previous write operations have completed.
// Returns a Promise that resolves with fn()'s return value.
function withLock(fn) {
  const next = _writeChain.then(fn);
  _writeChain = next.catch(() => {}); // keep chain alive even if fn throws
  return next;
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------
function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { users: [], games: [], picks: [] };
  }
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function nextId(collection) {
  return collection.length === 0 ? 1 : Math.max(...collection.map(r => r.id)) + 1;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
function getOrCreateUser(name) {
  return withLock(() => {
    const db = load();
    const existing = db.users.find(u => u.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const user = { id: nextId(db.users), name, created_at: new Date().toISOString() };
    db.users.push(user);
    save(db);
    return user;
  });
}

function getAllUsers() {
  return load().users;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------
function upsertGame({ odds_api_id, home_team, away_team, spread_home, game_time, round }) {
  return withLock(() => {
    const db = load();
    const idx = db.games.findIndex(g => g.odds_api_id === odds_api_id);
    if (idx >= 0) {
      db.games[idx] = { ...db.games[idx], home_team, away_team, spread_home, game_time, round };
    } else {
      db.games.push({
        id: nextId(db.games),
        odds_api_id,
        home_team, away_team,
        spread_home,
        game_time,
        round,
        home_score: null,
        away_score: null,
        is_final: false,
        created_at: new Date().toISOString(),
      });
    }
    save(db);
  });
}

function getGame(id) {
  return load().games.find(g => g.id === Number(id)) || null;
}

function getGameByOddsId(odds_api_id) {
  return load().games.find(g => g.odds_api_id === odds_api_id) || null;
}

function getAllGames() {
  const db = load();
  return db.games.slice().sort((a, b) => new Date(a.game_time) - new Date(b.game_time));
}

function updateGameResult({ odds_api_id, home_score, away_score, is_final }) {
  return withLock(() => {
    const db = load();
    const game = db.games.find(g => g.odds_api_id === odds_api_id);
    if (!game) return;
    game.home_score = home_score;
    game.away_score = away_score;
    game.is_final   = is_final;
    save(db);
    if (is_final) gradePicksForGame(db, game.id);
  });
}

function updateGameResultById({ game_id, home_score, away_score }) {
  return withLock(() => {
    const db = load();
    const game = db.games.find(g => g.id === Number(game_id));
    if (!game) return;
    game.home_score = home_score;
    game.away_score = away_score;
    game.is_final   = true;
    save(db);
    gradePicksForGame(db, game.id);
  });
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------
function savePick({ user_id, game_id, picked_team }) {
  return withLock(() => {
    const db = load();
    const existing = db.picks.find(p => p.user_id === Number(user_id) && p.game_id === Number(game_id));
    if (existing) {
      existing.picked_team = picked_team;
      existing.is_correct  = null;
    } else {
      db.picks.push({
        id: nextId(db.picks),
        user_id: Number(user_id),
        game_id: Number(game_id),
        picked_team,
        is_correct: null,
        created_at: new Date().toISOString(),
      });
    }
    save(db);
    return db.picks.find(p => p.user_id === Number(user_id) && p.game_id === Number(game_id));
  });
}

function getPicksForUser(user_id) {
  const db = load();
  const picks = db.picks.filter(p => p.user_id === Number(user_id));
  // Enrich with game data
  return picks.map(p => {
    const game = db.games.find(g => g.id === p.game_id) || {};
    return { ...p, ...game, id: p.id, game_id: p.game_id };
  }).sort((a, b) => new Date(a.game_time) - new Date(b.game_time));
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------
// Home spread e.g. -5.5 = home favored by 5.5
// Home covers  if: home_score + spread_home > away_score
// Away covers  if: home_score + spread_home < away_score
// Push         if: home_score + spread_home === away_score
function gradePicksForGame(db, game_id) {
  const game = db.games.find(g => g.id === Number(game_id));
  if (!game || !game.is_final || game.home_score == null) return;

  const adjusted = game.home_score + (game.spread_home || 0);
  let coversSide;
  if (adjusted > game.away_score)      coversSide = 'home';
  else if (adjusted < game.away_score) coversSide = 'away';
  else                                  coversSide = 'push';

  db.picks
    .filter(p => p.game_id === Number(game_id))
    .forEach(p => {
      if (coversSide === 'push') p.is_correct = -1;
      else p.is_correct = p.picked_team === coversSide ? 1 : 0;
    });

  save(db);
}

function gradePicksByGameId(game_id) {
  const db = load();
  gradePicksForGame(db, game_id);
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
function getLeaderboard() {
  const db = load();
  return db.users.map(user => {
    const picks = db.picks.filter(p => p.user_id === user.id);
    return {
      id:          user.id,
      name:        user.name,
      total_picks: picks.length,
      correct:     picks.filter(p => p.is_correct === 1).length,
      wrong:       picks.filter(p => p.is_correct === 0).length,
      pushes:      picks.filter(p => p.is_correct === -1).length,
      pending:     picks.filter(p => p.is_correct === null).length,
    };
  }).sort((a, b) => b.correct - a.correct || b.total_picks - a.total_picks);
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

// Get all picks enriched with user + game info (for admin view)
function getAllPicksWithDetails() {
  const data = load();
  return data.picks.map(p => {
    const user = data.users.find(u => u.id === p.user_id) || {};
    const game = data.games.find(g => g.id === p.game_id) || {};
    return {
      ...p,
      user_name:  user.name,
      home_team:  game.home_team,
      away_team:  game.away_team,
      spread_home: game.spread_home,
      game_time:  game.game_time,
      round:      game.round,
      is_final:   game.is_final,
      home_score: game.home_score,
      away_score: game.away_score,
    };
  }).sort((a, b) => new Date(a.game_time) - new Date(b.game_time));
}

// Delete a single pick by id
function deletePick(pick_id) {
  return withLock(() => {
    const data = load();
    const idx = data.picks.findIndex(p => p.id === Number(pick_id));
    if (idx === -1) return false;
    data.picks.splice(idx, 1);
    save(data);
    return true;
  });
}

// Override a pick's chosen team (admin can change after lock)
function overridePick(pick_id, picked_team) {
  return withLock(() => {
    const data = load();
    const pick = data.picks.find(p => p.id === Number(pick_id));
    if (!pick) return false;
    pick.picked_team = picked_team;
    pick.is_correct  = null; // reset grading — will re-grade if game is final
    save(data);
    // Re-grade if the game is already final
    const game = data.games.find(g => g.id === pick.game_id);
    if (game && game.is_final) gradePicksForGame(data, game.id);
    return true;
  });
}

// Rename a user
function renameUser(user_id, new_name) {
  return withLock(() => {
    const data = load();
    const user = data.users.find(u => u.id === Number(user_id));
    if (!user) return false;
    // Check name not already taken
    const taken = data.users.find(u => u.name.toLowerCase() === new_name.toLowerCase() && u.id !== Number(user_id));
    if (taken) return false;
    user.name = new_name;
    save(data);
    return true;
  });
}

// Delete a user and all their picks
function deleteUser(user_id) {
  return withLock(() => {
    const data = load();
    const idx = data.users.findIndex(u => u.id === Number(user_id));
    if (idx === -1) return false;
    data.users.splice(idx, 1);
    data.picks = data.picks.filter(p => p.user_id !== Number(user_id));
    save(data);
    return true;
  });
}

module.exports = {
  getOrCreateUser,
  getAllUsers,
  upsertGame,
  getGame,
  getAllGames,
  updateGameResult,
  updateGameResultById,
  savePick,
  getPicksForUser,
  getLeaderboard,
  gradePicksByGameId,
  getAllPicksWithDetails,
  deletePick,
  overridePick,
  renameUser,
  deleteUser,
};
