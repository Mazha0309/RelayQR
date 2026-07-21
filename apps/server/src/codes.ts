import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { RelayDatabase } from "./database.js";
import { requireUser } from "./auth.js";
import { randomSlug, validateTarget } from "./security.js";
import { defaultQrStyle, qrStyleSchema } from "./style.js";
import type { CodeRow } from "./types.js";

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入活码名称").max(80),
  target: z.string(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  style: qrStyleSchema.optional(),
});

const targetSchema = z.object({ target: z.string() });
const fallbackStateSchema = z.object({ enabled: z.boolean() });
const redirectStateSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(true), reason: z.string().optional() }),
  z.object({ enabled: z.literal(false), reason: z.string().trim().min(1, "关闭跳转时必须填写原因").max(300, "原因最多 300 个字符") }),
]);

function bodyOrError<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | undefined {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.code(400).send({ error: result.error.issues[0]?.message ?? "请求参数无效" });
    return undefined;
  }
  return result.data;
}

function ownedCode(db: RelayDatabase, codeId: string, userId: string) {
  return db.prepare(`
    SELECT codes.*, target_revisions.target, target_revisions.protocol
    FROM codes
    LEFT JOIN target_revisions ON target_revisions.id = codes.active_revision_id
    WHERE codes.id = ? AND codes.user_id = ? AND codes.deleted_at IS NULL
  `).get(codeId, userId) as CodeRow | undefined;
}

