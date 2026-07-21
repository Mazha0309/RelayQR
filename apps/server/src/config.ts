import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  dataDir: string;
  sessionSecret: string;
  sessionTtlDays: number;
  trustProxy: boolean;
  registrationEnabled: boolean;
  webDistDir: string;
}

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const appRoot = path.resolve(import.meta.dirname, "../../..");
  const sessionSecret = process.env.SESSION_SECRET ?? "development-only-secret-change-me-now";

  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    dataDir: path.resolve(process.env.DATA_DIR ?? path.join(appRoot, "data")),
    sessionSecret,
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
    trustProxy: booleanValue(process.env.TRUST_PROXY, false),
    registrationEnabled: booleanValue(process.env.REGISTRATION_ENABLED, true),
    webDistDir: path.resolve(process.env.WEB_DIST_DIR ?? path.join(appRoot, "apps/web/dist")),
    ...overrides,
  };
}
