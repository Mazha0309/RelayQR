import fs from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { registerAuth } from "./auth.js";
import { registerCodeRoutes } from "./codes.js";
import { registerRedirectRoute } from "./redirect.js";

export async function buildApp(overrides: Partial<AppConfig> = {}) {
  const config = loadConfig(overrides);
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: config.trustProxy,
    bodyLimit: 9_000_000,
  });
  const db = openDatabase(config.dataDir);

  await app.register(cookie);
  await app.register(multipart, { limits: { files: 1, fileSize: 8_000_000 } });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
  });

  registerAuth(app, db, config);
  registerCodeRoutes(app, db, config);
  registerRedirectRoute(app, db, config);

  app.get("/api/health", async () => ({ status: "ok" }));

  if (fs.existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, { root: config.webDistDir, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "接口不存在" });
    if (fs.existsSync(config.webDistDir)) return reply.type("text/html").sendFile("index.html");
    return reply.code(404).send({ error: "页面不存在；开发环境请启动 Vite" });
  });

  app.addHook("onClose", async () => db.close());
  return app;
}
