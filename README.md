# 简聊·iM（Cloudflare Worker）

本仓库为 **Cloudflare Workers + KV + R2** 的轻量化分发与 Bot 控制面板。

## 功能概览

- **多域名入口**：`jianliao.store`（主站/入口）、`api.jianliao.store`（Telegram Webhook）、`zhhg.online`（分发域）、若干固定安卓子域（抗封/分流）。
- **一次性下载链接**：Bot 生成 `https://zhhg.online/dl/<token>.apk`，Token KV 存储，按日有效（到北京时间 23:59）。
- **下载落地**：`/p` 生成一次性 Token 并跳转到 `/dl/<token>.apk`（带指纹冷却，支持可选 Turnstile）。
- **APK 托管**：APK 存 R2；Worker 侧最终 **302 到 R2 自定义域**（降低 Worker CPU/带宽消耗）。
- **统计与战报**：按天汇总（城市/来源 ref 等），每日定时群内推送。
- **二维码海报**：`/qrsvg`、`/qrpng` 生成海报；Bot 支持 `/qr` 把被回复消息生成二维码图。

## 快速开始（本地）

### 依赖

- Node.js **v20 LTS**
- npm

### 安装与构建

```bash
npm ci
npm run build
```

> 产物为 `dist/worker.js`（若你当前仍以 `index.js` 直接部署，也可仅作为构建验证）。

## 部署（Cloudflare）

仓库使用 `wrangler.jsonc` 管理环境：

- `staging`: `yuminglunxun-staging`
- `production`: `yuminglunxun`

常用命令：

```bash
npx wrangler deploy --env production
```

## 文档

- 开发与运维完整手册见 `docs/DEV_MANUAL.md`

