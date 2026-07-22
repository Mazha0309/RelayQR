import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "./config.js";
import type { RelayDatabase } from "./database.js";
import { parseGateConfig, type GateConfig } from "./gate.js";
import { locateIp, locationAllowed, normalizeIp, type IpLocation } from "./ip-location.js";
import type { CodeRow } from "./types.js";

const gateCookie = "relayqr_gate";
const gateTtlSeconds = 15 * 60;

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
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f6f8;color:#17202a;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(100%,480px);background:#fff;border:1px solid #e4e8ec;border-radius:24px;padding:36px;box-shadow:0 18px 60px rgba(30,42,55,.09)}.mark{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;background:#eef1ff;color:#5865db;font-size:24px;font-weight:800;margin-bottom:24px}h1{font-size:24px;margin:0 0 12px;letter-spacing:-.02em}h2{font-size:17px;margin:0 0 8px}p{color:#66717d;line-height:1.7;margin:0 0 24px;overflow-wrap:anywhere}.reason{padding:14px 16px;background:#fff8e8;border:1px solid #f6dfaa;color:#765516;border-radius:12px}.button{display:block;width:100%;border:0;text-align:center;padding:13px 18px;border-radius:12px;background:#17202a;color:#fff;text-decoration:none;font:inherit;font-weight:650;cursor:pointer}.divider{display:flex;align-items:center;gap:12px;margin:24px 0;color:#929ba5;font-size:12px}.divider:before,.divider:after{content:"";height:1px;background:#e5e9ed;flex:1}.fallback{padding:18px;border-radius:16px;background:#f7f8fa;border:1px solid #e5e9ed;text-align:center}.fallback p{font-size:13px;margin-bottom:14px}.fallback img{display:block;width:100%;max-height:560px;object-fit:contain;background:#fff;border:1px solid #dde2e7;border-radius:12px}.helper{font-size:12px;margin:12px 0 0!important;color:#8a949e!important}.foot{margin-top:24px;font-size:12px;color:#9aa3ad;text-align:center}.gate-form{display:grid;gap:20px}.question{display:grid;gap:10px;border:0;padding:0;margin:0}.question legend,.question-title{font-weight:700;line-height:1.5;padding:0}.option{display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border:1px solid #dfe4e8;border-radius:11px;color:#4c5762;font-size:14px}.option input{margin-top:3px;accent-color:#5865db}.answer{width:100%;border:1px solid #d7dde2;border-radius:11px;padding:12px;font:inherit;outline:none}.answer:focus{border-color:#7d87df;box-shadow:0 0 0 3px rgba(88,101,219,.1)}.gate-error{padding:12px 14px;border-radius:11px;background:#fff0f0;color:#a6323b;font-size:13px;line-height:1.5}.privacy{margin:0;font-size:12px;color:#929ba5}
</style></head><body><main class="card">${body}<div class="foot">RelayQR · Created by Mazha0309</div></main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

function codeBySlug(db: RelayDatabase, slug: string) {
  return db.prepare(`
    SELECT codes.*, target_revisions.target, target_revisions.protocol
    FROM codes LEFT JOIN target_revisions ON target_revisions.id = codes.active_revision_id
    WHERE codes.slug = ?
  `).get(slug) as CodeRow | undefined;
}

