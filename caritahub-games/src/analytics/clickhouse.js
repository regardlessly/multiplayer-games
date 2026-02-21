'use strict';

let client = null;

try {
  if (process.env.CLICKHOUSE_URL) {
    const { createClient } = require('@clickhouse/client');
    client = createClient({
      url: process.env.CLICKHOUSE_URL,
      database: process.env.CLICKHOUSE_DATABASE || 'default',
      username: process.env.CLICKHOUSE_USERNAME || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || ''
    });
    console.log('ClickHouse client initialised');
  }
} catch (e) {
  console.warn('ClickHouse unavailable:', e.message);
}

/**
 * Fire-and-forget event insert. Never throws, never awaited in the game loop.
 */
function logEvent(eventType, roomId, playerId, playerName, payload = {}) {
  if (!client) return;
  const row = {
    event_type: eventType,
    room_id: roomId || '',
    player_id: playerId || '',
    player_name: playerName || '',
    payload: JSON.stringify(payload),
    timestamp: new Date().toISOString()
  };
  client.insert({
    table: 'game_events',
    values: [row],
    format: 'JSONEachRow'
  }).catch(() => {}); // silent — analytics must never affect gameplay
}

module.exports = { logEvent };
