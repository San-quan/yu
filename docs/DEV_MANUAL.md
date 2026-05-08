# 简聊·iM 开发文档手册（Worker / Bot / 分发）

本手册以**可复制执行**为目标，覆盖：本地开发、构建、部署、变量/密钥、域名与路由、Bot 指令、APK 上传、二维码海报、统计与战报、排障与运维清单。

> 约定：本文提到的“生产环境”均对应 `wrangler.jsonc` 的 `env.production`。

---

## 1. 架构总览

### 1.1 组件

- **Cloudflare Worker**：核心路由与业务逻辑（`index.js`）
- **KV（绑定：`DB`）**：一次性 Token、冷却、统计、公开下载链接等
- **R2（绑定：`DB_BUCKET`，bucket：`apk`）**：APK 对象存储
- **自定义域**：
  - `jianliao.store`：主站（H5 首页、`/p`、`/qrpng` 等）
  - `api.jianliao.store`：Telegram webhook 入口（仅此域允许 POST `/webhook`）
  - `zhhg.online`：对外分发域（下载链接域名）
  - `dl.jianliao.store` / `dl.zhhg.online`：R2 自定义域（用于最终文件直出）
  - 若干固定安卓子域：用于入口/分流（写死 allowlist）

### 1.2 数据流（关键路径）

#### A) Bot 生成一次性下载链接

1. 群里执行 `/get 10` 或点菜单按钮 `get_10`
2. Worker 生成 token：`DL_TOKEN_<token>` 写 KV（TTL 到北京时间 23:59）
3. Bot 逐条输出纯链接：`https://zhhg.online/dl/<token>.apk`

#### B) 访问下载链接

1. 用户打开 `GET /dl/<token>.apk`
2. Worker 校验 token、统计、冷却（KV）
3. Worker 最终 `302` 重定向到 R2 自定义域（如 `https://dl.zhhg.online/latest.apk`）

#### C) `/p` 落地入口

1. `GET /p`（仅移动端 UA）
2. 可选 Turnstile（配置了 `TURNSTILE_SITEKEY` + `TURNSTILE_SECRET` 才启用）
3. 指纹冷却 60s（KV）
4. 生成 token 并跳转到 `/dl/<token>.apk`（GET 返回 HTML meta refresh，HEAD 返回 302）

---

## 2. 仓库结构

- `index.js`：Worker 主逻辑（路由 + Bot + 统计 + 海报）
- `wrangler.jsonc`：Wrangler 环境配置（staging/production、KV/R2、routes、crons、logs/traces）
- `package.json`、`webpack.config.js`：构建链路（webpack 输出到 `dist/worker.js`）
- `docs/DEV_MANUAL.md`：本文档

---

## 3. 本地开发与构建

### 3.1 环境要求

- Node.js：**v20 LTS（建议）**
- npm：与 Node 自带版本一致即可

### 3.2 安装依赖

```bash
npm ci
```

### 3.3 构建

```bash
npm run build
```

产物：

- `dist/worker.js`

> 如果你当前线上直接部署 `index.js`，也建议保留构建作为“可重复验证链路”。

---

## 4. Wrangler 配置与部署

### 4.1 环境划分

`wrangler.jsonc` 内包含：

- `env.staging`
  - `name`: `yuminglunxun-staging`
  - `vars.ROOT_DOMAINS`: `zhhg.online,jianliao.store,jianliao.online`
- `env.production`
  - `name`: `yuminglunxun`
  - `routes`: 明确列出自定义域（custom_domain）
  - `observability.logs/traces`: enabled
  - `crons`: `59 15 * * *`（北京时间 23:59）

### 4.2 部署命令

```bash
npx wrangler deploy --env production
```

### 4.3 部署后健康检查

```bash
curl -fsS "https://jianliao.store/health"
curl -fsS "https://api.jianliao.store/health"
```

---

## 5. 变量与密钥（生产安全）

### 5.1 必备变量（Cloudflare Variables）

> 以下变量的具体值以你后台为准（在 Worker 的 Variables/Settings 中配置）。

- `OP_GROUP_ID`：Bot 允许操作的群（非超级管理员在其他群的消息/回调会被忽略）
- `REPORT_GROUP_ID`：每日 23:59 战报推送群
- `TURNSTILE_SITEKEY`：可选（启用 `/p` 人机验证）

### 5.2 必备密钥（Cloudflare Secrets）

- `TG_TOKEN`：Telegram Bot Token
- `TG_WEBHOOK_SECRET`：Webhook Secret Token（Worker 会校验 `X-Telegram-Bot-Api-Secret-Token`）
- `TURNSTILE_SECRET`：可选（与 SITEKEY 配套）

写入方式示例（生产环境）：

```bash
npx wrangler secret put TG_TOKEN --env production
npx wrangler secret put TG_WEBHOOK_SECRET --env production
npx wrangler secret put TURNSTILE_SECRET --env production
```

> **注意**：Secrets 不应出现在 `wrangler.jsonc` 明文。

---

## 6. 域名、路由与安全策略

### 6.1 Host Allowlist

Worker 内对 Host 做了严格 allowlist（避免杂牌域蹭流量）。若要新增域名，必须同时：

1. 在 Cloudflare 侧完成自定义域绑定（`wrangler.jsonc` production routes）
2. 在 `index.js` allowlist 中加入该 host（否则 403）

### 6.2 Webhook 强约束

仅允许：

- host = `api.jianliao.store`
- path = `/webhook`
- method = `POST`
- header `X-Telegram-Bot-Api-Secret-Token` 必须等于 `TG_WEBHOOK_SECRET`（配置了才校验）

