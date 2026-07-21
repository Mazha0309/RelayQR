import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const BLOCKED_PROTOCOLS = new Set(["javascript", "data", "file", "vbscript", "blob", "about"]);

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltValue, hashValue] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string, secret: string) {
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

export function validateTarget(raw: string) {
  const target = raw.trim();
  if (!target || target.length > 4096) throw new Error("目标地址长度必须为 1–4096 个字符");
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(target);
  if (!match?.[1]) throw new Error("目标必须包含协议，例如 https:// 或 weixin://");
  const protocol = match[1].toLowerCase();
  if (BLOCKED_PROTOCOLS.has(protocol)) throw new Error(`不允许使用 ${protocol}: 协议`);
  if ((protocol === "http" || protocol === "https")) {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new Error("网址格式无效");
    }
    if (!parsed.hostname) throw new Error("网址缺少主机名");
  }
  return { target, protocol };
}

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function randomSlug(length = 10) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}
