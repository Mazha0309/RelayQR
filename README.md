# RelayQR

RelayQR 是一个自托管的动态二维码管理平台。二维码本身只保存 RelayQR 的固定短链接；你可以在后台随时更换实际目标，无需重新印刷二维码。

## 功能

- 多用户独立账号，用户名和密码登录，不依赖邮件服务。
- 每个账号可创建任意多个随机短码，短码删除后永不复用。
- 粘贴目标地址，或在浏览器本地识别二维码图片中的目标。
- 保存完整目标历史，可将旧目标恢复为新的当前版本。
- 每个活码独立控制是否允许跳转；暂停时必须填写面向扫码者的说明。
- 支持 HTTP(S)、微信链接和自定义 App 协议；拒绝可执行或本地危险协议。
- 二维码支持透明/纯色背景、顶部/底部文字、字体样式和可调大小的中心图标。
- 导出 1000 × 1000 PNG 或 SVG。
- 统计累计扫描、日期趋势、设备类别和来源域名，不保存 IP。
- SQLite 单文件数据与 Docker 自托管。

## 本地开发

要求 Node.js 22 或更高版本。

```bash
cp .env.example .env
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。Vite 会把 `/api` 和 `/r` 请求代理到 `http://localhost:3000`。

常用命令：

```bash
npm run typecheck
npm test
npm run build
npm start
```

生产构建后，Fastify 会从同一个端口提供前端、API 和公开短链接。

## Docker 部署

本机需要 Docker 与 Docker Compose。复制环境文件并至少修改以下两项：

```bash
cp .env.example .env
```

```dotenv
PUBLIC_BASE_URL=https://qr.example.com
SESSION_SECRET=请替换为至少32字节的随机字符串
```

启动服务：

```bash
docker compose up -d --build
```

数据保存在 `relayqr_data` 卷的 `/data` 中，其中包含 SQLite 数据库和用户上传的图标。升级或迁移前应同时备份整个数据卷。

建议通过 Caddy、Nginx 或其他反向代理提供 HTTPS。`PUBLIC_BASE_URL` 一旦用于印刷二维码，不应随意更换域名；服务器必须长期保留 `/r/:slug` 路由。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | 生成固定二维码时使用的公网根地址 |
| `DATA_DIR` | `./data` | SQLite 与图标持久化目录 |
| `SESSION_SECRET` | 仅开发默认值 | 生产环境必填的会话密钥 |
| `SESSION_TTL_DAYS` | `30` | 登录有效天数 |
| `REGISTRATION_ENABLED` | `true` | 是否允许创建新账号 |
| `TRUST_PROXY` | `false` | 反向代理部署时设为 `true` |

## 跳转行为

- HTTP(S) 目标返回 `302`，并带有 `Cache-Control: no-store`，防止浏览器或 CDN 缓存旧目标。
- 自定义协议先返回即时打开页，再尝试唤起对应 App；浏览器或 App 内置浏览器仍可能阻止深链。
- 暂停状态返回说明页，不包含目标地址，也不会执行跳转；该次访问仍计入扫描统计。
- 删除状态永久返回 `410 Gone`，短码不会分配给其他活码。

微信群、支付码或其他第三方二维码能否最终使用，仍取决于对应平台的有效期、人数限制、风控和客户端协议。RelayQR 负责更换入口目标，不会绕过第三方平台规则。

## 安全说明

- 密码通过 Node.js `scrypt` 加盐哈希。
- 会话使用随机令牌和 HttpOnly、SameSite Cookie；数据库只保存令牌哈希。
- 登录与注册接口有独立速率限制，所有接口均有全局速率限制。
- 图标限制为 1.5 MB 的 PNG、JPEG 或 WebP，并校验文件签名。
- 扫描统计只保存时间、设备类别和来源域名，不保存 IP 或完整 User-Agent。

## License

[MIT](LICENSE)