function codeDto(row: CodeRow, config: AppConfig) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    target: row.target ?? null,
    protocol: row.protocol ?? null,
    style: JSON.parse(row.style_json),
    hasIcon: Boolean(row.icon_path),
    iconUrl: row.icon_path ? `/api/codes/${row.id}/icon?v=${encodeURIComponent(row.updated_at)}` : null,
    hasSourceQr: Boolean(row.source_qr_path),
    sourceQrUrl: row.source_qr_path ? `/api/codes/${row.id}/source-qr?v=${encodeURIComponent(row.updated_at)}` : null,
    fallbackEnabled: Boolean(row.fallback_enabled),
    redirectEnabled: Boolean(row.redirect_enabled),
    disabledReason: row.disabled_reason,
    publicUrl: `${config.publicBaseUrl}/r/${row.slug}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uniqueSlug(db: RelayDatabase) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const slug = randomSlug();
    if (!db.prepare("SELECT 1 FROM codes WHERE slug = ?").get(slug)) return slug;
  }
  throw new Error("无法生成唯一短码，请重试");
}

function matchesImageType(buffer: Buffer, mime: string) {
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export function registerCodeRoutes(app: FastifyInstance, db: RelayDatabase, config: AppConfig) {
  app.get("/api/codes", { preHandler: requireUser }, async (request) => {
    const rows = db.prepare(`
      SELECT codes.*, target_revisions.target, target_revisions.protocol
      FROM codes LEFT JOIN target_revisions ON target_revisions.id = codes.active_revision_id
      WHERE codes.user_id = ? AND codes.deleted_at IS NULL
      ORDER BY codes.updated_at DESC
    `).all(request.currentUser!.id) as CodeRow[];
    return { codes: rows.map((row) => codeDto(row, config)) };
  });

  app.post("/api/codes", { preHandler: requireUser }, async (request, reply) => {
    const data = bodyOrError(createSchema, request.body, reply);
    if (!data) return;
    let validated: ReturnType<typeof validateTarget>;
    try {
      validated = validateTarget(data.target);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    const codeId = randomUUID();
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    const slug = uniqueSlug(db);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO codes (id, user_id, slug, name, style_json, redirect_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(codeId, request.currentUser!.id, slug, data.name, JSON.stringify(defaultQrStyle), now, now);
      db.prepare("INSERT INTO target_revisions (id, code_id, target, protocol, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(revisionId, codeId, validated.target, validated.protocol, now);
      db.prepare("UPDATE codes SET active_revision_id = ? WHERE id = ?").run(revisionId, codeId);
    })();
    const row = ownedCode(db, codeId, request.currentUser!.id)!;
    return reply.code(201).send({ code: codeDto(row, config) });
  });

  app.get<{ Params: { id: string } }>("/api/codes/:id", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    return { code: codeDto(row, config) };
  });

  app.patch<{ Params: { id: string } }>("/api/codes/:id", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    const data = bodyOrError(updateSchema, request.body, reply);
    if (!data) return;
    const now = new Date().toISOString();
    db.prepare("UPDATE codes SET name = ?, style_json = ?, updated_at = ? WHERE id = ?")
      .run(data.name ?? row.name, JSON.stringify(data.style ?? JSON.parse(row.style_json)), now, row.id);
    return { code: codeDto(ownedCode(db, row.id, request.currentUser!.id)!, config) };
  });

  app.put<{ Params: { id: string } }>("/api/codes/:id/target", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    const data = bodyOrError(targetSchema, request.body, reply);
    if (!data) return;
    let validated: ReturnType<typeof validateTarget>;
    try {
      validated = validateTarget(data.target);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("INSERT INTO target_revisions (id, code_id, target, protocol, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(revisionId, row.id, validated.target, validated.protocol, now);
      db.prepare("UPDATE codes SET active_revision_id = ?, fallback_enabled = 0, updated_at = ? WHERE id = ?").run(revisionId, now, row.id);
    })();
    return { code: codeDto(ownedCode(db, row.id, request.currentUser!.id)!, config) };
  });

  app.put<{ Params: { id: string } }>("/api/codes/:id/redirect-state", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    const data = bodyOrError(redirectStateSchema, request.body, reply);
    if (!data) return;
    const now = new Date().toISOString();
    db.prepare("UPDATE codes SET redirect_enabled = ?, disabled_reason = ?, updated_at = ? WHERE id = ?")
      .run(data.enabled ? 1 : 0, data.enabled ? null : data.reason, now, row.id);
    return { code: codeDto(ownedCode(db, row.id, request.currentUser!.id)!, config) };
  });

  app.get<{ Params: { id: string } }>("/api/codes/:id/history", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    const revisions = db.prepare("SELECT id, target, protocol, created_at FROM target_revisions WHERE code_id = ? ORDER BY created_at DESC")
      .all(row.id) as Array<{ id: string; target: string; protocol: string; created_at: string }>;
    return { revisions: revisions.map((revision) => ({ ...revision, createdAt: revision.created_at, isActive: revision.id === row.active_revision_id })) };
  });

  app.post<{ Params: { id: string; revisionId: string } }>("/api/codes/:id/history/:revisionId/restore", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    const revision = db.prepare("SELECT target, protocol FROM target_revisions WHERE id = ? AND code_id = ?")
      .get(request.params.revisionId, row.id) as { target: string; protocol: string } | undefined;
    if (!revision) return reply.code(404).send({ error: "历史版本不存在" });
    const newRevisionId = randomUUID();
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("INSERT INTO target_revisions (id, code_id, target, protocol, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(newRevisionId, row.id, revision.target, revision.protocol, now);
      db.prepare("UPDATE codes SET active_revision_id = ?, fallback_enabled = 0, updated_at = ? WHERE id = ?").run(newRevisionId, now, row.id);
    })();
    return { code: codeDto(ownedCode(db, row.id, request.currentUser!.id)!, config) };
  });

  app.delete<{ Params: { id: string } }>("/api/codes/:id", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    const now = new Date().toISOString();
    db.prepare("UPDATE codes SET deleted_at = ?, redirect_enabled = 0, updated_at = ? WHERE id = ?").run(now, now, row.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/codes/:id/icon", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    const file = await request.file({ limits: { fileSize: 1_500_000, files: 1 } });
    if (!file) return reply.code(400).send({ error: "请选择图标文件" });
    const extensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
    const extension = extensions[file.mimetype];
    if (!extension) return reply.code(400).send({ error: "图标仅支持 PNG、JPEG 或 WebP" });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ error: "图标文件为空" });
    if (!matchesImageType(buffer, file.mimetype)) return reply.code(400).send({ error: "图标文件内容与格式不匹配" });
    const iconDir = path.join(config.dataDir, "icons");
    fs.mkdirSync(iconDir, { recursive: true });
    const filename = `${randomUUID()}${extension}`;
    fs.writeFileSync(path.join(iconDir, filename), buffer, { flag: "wx" });
    if (row.icon_path) fs.rmSync(path.join(iconDir, path.basename(row.icon_path)), { force: true });
    const now = new Date().toISOString();
    db.prepare("UPDATE codes SET icon_path = ?, updated_at = ? WHERE id = ?").run(filename, now, row.id);
    return { code: codeDto(ownedCode(db, row.id, request.currentUser!.id)!, config) };
  });

  app.get<{ Params: { id: string } }>("/api/codes/:id/icon", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row?.icon_path) return reply.code(404).send({ error: "图标不存在" });
    const iconPath = path.join(config.dataDir, "icons", path.basename(row.icon_path));
    if (!fs.existsSync(iconPath)) return reply.code(404).send({ error: "图标文件不存在" });
    const mime = row.icon_path.endsWith(".png") ? "image/png" : row.icon_path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    reply.header("Cache-Control", "private, max-age=3600").type(mime);
    return reply.send(fs.createReadStream(iconPath));
  });

  app.delete<{ Params: { id: string } }>("/api/codes/:id/icon", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    if (row.icon_path) fs.rmSync(path.join(config.dataDir, "icons", path.basename(row.icon_path)), { force: true });
    const now = new Date().toISOString();
    db.prepare("UPDATE codes SET icon_path = NULL, updated_at = ? WHERE id = ?").run(now, row.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string }; Querystring: { target?: string } }>("/api/codes/:id/source-qr", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    let validatedTarget: ReturnType<typeof validateTarget> | null = null;
    if (request.query.target !== undefined) {
      try {
        validatedTarget = validateTarget(request.query.target);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    }
    const file = await request.file({ limits: { fileSize: 8_000_000, files: 1 } });
    if (!file) return reply.code(400).send({ error: "请选择二维码原图" });
    const extensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
    const extension = extensions[file.mimetype];
    if (!extension) return reply.code(400).send({ error: "二维码原图仅支持 PNG、JPEG 或 WebP" });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ error: "二维码原图文件为空" });
    if (!matchesImageType(buffer, file.mimetype)) return reply.code(400).send({ error: "二维码原图内容与格式不匹配" });
    const sourceDir = path.join(config.dataDir, "source-qrs");
    fs.mkdirSync(sourceDir, { recursive: true });
    const filename = `${randomUUID()}${extension}`;
    const newPath = path.join(sourceDir, filename);
    fs.writeFileSync(newPath, buffer, { flag: "wx" });
    const now = new Date().toISOString();
    try {
      db.transaction(() => {
        if (validatedTarget && validatedTarget.target !== row.target) {
          const revisionId = randomUUID();
          db.prepare("INSERT INTO target_revisions (id, code_id, target, protocol, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(revisionId, row.id, validatedTarget.target, validatedTarget.protocol, now);
          db.prepare("UPDATE codes SET active_revision_id = ?, source_qr_path = ?, updated_at = ? WHERE id = ?")
            .run(revisionId, filename, now, row.id);
        } else {
          db.prepare("UPDATE codes SET source_qr_path = ?, updated_at = ? WHERE id = ?").run(filename, now, row.id);
        }
      })();
    } catch (error) {
      fs.rmSync(newPath, { force: true });
      throw error;
    }
    if (row.source_qr_path) fs.rmSync(path.join(sourceDir, path.basename(row.source_qr_path)), { force: true });
    return { code: codeDto(ownedCode(db, row.id, request.currentUser!.id)!, config) };
  });

  app.get<{ Params: { id: string } }>("/api/codes/:id/source-qr", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row?.source_qr_path) return reply.code(404).send({ error: "二维码原图不存在" });
    const imagePath = path.join(config.dataDir, "source-qrs", path.basename(row.source_qr_path));
    if (!fs.existsSync(imagePath)) return reply.code(404).send({ error: "二维码原图文件不存在" });
    const mime = row.source_qr_path.endsWith(".png") ? "image/png" : row.source_qr_path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    reply.header("Cache-Control", "private, no-cache").type(mime);
    return reply.send(fs.createReadStream(imagePath));
  });

  app.delete<{ Params: { id: string } }>("/api/codes/:id/source-qr", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    if (row.source_qr_path) fs.rmSync(path.join(config.dataDir, "source-qrs", path.basename(row.source_qr_path)), { force: true });
    const now = new Date().toISOString();
    db.prepare("UPDATE codes SET source_qr_path = NULL, fallback_enabled = 0, updated_at = ? WHERE id = ?").run(now, row.id);
    return { code: codeDto(ownedCode(db, row.id, request.currentUser!.id)!, config) };
  });

  app.put<{ Params: { id: string } }>("/api/codes/:id/fallback-state", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    const data = bodyOrError(fallbackStateSchema, request.body, reply);
    if (!data) return;
    if (data.enabled && !row.source_qr_path) return reply.code(400).send({ error: "请先上传并识别二维码图片" });
    const now = new Date().toISOString();
    db.prepare("UPDATE codes SET fallback_enabled = ?, updated_at = ? WHERE id = ?").run(data.enabled ? 1 : 0, now, row.id);
    return { code: codeDto(ownedCode(db, row.id, request.currentUser!.id)!, config) };
  });

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>("/api/codes/:id/stats", { preHandler: requireUser }, async (request, reply) => {
    const row = ownedCode(db, request.params.id, request.currentUser!.id);
    if (!row) return reply.code(404).send({ error: "活码不存在" });
    const days = Math.min(365, Math.max(7, Number(request.query.days ?? 30) || 30));
    const since = new Date(Date.now() - (days - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const total = (db.prepare("SELECT COUNT(*) AS count FROM scan_events WHERE code_id = ?").get(row.id) as { count: number }).count;
    const daily = db.prepare(`SELECT substr(scanned_at, 1, 10) AS date, COUNT(*) AS count FROM scan_events WHERE code_id = ? AND scanned_at >= ? GROUP BY date ORDER BY date`)
      .all(row.id, since.toISOString());
    const devices = db.prepare("SELECT device_type AS label, COUNT(*) AS count FROM scan_events WHERE code_id = ? AND scanned_at >= ? GROUP BY device_type ORDER BY count DESC")
      .all(row.id, since.toISOString());
    const referrers = db.prepare("SELECT COALESCE(referrer_host, '直接访问') AS label, COUNT(*) AS count FROM scan_events WHERE code_id = ? AND scanned_at >= ? GROUP BY referrer_host ORDER BY count DESC LIMIT 10")
      .all(row.id, since.toISOString());
    return { total, days, daily, devices, referrers };
  });
}
