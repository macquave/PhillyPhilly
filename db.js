/**
 * Simple JSON file database — no native dependencies needed.
 * Stores all data in picks.json next to this file.
 */
const fs   = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'picks.json');

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
  const db = load();
  const existing = db.users.find(u => u.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const user = { id: nextId(db.users), name, created_at: new Date().toISOString() };
  db.users.push(user);
  save(db);
  return user;
}

function getAllUsers() {
  return load().users;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------
function upsertGame({ odds_api_id, home_team, away_team, spread_home, game_time, round }) {
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
  const db = load();
  const game = db.games.find(g => g.odds_api_id === odds_api_id);
  if (!game) return;
  game.home_score = home_score;
  game.away_score = away_score;
  game.is_final   = is_final;
  save(db);
  if (is_final) gradePicksForGame(db, game.id);
}

function updateGameResultById({ game_id, home_score, away_score }) {
  const db = load();
  const game = db.games.find(g => g.id === Number(game_id));
  if (!game) return;
  game.home_score = home_score;
  game.away_score = away_score;
  game.is_final   = true;
  save(db);
  gradePicksForGame(db, game.id);
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------
function savePick({ user_id, game_id, picked_team }) {
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
};
