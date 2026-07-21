import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
if (process.env.NODE_ENV === "production" && (
  config.sessionSecret === "development-only-secret-change-me-now"
  || config.sessionSecret.startsWith("replace-with-")
  || config.sessionSecret.length < 32
)) {
  throw new Error("生产环境必须设置至少 32 个字符的随机 SESSION_SECRET");
}

const app = await buildApp(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
