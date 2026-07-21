import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import type { RelayDatabase } from "./database.js";
import type { CodeRow } from "./types.js";

function deviceType(userAgent: string) {
  if (/bot|crawler|spider|preview/i.test(userAgent)) return "机器人";
  if (/ipad|tablet|playbook|silk/i.test(userAgent)) return "平板";
  if (/mobile|iphone|ipod|android/i.test(userAgent)) return "手机";
  if (userAgent) return "桌面设备";
  return "未知设备";
}

function referrerHost(referrer: string | undefined) {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.slice(0, 255) || null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]!);
}

function page(title: string, body: string, script = "", nonce = "") {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · RelayQR</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f6f8;color:#17202a;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(100%,480px);background:#fff;border:1px solid #e4e8ec;border-radius:24px;padding:36px;box-shadow:0 18px 60px rgba(30,42,55,.09)}.mark{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;background:#eef1ff;color:#5865db;font-size:24px;font-weight:800;margin-bottom:24px}h1{font-size:24px;margin:0 0 12px;letter-spacing:-.02em}h2{font-size:17px;margin:0 0 8px}p{color:#66717d;line-height:1.7;margin:0 0 24px;overflow-wrap:anywhere}.reason{padding:14px 16px;background:#fff8e8;border:1px solid #f6dfaa;color:#765516;border-radius:12px}.button{display:block;text-align:center;padding:13px 18px;border-radius:12px;background:#17202a;color:#fff;text-decoration:none;font-weight:650}.divider{display:flex;align-items:center;gap:12px;margin:24px 0;color:#929ba5;font-size:12px}.divider:before,.divider:after{content:"";height:1px;background:#e5e9ed;flex:1}.fallback{padding:18px;border-radius:16px;background:#f7f8fa;border:1px solid #e5e9ed;text-align:center}.fallback p{font-size:13px;margin-bottom:14px}.fallback img{display:block;width:100%;max-height:560px;object-fit:contain;background:#fff;border:1px solid #dde2e7;border-radius:12px}.helper{font-size:12px;margin:12px 0 0!important;color:#8a949e!important}.foot{margin-top:24px;font-size:12px;color:#9aa3ad;text-align:center}
</style></head><body><main class="card">${body}<div class="foot">RelayQR · Created by Mazha0309</div></main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

export function registerRedirectRoute(app: FastifyInstance, db: RelayDatabase, config: AppConfig) {
  app.get<{ Params: { slug: string } }>("/r/:slug/source-qr", async (request, reply) => {
    const row = db.prepare("SELECT source_qr_path, fallback_enabled, redirect_enabled, deleted_at FROM codes WHERE slug = ?")
      .get(request.params.slug) as Pick<CodeRow, "source_qr_path" | "fallback_enabled" | "redirect_enabled" | "deleted_at"> | undefined;
    if (!row?.source_qr_path || !row.fallback_enabled || row.deleted_at || !row.redirect_enabled) return reply.code(404).send();
    const imagePath = path.join(config.dataDir, "source-qrs", path.basename(row.source_qr_path));
    if (!fs.existsSync(imagePath)) return reply.code(404).send();
    const mime = row.source_qr_path.endsWith(".png") ? "image/png" : row.source_qr_path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    reply.header("Content-Disposition", "inline").type(mime);
    return reply.send(fs.createReadStream(imagePath));
  });

  app.get<{ Params: { slug: string } }>("/r/:slug", async (request, reply) => {
    const row = db.prepare(`
      SELECT codes.*, target_revisions.target, target_revisions.protocol
      FROM codes LEFT JOIN target_revisions ON target_revisions.id = codes.active_revision_id
      WHERE codes.slug = ?
    `).get(request.params.slug) as CodeRow | undefined;

    reply.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    reply.header("Pragma", "no-cache");
    reply.header("Referrer-Policy", "no-referrer");

    if (!row) {
      return reply.code(404).type("text/html").send(page("活码不存在", `<div class="mark">?</div><h1>找不到这个活码</h1><p>请检查二维码是否完整，或联系二维码提供者。</p>`));
    }
    if (row.deleted_at) {
      return reply.code(410).type("text/html").send(page("活码已删除", `<div class="mark">×</div><h1>这个活码已失效</h1><p>该入口已被所有者永久删除，不会再指向其他内容。</p>`));
    }

    db.prepare("INSERT INTO scan_events (code_id, scanned_at, device_type, referrer_host) VALUES (?, ?, ?, ?)")
      .run(row.id, new Date().toISOString(), deviceType(request.headers["user-agent"] ?? ""), referrerHost(request.headers.referer));

    if (!row.redirect_enabled) {
      const reason = row.disabled_reason || "所有者暂时关闭了此二维码的跳转。";
      return reply.code(200).type("text/html").send(page(
        "跳转已暂停",
        `<div class="mark">Ⅱ</div><h1>${escapeHtml(row.name)}</h1><p>此二维码当前暂停跳转。</p><p class="reason">${escapeHtml(reason)}</p>`,
      ));
    }
    if (!row.target || !row.protocol) {
      return reply.code(503).type("text/html").send(page("目标未配置", `<div class="mark">!</div><h1>${escapeHtml(row.name)}</h1><p>所有者尚未为此二维码配置有效目标。</p>`));
    }

    if (row.source_qr_path && row.fallback_enabled) {
      const imageUrl = `/r/${encodeURIComponent(row.slug)}/source-qr?v=${encodeURIComponent(row.updated_at)}`;
      reply.header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      return reply.type("text/html").send(page(
        "选择入群方式",
        `<div class="mark">↗</div><h1>${escapeHtml(row.name)}</h1><p>请选择适合你的入群方式。微信限制链接入群时，请使用下方最新群二维码。</p><a class="button" href="${escapeHtml(row.target)}" rel="noreferrer">尝试打开群链接</a><div class="divider">备用方式</div><section class="fallback"><h2>长按识别群二维码</h2><p>此图片可由管理员随时更新，外部固定二维码无需更换。</p><img src="${imageUrl}" alt="${escapeHtml(row.name)}的最新群二维码"><p class="helper">长按无反应时，请保存图片后从微信“扫一扫 → 相册”识别。</p></section>`,
      ));
    }

    if (row.protocol === "http" || row.protocol === "https") {
      return reply.code(302).header("Location", row.target).send();
    }

    const nonce = randomBytes(16).toString("base64");
    const safeTargetJson = JSON.stringify(row.target).replace(/[<>&]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    reply.header("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`);
    return reply.type("text/html").send(page(
      "正在打开",
      `<div class="mark">→</div><h1>正在打开目标应用</h1><p>如果没有自动打开，可能是当前浏览器阻止了应用跳转，请点击下面的按钮。</p><a class="button" href="${escapeHtml(row.target)}">立即打开</a>`,
      `window.location.href=${safeTargetJson};`,
      nonce,
    ));
  });
}