function gateToken(row: CodeRow, ip: string, secret: string) {
  const payload = Buffer.from(JSON.stringify({ codeId: row.id, ip: normalizeIp(ip), revision: gateRevision(row), exp: Date.now() + gateTtlSeconds * 1000 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function gateRevision(row: CodeRow) {
  return createHash("sha256").update(JSON.stringify({
    gateEnabled: row.gate_enabled,
    gateConfig: row.gate_config_json,
    sourceQr: row.source_qr_path,
    target: row.target,
    redirectEnabled: row.redirect_enabled,
  })).digest("base64url");
}

function validGateToken(token: string | undefined, row: CodeRow, ip: string, secret: string) {
  if (!token) return false;
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return false;
    const expected = createHmac("sha256", secret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { codeId?: string; ip?: string; revision?: string; exp?: number };
    return parsed.codeId === row.id
      && parsed.ip === normalizeIp(ip)
      && parsed.revision === gateRevision(row)
      && typeof parsed.exp === "number"
      && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

function setGateCookie(reply: FastifyReply, row: CodeRow, ip: string, config: AppConfig) {
  reply.setCookie(gateCookie, gateToken(row, ip, config.sessionSecret), {
    path: `/r/${row.slug}`,
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicBaseUrl.startsWith("https://"),
    maxAge: gateTtlSeconds,
  });
}

function choicePage(row: CodeRow) {
  const imageUrl = `/r/${encodeURIComponent(row.slug)}/source-qr?v=${encodeURIComponent(row.updated_at)}`;
  const showLink = Boolean(row.fallback_show_link);
  const linkSection = showLink
    ? `<a class="button" href="${escapeHtml(row.target!)}" rel="noreferrer">打开目标链接</a><div class="divider">二维码方式</div>`
    : "";
  return page(
    showLink ? "选择访问方式" : "查看二维码",
    `<div class="mark">↗</div><h1>${escapeHtml(row.name)}</h1><p>${showLink ? "请选择适合你的访问方式；如果当前应用限制链接打开，请使用下方最新二维码。" : "请使用下方最新二维码继续访问。"}</p>${linkSection}<section class="fallback"><h2>长按识别二维码</h2><p>此图片可由管理员随时更新，外部固定二维码无需更换。</p><img src="${imageUrl}" alt="${escapeHtml(row.name)}的最新二维码"><p class="helper">长按无反应时，请保存图片后从对应应用的“扫一扫 → 相册”识别。</p></section>`,
  );
}

function gateForm(row: CodeRow, gate: GateConfig, error = "") {
  const questions = gate.questions.map((question, index) => {
    const title = `<legend>${index + 1}. ${escapeHtml(question.prompt)}</legend>`;
    if (question.type === "choice") {
      const options = question.options.map((option, optionIndex) => `<label class="option"><input type="radio" name="q_${question.id}" value="${optionIndex}" required><span>${escapeHtml(option)}</span></label>`).join("");
      return `<fieldset class="question">${title}${options}</fieldset>`;
    }
    return `<label class="question"><span class="question-title">${index + 1}. ${escapeHtml(question.prompt)}</span><input class="answer" type="text" name="q_${question.id}" maxlength="200" autocomplete="off" required placeholder="请输入答案"></label>`;
  }).join("");
  return page(
    "验证访问条件",
    `<div class="mark">✓</div><h1>${escapeHtml(row.name)}</h1><p>请先回答以下问题。全部正确后才会显示目标内容。</p>${error ? `<div class="gate-error">${escapeHtml(error)}</div>` : ""}<form class="gate-form" method="post" action="/r/${encodeURIComponent(row.slug)}/verify">${questions}<button class="button" type="submit">提交验证</button><p class="privacy">为执行属地限制和安全统计，本次访问会记录 IP 地址及解析属地。</p></form>`,
  );
}

function locationPasses(gate: GateConfig, location: IpLocation) {
  return !gate.locationEnabled || locationAllowed(location.searchableParts, gate.allowedRegions);
}

function answersPass(gate: GateConfig, body: Record<string, unknown>) {
  return gate.questions.every((question) => {
    const answer = body[`q_${question.id}`];
    const value = Array.isArray(answer) ? answer[0] : answer;
    if (typeof value !== "string") return false;
    if (question.type === "choice") return Number(value) === question.correctOption && /^\d+$/.test(value);
    return value.trim().toLocaleLowerCase("zh-CN") === question.correctAnswer.trim().toLocaleLowerCase("zh-CN");
  });
}

function noCache(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  reply.header("Pragma", "no-cache");
  reply.header("Referrer-Policy", "no-referrer");
}

export function registerRedirectRoute(app: FastifyInstance, db: RelayDatabase, config: AppConfig) {
  app.get<{ Params: { slug: string } }>("/r/:slug/source-qr", async (request, reply) => {
    const row = codeBySlug(db, request.params.slug);
    if (!row?.source_qr_path || !row.fallback_enabled || row.deleted_at || !row.redirect_enabled) return reply.code(404).send();
    if (row.gate_enabled && !validGateToken(request.cookies[gateCookie], row, request.ip, config.sessionSecret)) {
      return reply.code(403).send();
    }
    const imagePath = path.join(config.dataDir, "source-qrs", path.basename(row.source_qr_path));
    if (!fs.existsSync(imagePath)) return reply.code(404).send();
    const mime = row.source_qr_path.endsWith(".png") ? "image/png" : row.source_qr_path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    reply.header("Content-Disposition", "inline").type(mime);
    return reply.send(fs.createReadStream(imagePath));
  });

  app.post<{ Params: { slug: string }; Body: Record<string, unknown> }>("/r/:slug/verify", {
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const row = codeBySlug(db, request.params.slug);
    noCache(reply);
    if (!row || row.deleted_at) return reply.code(404).type("text/html").send(page("活码不存在", `<div class="mark">?</div><h1>找不到这个活码</h1><p>请检查二维码是否完整，或联系二维码提供者。</p>`));
    if (!row.redirect_enabled || !row.source_qr_path || !row.fallback_enabled || !row.gate_enabled || !row.target) {
      return reply.code(403).type("text/html").send(page("无法验证", `<div class="mark">!</div><h1>当前无法访问</h1><p>该入口未开启访问验证或已暂停，请联系二维码提供者。</p>`));
    }
    const gate = parseGateConfig(row.gate_config_json);
    const location = await locateIp(request.ip);
    if (!locationPasses(gate, location)) {
      return reply.code(403).type("text/html").send(page("地区不符合条件", `<div class="mark">×</div><h1>暂时无法访问</h1><p>当前 IP 属地不符合此入口的访问条件，目标内容不会显示。</p>`));
    }
    if (!answersPass(gate, request.body ?? {})) {
      reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      return reply.code(403).type("text/html").send(gateForm(row, gate, "答案不正确，请检查后重试。"));
    }
    setGateCookie(reply, row, request.ip, config);
    reply.header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    return reply.type("text/html").send(choicePage(row));
  });

  app.get<{ Params: { slug: string } }>("/r/:slug", async (request, reply) => {
    const row = codeBySlug(db, request.params.slug);
    noCache(reply);

    if (!row) {
      return reply.code(404).type("text/html").send(page("活码不存在", `<div class="mark">?</div><h1>找不到这个活码</h1><p>请检查二维码是否完整，或联系二维码提供者。</p>`));
    }
    if (row.deleted_at) {
      return reply.code(410).type("text/html").send(page("活码已删除", `<div class="mark">×</div><h1>这个活码已失效</h1><p>该入口已被所有者永久删除，不会再指向其他内容。</p>`));
    }

    const location = await locateIp(request.ip);
    db.prepare("INSERT INTO scan_events (code_id, scanned_at, device_type, referrer_host, ip_address, ip_region) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, new Date().toISOString(), deviceType(request.headers["user-agent"] ?? ""), referrerHost(request.headers.referer), location.ip, location.label);

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
      if (row.gate_enabled) {
        const gate = parseGateConfig(row.gate_config_json);
        if (!locationPasses(gate, location)) {
          return reply.code(403).type("text/html").send(page("地区不符合条件", `<div class="mark">×</div><h1>暂时无法访问</h1><p>当前 IP 属地不符合此入口的访问条件，目标内容不会显示。</p>`));
        }
        if (!validGateToken(request.cookies[gateCookie], row, request.ip, config.sessionSecret)) {
          if (gate.questions.length > 0) {
            reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
            return reply.type("text/html").send(gateForm(row, gate));
          }
          setGateCookie(reply, row, request.ip, config);
        }
      }
      reply.header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      return reply.type("text/html").send(choicePage(row));
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
