import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type RelayDatabase = Database.Database;

export function openDatabase(dataDir: string): RelayDatabase {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "relayqr.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: RelayDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      active_revision_id TEXT,
      style_json TEXT NOT NULL,
      icon_path TEXT,
      source_qr_path TEXT,
      fallback_enabled INTEGER NOT NULL DEFAULT 0,
      fallback_show_link INTEGER NOT NULL DEFAULT 1,
      gate_enabled INTEGER NOT NULL DEFAULT 0,
      gate_config_json TEXT NOT NULL DEFAULT '{"locationEnabled":false,"allowedRegions":[],"questions":[]}',
      redirect_enabled INTEGER NOT NULL DEFAULT 1,
      disabled_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS codes_user_id ON codes(user_id, deleted_at);

    CREATE TABLE IF NOT EXISTS target_revisions (
      id TEXT PRIMARY KEY,
      code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
      target TEXT NOT NULL,
      protocol TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS revisions_code_id ON target_revisions(code_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS scan_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
      scanned_at TEXT NOT NULL,
      device_type TEXT NOT NULL,
      referrer_host TEXT,
      ip_address TEXT,
      ip_region TEXT
    );
    CREATE INDEX IF NOT EXISTS scans_code_time ON scan_events(code_id, scanned_at DESC);
  `);

  const codeColumns = db.prepare("PRAGMA table_info(codes)").all() as Array<{ name: string }>;
  const columnNames = new Set(codeColumns.map((column) => column.name));
  if (!columnNames.has("redirect_enabled")) {
    db.exec("ALTER TABLE codes ADD COLUMN redirect_enabled INTEGER NOT NULL DEFAULT 1");
  }
  if (!columnNames.has("disabled_reason")) {
    db.exec("ALTER TABLE codes ADD COLUMN disabled_reason TEXT");
  }
  if (!columnNames.has("source_qr_path")) {
    db.exec("ALTER TABLE codes ADD COLUMN source_qr_path TEXT");
  }
  if (!columnNames.has("fallback_enabled")) {
    db.exec("ALTER TABLE codes ADD COLUMN fallback_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnNames.has("fallback_show_link")) {
    db.exec("ALTER TABLE codes ADD COLUMN fallback_show_link INTEGER NOT NULL DEFAULT 1");
  }
  if (!columnNames.has("gate_enabled")) {
    db.exec("ALTER TABLE codes ADD COLUMN gate_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnNames.has("gate_config_json")) {
    db.exec(`ALTER TABLE codes ADD COLUMN gate_config_json TEXT NOT NULL DEFAULT '{"locationEnabled":false,"allowedRegions":[],"questions":[]}'`);
  }

  const scanColumns = db.prepare("PRAGMA table_info(scan_events)").all() as Array<{ name: string }>;
  const scanColumnNames = new Set(scanColumns.map((column) => column.name));
  if (!scanColumnNames.has("ip_address")) {
    db.exec("ALTER TABLE scan_events ADD COLUMN ip_address TEXT");
  }
  if (!scanColumnNames.has("ip_region")) {
    db.exec("ALTER TABLE scan_events ADD COLUMN ip_region TEXT");
  }
}
