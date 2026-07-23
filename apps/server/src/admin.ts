import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { RelayDatabase } from "./database.js";
import type { RequestMonitor } from "./monitor.js";
import { recordAudit } from "./audit.js";
import { verifyPassword } from "./security.js";
import { registrationEnabled, setRegistrationEnabled } from "./settings.js";
import type { UserRow } from "./types.js";

const roleSchema = z.object({ isAdmin: z.boolean() });
const registrationSchema = z.object({ enabled: z.boolean() });
const adminPasswordSchema = z.object({ password: z.string().min(1, "请输入管理员密码").max(128) });

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.currentUser) return reply.code(401).send({ error: "请先登录" });
  if (!request.currentUser.isAdmin) return reply.code(403).send({ error: "仅管理员可以访问" });
}

function normalizedIp(ip: string) {
  return (ip.startsWith("::ffff:") ? ip.slice(7) : ip).slice(0, 64);
}

function fileSize(filePath: string) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function diskUsage(dataDir: string) {
  try {
    const stats = fs.statfsSync(dataDir);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    return { totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) };
  } catch {
    return { totalBytes: 0, freeBytes: 0, usedBytes: 0 };
  }
}

export function registerAdminRoutes(
  app: FastifyInstance,
  db: RelayDatabase,
  config: AppConfig,
  monitor: RequestMonitor,
) {
  app.get("/api/admin/users", { preHandler: requireAdmin }, async () => {
    const rows = db.prepare(`
      SELECT
        users.id,
        users.username,
        users.is_admin,
        users.created_at,
        (SELECT COUNT(*) FROM codes WHERE codes.user_id = users.id AND codes.deleted_at IS NULL) AS code_count,
        (SELECT COUNT(*) FROM audit_events WHERE audit_events.actor_user_id = users.id) AS audit_count,
        (SELECT MAX(created_at) FROM audit_events WHERE audit_events.actor_user_id = users.id) AS last_activity_at
      FROM users
      ORDER BY users.created_at, users.username
    `).all() as Array<{
      id: string;
      username: string;
      is_admin: number;
      created_at: string;
      code_count: number;
      audit_count: number;
      last_activity_at: string | null;
    }>;
    return {
      users: rows.map((user) => ({
        id: user.id,
        username: user.username,
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
        codeCount: user.code_count,
        auditCount: user.audit_count,
        lastActivityAt: user.last_activity_at,
      })),
    };
  });

  app.get("/api/admin/settings", { preHandler: requireAdmin }, async () => ({
    registrationEnabled: registrationEnabled(db, config.registrationEnabled),
  }));

  app.get<{ Querystring: { userId?: string } }>("/api/admin/codes", { preHandler: requireAdmin }, async (request) => {
    const userId = request.query.userId?.trim();
    const where = userId ? "AND codes.user_id = ?" : "";
    const rows = db.prepare(`
      SELECT
        codes.id,
        codes.user_id,
        users.username AS owner_username,
        codes.slug,
        codes.name,
        codes.fallback_enabled,
        codes.fallback_show_link,
        codes.gate_enabled,
        codes.redirect_enabled,
        codes.disabled_reason,
        codes.source_qr_path,
        codes.created_at,
        codes.updated_at,
        target_revisions.target,
        target_revisions.protocol,
        (SELECT COUNT(*) FROM scan_events WHERE scan_events.code_id = codes.id) AS scan_count
      FROM codes
      JOIN users ON users.id = codes.user_id
      LEFT JOIN target_revisions ON target_revisions.id = codes.active_revision_id
      WHERE codes.deleted_at IS NULL ${where}
      ORDER BY codes.updated_at DESC
    `).all(...(userId ? [userId] : [])) as Array<{
      id: string;
      user_id: string;
      owner_username: string;
      slug: string;
      name: string;
      fallback_enabled: number;
      fallback_show_link: number;
      gate_enabled: number;
      redirect_enabled: number;
      disabled_reason: string | null;
      source_qr_path: string | null;
      created_at: string;
      updated_at: string;
      target: string | null;
      protocol: string | null;
      scan_count: number;
    }>;
    return {
      codes: rows.map((code) => ({
        id: code.id,
        ownerId: code.user_id,
        ownerUsername: code.owner_username,
        slug: code.slug,
        name: code.name,
        target: code.target,
        protocol: code.protocol,
        publicUrl: `${config.publicBaseUrl}/r/${code.slug}`,
        redirectEnabled: Boolean(code.redirect_enabled),
        disabledReason: code.disabled_reason,
        fallbackEnabled: Boolean(code.fallback_enabled),
        showTargetLink: Boolean(code.fallback_show_link),
        gateEnabled: Boolean(code.gate_enabled),
        hasSourceQr: Boolean(code.source_qr_path),
        scanCount: code.scan_count,
        createdAt: code.created_at,
        updatedAt: code.updated_at,
      })),
    };
  });

  app.post<{ Params: { id: string } }>("/api/admin/codes/:id/edit-session", {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const parsed = adminPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "请求参数无效" });
    const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(request.currentUser!.id) as UserRow;
    if (!(await verifyPassword(parsed.data.password, admin.password_hash))) {
      return reply.code(401).send({ error: "管理员密码错误" });
    }
    const code = db.prepare(`
      SELECT codes.id, codes.name, codes.user_id, users.username AS owner_username
      FROM codes JOIN users ON users.id = codes.user_id
      WHERE codes.id = ? AND codes.deleted_at IS NULL
    `).get(request.params.id) as { id: string; name: string; user_id: string; owner_username: string } | undefined;
    if (!code) return reply.code(404).send({ error: "活码不存在" });
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    db.prepare("DELETE FROM admin_code_edit_grants WHERE expires_at <= ?").run(new Date().toISOString());
    db.prepare(`
      INSERT INTO admin_code_edit_grants (admin_user_id, code_id, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(admin_user_id) DO UPDATE SET code_id = excluded.code_id, expires_at = excluded.expires_at
    `).run(admin.id, code.id, expiresAt);
    recordAudit(db, {
      actorUserId: admin.id,
      actorUsername: admin.username,
      action: `验证密码并解锁编辑（成员：${code.owner_username}）`,
      resourceType: "code",
      resourceId: code.id,
      resourceName: code.name,
      ipAddress: normalizedIp(request.ip),
    });
    return { expiresAt };
  });

  app.delete("/api/admin/codes/edit-session", { preHandler: requireAdmin }, async (request, reply) => {
    db.prepare("DELETE FROM admin_code_edit_grants WHERE admin_user_id = ?").run(request.currentUser!.id);
    return reply.code(204).send();
  });

  app.put("/api/admin/settings/registration", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "请求参数无效" });
    setRegistrationEnabled(db, parsed.data.enabled, request.currentUser!.id);
    recordAudit(db, {
      actorUserId: request.currentUser!.id,
      actorUsername: request.currentUser!.username,
      action: parsed.data.enabled ? "开启账号注册" : "关闭账号注册",
      resourceType: "system",
      resourceName: "账号注册设置",
      ipAddress: normalizedIp(request.ip),
    });
    return { registrationEnabled: parsed.data.enabled };
  });

  app.put<{ Params: { id: string } }>("/api/admin/users/:id/admin", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = roleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "请求参数无效" });
    const target = db.prepare("SELECT id, username, is_admin FROM users WHERE id = ?")
      .get(request.params.id) as { id: string; username: string; is_admin: number } | undefined;
    if (!target) return reply.code(404).send({ error: "成员不存在" });
    const wasAdmin = Boolean(target.is_admin);
    if (wasAdmin === parsed.data.isAdmin) return { user: { id: target.id, username: target.username, isAdmin: wasAdmin } };
    if (wasAdmin && !parsed.data.isAdmin) {
      const adminCount = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1").get() as { count: number }).count;
      if (adminCount <= 1) return reply.code(400).send({ error: "不能取消最后一个管理员" });
    }

    db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(parsed.data.isAdmin ? 1 : 0, target.id);
    recordAudit(db, {
      actorUserId: request.currentUser!.id,
      actorUsername: request.currentUser!.username,
      action: parsed.data.isAdmin ? "授予管理员权限" : "取消管理员权限",
      resourceType: "user",
      resourceId: target.id,
      resourceName: target.username,
      ipAddress: normalizedIp(request.ip),
    });
    return { user: { id: target.id, username: target.username, isAdmin: parsed.data.isAdmin } };
  });

  app.get<{ Querystring: { userId?: string; limit?: string; offset?: string } }>("/api/admin/audit", { preHandler: requireAdmin }, async (request) => {
    const limit = Math.min(200, Math.max(20, Number(request.query.limit ?? 100) || 100));
    const offset = Math.max(0, Number(request.query.offset ?? 0) || 0);
    const userId = request.query.userId?.trim();
    const where = userId ? `
      WHERE audit_events.actor_user_id = ?
        OR (
          audit_events.resource_type = 'code'
          AND audit_events.resource_id IN (SELECT id FROM codes WHERE user_id = ?)
        )
    ` : "";
    const values = userId ? [userId, userId, limit, offset] : [limit, offset];
    const events = db.prepare(`
      SELECT id, actor_user_id, actor_username, action, resource_type, resource_id, resource_name, ip_address, created_at
      FROM audit_events
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values) as Array<{
      id: number;
      actor_user_id: string | null;
      actor_username: string;
      action: string;
      resource_type: string;
      resource_id: string | null;
      resource_name: string | null;
      ip_address: string | null;
      created_at: string;
    }>;
    return {
      events: events.map((event) => ({
        id: event.id,
        actorUserId: event.actor_user_id,
        actorUsername: event.actor_username,
        action: event.action,
        resourceType: event.resource_type,
        resourceId: event.resource_id,
        resourceName: event.resource_name,
        ipAddress: event.ip_address ?? "未记录",
        createdAt: event.created_at,
      })),
      limit,
      offset,
    };
  });

  app.get("/api/admin/server", { preHandler: requireAdmin }, async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 86_400_000).toISOString();
    const memory = process.memoryUsage();
    const disk = diskUsage(config.dataDir);
    const sqlitePath = path.join(config.dataDir, "relayqr.sqlite");
    const databaseBytes = fileSize(sqlitePath) + fileSize(`${sqlitePath}-wal`) + fileSize(`${sqlitePath}-shm`);
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE is_admin = 1) AS admins,
        (SELECT COUNT(*) FROM codes WHERE deleted_at IS NULL) AS codes,
        (SELECT COUNT(*) FROM codes WHERE deleted_at IS NULL AND redirect_enabled = 1) AS active_codes,
        (SELECT COUNT(*) FROM scan_events) AS scans,
        (SELECT COUNT(*) FROM scan_events WHERE scanned_at >= ?) AS scans_24h,
        (SELECT COUNT(*) FROM sessions WHERE expires_at > ?) AS active_sessions,
        (SELECT COUNT(*) FROM audit_events) AS audit_events
    `).get(since, now.toISOString()) as Record<string, number>;
    const cpus = os.cpus().length || 1;
    const loadAverage = os.loadavg();
    return {
      generatedAt: now.toISOString(),
      instance: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        nodeVersion: process.version,
        cpuCount: cpus,
        hostUptimeSeconds: Math.floor(os.uptime()),
      },
      requests: monitor.snapshot(),
      memory: {
        processRssBytes: memory.rss,
        processHeapUsedBytes: memory.heapUsed,
        processHeapTotalBytes: memory.heapTotal,
        systemTotalBytes: os.totalmem(),
        systemFreeBytes: os.freemem(),
      },
      load: {
        oneMinute: loadAverage[0] ?? 0,
        fiveMinutes: loadAverage[1] ?? 0,
        fifteenMinutes: loadAverage[2] ?? 0,
        oneMinutePercent: (loadAverage[0] ?? 0) / cpus * 100,
      },
      storage: { ...disk, databaseBytes },
      counts: {
        users: counts.users ?? 0,
        admins: counts.admins ?? 0,
        codes: counts.codes ?? 0,
        activeCodes: counts.active_codes ?? 0,
        scans: counts.scans ?? 0,
        scans24h: counts.scans_24h ?? 0,
        activeSessions: counts.active_sessions ?? 0,
        auditEvents: counts.audit_events ?? 0,
      },
    };
  });
}
