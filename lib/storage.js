'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'league-state.json');

function defaultState() {
  return {
    generateConfig: null,
    schedule: [],
    playoffSchedule: null,
    finalizedWeeks: [],
    divisionVenueConfig: {},
    divisionCourtMap: {},
    weeklyRankings: {},
    promotionRules: {}
  };
}

/**
 * loadState — synchronous for file, async fallback to Redis if env vars set.
 * Returns state object synchronously when using file storage.
 * When Redis env vars are set, attempts Redis first (async), falls back to file.
 */
function loadState() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    // Async Redis path — caller must handle the Promise
    return loadFromRedis();
  }
  return loadFromFile();
}

async function loadFromRedis() {
  try {
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    });
    const data = await redis.get('league:state');
    return data || defaultState();
  } catch (e) {
    console.warn('Redis load failed, falling back to file:', e.message);
    return loadFromFile();
  }
}

/**
 * saveState — synchronous for file, fire-and-forget async for Redis.
 */
function saveState(state) {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    saveToRedis(state).catch(e => {
      console.warn('Redis save failed, falling back to file:', e.message);
      saveToFile(state);
    });
    return;
  }
  saveToFile(state);
}

async function saveToRedis(state) {
  const { Redis } = require('@upstash/redis');
  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
  });
  await redis.set('league:state', JSON.stringify(state));
}

function loadFromFile() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultState();
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return defaultState();
  }
}

function saveToFile(state) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save state to file:', e.message);
  }
}

module.exports = { loadState, saveState, defaultState };
