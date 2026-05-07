/**
 * ==========================================
 * v12.2 量子矩阵升级版
 * 优化：UI 错误页 + R2 双路径容错 + TransformStream 流式返回
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

const TOKEN_TTL = 86400;
const STATS_TTL = 86400 * 8;

const UI = {
  theme(title, message, sub) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--neon:#00f2ff;--bg:#020205}body{background:var(--bg);color:var(--neon);font-family:Consolas,Monaco,monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;overflow:hidden}.box{border:1px solid var(--neon);background:rgba(0,242,255,.02);padding:28px;position:relative;width:85%;max-width:520px;box-shadow:0 0 30px rgba(0,242,255,.1)}.box::after{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:var(--neon);opacity:.25;animation:scan 3s linear infinite}.title{font-size:1.2rem;font-weight:700;margin:0 0 12px;letter-spacing:1px;text-shadow:0 0 8px var(--neon)}.msg{color:#fff;font-size:.95rem;line-height:1.8;margin:0 0 16px;opacity:.82}.footer{font-size:.75rem;border-top:1px solid #1a1a2e;padding-top:12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;opacity:.55}@keyframes scan{0%{top:0}100%{top:100%}}</style></head><body><div class="box"><div class="title">&gt; ${escapeHtml(title)}</div><div class="msg">${escapeHtml(message)}</div><div class="footer"><span>NODE: QUANTUM_V12.2</span><span>STATUS: ${escapeHtml(sub || "")}</span></div></div></body></html>`;
  }
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const host = url.hostname || "";

      const isWorkersDev = host.endsWith(".workers.dev");
      const isMainHost = host === "jianliao.store";
      const isApiHost = host === "api.jianliao.store";
      const isDlHost = false;
      const isZhhgHost = host === "zhhg.online";
      const isDlJianliaoHost = host === "dl.jianliao.store";
      const isAndroidHost =
        host === "android.apk.pay.jianliao.store" ||
        host === "android.apk.360.jianliao.store" ||
        host === "android.app.pay.jianliao.store" ||
        host === "android.360.pay.jianliao.store";

      if (!isWorkersDev && !isMainHost && !isApiHost && !isDlHost && !isZhhgHost && !isDlJianliaoHost && !isAndroidHost) {
        return new Response("Forbidden", { status: 403 });
      }

      if (request.method === "POST" && url.pathname === "/webhook") {
        if (!isApiHost) return new Response("Not Found", { status: 404 });
        return await handleTelegram(request, env);
      }

      if (url.pathname === "/health" || url.pathname === "/status") {
        return await handleHealth(request, env);
      }

      if (url.pathname.startsWith("/i/")) {
        const ref = url.pathname.replace("/i/", "").split("/")[0];
        return await handleInviteLanding(ref, request, env);
      }

      if (url.pathname.startsWith("/dl/")) {
        if (isApiHost) return new Response("Not Found", { status: 404 });
        const token = url.pathname.replace("/dl/", "").replace(".apk", "");
        return await handleOneTimeDownload(token, request, env, ctx);
      }

      if (isZhhgHost || isDlJianliaoHost || isAndroidHost) {
        return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZHHG Download</title></head><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;max-width:720px;margin:40px auto;line-height:1.6;padding:0 16px;"><h1>ZHHG 下载入口</h1><p>请使用由机器人生成的下载链接（<code>/dl/&lt;token&gt;.apk</code>）。</p><p><a href="/health">/health</a></p></body></html>`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      return new Response("🌌 Quantum Node v9.8 Online", { status: 200 });
    } catch (e) {
      return new Response(JSON.stringify({
        ok: false,
        error: e && e.message ? e.message : String(e)
      }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
  },

  async scheduled(event, env, ctx) {
    const cron = event.cron || "";

    if (cron === "*/5 * * * *") {
      await ensurePoolSizeSmooth(env);
    }

    if (cron === "*/30 * * * *") {
      await pruneUnhealthyDomains(env);
    }

    if (cron === "59 15 * * *") {
      const gid = env.REPORT_GROUP_ID;
      if (!gid) return;
      const ymd = new Date().toISOString().slice(0, 10);
      const report = await buildDailyReport(env, ymd);
      await sendTG(parseInt(gid, 10), `🏁 **今日战绩 ${ymd}**\n\n${report}`, env);
    }
  }
};

