// Ids (user ids, session ids, etc.) are UUIDs (v7) — a malformed id can
// never match a row, so once the caller is authorized it gets the same 404
// as an id that simply doesn't exist, without ever reaching the DB.
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