### 6.3 防盗链（二维码）

`/qrsvg` 与 `/qrpng` 会校验 Referer/Origin（允许空来路），用于减少外站盗链直接刷图。

---

## 7. Telegram Bot 指令手册（群内操作）

### 7.1 权限模型

- **超级管理员**：`SUPER_ADMIN`（代码常量）  
  - 可私聊交互
  - 可在任意群操作
- **普通成员**：
  - 仅当 Bot 所在群为 `OP_GROUP_ID` 时才响应（其它群会静默忽略）
  - 私聊会提示“请回到群内操作。”

### 7.2 指令列表（按 `command - 说明` 格式）

- `/start` - 显示功能菜单与快捷按钮（生成链路 / 今日战绩 / 当前直链）
- `/help` - 查看指令帮助与用法
- `/get <数量>` - 生成当日一次性下载链接（1-10，默认 5；仅群内）
- `/L` - 快捷生成 5 条当日一次性链接（仅群内）
- `/链接` - 快捷生成 5 条当日一次性链接（仅群内）
- `/pool` - 查看今日战绩与系统状态（含域名池数量与统计）
- `/update` - 上传 APK（发送 `.apk` 文件并配合指令；需要管理员/授权用户）
- `/links` - 查看当前 Android/iOS 公共下载链接，并附带二维码
- `/set android <url>` - 设置 Android 公共下载链接（群内可用，需 http(s)）
- `/set ios <url>` - 设置 iOS 公共下载链接（群内可用，需 http(s)）
- `/qr` - **回复一条消息后**发送 `/qr`，Bot 将被回复内容生成二维码 PNG 海报（失败自动回退）

### 7.3 菜单按钮（Inline Keyboard）

- `1 个 / 5 个 / 10 个`：生成对应数量一次性链接（逐条发送，纯 URL）
- `📡 今日战绩`：显示统计与系统状态
- `🔗 当前直链`：展示 Android/iOS 公共链接 + 二维码

---

## 8. APK 上传与 R2 对象规范

### 8.1 R2 对象名

上传逻辑会写入（以代码为准）：

- `apk/latest.apk`（优先）
- `latest.apk`（兼容兜底）

下载侧会先尝试 `apk/latest.apk`，再尝试 `latest.apk`。

### 8.2 下载最终出口

当前实现为 Worker 302 到：

- `https://dl.zhhg.online/latest.apk`

> 这意味着“下载成功”口径属于“已校验 token 并发起重定向”。如需“文件传输完成”口径，需要配合 R2/Logpush/分析日志实现。

---

## 9. 二维码海报（/qrsvg 与 /qrpng）

### 9.1 接口

- `GET /qrsvg?data=<文本或URL>`：返回 SVG
- `GET /qrpng?data=<文本或URL>&v=<时间戳>`：返回 PNG（通过第三方 raster 服务把 SVG 转 PNG）

### 9.2 Bot 侧使用

`/qr` 会优先使用：

- `https://jianliao.store/qrpng?data=...&v=...`

失败后回退：

- `https://api.qrserver.com/v1/create-qr-code/...`

---

## 10. 统计与每日战报

### 10.1 统计口径

以“按天（UTC 日期串 ymd）”维度写入 KV，包含：

- 点击/唯一/重复/成功（success）等字段
- 维度包含城市（`request.cf.city`）与 ref（通常为 TG user id）

### 10.2 定时战报

Cron（`59 15 * * *`）对应北京时间 23:59，会推送到 `REPORT_GROUP_ID`。

---

## 11. 常见问题与排障

### 11.1 Wrangler 认证失败（10000 / 9109）

症状：`Invalid access token` / `Authentication error`

处理：

```bash
npx wrangler logout
npx wrangler login
```

并确认本机环境变量未误设 `CF_API_TOKEN` / `CLOUDFLARE_API_TOKEN` 等。

### 11.2 Windows 上 Node v25 导致 wrangler 异常崩溃

现象：Assertion failed / UV_HANDLE_CLOSING 等

处理：切换 Node 到 **v20 LTS** 再执行 wrangler。

### 11.3 自定义域绑定 522

通常是 Cloudflare Custom Domain 仍在 Pending/未激活，或 DNS 记录冲突。

处理：

- 重新 `wrangler deploy --env production` 触发绑定
- 检查该 hostname 是否已有外部托管 DNS 记录（100117）

### 11.4 100117：Hostname 已有外部 DNS 记录

含义：该 hostname 已存在 A/CNAME 等记录且不受 Worker 管理。

处理策略：

- 删除冲突 DNS 记录，或
- 改用 Cloudflare Redirect Rules 做“不死码”，避免把该域绑定为 Worker 自定义域

---

## 12. 运维检查清单（上线前/每日）

- `/health` 返回 ok
- `api.jianliao.store/webhook` 仅允许 TG 请求（Secret 校验生效）
- `OP_GROUP_ID` / `REPORT_GROUP_ID` 配置正确
- R2 自定义域可访问 `latest.apk`
- Bot `/get` 输出链接可打开并成功 302 到 R2
- `/p` 指纹冷却正常（60s）且可选 Turnstile 正常

---

## 13. 变更流程建议（最小风险）

- 所有“新增域名”必须同时改：Cloudflare 绑定 + Worker allowlist
- 对外关键入口（`/p`、`/dl/*`、`/webhook`）变更后必须立刻跑健康检查
- 统计口径调整前，先明确“点击/跳转/真正下载完成”的定义

