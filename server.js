require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const oddsApi = require('./odds-api');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'brackets2026';

app.use(express.json());
// Serve static files from 'public' subfolder if it exists, otherwise root
const staticDir = require('fs').existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : __dirname;
app.use(express.static(staticDir));

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

// POST /api/login  { name }
// Returns the user object (creates if new)
app.post('/api/login', async (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 30) return res.status(400).json({ error: 'Name too long (max 30 chars)' });
  try {
    const user = await db.getOrCreateUser(name);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Could not create user' });
  }
});

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

// GET /api/games
// Returns all games with spread info
app.get('/api/games', (req, res) => {
  const games = db.getAllGames();
  res.json(games);
});

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

// GET /api/picks/:userId
app.get('/api/picks/:userId', (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });
  res.json(db.getPicksForUser(userId));
});

// POST /api/picks  { userId, gameId, pickedTeam: 'home'|'away' }
app.post('/api/picks', async (req, res) => {
  const { userId, gameId, pickedTeam } = req.body;

  if (!userId || !gameId || !pickedTeam) {
    return res.status(400).json({ error: 'userId, gameId, and pickedTeam required' });
  }
  if (!['home', 'away'].includes(pickedTeam)) {
    return res.status(400).json({ error: "pickedTeam must be 'home' or 'away'" });
  }

  const game = db.getGame(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  // Lock picks once the game has started
  if (new Date(game.game_time) <= new Date()) {
    return res.status(400).json({ error: 'Picks are locked — this game has already started' });
  }

  try {
    const pick = await db.savePick({ user_id: userId, game_id: gameId, picked_team: pickedTeam });
    res.json(pick);
  } catch (err) {
    res.status(500).json({ error: 'Could not save pick' });
  }
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

// GET /api/leaderboard
app.get('/api/leaderboard', (req, res) => {
  res.json(db.getLeaderboard());
});

// ---------------------------------------------------------------------------
// Admin endpoints (password-protected)
// ---------------------------------------------------------------------------

function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.body?.adminPassword;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// POST /api/admin/sync  — manually trigger odds/score sync
app.post('/api/admin/sync', adminAuth, async (req, res) => {
  try {
    await oddsApi.syncAll();
    res.json({ success: true, message: 'Sync complete' });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed', detail: err.message });
  }
});

// POST /api/admin/result  — manually enter a game result
// Body: { adminPassword, gameId, homeScore, awayScore }
app.post('/api/admin/result', adminAuth, async (req, res) => {
  const { gameId, homeScore, awayScore } = req.body;
  if (gameId == null || homeScore == null || awayScore == null) {
    return res.status(400).json({ error: 'gameId, homeScore, awayScore required' });
  }
  try {
    await db.updateGameResultById({
      game_id: parseInt(gameId, 10),
      home_score: parseInt(homeScore, 10),
      away_score: parseInt(awayScore, 10),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update result' });
  }
});

// POST /api/admin/game  — manually add a game (if API doesn't have it)
// Body: { adminPassword, homeTeam, awayTeam, spreadHome, gameTime, round }
app.post('/api/admin/game', adminAuth, async (req, res) => {
  const { homeTeam, awayTeam, spreadHome, gameTime, round } = req.body;
  if (!homeTeam || !awayTeam || !gameTime) {
    return res.status(400).json({ error: 'homeTeam, awayTeam, gameTime required' });
  }
  try {
    await db.upsertGame({
      odds_api_id: `manual_${Date.now()}`,
      home_team: homeTeam,
      away_team: awayTeam,
      spread_home: spreadHome != null ? parseFloat(spreadHome) : null,
      game_time: gameTime,
      round: round || 'NCAA Tournament',
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not add game' });
  }
});

// GET /api/admin/picks — all picks with user + game details
app.get('/api/admin/picks', adminAuth, (req, res) => {
  res.json(db.getAllPicksWithDetails());
});

// GET /api/admin/export?pw=PASSWORD — download all picks as CSV
// Password passed as query param so the browser can trigger a direct download
app.get('/api/admin/export', (req, res) => {
  const pw = req.query.pw || '';
  if (pw !== ADMIN_PASSWORD) return res.status(401).send('Unauthorized');

  const picks = db.getAllPicksWithDetails();
  const lines = [
    ['Player', 'Round', 'Game', 'Game Time', 'Their Pick', 'Result'].join(','),
    ...picks.map(p => {
      const game     = `${p.away_team} @ ${p.home_team}`;
      const pick     = p.picked_team === 'home' ? p.home_team : p.away_team;
      const result   = p.is_correct === 1 ? 'Correct' : p.is_correct === 0 ? 'Wrong' : p.is_correct === -1 ? 'Push' : 'Pending';
      const gameTime = new Date(p.game_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      // Wrap fields in quotes to handle commas in team names
      return [p.user_name, p.round, game, gameTime, pick, result].map(f => `"${f ?? ''}"`).join(',');
    }),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="picks-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(lines.join('\n'));
});

// GET /api/admin/users — all users
app.get('/api/admin/users', adminAuth, (req, res) => {
  res.json(db.getAllUsers());
});

// DELETE /api/admin/picks/:pickId
app.delete('/api/admin/picks/:pickId', adminAuth, async (req, res) => {
  const ok = await db.deletePick(req.params.pickId);
  ok ? res.json({ success: true }) : res.status(404).json({ error: 'Pick not found' });
});

// PUT /api/admin/picks/:pickId — override picked team
app.put('/api/admin/picks/:pickId', adminAuth, async (req, res) => {
  const { pickedTeam } = req.body;
  if (!['home','away'].includes(pickedTeam)) return res.status(400).json({ error: 'Invalid team' });
  const ok = await db.overridePick(req.params.pickId, pickedTeam);
  ok ? res.json({ success: true }) : res.status(404).json({ error: 'Pick not found' });
});

// PUT /api/admin/users/:userId — rename user
app.put('/api/admin/users/:userId', adminAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const ok = await db.renameUser(req.params.userId, name.trim());
  ok ? res.json({ success: true }) : res.status(400).json({ error: 'User not found or name taken' });
});

// DELETE /api/admin/users/:userId — delete user + all their picks
app.delete('/api/admin/users/:userId', adminAuth, async (req, res) => {
  const ok = await db.deleteUser(req.params.userId);
  ok ? res.json({ success: true }) : res.status(404).json({ error: 'User not found' });
});

// ---------------------------------------------------------------------------
// Serve the SPA for any unmatched route
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n🏀  March Madness Picks running on http://localhost:${PORT}\n`);
});

// Sync odds on startup, then every 2 hours
oddsApi.syncAll().catch(console.error);
setInterval(() => oddsApi.syncAll().catch(console.error), 2 * 60 * 60 * 1000);
