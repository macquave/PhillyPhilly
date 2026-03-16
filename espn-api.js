/**
 * ESPN NCAA Tournament integration — no API key required.
 *
 * Uses the public ESPN scoreboard API with groups=100 (NCAA Tournament filter),
 * the same endpoint used by espn.com itself. Free, unlimited, no credentials.
 *
 * Each syncAll() fetches all 12 tournament dates and upserts games + scores
 * into the DB in a single pass.
 */

const axios = require('axios');
const db    = require('./db');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';

// ---------------------------------------------------------------------------
// 2026 NCAA Tournament schedule — maps each date (YYYYMMDD) to its round name
// ---------------------------------------------------------------------------
const ROUND_BY_DATE = {
  '20260318': 'First Four',
  '20260319': 'First Four',
  '20260320': 'Round of 64',
  '20260321': 'Round of 64',
  '20260322': 'Round of 32',
  '20260323': 'Round of 32',
  '20260327': 'Sweet 16',
  '20260328': 'Sweet 16',
  '20260329': 'Elite 8',
  '20260330': 'Elite 8',
  '20260404': 'Final Four',
  '20260406': 'Championship',
};

const ALL_DATES = Object.keys(ROUND_BY_DATE);

// ---------------------------------------------------------------------------
// Last sync tracking
// ---------------------------------------------------------------------------
let _lastSync = null;

function getLastSync() {
  return { updatedAt: _lastSync, source: 'ESPN (free)' };
}

// ---------------------------------------------------------------------------
// Fetch all ESPN events for a single date (YYYYMMDD)
// ---------------------------------------------------------------------------
async function fetchDate(dateStr) {
  const res = await axios.get(ESPN_BASE, {
    params:  { groups: 100, limit: 50, dates: dateStr },
    timeout: 10000,
  });
  return res.data.events || [];
}

// ---------------------------------------------------------------------------
// Extract home-team spread from ESPN odds object.
//
// ESPN's odds look like:
//   { spread: 5.5, details: "Duke -5.5", overUnder: 141,
//     homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } }
//
// spread_home < 0 means home team is favored (e.g. -5.5)
// spread_home > 0 means away team is favored (e.g. +5.5)
// ---------------------------------------------------------------------------
function extractSpread(odds, homeTeamName) {
  if (!odds) return null;

  // Method 1: use homeTeamOdds.favorite flag + spread magnitude
  if (odds.spread != null && odds.homeTeamOdds != null) {
    const homeFav = odds.homeTeamOdds.favorite;
    if (homeFav === true)  return -Math.abs(odds.spread);
    if (homeFav === false) return  Math.abs(odds.spread);
  }

  // Method 2: parse "FavoredTeamName -X.X" details string
  if (odds.details && !/^even$/i.test(odds.details.trim())) {
    const m = odds.details.trim().match(/^(.+?)\s+([+-]?\d+\.?\d*)$/);
    if (m) {
      const favoredName = m[1].toLowerCase();
      const spreadVal   = parseFloat(m[2]); // already negative for favored team
      const homeWord    = (homeTeamName || '').toLowerCase().split(/\s+/)[0];
      const homeIsFav   = homeWord && favoredName.includes(homeWord);
      // spreadVal is something like -5.5 (favored) or +5.5 (underdog)
      // We want spread_home: if home is favored, spreadVal < 0 → return as-is
      //                       if away is favored, spreadVal < 0 → home gets +|spreadVal|
      return homeIsFav ? spreadVal : -spreadVal;
    }
  }

  // Pick'em / even
  if (/^even$/i.test((odds.details || '').trim())) return 0;

  return null;
}

// ---------------------------------------------------------------------------
// Parse a single ESPN event into our DB shape
// ---------------------------------------------------------------------------
function parseEvent(ev, round) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;

  const home = comp.competitors?.find(c => c.homeAway === 'home');
  const away = comp.competitors?.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  const homeName = home.team?.shortDisplayName || home.team?.displayName;
  const awayName = away.team?.shortDisplayName || away.team?.displayName;
  if (!homeName || !awayName || homeName === 'TBD' || awayName === 'TBD') return null;

  const isFinal   = comp.status?.type?.completed === true;
  const homeScore = (isFinal && home.score != null) ? parseInt(home.score, 10) : null;
  const awayScore = (isFinal && away.score != null) ? parseInt(away.score, 10) : null;

  const spreadHome = extractSpread(comp.odds?.[0] ?? null, homeName);

  return {
    espn_id:     ev.id,
    home_team:   homeName,
    away_team:   awayName,
    spread_home: spreadHome,
    game_time:   ev.date,
    round,
    is_final:    isFinal,
    home_score:  homeScore,
    away_score:  awayScore,
  };
}

// ---------------------------------------------------------------------------
// Main sync — fetches all tournament dates, upserts games, updates scores
// ---------------------------------------------------------------------------
async function syncAll() {
  let upserted = 0, scored = 0, skipped = 0;

  for (const dateStr of ALL_DATES) {
    let events;
    try {
      events = await fetchDate(dateStr);
    } catch (err) {
      console.error(`[espn-api] Failed to fetch ${dateStr}:`, err.message);
      continue;
    }

    for (const ev of events) {
      const parsed = parseEvent(ev, ROUND_BY_DATE[dateStr]);
      if (!parsed) { skipped++; continue; }

      // Upsert game schedule + spread (odds_api_id column reused for ESPN event id)
      await db.upsertGame({
        odds_api_id: parsed.espn_id,
        home_team:   parsed.home_team,
        away_team:   parsed.away_team,
        spread_home: parsed.spread_home,
        game_time:   parsed.game_time,
        round:       parsed.round,
      });
      upserted++;

      // Update score if game is complete
      if (parsed.is_final && parsed.home_score != null && parsed.away_score != null) {
        await db.updateGameResult({
          odds_api_id: parsed.espn_id,
          home_score:  parsed.home_score,
          away_score:  parsed.away_score,
          is_final:    true,
        });
        scored++;
      }
    }
  }

  _lastSync = new Date().toISOString();
  console.log(`[espn-api] Sync complete — ${upserted} games upserted, ${scored} scores updated, ${skipped} events skipped`);
}

module.exports = { syncAll, getLastSync };
