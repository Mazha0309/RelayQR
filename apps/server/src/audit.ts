import type { FastifyInstance } from "fastify";
import type { RelayDatabase } from "./database.js";

interface AuditDefinition {
  action: string;
  resourceType: "code" | "account" | "user";
}

const definitions: Record<string, AuditDefinition> = {
  "POST /api/codes": { action: "创建活码", resourceType: "code" },
  "PATCH /api/codes/:id": { action: "修改活码名称或样式", resourceType: "code" },
  "PUT /api/codes/:id/target": { action: "更新目标地址", resourceType: "code" },
  "PUT /api/codes/:id/redirect-state": { action: "修改跳转状态", resourceType: "code" },
  "POST /api/codes/:id/history/:revisionId/restore": { action: "恢复历史目标", resourceType: "code" },
  "DELETE /api/codes/:id": { action: "删除活码", resourceType: "code" },
  "POST /api/codes/:id/icon": { action: "上传中心图标", resourceType: "code" },
  "DELETE /api/codes/:id/icon": { action: "删除中心图标", resourceType: "code" },
  "POST /api/codes/:id/source-qr": { action: "上传二维码原图", resourceType: "code" },
  "DELETE /api/codes/:id/source-qr": { action: "删除二维码原图", resourceType: "code" },
  "PUT /api/codes/:id/fallback-state": { action: "修改 Fallback 设置", resourceType: "code" },
  "PUT /api/codes/:id/gate": { action: "修改访问条件", resourceType: "code" },
  "PATCH /api/auth/password": { action: "修改账号密码", resourceType: "account" },
};

function requestIp(ip: string) {
  return (ip.startsWith("::ffff:") ? ip.slice(7) : ip).slice(0, 64);
}

export function recordAudit(
  db: RelayDatabase,
  event: {
    actorUserId: string;
    actorUsername: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    resourceName?: string | null;
    ipAddress?: string | null;
  },
) {
  db.prepare(`
    INSERT INTO audit_events (
      actor_user_id, actor_username, action, resource_type, resource_id, resource_name, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.actorUserId,
    event.actorUsername,
    event.action,
    event.resourceType,
    event.resourceId ?? null,
    event.resourceName ?? null,
    event.ipAddress ?? null,
    new Date().toISOString(),
  );
}

export function registerAuditLog(app: FastifyInstance, db: RelayDatabase) {
  app.addHook("onResponse", async (request, reply) => {
    if (!request.currentUser || reply.statusCode >= 400) return;
    const route = request.routeOptions.url;
    const definition = definitions[`${request.method} ${route}`];
    if (!definition) return;

    const params = request.params as { id?: string };
    let resourceId = definition.resourceType === "account" ? request.currentUser.id : params.id ?? null;
    let resourceName: string | null = definition.resourceType === "account" ? request.currentUser.username : null;
    if (route === "/api/codes" && request.method === "POST") {
      const created = db.prepare("SELECT id, name FROM codes WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
        .get(request.currentUser.id) as { id: string; name: string } | undefined;
      resourceId = created?.id ?? null;
      resourceName = created?.name ?? null;
    }
    if (definition.resourceType === "code" && resourceId) {
      resourceName ??= (db.prepare("SELECT name FROM codes WHERE id = ?").get(resourceId) as { name: string } | undefined)?.name ?? null;
    }
    recordAudit(db, {
      actorUserId: request.currentUser.id,
      actorUsername: request.currentUser.username,
      action: definition.action,
      resourceType: definition.resourceType,
      resourceId,
      resourceName,
      ipAddress: requestIp(request.ip),
    });
  });
}
