import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

describe("RelayQR API", () => {
  let app: FastifyInstance;
  let dataDir: string;
  let cookie: string;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "relayqr-test-"));
    app = await buildApp({
      dataDir,
      webDistDir: path.join(dataDir, "missing-web"),
      publicBaseUrl: "http://relay.test",
      sessionSecret: "test-session-secret-with-enough-entropy",
      trustProxy: true,
    });
    await app.ready();
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "tester", password: "strong-password" },
    });
    expect(register.statusCode).toBe(201);
    cookie = register.headers["set-cookie"]!.split(";")[0]!;
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("requires authentication and isolates each user's codes", async () => {
    expect((await app.inject({ method: "GET", url: "/api/codes" })).statusCode).toBe(401);
    const second = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "second", password: "second-password" } });
    const secondCookie = second.headers["set-cookie"]!.split(";")[0]!;
    await createCode();
    const secondList = await app.inject({ method: "GET", url: "/api/codes", headers: { cookie: secondCookie } });
    expect(secondList.json().codes).toHaveLength(0);
  });

  it("rejects duplicate users and supports authenticated password changes", async () => {
    const duplicate = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "TESTER", password: "another-password" } });
    expect(duplicate.statusCode).toBe(409);
    const wrong = await app.inject({ method: "PATCH", url: "/api/auth/password", headers: { cookie }, payload: { currentPassword: "wrong-password", newPassword: "updated-password" } });
    expect(wrong.statusCode).toBe(400);
    const changed = await app.inject({ method: "PATCH", url: "/api/auth/password", headers: { cookie }, payload: { currentPassword: "strong-password", newPassword: "updated-password" } });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "tester", password: "strong-password" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "tester", password: "updated-password" } })).statusCode).toBe(200);
  });

  it("restricts the admin console, records member changes, and safely manages admin roles", async () => {
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.json().user.isAdmin).toBe(true);

    const second = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "member", password: "member-password" } });
    expect(second.json().user.isAdmin).toBe(false);
    const memberId = second.json().user.id as string;
    const secondCookie = second.headers["set-cookie"]!.split(";")[0]!;
    expect((await app.inject({ method: "GET", url: "/api/admin/server", headers: { cookie: secondCookie } })).statusCode).toBe(403);

    const memberChange = await app.inject({
      method: "POST",
      url: "/api/codes",
      headers: { cookie: secondCookie },
      payload: { name: "Member code", target: "https://example.com/member" },
    });
    expect(memberChange.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/api/admin/codes", headers: { cookie: secondCookie } })).statusCode).toBe(403);
    const memberCodes = await app.inject({ method: "GET", url: `/api/admin/codes?userId=${memberId}`, headers: { cookie } });
    expect(memberCodes.statusCode).toBe(200);
    expect(memberCodes.json().codes).toEqual([
      expect.objectContaining({
        ownerUsername: "member",
        name: "Member code",
        target: "https://example.com/member",
        publicUrl: expect.stringContaining("/r/"),
      }),
    ]);
    const memberCodeId = memberChange.json().code.id as string;
    expect((await app.inject({ method: "GET", url: `/api/codes/${memberCodeId}`, headers: { cookie } })).statusCode).toBe(404);
    const wrongAdminPassword = await app.inject({
      method: "POST",
      url: `/api/admin/codes/${memberCodeId}/edit-session`,
      headers: { cookie },
      payload: { password: "wrong-password" },
    });
    expect(wrongAdminPassword.statusCode).toBe(401);
    const unlocked = await app.inject({
      method: "POST",
      url: `/api/admin/codes/${memberCodeId}/edit-session`,
      headers: { cookie },
      payload: { password: "strong-password" },
    });
    expect(unlocked.statusCode).toBe(200);
    expect(unlocked.json().expiresAt).toEqual(expect.any(String));
    const adminUpdate = await app.inject({
      method: "PUT",
      url: `/api/codes/${memberCodeId}/target`,
      headers: { cookie },
      payload: { target: "https://example.com/admin-updated" },
    });
    expect(adminUpdate.statusCode).toBe(200);
    expect(adminUpdate.json().code.target).toBe("https://example.com/admin-updated");
    expect((await app.inject({ method: "DELETE", url: `/api/codes/${memberCodeId}`, headers: { cookie } })).statusCode).toBe(403);
    const memberReadsUpdate = await app.inject({ method: "GET", url: `/api/codes/${memberCodeId}`, headers: { cookie: secondCookie } });
    expect(memberReadsUpdate.json().code.target).toBe("https://example.com/admin-updated");
    expect((await app.inject({ method: "DELETE", url: "/api/admin/codes/edit-session", headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/codes/${memberCodeId}`, headers: { cookie } })).statusCode).toBe(404);

    const audit = await app.inject({ method: "GET", url: `/api/admin/audit?userId=${memberId}`, headers: { cookie } });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().events).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorUsername: "member", action: "创建活码", resourceName: "Member code" }),
      expect.objectContaining({ actorUsername: "tester", action: "更新目标地址", resourceName: "Member code" }),
      expect.objectContaining({ actorUsername: "tester", action: expect.stringContaining("解锁编辑"), resourceName: "Member code" }),
    ]));

    const server = await app.inject({ method: "GET", url: "/api/admin/server", headers: { cookie } });
    expect(server.statusCode).toBe(200);
    expect(server.json()).toMatchObject({ counts: { users: 2, admins: 1 }, requests: { totalRequests: expect.any(Number) } });

    const registrationOff = await app.inject({
      method: "PUT",
      url: "/api/admin/settings/registration",
      headers: { cookie },
      payload: { enabled: false },
    });
    expect(registrationOff.json().registrationEnabled).toBe(false);
    expect((await app.inject({ method: "GET", url: "/api/auth/config" })).json().registrationEnabled).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "blocked", password: "blocked-password" } })).statusCode).toBe(403);
    const registrationOn = await app.inject({
      method: "PUT",
      url: "/api/admin/settings/registration",
      headers: { cookie },
      payload: { enabled: true },
    });
    expect(registrationOn.json().registrationEnabled).toBe(true);

    const promoted = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${memberId}/admin`,
      headers: { cookie },
      payload: { isAdmin: true },
    });
    expect(promoted.json().user.isAdmin).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: secondCookie } })).statusCode).toBe(200);

    const demoted = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${memberId}/admin`,
      headers: { cookie },
      payload: { isAdmin: false },
    });
    expect(demoted.json().user.isAdmin).toBe(false);
    const lastAdminRejected = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${me.json().user.id}/admin`,
      headers: { cookie },
      payload: { isAdmin: false },
    });
    expect(lastAdminRejected.statusCode).toBe(400);
    expect(lastAdminRejected.json().error).toContain("最后一个管理员");
  });

  it("updates targets, keeps history, redirects without caching, and restores revisions", async () => {
    const code = await createCode();
    const firstRedirect = await app.inject({ method: "GET", url: `/r/${code.slug}`, headers: { "user-agent": "Mozilla/5.0 iPhone" } });
    expect(firstRedirect.statusCode).toBe(302);
    expect(firstRedirect.headers.location).toBe("https://example.com/first");
    expect(firstRedirect.headers["cache-control"]).toContain("no-store");

    const update = await app.inject({ method: "PUT", url: `/api/codes/${code.id}/target`, headers: { cookie }, payload: { target: "weixin://qr/group/new" } });
    expect(update.statusCode).toBe(200);
    const customRedirect = await app.inject({ method: "GET", url: `/r/${code.slug}` });
    expect(customRedirect.statusCode).toBe(200);
    expect(customRedirect.body).toContain("正在打开目标应用");

    const history = await app.inject({ method: "GET", url: `/api/codes/${code.id}/history`, headers: { cookie } });
    expect(history.json().revisions).toHaveLength(2);
    const oldRevision = history.json().revisions.find((revision: { target: string }) => revision.target.includes("example.com"));
    const restore = await app.inject({ method: "POST", url: `/api/codes/${code.id}/history/${oldRevision.id}/restore`, headers: { cookie } });
    expect(restore.json().code.target).toBe("https://example.com/first");
    expect((await app.inject({ method: "GET", url: `/api/codes/${code.id}/history`, headers: { cookie } })).json().revisions).toHaveLength(3);
  });

  it("requires a reason when pausing and shows it without redirecting", async () => {
    const code = await createCode();
    const rejected = await app.inject({ method: "PUT", url: `/api/codes/${code.id}/redirect-state`, headers: { cookie }, payload: { enabled: false, reason: "" } });
    expect(rejected.statusCode).toBe(400);

    const paused = await app.inject({ method: "PUT", url: `/api/codes/${code.id}/redirect-state`, headers: { cookie }, payload: { enabled: false, reason: "活动维护中" } });
    expect(paused.json().code.redirectEnabled).toBe(false);
    const publicPage = await app.inject({ method: "GET", url: `/r/${code.slug}`, headers: { "user-agent": "Mozilla/5.0 Android" } });
    expect(publicPage.statusCode).toBe(200);
    expect(publicPage.body).toContain("活动维护中");
    expect(publicPage.headers.location).toBeUndefined();

    const stats = await app.inject({ method: "GET", url: `/api/codes/${code.id}/stats`, headers: { cookie } });
    expect(stats.json().total).toBe(1);
    expect(stats.json().devices).toEqual([{ label: "手机", count: 1 }]);

    const resumed = await app.inject({ method: "PUT", url: `/api/codes/${code.id}/redirect-state`, headers: { cookie }, payload: { enabled: true } });
    expect(resumed.json().code.redirectEnabled).toBe(true);
    expect((await app.inject({ method: "GET", url: `/r/${code.slug}` })).statusCode).toBe(302);
  });

  it("stores an uploaded QR source and lets the owner toggle the fallback choice page", async () => {
    const code = await createCode();
    const rejected = await app.inject({ method: "PUT", url: `/api/codes/${code.id}/fallback-state`, headers: { cookie }, payload: { enabled: true } });
    expect(rejected.statusCode).toBe(400);

    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const multipart = imageUpload(image);
    const target = "https://weixin.qq.com/g/example-group";
    const upload = await app.inject({
      method: "POST",
      url: `/api/codes/${code.id}/source-qr?target=${encodeURIComponent(target)}`,
      headers: { cookie, "content-type": multipart.contentType },
      payload: multipart.body,
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json().code).toMatchObject({ target, hasSourceQr: true, fallbackEnabled: false, showTargetLink: true });

    const direct = await app.inject({ method: "GET", url: `/r/${code.slug}` });
    expect(direct.statusCode).toBe(302);
    expect(direct.headers.location).toBe(target);

    const enabled = await app.inject({ method: "PUT", url: `/api/codes/${code.id}/fallback-state`, headers: { cookie }, payload: { enabled: true } });
    expect(enabled.json().code.fallbackEnabled).toBe(true);
    const choicePage = await app.inject({ method: "GET", url: `/r/${code.slug}` });
    expect(choicePage.statusCode).toBe(200);
    expect(choicePage.headers.location).toBeUndefined();
    expect(choicePage.headers["content-security-policy"]).toContain("img-src 'self'");
    expect(choicePage.body).toContain("打开目标链接");
    expect(choicePage.body).toContain("长按识别二维码");
    expect(choicePage.body).toContain(`/r/${code.slug}/source-qr`);

    const imageOnlyState = await app.inject({ method: "PUT", url: `/api/codes/${code.id}/fallback-state`, headers: { cookie }, payload: { enabled: true, showTargetLink: false } });
    expect(imageOnlyState.json().code.showTargetLink).toBe(false);
    const imageOnlyPage = await app.inject({ method: "GET", url: `/r/${code.slug}` });
    expect(imageOnlyPage.statusCode).toBe(200);
    expect(imageOnlyPage.body).toContain("长按识别二维码");
    expect(imageOnlyPage.body).not.toContain("打开目标链接");
    expect(imageOnlyPage.body).not.toContain(target);

    const disabled = await app.inject({ method: "PUT", url: `/api/codes/${code.id}/fallback-state`, headers: { cookie }, payload: { enabled: false } });
    expect(disabled.json().code.fallbackEnabled).toBe(false);
    expect((await app.inject({ method: "GET", url: `/r/${code.slug}` })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: `/r/${code.slug}/source-qr` })).statusCode).toBe(404);
    await app.inject({ method: "PUT", url: `/api/codes/${code.id}/fallback-state`, headers: { cookie }, payload: { enabled: true } });

    const publicImage = await app.inject({ method: "GET", url: `/r/${code.slug}/source-qr` });
    expect(publicImage.statusCode).toBe(200);
    expect(publicImage.headers["content-type"]).toContain("image/png");
    expect(publicImage.rawPayload.equals(image)).toBe(true);

    const removed = await app.inject({ method: "DELETE", url: `/api/codes/${code.id}/source-qr`, headers: { cookie } });
    expect(removed.json().code).toMatchObject({ hasSourceQr: false, fallbackEnabled: false });
    expect((await app.inject({ method: "GET", url: `/r/${code.slug}` })).statusCode).toBe(302);
    expect((await app.inject({ method: "GET", url: `/r/${code.slug}/source-qr` })).statusCode).toBe(404);
  });

  it("gates the link and source image by IP location, choice questions, and text answers", async () => {
    const code = await createCode();
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const multipart = imageUpload(image);
    const target = "https://weixin.qq.com/g/protected-group";
    await app.inject({
      method: "POST",
      url: `/api/codes/${code.id}/source-qr?target=${encodeURIComponent(target)}`,
      headers: { cookie, "content-type": multipart.contentType },
      payload: multipart.body,
    });
    await app.inject({ method: "PUT", url: `/api/codes/${code.id}/fallback-state`, headers: { cookie }, payload: { enabled: true } });

    const gate = await app.inject({
      method: "PUT",
      url: `/api/codes/${code.id}/gate`,
      headers: { cookie },
      payload: {
        enabled: true,
        locationEnabled: true,
        allowedRegions: ["江苏省"],
        questions: [
          { id: "choice1", type: "choice", prompt: "请选择正确数字", options: ["一", "二", "三"], correctOption: 1 },
          { id: "text1", type: "text", prompt: "请输入口令", correctAnswer: "RelayQR" },
        ],
      },
    });
    expect(gate.statusCode).toBe(200);
    expect(gate.json().code.gate).toMatchObject({ enabled: true, locationEnabled: true, allowedRegions: ["江苏省"] });

    const visitorHeaders = { "x-forwarded-for": "218.4.167.70" };
    const form = await app.inject({ method: "GET", url: `/r/${code.slug}`, headers: visitorHeaders });
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain("请选择正确数字");
    expect(form.body).toContain("请输入口令");
    expect(form.body).not.toContain(target);
    expect((await app.inject({ method: "GET", url: `/r/${code.slug}/source-qr`, headers: visitorHeaders })).statusCode).toBe(403);

    const wrong = await app.inject({
      method: "POST",
      url: `/r/${code.slug}/verify`,
      headers: { ...visitorHeaders, "content-type": "application/x-www-form-urlencoded" },
      payload: "q_choice1=0&q_text1=RelayQR",
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.body).toContain("答案不正确");
    expect(wrong.body).not.toContain(target);

    const passed = await app.inject({
      method: "POST",
      url: `/r/${code.slug}/verify`,
      headers: { ...visitorHeaders, "content-type": "application/x-www-form-urlencoded" },
      payload: "q_choice1=1&q_text1=relayqr%20",
    });
    expect(passed.statusCode).toBe(200);
    expect(passed.body).toContain(target);
    const gateCookie = passed.headers["set-cookie"]!.split(";")[0]!;
    const source = await app.inject({ method: "GET", url: `/r/${code.slug}/source-qr`, headers: { ...visitorHeaders, cookie: gateCookie } });
    expect(source.statusCode).toBe(200);
    expect(source.rawPayload.equals(image)).toBe(true);

    const deniedRegion = await app.inject({ method: "GET", url: `/r/${code.slug}`, headers: { "x-forwarded-for": "8.8.8.8" } });
    expect(deniedRegion.statusCode).toBe(403);
    expect(deniedRegion.body).not.toContain(target);

    const stats = await app.inject({ method: "GET", url: `/api/codes/${code.id}/stats`, headers: { cookie } });
    expect(stats.json().recentScans[0]).toMatchObject({ ipAddress: "8.8.8.8" });
    expect(stats.json().recentScans.some((scan: { ipAddress: string; region: string }) => scan.ipAddress === "218.4.167.70" && scan.region.includes("江苏省"))).toBe(true);
  });

  it("rejects dangerous targets and never reuses a deleted route", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/codes", headers: { cookie }, payload: { name: "Bad", target: "data:text/html,hello" } });
    expect(bad.statusCode).toBe(400);
    const code = await createCode();
    expect((await app.inject({ method: "DELETE", url: `/api/codes/${code.id}`, headers: { cookie } })).statusCode).toBe(204);
    const deleted = await app.inject({ method: "GET", url: `/r/${code.slug}` });
    expect(deleted.statusCode).toBe(410);
    expect(deleted.body).toContain("永久删除");
  });

  async function createCode() {
    const response = await app.inject({
      method: "POST",
      url: "/api/codes",
      headers: { cookie },
      payload: { name: "Example", target: "https://example.com/first" },
    });
    expect(response.statusCode).toBe(201);
    return response.json().code as { id: string; slug: string };
  }

  function imageUpload(image: Buffer) {
    const boundary = "----relayqr-test-boundary";
    return {
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sourceQr"; filename="group.png"\r\nContent-Type: image/png\r\n\r\n`),
        image,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    };
  }
});
