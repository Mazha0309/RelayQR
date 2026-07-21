# RelayQR

RelayQR 是一个自托管的动态二维码管理平台。二维码本身只保存 RelayQR 的固定短链接；你可以在后台随时更换实际目标，无需重新印刷二维码。

由 [Mazha0309](https://github.com/Mazha0309) 创建并维护。

## 功能

- 多用户独立账号，用户名和密码登录，不依赖邮件服务。
- 每个账号可创建任意多个随机短码，短码删除后永不复用。
- 粘贴目标地址，或上传二维码图片：浏览器本地解析目标，原图默认保存到自托管服务器。
- 每个活码可独立开启 Fallback 选择页，让扫码者选择打开链接或长按识别已上传的二维码原图。
- 每个 Fallback 可开启入群条件：按允许的 IP 国家/省/城市筛选，并组合最多 10 道单选题或填空题；全部通过后才显示链接和二维码。
- 保存完整目标历史，可将旧目标恢复为新的当前版本。
- 每个活码独立控制是否允许跳转；暂停时必须填写面向扫码者的说明。
- 支持 HTTP(S)、微信链接和自定义 App 协议；拒绝可执行或本地危险协议。
- 二维码支持透明/纯色背景、顶部/底部文字、字体样式和可调大小的中心图标。
- 导出 1000 × 1000 PNG 或 SVG。
- 统计累计扫描、日期趋势、设备类别、来源域名和 IP 属地，并在后台查看最近 100 次访问的完整 IP 明细。
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
DOMAIN=qr.example.com
SESSION_SECRET=请替换为至少32字节的随机字符串
```

启动服务：

```bash
docker compose up -d --build
```

Compose 只启动 RelayQR，并将端口绑定到宿主机的 `127.0.0.1:3000`，外网无法直接绕过 HTTPS 访问。部署前必须把域名的 A/AAAA 记录解析到服务器，并在宿主机 Caddy 中加入：

```caddyfile
qr.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

将示例域名替换为 `.env` 中的 `DOMAIN`，然后执行 `sudo systemctl reload caddy`。服务器防火墙或云安全组需要放行 TCP 80 和 TCP 443。

业务数据保存在 `relayqr_data` 卷中。升级或迁移前应备份该数据卷；HTTPS 证书继续由宿主机现有 Caddy 管理。

建议通过 Caddy、Nginx 或其他反向代理提供 HTTPS。`PUBLIC_BASE_URL` 一旦用于印刷二维码，不应随意更换域名；服务器必须长期保留 `/r/:slug` 路由。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `DOMAIN` | `qr.example.com` | Docker HTTPS 部署使用的公网域名 |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | 生成固定二维码时使用的公网根地址 |
| `DATA_DIR` | `./data` | SQLite、图标与上传二维码原图的持久化目录 |
| `SESSION_SECRET` | 仅开发默认值 | 生产环境必填的会话密钥 |
| `SESSION_TTL_DAYS` | `30` | 登录有效天数 |
| `REGISTRATION_ENABLED` | `true` | 是否允许创建新账号 |
| `TRUST_PROXY` | `false` | 反向代理部署时设为 `true` |

## 跳转行为

- HTTP(S) 目标返回 `302`，并带有 `Cache-Control: no-store`，防止浏览器或 CDN 缓存旧目标。
- 启用 Fallback 且已上传二维码原图时返回选择页，由扫码者选择打开链接或长按识别原图；关闭开关即恢复直接跳转。
- 启用入群条件时，服务端先校验 IP 属地，再校验全部题目；任一条件不通过都不会把目标链接或二维码图片返回给访客。
- 验证通过后签发与活码、访客 IP 和当前门禁配置绑定的 15 分钟 HttpOnly 凭证；直接猜测二维码图片地址会被拒绝。
- 自定义协议先返回即时打开页，再尝试唤起对应 App；浏览器或 App 内置浏览器仍可能阻止深链。
- 暂停状态返回说明页，不包含目标地址，也不会执行跳转；该次访问仍计入扫描统计。
- 删除状态永久返回 `410 Gone`，短码不会分配给其他活码。

微信群、支付码或其他第三方二维码能否最终使用，仍取决于对应平台的有效期、人数限制、风控和客户端协议。RelayQR 负责更换入口目标，不会绕过第三方平台规则。

## 安全说明

- 密码通过 Node.js `scrypt` 加盐哈希。
- 会话使用随机令牌和 HttpOnly、SameSite Cookie；数据库只保存令牌哈希。
- 登录与注册接口有独立速率限制，所有接口均有全局速率限制。
- 图标限制为 1.5 MB、二维码原图限制为 8 MB；均仅支持 PNG、JPEG 或 WebP，并校验文件签名。
- 扫描统计保存时间、完整 IP、离线解析属地、设备类别和来源域名，不保存完整 User-Agent。IP 地址属于个人信息，部署者应依法告知访客、限制后台访问并制定删除/保留策略。
- IP 属地使用内置 [ip2region](https://github.com/lionsoul2014/ip2region) IPv4 离线数据解析，不会把访客 IP 发给外部定位接口。代理、VPN、移动网络和数据更新频率均可能影响准确性；无法解析的属地在开启筛选时按不通过处理。

## License

[MIT](LICENSE) © 2026 [Mazha0309](https://github.com/Mazha0309)
