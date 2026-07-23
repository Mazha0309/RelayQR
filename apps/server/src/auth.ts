import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { RelayDatabase } from "./database.js";
import { hashPassword, hashToken, newSessionToken, verifyPassword } from "./security.js";
import { registrationEnabled } from "./settings.js";
import type { SessionUser, UserRow } from "./types.js";

const credentialsSchema = z.object({
  username: z.string().trim().min(3, "用户名至少需要 3 个字符").max(32, "用户名最多 32 个字符").regex(/^[\p{L}\p{N}_-]+$/u, "用户名只能包含文字、数字、下划线和短横线"),
  password: z.string().min(8, "密码至少需要 8 个字符").max(128, "密码最多 128 个字符"),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "新密码至少需要 8 个字符").max(128),
});

const COOKIE_NAME = "relayqr_session";

function cookieOptions(config: AppConfig) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.publicBaseUrl.startsWith("https://"),
    maxAge: config.sessionTtlDays * 24 * 60 * 60,
  };
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | undefined {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.code(400).send({ error: result.error.issues[0]?.message ?? "请求参数无效" });
    return undefined;
  }
  return result.data;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.currentUser) return reply.code(401).send({ error: "请先登录" });
}

export function registerAuth(app: FastifyInstance, db: RelayDatabase, config: AppConfig) {
  app.decorateRequest("currentUser", null);

  app.addHook("onRequest", async (request) => {
    request.currentUser = null;
    const token = request.cookies[COOKIE_NAME];
    if (!token) return;
    const now = new Date().toISOString();
    const user = db.prepare(`
      SELECT users.id, users.username, users.is_admin AS isAdmin
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(token, config.sessionSecret), now) as { id: string; username: string; isAdmin: number } | undefined;
    request.currentUser = user ? { ...user, isAdmin: Boolean(user.isAdmin) } : null;
  });

  const createSession = (reply: FastifyReply, userId: string) => {
    const token = newSessionToken();
    const now = new Date();
    const expires = new Date(now.getTime() + config.sessionTtlDays * 86_400_000);
    db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(token, config.sessionSecret), userId, now.toISOString(), expires.toISOString());
    reply.setCookie(COOKIE_NAME, token, cookieOptions(config));
  };

  app.post("/api/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!registrationEnabled(db, config.registrationEnabled)) return reply.code(403).send({ error: "当前未开放注册" });
    const data = parseBody(credentialsSchema, request.body, reply);
    if (!data) return;
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(data.username);
    if (existing) return reply.code(409).send({ error: "该用户名已被使用" });
    const userId = randomUUID();
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(data.password);
    const isAdmin = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count === 0;
    db.prepare("INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, data.username, passwordHash, isAdmin ? 1 : 0, now);
    createSession(reply, userId);
    return reply.code(201).send({ user: { id: userId, username: data.username, isAdmin } });
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const data = parseBody(credentialsSchema, request.body, reply);
    if (!data) return;
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(data.username) as UserRow | undefined;
    if (!user || !(await verifyPassword(data.password, user.password_hash))) {
      return reply.code(401).send({ error: "用户名或密码错误" });
    }
    createSession(reply, user.id);
    return { user: { id: user.id, username: user.username, isAdmin: Boolean(user.is_admin) } };
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.currentUser) return reply.code(401).send({ error: "请先登录" });
    return { user: request.currentUser };
  });

  app.get("/api/auth/config", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { registrationEnabled: registrationEnabled(db, config.registrationEnabled) };
  });

  app.post("/api/auth/logout", { preHandler: requireUser }, async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token, config.sessionSecret));
    db.prepare("DELETE FROM admin_code_edit_grants WHERE admin_user_id = ?").run(request.currentUser!.id);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.code(204).send();
  });

  app.patch("/api/auth/password", { preHandler: requireUser }, async (request, reply) => {
    const data = parseBody(passwordChangeSchema, request.body, reply);
    if (!data) return;
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(request.currentUser!.id) as UserRow;
    if (!(await verifyPassword(data.currentPassword, user.password_hash))) {
      return reply.code(400).send({ error: "当前密码错误" });
    }
    const passwordHash = await hashPassword(data.newPassword);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, user.id);
    db.prepare("DELETE FROM admin_code_edit_grants WHERE admin_user_id = ?").run(user.id);
    const token = request.cookies[COOKIE_NAME];
    if (token) {
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
        .run(user.id, hashToken(token, config.sessionSecret));
    }
    return { ok: true };
  });
}
