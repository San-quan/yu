/**
 * ==========================================
 * v9.8 完整覆盖版（R2 路径已修复为 apk/latest.apk）
 * 只保留 jianliao.store + 真实下载 + 自动域名池
 * ==========================================
 */

const SUPER_ADMIN = 6919196077;
const ADMIN_IDS = new Set([SUPER_ADMIN]);

const MAX_APK_SIZE_MB = 80;

const DOMAIN_POOL_TARGET = 300;
const MAX_GENERATE_PER_RUN = 20;
const DOMAIN_TTL = 7200;

const ROOT_DOMAINS = ["jianliao.store"];
const ZONE_MAP = {
  "jianliao.store": "e8fa3bf7335108fa72adf92893ca8b19"
};
const DOMAIN_PREFIXES = ["m", "cdn", "app", "file"];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/webhook") {
      return await handleTelegram(request, env);
    }

    if (url.pathname === "/health" || url.pathname === "/status") {
      return await handleHealth(request, env);
    }

    if (url.pathname.startsWith("/dl/")) {
      if (!isMobile(request)) return new Response("Access Denied", { status: 404 });
      const token = url.pathname.replace("/dl/", "").replace(".apk", "");
      return await handleOneTimeDownload(token, request, env, ctx);
    }

    return new Response("🌌 Quantum Node v9.8 Online", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    const cron = event.cron || "";

    if (cron === "*/5 * * * *") {
      await ensurePoolSizeSmooth(env);
    }

    if (cron === "*/30 * * * *") {
      await pruneUnhealthyDomains(env);
    }
  }
};

/* ====================== 工具函数 ====================== */
function isMobile(request) {
  const ua = (request.headers.get("User-Agent") || "").toLowerCase();
  return ua.includes("android") || ua.includes("iphone") || ua.includes("micromessenger");
}

function randomLabel(len = 6) {
  return Math.random().toString(36).substring(2, 2 + len);
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

/* ====================== 权限系统 ====================== */
async function isAuthorized(userId, env) {
  if (ADMIN_IDS.has(userId)) return true;
  const list = await env.DB.get("AUTHORIZED_USERS");
  if (!list) return false;
  try { return JSON.parse(list).includes(userId); } catch { return false; }
}

async function addAuthorizedUser(userId, env) {
  let users = [];
  const list = await env.DB.get("AUTHORIZED_USERS");
  if (list) { try { users = JSON.parse(list); } catch {} }
  if (!users.includes(userId)) users.push(userId);
  await env.DB.put("AUTHORIZED_USERS", JSON.stringify(users));
}

async function removeAuthorizedUser(userId, env) {
  let users = [];
  const list = await env.DB.get("AUTHORIZED_USERS");
  if (list) { try { users = JSON.parse(list); } catch {} }
  users = users.filter(id => id !== userId);
  await env.DB.put("AUTHORIZED_USERS", JSON.stringify(users));
}

async function listAuthorizedUsers(env) {
  const list = await env.DB.get("AUTHORIZED_USERS");
  if (!list) return [];
  try { return JSON.parse(list); } catch { return []; }
}

/* ====================== 域名池 ====================== */
async function createCNAME(domain, zoneId, env) {
  const headers = { "Content-Type": "application/json" };
  if (env.CF_API_TOKEN) headers.Authorization = `Bearer ${env.CF_API_TOKEN}`;

  const body = JSON.stringify({
    type: "CNAME",
    name: domain,
    content: env.TARGET_WORKER,
    ttl: 60,
    proxied: true
  });

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
      method: "POST", headers, body
    });
    if (res.ok) return { success: true };
    return { success: false, status: res.status, error: await res.text() };
  } catch (e) {
    return { success: false, status: 0, error: e.message };
  }
}

async function generateAndRotateDomains(env, needCount) {
  const roots = ROOT_DOMAINS;
  let created = 0, failed = 0, errors = [];

  for (let i = 0; i < needCount; i++) {
    try {
      const root = roots[0];
      const zoneId = ZONE_MAP[root];
      const prefix = DOMAIN_PREFIXES[Math.floor(Math.random() * DOMAIN_PREFIXES.length)];
      const domain = `${randomLabel(6)}.${prefix}.${root}`;

      const result = await createCNAME(domain, zoneId, env);
      if (result.success) {
        created++;
        await env.DB.put(`DOMAIN_GLOBAL_${domain}`, JSON.stringify({
          score: 100, lastUsed: 0, lastCheck: Date.now()
        }), { expirationTtl: DOMAIN_TTL });
      } else {
        failed++;
        errors.push(`${domain}: ${result.status}`);
      }
    } catch (e) { failed++; }
    await new Promise(r => setTimeout(r, 120));
  }
  return { created, failed, errors };
}

async function pickBestDomain(env) {
  const list = await env.DB.list({ prefix: "DOMAIN_GLOBAL_" });
  if (!list.keys.length) return ROOT_DOMAINS[0];
  return list.keys[0].name.replace("DOMAIN_GLOBAL_", "");
}

async function pruneUnhealthyDomains(env) {
  const list = await env.DB.list({ prefix: "DOMAIN_GLOBAL_" });
  const now = Date.now();
  for (const item of list.keys) {
    try {
      const meta = JSON.parse((await env.DB.get(item.name)) || "{}");
      if (now - (meta.lastCheck || 0) > 24 * 3600 * 1000 || (meta.score || 0) < 30) {
        await env.DB.delete(item.name);
      }
    } catch {}
  }
}

