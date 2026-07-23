import type { RelayDatabase } from "./database.js";

const registrationKey = "registration_enabled";

export function registrationEnabled(db: RelayDatabase, fallback: boolean) {
  const setting = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(registrationKey) as { value: string } | undefined;
  return setting ? setting.value === "true" : fallback;
}

export function setRegistrationEnabled(db: RelayDatabase, enabled: boolean, userId: string) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(registrationKey, enabled ? "true" : "false", new Date().toISOString(), userId);
}
