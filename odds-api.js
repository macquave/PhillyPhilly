/**
 * The Odds API integration
 * Docs: https://the-odds-api.com/liveapi/guides/v4/
 *
 * Free tier: 500 requests / month — plenty for the whole tournament.
 * Sign up at https://the-odds-api.com to get your API key.
 */

const axios = require('axios');
const db = require('./db');

const API_KEY = process.env.ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com/v4';
const SPORT = 'basketball_ncaab';

// ---------------------------------------------------------------------------
// Quota tracking — updated after every successful API call
// ---------------------------------------------------------------------------
let _quota = { used: null, remaining: null, updatedAt: null };

function updateQuota(headers) {
  const used      = headers['x-requests-used'];
  const remaining = headers['x-requests-remaining'];
  if (used != null || remaining != null) {
    _quota = {
      used:      used      != null ? parseInt(used, 10)      : _quota.used,
      remaining: remaining != null ? parseInt(remaining, 10) : _quota.remaining,
      updatedAt: new Date().toISOString(),
    };
  }
}

function getQuota() { return { ..._quota }; }
// Preferred bookmaker order (we pick the first one available per game)
const PREFERRED_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'bovada', 'williamhill_us'];

// 2026 NCAA Tournament window — games outside this range are ignored entirely
const TOURNAMENT_START = new Date('2026-03-17T00:00:00-04:00'); // First Four eve
const TOURNAMENT_END   = new Date('2026-04-07T00:00:00-04:00'); // day after Championship

function isInTournamentWindow(isoString) {
  const d = new Date(isoString);
  return d >= TOURNAMENT_START && d <= TOURNAMENT_END;
}

// Detect the tournament round from the scheduled game time.
// Uses Eastern time (UTC-4 during March/April DST) to avoid day-boundary
// misclassification — a 9 PM ET game is still "that day" in Eastern, but
// rolls over to the next UTC day.
function detectRound(gameTime) {
  const ET_OFFSET_MS = 4 * 60 * 60 * 1000; // UTC-4 (Eastern Daylight Time)
  const d     = new Date(new Date(gameTime).getTime() - ET_OFFSET_MS);
  const month = d.getUTCMonth() + 1;
  const day   = d.getUTCDate();

  if (month === 3) {
    if (day === 17 || day === 18) return 'First Four';
    if (day === 19 || day === 20) return 'Round of 64';
    if (day === 21 || day === 22) return 'Round of 32';
    if (day === 27 || day === 28) return 'Sweet 16';
    if (day === 29 || day === 30) return 'Elite 8';
  }
  if (month === 4) {
    if (day === 4 || day === 5) return 'Final Four';    // Sat Apr 4
    if (day === 6 || day === 7) return 'Championship';  // Mon Apr 6
  }
  return null; // outside known tournament schedule
}

// Pull the best spread for a game from the bookmakers list
function extractSpread(bookmakers, homeTeam) {
  for (const book of PREFERRED_BOOKS) {
    const bm = bookmakers.find((b) => b.key === book);
    if (!bm) continue;
    const market = bm.markets?.find((m) => m.key === 'spreads');
    if (!market) continue;
    const homeOutcome = market.outcomes.find((o) => o.name === homeTeam);
    if (homeOutcome != null) return homeOutcome.point;
  }
  // Fallback: use the first bookmaker that has a spread
  for (const bm of bookmakers) {
    const market = bm.markets?.find((m) => m.key === 'spreads');
    if (!market) continue;
    const homeOutcome = market.outcomes.find((o) => o.name === homeTeam);
    if (homeOutcome != null) return homeOutcome.point;
  }
  return null;
}

// Fetch upcoming games with spreads from The Odds API
async function fetchAndSaveGames() {
  if (!API_KEY) {
    console.warn('[odds-api] ODDS_API_KEY not set — skipping game sync');
    return;
  }

  try {
    const res = await axios.get(`${BASE_URL}/sports/${SPORT}/odds`, {
      params: {
        apiKey: API_KEY,
        regions: 'us',
        markets: 'spreads',
        oddsFormat: 'american',
        dateFormat: 'iso',
      },
    });

    updateQuota(res.headers);
    const games = res.data;
    console.log(`[odds-api] Fetched ${games.length} NCAAB games from API`);

    let saved = 0;
    for (const g of games) {
      // Skip anything outside the tournament window (NIT, conference tourneys, etc.)
      if (!isInTournamentWindow(g.commence_time)) continue;

      const round = detectRound(g.commence_time);
      if (!round) continue; // date is in window but doesn't map to a known round

      const spread_home = extractSpread(g.bookmakers, g.home_team);
      db.upsertGame({
        odds_api_id: g.id,
        home_team: g.home_team,
        away_team: g.away_team,
        spread_home,
        game_time: g.commence_time,
        round,
      });
      saved++;
    }
    console.log(`[odds-api] ${saved} tournament games saved to DB (${games.length - saved} non-tournament skipped)`);
  } catch (err) {
    console.error('[odds-api] Error fetching games:', err.response?.data || err.message);
  }
}

// Fetch completed game scores and update results
async function fetchAndSaveScores() {
  if (!API_KEY) return;

  try {
    const res = await axios.get(`${BASE_URL}/sports/${SPORT}/scores`, {
      params: {
        apiKey: API_KEY,
        daysFrom: 3, // look back 3 days for recently completed games
      },
    });

    updateQuota(res.headers);
    const scores = res.data;
    let updated = 0;

    for (const s of scores) {
      if (!s.completed) continue;
      const homeScore = s.scores?.find((sc) => sc.name === s.home_team)?.score;
      const awayScore = s.scores?.find((sc) => sc.name === s.away_team)?.score;
      if (homeScore == null || awayScore == null) continue;

      db.updateGameResult({
        odds_api_id: s.id,
        home_score: parseInt(homeScore, 10),
        away_score: parseInt(awayScore, 10),
        is_final: true,
      });
      updated++;
    }
    if (updated > 0) console.log(`[odds-api] Updated scores for ${updated} completed games`);
  } catch (err) {
    console.error('[odds-api] Error fetching scores:', err.response?.data || err.message);
  }
}

// Run both syncs
async function syncAll() {
  await fetchAndSaveGames();
  await fetchAndSaveScores();
}

module.exports = { syncAll, fetchAndSaveGames, fetchAndSaveScores, getQuota };