async function ensurePoolSizeSmooth(env) {
  const list = await env.DB.list({ prefix: "DOMAIN_GLOBAL_" });
  const current = list.keys.length;
  if (current >= DOMAIN_POOL_TARGET) return;
  const need = Math.min(MAX_GENERATE_PER_RUN, DOMAIN_POOL_TARGET - current);
  if (need > 0) await generateAndRotateDomains(env, need);
}

/* ====================== 健康检查 ====================== */
async function handleHealth(request, env) {
  const pool = (await env.DB.list({ prefix: "DOMAIN_GLOBAL_" })).keys.length;
  return new Response(JSON.stringify({
    ok: true,
    version: "v9.8",
    pool
  }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

/* ====================== 真实 APK 下载 ====================== */
async function handleOneTimeDownload(token, request, env, ctx) {
  const obj = await env.DB_BUCKET.get("apk/latest.apk");

  if (!obj) {
    return new Response("当前没有可用的 APK，请确认 R2 中文件路径是否为 apk/latest.apk", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", "application/vnd.android.package-archive");
  headers.set("Content-Disposition", 'attachment; filename="app.apk"');

  return new Response(obj.body, { status: 200, headers });
}

/* ====================== Telegram 后台 ====================== */
async function handleTelegram(request, env) {
  if (env.TG_WEBHOOK_SECRET) {
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (secret !== env.TG_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let update;
  try { update = await request.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  if (update.callback_query) {
    const chatId = update.callback_query.message.chat.id;
    const data = update.callback_query.data;
    if (data === "menu_generate") await sendTG(chatId, "请发送 `/get <数量>` 生成链接", env);
    if (data === "menu_status") await sendTG(chatId, await getStatusText(env), env);
    if (data === "menu_fr") await sendTG(chatId, "正在执行域名池扩容...", env);
    return new Response("OK");
  }

  const chatId = update.message?.chat.id;
  const text = (update.message?.text || "").trim();
  const fromId = update.message?.from?.id;
  const isSuper = fromId === SUPER_ADMIN;

  if (!text) return new Response("OK");

  if (text === "/start") {
    const keyboard = {
      inline_keyboard: [
        [{ text: "🚀 生成链接", callback_data: "menu_generate" }],
        [{ text: "📊 系统状态", callback_data: "menu_status" }],
        [{ text: "🌐 扩容域名池", callback_data: "menu_fr" }]
      ]
    };
    await sendTG(chatId, `🌌 **量子节点 v9.8 已连接**`, env, keyboard);
    return new Response("OK");
  }

  if (text === "/help") {
    await sendTG(chatId, `⚡ **v9.8 指令矩阵**\n\n/get <数量> - 生成链接\n/s - 系统状态\n/fr - 手动扩容\n/update - 上传APK`, env);
    return new Response("OK");
  }

  if (text.startsWith("/get ")) {
    const num = Math.min(parseInt(text.split(" ")[1]) || 3, 10);
    let links = "";
    for (let i = 0; i < num; i++) {
      const domain = await pickBestDomain(env);
      const token = crypto.randomUUID().replace(/-/g, "");
      links += `https://${domain}/dl/${token}.apk\n`;
    }
    await sendTG(chatId, `🔗 **已生成 ${num} 个链接**：\n\n${links}`, env);
    return new Response("OK");
  }

  if (text === "/s" || text === "/pool") {
    const pool = (await env.DB.list({ prefix: "DOMAIN_GLOBAL_" })).keys.length;
    await sendTG(chatId, `🌐 **域名池状态 v9.8**\n当前可用节点：${pool} 个`, env);
    return new Response("OK");
  }

  if (isSuper && text === "/fr") {
    const result = await generateAndRotateDomains(env, 12);
    await sendTG(chatId, `🌐 **域名池扩容完成**\n✅ 成功：${result.created} | ❌ 失败：${result.failed}`, env);
    return new Response("OK");
  }

  if (text === "/update" && update.message.document?.file_name?.endsWith(".apk")) {
    const authorized = isSuper || await isAuthorized(fromId, env);
    if (!authorized) {
      await sendTG(chatId, "❌ 权限不足", env);
      return new Response("OK");
    }
    await handleApkUploadEnhanced(chatId, update.message.document, env);
    return new Response("OK");
  }

  return new Response("OK");
}

async function getStatusText(env) {
  const pool = (await env.DB.list({ prefix: "DOMAIN_GLOBAL_" })).keys.length;
  return `📡 **系统实时状态 v9.8**\n域名池负载：${pool} 个`;
}

async function sendTG(chatId, text, env, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}

/* ====================== 增强版 APK 上传 ====================== */
async function handleApkUploadEnhanced(chatId, doc, env) {
  const fileSizeMB = doc.file_size / 1024 / 1024;

  if (fileSizeMB > MAX_APK_SIZE_MB) {
    await sendTG(chatId, `❌ 文件过大！限制 ${MAX_APK_SIZE_MB}MB`, env);
    return;
  }

  await sendTG(chatId, `📡 **正在接收 APK...**`, env);

  try {
    const fileRes = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/getFile?file_id=${doc.file_id}`);
    const fileData = await fileRes.json();
    if (!fileData.ok) throw new Error("获取文件失败");

    const downloadUrl = `https://api.telegram.org/file/bot${env.TG_TOKEN}/${fileData.result.file_path}`;
    const apkRes = await fetch(downloadUrl);
    const apkArrayBuffer = await apkRes.arrayBuffer();

    await env.DB_BUCKET.put("apk/latest.apk", apkArrayBuffer, {
      httpMetadata: { contentType: "application/vnd.android.package-archive" }
    });

    await sendTG(chatId, `✅ **APK 上传成功！**\n文件大小：${formatSize(doc.file_size)}`, env);
  } catch (e) {
    await sendTG(chatId, `❌ 上传失败：${e.message}`, env);
  }
}