/* ====================== 工具函数 ====================== */
function isMobile(request) {
  const ua = (request.headers.get("User-Agent") || "").toLowerCase();
  return ua.includes("android") || ua.includes("iphone") || ua.includes("micromessenger");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  let pool = 0;
  try {
    if (!env.DB) throw new Error("DB binding missing");
    pool = (await env.DB.list({ prefix: "DOMAIN_GLOBAL_" })).keys.length;
  } catch {}
  return new Response(JSON.stringify({
    ok: true,
    version: "v12.2",
    pool
  }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function handleInviteLanding(ref, request, env) {
  if (!env.DB) return new Response("Service Unavailable", { status: 503 });
  if (!ref || !/^\d{5,20}$/.test(ref)) {
    return new Response(UI.theme("参数错误", "入口链接无效。", "BAD_REF"), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  const fp = await fingerprint(request);
  const city = ((request.cf && request.cf.city) ? request.cf.city : "") || "Unknown";
  const ymd = new Date().toISOString().slice(0, 10);
  const cityKey = `STATS_CITY_${ymd}_${city}`;
  const refKey = `STATS_REF_${ymd}_${ref}`;
  const cooldownKey = `COOLDOWN_${ymd}_${ref}_${fp}`;
  const cooling = await env.DB.get(cooldownKey);
  if (cooling) {
    return new Response(UI.theme("冷却中", "请求过于频繁，请稍后再试。", "COOLDOWN"), {
      status: 429,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  await env.DB.put(cooldownKey, "1", { expirationTtl: 90 });

  try {
    const currentCity = JSON.parse((await env.DB.get(cityKey)) || "{}");
    const currentRef = JSON.parse((await env.DB.get(refKey)) || "{}");

    currentCity.clicks = (currentCity.clicks || 0) + 1;
    currentRef.clicks = (currentRef.clicks || 0) + 1;

    const uniqKey = `STATS_ENTRY_UNIQ_${ymd}_${ref}_${fp}_${city}`;
    const seen = await env.DB.get(uniqKey);
    if (!seen) {
      await env.DB.put(uniqKey, "1", { expirationTtl: STATS_TTL });
      currentCity.unique = (currentCity.unique || 0) + 1;
    } else {
      currentCity.repeat = (currentCity.repeat || 0) + 1;
    }

    await env.DB.put(cityKey, JSON.stringify(currentCity), { expirationTtl: STATS_TTL });
    await env.DB.put(refKey, JSON.stringify(currentRef), { expirationTtl: STATS_TTL });
  } catch {}

  const token = crypto.randomUUID().replace(/-/g, "");
  const ttl = secondsUntilBJ2359();
  await env.DB.put(`DL_TOKEN_${token}`, JSON.stringify({ ref, ts: Date.now() }), { expirationTtl: ttl });

  const link = `/dl/${token}.apk`;
  return new Response(UI.theme("终端接入", `节点已在线。点击获取资源载荷：${link}`, "READY"), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

/* ====================== 真实 APK 下载 ====================== */
async function handleOneTimeDownload(token, request, env, ctx) {
  if (!token) return new Response("Not Found", { status: 404 });
  if (!env.DB || !env.DB_BUCKET) return new Response("Service Unavailable", { status: 503 });
  if (!isMobile(request)) {
    return new Response(UI.theme("接入受阻", "非法访问：检测到非授权终端尝试接入矩阵。请使用移动端操作。", "AUTH_FAIL"), {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
  const metaKey = `DL_TOKEN_${token}`;
  const metaStr = await env.DB.get(metaKey);
  if (!metaStr) {
    return new Response(UI.theme("凭证解构", "该链路载荷已完成提取或令牌已超时失效。", "EXPIRED"), {
      status: 410,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  let meta = null;
  try { meta = JSON.parse(metaStr); } catch { meta = null; }
  if (!meta || !meta.ref) {
    return new Response(UI.theme("凭证异常", "令牌数据结构异常，已拒绝本次提取。", "TOKEN_BAD"), {
      status: 410,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  await env.DB.delete(metaKey);

  const ymd = new Date().toISOString().slice(0, 10);
  const fp = await fingerprint(request);
  const dlCooldownKey = `COOLDOWN_DL_${ymd}_${meta.ref}_${fp}`;
  const dlCooling = await env.DB.get(dlCooldownKey);
  if (dlCooling) {
    return new Response(UI.theme("冷却中", "下载请求过于频繁，请稍后再试。", "COOLDOWN"), {
      status: 429,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
  await env.DB.put(dlCooldownKey, "1", { expirationTtl: 60 });

  const city = ((request.cf && request.cf.city) ? request.cf.city : "") || "Unknown";
  const cityKey = `STATS_CITY_${ymd}_${city}`;
  const refKey = `STATS_REF_${ymd}_${meta.ref}`;

  let obj = await env.DB_BUCKET.get("apk/latest.apk");
  if (!obj) obj = await env.DB_BUCKET.get("latest.apk");

  if (!obj) {
    return new Response(UI.theme("资源失联", "目标物料未在仓库(R2)检出。请管理员核查存储路径。", "FILE_NOT_FOUND"), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  try {
    const currentCity = JSON.parse((await env.DB.get(cityKey)) || "{}");
    const currentRef = JSON.parse((await env.DB.get(refKey)) || "{}");
    currentCity.success = (currentCity.success || 0) + 1;
    currentRef.success = (currentRef.success || 0) + 1;
    await env.DB.put(cityKey, JSON.stringify(currentCity), { expirationTtl: STATS_TTL });
    await env.DB.put(refKey, JSON.stringify(currentRef), { expirationTtl: STATS_TTL });
  } catch {}

  const headers = new Headers();
  headers.set("Content-Type", "application/vnd.android.package-archive");
  headers.set("Content-Disposition", 'attachment; filename="app.apk"');
  headers.set("Cache-Control", "no-store");

  return Response.redirect("https://dl.zhhg.online/latest.apk", 302);
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

  const chatType = update.message?.chat?.type || update.callback_query?.message?.chat?.type || "";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const isPrivate = chatType === "private";

  if (update.callback_query) {
    const chatId = update.callback_query.message.chat.id;
    const data = update.callback_query.data;
    if (data === "menu_generate") await sendTG(chatId, "⚡ 请在群内发送 `/get` 获取当日链路。", env);
    if (data === "menu_status") await sendTG(chatId, await getStatusText(env), env);
    if (data === "menu_fr") await sendTG(chatId, "正在执行域名池扩容...", env);
    return new Response("OK");
  }

  const chatId = update.message?.chat.id;
  const text = (update.message?.text || "").trim();
  const fromId = update.message?.from?.id;
  const isSuper = fromId === SUPER_ADMIN;

  if (!text) return new Response("OK");

  const opGroupId = env.OP_GROUP_ID ? parseInt(env.OP_GROUP_ID, 10) : 0;
  if (isGroup && opGroupId && chatId !== opGroupId) {
    return new Response("OK");
  }

  if (isPrivate && !isSuper) {
    await sendTG(chatId, "请回到群内操作。", env);
    return new Response("OK");
  }

  if (text === "/start") {
    const keyboard = {
      inline_keyboard: [
        [{ text: "⚡ 获取链路", callback_data: "menu_generate" }],
        [{ text: "📡 今日战绩", callback_data: "menu_status" }],
        [{ text: "🌐 扩容域名池", callback_data: "menu_fr" }]
      ]
    };
    await sendTG(chatId, `🌌 **QUANTUM MATRIX v12.2 ONLINE**\n群内发送 \`/get\` 获取当日链路\n发送 \`/s\` 查看今日战绩`, env, keyboard);
    return new Response("OK");
  }

  if (text === "/help") {
    await sendTG(chatId, `⚡ **v9.8 指令矩阵**\n\n/get <数量> - 生成链接\n/s - 系统状态\n/fr - 手动扩容\n/update - 上传APK`, env);
    return new Response("OK");
  }

  if (text === "/get" || text.startsWith("/get ")) {
    if (!isGroup) return new Response("OK");
    const ref = String(fromId);
    const parts = text.split(" ").filter(Boolean);
    const count = Math.max(1, Math.min(parseInt(parts[1] || "10", 10) || 10, 10));

    let links = "";
    const ttl = secondsUntilBJ2359();
    for (let i = 0; i < count; i++) {
      const token = crypto.randomUUID().replace(/-/g, "");
      await env.DB.put(`DL_TOKEN_${token}`, JSON.stringify({ ref, ts: Date.now() }), { expirationTtl: ttl });
      links += `https://zhhg.online/dl/${token}.apk\n`;
    }

    await sendTG(chatId, `🔗 **已生成 ${count} 个下载链接（今日有效）**：\n\n${links}`, env);
    return new Response("OK");
  }

  if (text === "/s" || text === "/pool") {
    const pool = (await env.DB.list({ prefix: "DOMAIN_GLOBAL_" })).keys.length;
    const ymd = new Date().toISOString().slice(0, 10);
    const report = await buildDailyReport(env, ymd);
    await sendTG(chatId, `🌐 **今日战绩 ${ymd}**\n域名池：${pool} 个\n\n${report}`, env);
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
  const ymd = new Date().toISOString().slice(0, 10);
  const report = await buildDailyReport(env, ymd);
  return `📡 **系统实时状态 v9.8**\n域名池负载：${pool} 个\n\n${report}`;
}

async function sendTG(chatId, text, env, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (keyboard) body.reply_markup = keyboard;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    return res.ok;
  } catch {
    return false;
  }
}

function secondsUntilBJ2359() {
  const now = new Date();
  const utc = now.getTime();
  const bj = utc + 8 * 3600 * 1000;
  const bjDate = new Date(bj);
  const y = bjDate.getUTCFullYear();
  const m = bjDate.getUTCMonth();
  const d = bjDate.getUTCDate();
  const endBj = Date.UTC(y, m, d, 23, 59, 0, 0);
  const endUtc = endBj - 8 * 3600 * 1000;
  let sec = Math.floor((endUtc - utc) / 1000);
  if (sec < 60) sec = 60;
  if (sec > 86400) sec = 86400;
  return sec;
}

async function fingerprint(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ua = request.headers.get("User-Agent") || "";
  const lang = request.headers.get("Accept-Language") || "";
  const ch = request.headers.get("Sec-CH-UA") || "";
  const raw = `${ip}|${ua}|${lang}|${ch}`;
  const buf = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function buildDailyReport(env, ymd) {
  try {
    const cities = await env.DB.list({ prefix: `STATS_CITY_${ymd}_` });
    let lines = [];
    let totalClicks = 0, totalUnique = 0, totalRepeat = 0, totalSuccess = 0;

    for (const k of cities.keys) {
      const name = k.name.replace(`STATS_CITY_${ymd}_`, "");
      const data = JSON.parse((await env.DB.get(k.name)) || "{}");
      const clicks = data.clicks || 0;
      const unique = data.unique || 0;
      const repeat = data.repeat || 0;
      const success = data.success || 0;
      totalClicks += clicks; totalUnique += unique; totalRepeat += repeat; totalSuccess += success;
      lines.push(`${name} 点击:${clicks} 去重:${unique} 重复:${repeat} 成功:${success}`);
    }

    const users = await env.DB.list({ prefix: `STATS_REF_${ymd}_` });
    let bestUid = null, bestSuccess = -1;
    for (const k of users.keys) {
      const uid = k.name.replace(`STATS_REF_${ymd}_`, "");
      const data = JSON.parse((await env.DB.get(k.name)) || "{}");
      const success = data.success || 0;
      if (success > bestSuccess) { bestSuccess = success; bestUid = uid; }
    }

    if (!lines.length) lines.push("暂无数据");
    lines.push(`\n总统计 点击:${totalClicks} 去重:${totalUnique} 重复:${totalRepeat} 成功:${totalSuccess}`);
    if (bestUid) lines.push(`今日榜一: ${bestUid} (${bestSuccess})`);
    return lines.join("\n");
  } catch {
    return "暂无数据";
  }
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
    await env.DB_BUCKET.put("latest.apk", apkArrayBuffer, {
      httpMetadata: { contentType: "application/vnd.android.package-archive" }
    });

    await sendTG(chatId, `✅ **APK 上传成功！**\n文件大小：${formatSize(doc.file_size)}`, env);
  } catch (e) {
    await sendTG(chatId, `❌ 上传失败：${e.message}`, env);
  }
}