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
      const isCnMainHost = host === "xn--xyz11h.xn--fiqs8s";
      const isMainEntryHost = isMainHost || isCnMainHost;
      const isApiHost = host === "api.jianliao.store";
      const isDlHost = false;
      const isZhhgHost = host === "zhhg.online";
      const isDlJianliaoHost = host === "dl.jianliao.store";
      const isDirectDlAlias =
        host === "6m09xp.app.jianliao.store" ||
        host === "6pcopl.app.jianliao.store";
      const isAndroidHost =
        host === "android.apk.pay.jianliao.store" ||
        host === "android.apk.360.jianliao.store" ||
        host === "apk.360.app.jianliao.store" ||
        host === "android.app.pay.jianliao.store" ||
        host === "android.360.pay.jianliao.store";

      if (!isWorkersDev && !isMainEntryHost && !isApiHost && !isDlHost && !isZhhgHost && !isDlJianliaoHost && !isDirectDlAlias && !isAndroidHost) {
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

      if (isMainEntryHost && url.pathname === "/qrsvg" && request.method === "GET") {
        const data = url.searchParams.get("data") || url.searchParams.get("url") || "";
        if (!data) return new Response("Not Found", { status: 404 });
        if (!allowHotlink(request)) return new Response("禁止盗用外链", { status: 403 });
        const svg = await buildPosterSvg(data);
        return new Response(svg, {
          status: 200,
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "no-store"
          }
        });
      }

      if (isMainEntryHost && url.pathname === "/qrpng" && request.method === "GET") {
        const data = url.searchParams.get("data") || url.searchParams.get("url") || "";
        if (!data) return new Response("Not Found", { status: 404 });
        if (!allowHotlink(request)) return new Response("禁止盗用外链", { status: 403 });
        const v = url.searchParams.get("v") || "";
        const src = `${url.origin}/qrsvg?data=${encodeURIComponent(data)}${v ? `&v=${encodeURIComponent(v)}` : ""}`;
        const raster = `https://images.weserv.nl/?url=${encodeURIComponent(src)}&output=png`;
        const res = await fetch(raster);
        if (!res.ok) {
          const fallback = await fetch(`${qrUrl(data)}${v ? `&v=${encodeURIComponent(v)}` : ""}`);
          if (!fallback.ok) return new Response("Not Found", { status: 404 });
          return new Response(fallback.body, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "no-store"
            }
          });
        }
        return new Response(res.body, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store"
          }
        });
      }

      if (isMainEntryHost && url.pathname === "/p" && (request.method === "GET" || request.method === "HEAD")) {
        if (!isMobile(request)) return new Response("Not Found", { status: 404 });
        if (!env.DB) return new Response("Service Unavailable", { status: 503 });

        const tsSiteKey = env.TURNSTILE_SITEKEY || "";
        const tsSecret = env.TURNSTILE_SECRET || "";
        if (tsSiteKey && tsSecret) {
          const url = new URL(request.url);
          const ts = url.searchParams.get("ts") || "";
          if (!ts) {
            return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>验证中</title><link rel="icon" href="https://i.imgant.com/v2/4pGdor9.png"><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#070712;color:#eaeaf2;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{width:100%;max-width:420px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.06);padding:18px}.t{font-weight:700;margin:0 0 10px}.p{margin:0 0 14px;color:rgba(234,234,242,.72);line-height:1.7}.btn{margin-top:12px;width:100%;border:0;border-radius:12px;padding:12px 14px;font-weight:700;background:linear-gradient(135deg, rgba(124,58,237,.95), rgba(37,99,235,.95));color:#fff}</style></head><body><div class="card"><div class="t">正在验证</div><p class="p">完成验证后将自动提取载荷。</p><form method="GET" action="/p"><div class="cf-turnstile" data-sitekey="${escapeHtml(tsSiteKey)}"></div><button class="btn" type="submit">继续</button></form></div></body></html>`, {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" }
            });
          }
          const ok = await verifyTurnstile(ts, request, tsSecret);
          if (!ok) return new Response("Not Found", { status: 404 });
        }

        const ymd = new Date().toISOString().slice(0, 10);
        const fp = await fingerprint(request);
        const cdKey = `COOLDOWN_P_${ymd}_${fp}`;
        const cooling = await env.DB.get(cdKey);
        if (cooling) return new Response("Not Found", { status: 404 });
        await env.DB.put(cdKey, "1", { expirationTtl: 60 });

        const token = crypto.randomUUID().replace(/-/g, "");
        const ttl = secondsUntilBJ2359();
        await env.DB.put(`DL_TOKEN_${token}`, JSON.stringify({ ref: "PUBLIC", ts: Date.now() }), { expirationTtl: ttl });
        const target = new URL(`/dl/${token}.apk`, request.url).toString();
        if (request.method === "HEAD") return Response.redirect(target, 302);
        return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${escapeHtml(target)}"><title>Redirecting</title></head><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:18px">正在跳转…<a href="${escapeHtml(target)}">点击继续</a></body></html>`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
        });
      }

      if (isMainEntryHost && url.pathname === "/" && request.method === "GET") {
        const links = await getPublicDownloadLinks(env);
        if (!isMobile(request)) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0,user-scalable=no" />
    <title>简聊·iM - 纯粹通讯</title>
    <link rel="icon" href="https://i.imgant.com/v2/4pGdor9.png">
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #7c3aed;
            --bg: #070712;
            --card-bg: #000000;
            --text: #eaeaf2;
            --muted: rgba(234,234,242,0.6);
            --line: rgba(255,255,255,0.08);
            --font-sans: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
            --font-mono: "JetBrains Mono", monospace;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        
        body {
            font-family: var(--font-sans);
            background: radial-gradient(circle at 10% 10%, rgba(124,58,237,0.12) 0%, transparent 40%), var(--bg);
            color: var(--text);
            line-height: 1.6;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        /* 顶部导航 */
        .topbar {
            display: flex; align-items: center; justify-content: center;
            padding: 18px; background: rgba(7,7,18,0.7); backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--line); position: fixed; top: 0; width: 100%; z-index: 100;
        }
        .topbar img { width: 28px; height: 28px; margin-right: 10px; border-radius: 7px; }
        .topbar span { font-weight: 800; font-size: 16px; letter-spacing: 1px; }

        /* 主体内容 */
        #main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 120px 24px 60px; }
        .hero { max-width: 520px; text-align: center; width: 100%; }
        
        .hero h1 { font-size: 38px; font-weight: 800; margin-bottom: 16px; background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        
        .slogan-box { margin-bottom: 40px; }
        .slogan-box p { font-size: 15px; margin-bottom: 8px; letter-spacing: 2px; }
        .slogan-box p:nth-child(1) { color: var(--primary); font-weight: 700; }
        .slogan-box p:nth-child(2) { color: var(--text); font-weight: 500; }
        .slogan-box p:nth-child(3) { color: var(--muted); font-size: 13px; }

        /* 下载卡片容器 */
        .download-card { 
            background: var(--card-bg); 
            border: 1px solid rgba(255,255,255,0.1); 
            border-radius: 36px; 
            padding: 40px 25px; 
            box-shadow: 0 40px 80px -12px rgba(0,0,0,0.7);
            position: relative;
        }
        
        .download-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        
        /* 正方形下载图标美化 */
        .btn-download {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            text-decoration: none;
            padding: 24px 10px;
            background: linear-gradient(145deg, #0f0f0f, #000000);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 28px;
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            box-shadow: inset 0 1px 1px rgba(255,255,255,0.1);
        }
        
        .btn-download:hover {
            transform: translateY(-8px);
            border-color: var(--primary);
            box-shadow: 0 15px 30px rgba(124,58,237,0.2), inset 0 1px 2px rgba(255,255,255,0.1);
        }

        .icon-wrapper {
            width: 80px; height: 80px;
            background: #000;
            border-radius: 18px; 
            display: flex; align-items: center; justify-content: center;
            margin-bottom: 15px;
            border: 1px solid rgba(255,255,255,0.15); 
            overflow: hidden;
            position: relative;
        }

        .btn-download img { 
            width: 100%; height: 100%; 
            mix-blend-mode: screen; 
            filter: drop-shadow(0 0 8px rgba(124,58,237,0.3));
            object-fit: cover;
        }
        
        .btn-download span { font-size: 14px; font-weight: 700; color: #fff; letter-spacing: 1px; }

        /* 页脚区域排版 */
        .footer { padding: 60px 24px; border-top: 1px solid var(--line); background: rgba(0,0,0,0.5); }
        .footer-inner { max-width: 650px; margin: 0 auto; text-align: left; }
        
        /* 实时技术面板排版 */
        .status-panel {
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--line);
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 30px;
            font-size: 11px;
            line-height: 1.8;
            color: var(--muted);
            position: relative;
        }
        .status-panel::before {
            content: "系统实时状态";
            position: absolute; top: -10px; left: 20px;
            background: var(--primary); color: #fff;
            padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: bold;
        }

        .status-panel b { color: #fff; }
        .status-panel .highlight-text { color: #4ade80; } 

        .footer-row { margin-bottom: 12px; font-size: 11px; opacity: 0.8; }
        .footer-tag { background: rgba(124,58,237,0.1); color: var(--primary); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(124,58,237,0.2); margin: 0 4px; font-weight: bold; }
        
        .copyright-area { text-align: center; border-top: 1px dashed var(--line); padding-top: 25px; margin-top: 25px; }
        .copyright-area p { font-size: 10px; color: rgba(234, 234, 242, 0.4); letter-spacing: 1px; }

    </style>
</head>
<body>
    <div class="topbar">
        <img src="https://i.imgant.com/v2/4pGdor9.png" alt="LOGO" />
        <span>简聊 · iM</span>
    </div>
    
    <main id="main">
        <div class="hero">
            <h1>回归纯粹对话</h1>
            
            <div class="slogan-box">
                <p>极简，而不简单</p>
                <p>你的隐私，只有天知、地知、你知。</p>
                <p>基于端到端加密协议，为审美挑剔的沟通者打造。</p>
            </div>
            
            <div class="download-card">
                <div class="download-grid">
                    <a href="${escapeHtml(links.android || "#")}" class="btn-download">
                        <div class="icon-wrapper">
                            <img src="https://i.imgant.com/v2/8dPwSFS.png" alt="Android" />
                        </div>
                        <span>安卓端 安装</span>
                    </a>
                    <a href="${escapeHtml(links.ios || "#")}" class="btn-download">
                        <div class="icon-wrapper">
                            <img src="https://i.imgant.com/v2/mCzxZvZ.png" alt="iOS" />
                        </div>
                        <span>苹果端 下载</span>
                    </a>
                </div>
            </div>
        </div>
    </main>

    <footer class="footer">
        <div class="footer-inner">
            <!-- 技术状态面板 -->
            <div class="status-panel">
                通讯链路： <b>动态路由适配 (Dynamic Provider Routing)</b> | 自愈状态： <span class="highlight-text">在线 (Active)</span><br>
                系统已启用 <b>错误恢复 (Error Resuming)</b> 机制，确保在复杂网络环境下后台任务的原子性。服务商防护： 自动切换至冗余备用链路。数据根据 <b>RFC-7519</b> 标准进行分片处理，保障端到端重连无损。
            </div>

            <div class="footer-row">
                <span class="cn">隐私保护：采用</span>
                <span class="footer-tag">双棘轮算法 (Double Ratchet)</span>
                <span class="cn">端到端加密核心协议</span>
            </div>

            <div class="copyright-area">
                <p>© 2026 简聊技术实验室 | 集群编号：<span style="color:var(--text)">CL-9c53-ab</span></p>
                <p style="margin-top: 5px; font-family: var(--font-mono);">版权所有 简聊·iM 实验室</p>
            </div>
        </div>
    </footer>
</body>
</html>`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      if (isZhhgHost && url.pathname === "/" && request.method === "GET") {
        const links = await getPublicDownloadLinks(env);
        return new Response(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0,user-scalable=no" /><title>简聊·iM 下载</title><link rel="icon" href="https://i.imgant.com/v2/4pGdor9.png"><style>:root{--primary:#4285F4;--secondary:#6c757d;--bg:#f9f9f9;--text:#212529;--title:#0d0d0d;--font-sans:'Helvetica Neue',Helvetica,Arial,sans-serif}*{margin:0;padding:0;box-sizing:border-box}body{font-family:var(--font-sans);background:var(--bg);color:var(--text);line-height:1.6}a.topbar{display:flex;align-items:center;padding:1rem 2rem;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.05);text-decoration:none;color:var(--title)}a.topbar .brand-mark{width:42px;height:42px;margin-right:.5rem}#top{display:flex;flex-direction:column;align-items:center;background:#fff;padding:3rem 1rem}.hero{max-width:800px;text-align:center}.hero h1{font-size:2.8rem;color:var(--title);margin-bottom:.5rem}.hero .eyebrow{font-size:.9rem;color:#666;display:block;margin-bottom:1rem}.hero p{font-size:1rem;margin-bottom:2rem}.hero-actions{display:flex;gap:.8rem;justify-content:center}.btn{padding:.8rem 1.5rem;border:none;border-radius:4px;text-decoration:none;color:#fff;font-weight:500;cursor:pointer;transition:background .2s}.btn-primary{background:var(--primary)}.btn-primary:hover{background:#3367d6}.btn-secondary{background:var(--secondary)}.btn-secondary:hover{background:#5a6268}.download-card{background:#f7f7f7;padding:2rem;border-radius:8px;margin-top:2rem;width:100%;max-width:500px;box-shadow:0 2px 6px rgba(0,0,0,.1)}.download-card h2{font-size:1.4rem;margin-bottom:.6rem}.download-card p{font-size:.95rem;margin-bottom:1.2rem}.platform-list{display:flex;gap:1rem;justify-content:center;margin-bottom:1.5rem}.platform-item a{display:block;padding:.6rem 1rem;background:#fff;border:1px solid #ddd;border-radius:4px;text-decoration:none;color:var(--title);font-size:.9rem}.qr-wrap{text-align:center}.qr-text{font-size:.85rem;margin-bottom:.4rem}.qr{width:124px;height:124px}.section{padding:3rem 1rem;background:#fff}.section-title{font-size:1.8rem;text-align:center;margin-bottom:1rem;color:var(--title)}.section-desc{text-align:center;margin-bottom:2rem;color:#555;max-width:700px;margin:auto}.feature-grid{display:flex;flex-wrap:wrap;gap:1.5rem;justify-content:center}.feature-card{background:#fdfdfd;padding:1.5rem;flex:1 1 260px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.08);position:relative}.feature-no{position:absolute;top:-12px;left:-12px;background:var(--primary);color:#fff;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:.8rem}.feature-card h3{font-size:1.2rem;margin-bottom:.5rem;color:var(--title)}.feature-card p{font-size:.9rem;color:#555}#guide .section-desc{max-width:700px;margin:auto}.footer{background:#f1f1f1;padding:2rem 1rem}.footer-card{max-width:800px;margin:auto;text-align:center}.footer-card p{font-size:.85rem;color:#666;margin-bottom:1rem}.footer-links a{margin:0 .5rem;color:var(--primary);text-decoration:none;font-size:.85rem}.footer-links a:hover{text-decoration:underline}@media (max-width:768px){.hero h1{font-size:2.2rem}.hero-actions{flex-direction:column}.platform-list{flex-direction:column}.feature-grid{flex-direction:column}}</style></head><body><a href="/" class="topbar"><img src="https://i.imgant.com/v2/4pGdor9.png" alt="简聊·iM LOGO" class="brand-mark" /><span>简聊·iM</span></a><section id="top"><div class="hero"><h1>简聊·iM</h1><span class="eyebrow">多端互通 · 即下即用</span><p>专注稳定、高效、易用的即时通讯体验。支持 Android、iOS 多端登录，消息同步、文件传输、群聊协作一步到位。</p><div class="hero-actions"><a href="#download" class="btn btn-primary">立即下载</a><a href="#guide" class="btn btn-secondary">安装说明</a></div></div><aside id="download" class="download-card"><h2>扫码或选择版本下载</h2><p>默认推荐下载安装最新客户端。可先使用下方平台按钮直接下载。</p><div class="platform-list"><div class="platform-item"><a href="${escapeHtml(links.android)}" class="platform-link android">Android 下载</a></div><div class="platform-item"><a href="${escapeHtml(links.ios)}" class="platform-link ios">iOS 下载</a></div></div><div class="qr-wrap"><div class="qr-text">扫描二维码直接下载</div><img id="qrImage" src="https://i.imgant.com/v2/4pGdor9.png" alt="简聊·iM 二维码" class="qr" /></div></aside></section><section id="features" class="section"><h2 class="section-title">功能亮点</h2><p class="section-desc">下载页以“品牌展示 + 多端下载 + 清晰引导”为核心，适合直接对外分发，也方便你后续替换成正式安装包与二维码。</p><div class="feature-grid"><article class="feature-card"><span class="feature-no">01</span><h3>清爽品牌首屏</h3><p>首页首屏直接展示简聊·iM 品牌名、产品定位和主要下载入口，便于用户快速识别并完成安装。</p></article><article class="feature-card"><span class="feature-no">02</span><h3>多平台入口</h3><p>页面内置 Android、iOS 两个下载位，后续只需要替换链接即可直接上线使用。</p></article><article class="feature-card"><span class="feature-no">03</span><h3>适配移动端</h3><p>页面已做好响应式布局，手机访问时会自动调整层级和按钮尺寸，适合扫码落地页场景。</p></article></div></section><section id="guide" class="section"><h2 class="section-title">安装指引</h2><p class="section-desc">Android 可直接下载安装包；iOS 建议填写 TestFlight、企业签名页或应用分发页链接。若你是通过机器人获取专属一次性链接，则直接打开形如 <code>/dl/&lt;token&gt;.apk</code> 的地址即可。</p></section><footer class="footer"><div class="footer-card"><p>© 2026 简聊·iM. 保留所有权利。<br>当前页面为独立静态下载页，可直接部署到任意静态站点或下载目录。</p><div class="footer-links"><a href="#download">下载入口</a><a href="#features">功能亮点</a><a href="#guide">安装指引</a></div></div></footer></body></html>`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }

      if (isZhhgHost || isDlJianliaoHost || isDirectDlAlias || isAndroidHost) {
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
    const cbChatType = update.callback_query.message.chat.type || "";
    const cbIsGroup = cbChatType === "group" || cbChatType === "supergroup";
    const cbFromId = update.callback_query.from?.id;
    const cbIsSuper = cbFromId === SUPER_ADMIN;
    const cbOpGroupId = env.OP_GROUP_ID ? parseInt(env.OP_GROUP_ID, 10) : 0;
    if (!cbIsSuper && cbIsGroup && cbOpGroupId && chatId !== cbOpGroupId) {
      return new Response("OK");
    }

    const data = update.callback_query.data;
    if (data === "menu_generate") {
      const keyboard = {
        inline_keyboard: [
          [
            { text: "1 个", callback_data: "get_1" },
            { text: "5 个", callback_data: "get_5" },
            { text: "10 个", callback_data: "get_10" }
          ],
          [{ text: "📡 今日战绩", callback_data: "menu_status" }],
          [{ text: "🔗 当前直链", callback_data: "menu_links" }]
        ]
      };
      await sendTG(chatId, "⚡ 选择要生成的链接数量（今日有效）：", env, keyboard);
      return new Response("OK");
    }
    if (data === "menu_status") await sendTG(chatId, await getStatusText(env), env);
    if (data === "menu_links") {
      const links = await getPublicDownloadLinks(env);
      await sendTG(chatId, `🔗 **当前下载链接**\nAndroid: ${links.android}\niOS: ${links.ios}`, env);
      const aPoster = `https://jianliao.store/qrpng?data=${encodeURIComponent(links.android)}&v=${Date.now()}`;
      const iPoster = `https://jianliao.store/qrpng?data=${encodeURIComponent(links.ios)}&v=${Date.now()}`;
      const aOk = await sendTGPhoto(chatId, aPoster, "Android 下载二维码", env);
      if (!aOk) await sendTGPhoto(chatId, `${qrUrl(links.android)}&v=${Date.now()}`, "Android 下载二维码", env);
      const iOk = await sendTGPhoto(chatId, iPoster, "iOS 下载二维码", env);
      if (!iOk) await sendTGPhoto(chatId, `${qrUrl(links.ios)}&v=${Date.now()}`, "iOS 下载二维码", env);
      return new Response("OK");
    }

    if ((cbIsGroup || cbIsSuper) && (data === "get_1" || data === "get_5" || data === "get_10")) {
      const count = parseInt(data.replace("get_", ""), 10) || 10;
      const ref = String(cbFromId || "");
      const ttl = secondsUntilBJ2359();
      for (let i = 0; i < count; i++) {
        const token = crypto.randomUUID().replace(/-/g, "");
        await env.DB.put(`DL_TOKEN_${token}`, JSON.stringify({ ref, ts: Date.now() }), { expirationTtl: ttl });
        await sendTGPlain(chatId, `https://zhhg.online/dl/${token}.apk`, env);
      }
      return new Response("OK");
    }
    return new Response("OK");
  }

  const chatId = update.message?.chat.id;
  const text = (update.message?.text || "").trim();
  const textLower = text.toLowerCase();
  const fromId = update.message?.from?.id;
  const isSuper = fromId === SUPER_ADMIN;

  if (!text) return new Response("OK");

  const opGroupId = env.OP_GROUP_ID ? parseInt(env.OP_GROUP_ID, 10) : 0;
  if (!isSuper && isGroup && opGroupId && chatId !== opGroupId) {
    return new Response("OK");
  }

  if (isPrivate && !isSuper) {
    await sendTG(chatId, "请回到群内操作。", env);
    return new Response("OK");
  }

  if (text === "/start") {
    const keyboard = {
      inline_keyboard: [
        [
          { text: "⚡ 1个链路", callback_data: "get_1" },
          { text: "⚡ 5个链路", callback_data: "get_5" },
          { text: "⚡ 10个链路", callback_data: "get_10" }
        ],
        [{ text: "📡 今日战绩", callback_data: "menu_status" }],
        [{ text: "🔗 当前直链", callback_data: "menu_links" }]
      ]
    };
    await sendTG(chatId, `欢迎使用 **简聊·iM**\n\n点击按钮即可操作。`, env, keyboard);
    return new Response("OK");
  }

  if (text === "/help") {
    await sendTG(chatId, `/start - 显示功能菜单与快捷按钮\n/help - 查看指令帮助与用法\n/get <数量> - 生成当日一次性下载链接（1-10，默认10，仅群内）\n/pool - 查看今日战绩与系统状态\n/update - 上传 APK（需携带 .apk 文件，管理员/授权用户可用）\n/links - 查看当前 Android/iOS 公共下载链接\n/set android <url> - 设置 Android 公共下载链接\n/set ios <url> - 设置 iOS 公共下载链接`, env);
    return new Response("OK");
  }

  if (text === "/links") {
    const links = await getPublicDownloadLinks(env);
    await sendTG(chatId, `🔗 **当前下载链接**\nAndroid: ${links.android}\niOS: ${links.ios}`, env);
    const aPoster = `https://jianliao.store/qrpng?data=${encodeURIComponent(links.android)}&v=${Date.now()}`;
    const iPoster = `https://jianliao.store/qrpng?data=${encodeURIComponent(links.ios)}&v=${Date.now()}`;
    const aOk = await sendTGPhoto(chatId, aPoster, "Android 下载二维码", env);
    if (!aOk) await sendTGPhoto(chatId, `${qrUrl(links.android)}&v=${Date.now()}`, "Android 下载二维码", env);
    const iOk = await sendTGPhoto(chatId, iPoster, "iOS 下载二维码", env);
    if (!iOk) await sendTGPhoto(chatId, `${qrUrl(links.ios)}&v=${Date.now()}`, "iOS 下载二维码", env);
    return new Response("OK");
  }

  if (text === "/qr") {
    if (!isGroup) return new Response("OK");
    const replied = update.message?.reply_to_message;
    const payload =
      (replied && typeof replied.text === "string" && replied.text.trim()) ? replied.text.trim() :
      (replied && typeof replied.caption === "string" && replied.caption.trim()) ? replied.caption.trim() :
      "";
    if (!payload) {
      await sendTG(chatId, "用法：回复一条消息，然后发送 /qr（将被回复消息内容转二维码）", env);
      return new Response("OK");
    }
    const photo = `https://jianliao.store/qrpng?data=${encodeURIComponent(payload)}&v=${Date.now()}`;
    const ok = await sendTGPhoto(chatId, photo, "二维码（PNG）", env);
    if (!ok) {
      await sendTGPhoto(chatId, `${qrUrl(payload)}&v=${Date.now()}`, "二维码（PNG）", env);
    }
    return new Response("OK");
  }

  if (textLower === "/l" || text === "/链接") {
    if (!isGroup) return new Response("OK");
    const ref = String(fromId);
    const ttl = secondsUntilBJ2359();
    for (let i = 0; i < 5; i++) {
      const token = crypto.randomUUID().replace(/-/g, "");
      await env.DB.put(`DL_TOKEN_${token}`, JSON.stringify({ ref, ts: Date.now() }), { expirationTtl: ttl });
      await sendTGPlain(chatId, `https://zhhg.online/dl/${token}.apk`, env);
    }
    return new Response("OK");
  }

  if ((isGroup || isSuper) && (text === "/set" || text.startsWith("/set "))) {
    const parts = text.split(" ").filter(Boolean);
    const key = (parts[1] || "").toLowerCase();
    const url = parts.slice(2).join(" ").trim();
    if (!key || !url) {
      await sendTG(chatId, "用法：/set android|ios <url>", env);
      return new Response("OK");
    }
    if (!/^https?:\/\//i.test(url)) {
      await sendTG(chatId, "❌ URL 必须以 http:// 或 https:// 开头", env);
      return new Response("OK");
    }
    let storeKey = "";
    if (key === "android") storeKey = "PUBLIC_DL_ANDROID";
    if (key === "ios") storeKey = "PUBLIC_DL_IOS";
    if (!storeKey) {
      await sendTG(chatId, "❌ 平台仅支持 android / ios", env);
      return new Response("OK");
    }
    await env.DB.put(storeKey, url);
    await sendTG(chatId, `✅ 已更新 ${key} 链接`, env);
    return new Response("OK");
  }

  if (text === "/get" || text.startsWith("/get ")) {
    if (!isGroup) return new Response("OK");
    const ref = String(fromId);
    const parts = text.split(" ").filter(Boolean);
    const count = Math.max(1, Math.min(parseInt(parts[1] || "5", 10) || 5, 10));

    const ttl = secondsUntilBJ2359();
    for (let i = 0; i < count; i++) {
      const token = crypto.randomUUID().replace(/-/g, "");
      await env.DB.put(`DL_TOKEN_${token}`, JSON.stringify({ ref, ts: Date.now() }), { expirationTtl: ttl });
      await sendTGPlain(chatId, `https://zhhg.online/dl/${token}.apk`, env);
    }
    return new Response("OK");
  }

  if (text === "/pool") {
    const pool = (await env.DB.list({ prefix: "DOMAIN_GLOBAL_" })).keys.length;
    const ymd = new Date().toISOString().slice(0, 10);
    const report = await buildDailyReport(env, ymd);
    await sendTG(chatId, `🌐 **今日战绩 ${ymd}**\n域名池：${pool} 个\n\n${report}`, env);
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

async function sendTGPlain(chatId, text, env) {
  const body = { chat_id: chatId, text };
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    return res.ok;
  } catch {
    return false;
  }
}

function qrUrl(data) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(data)}`;
}

async function sendTGPhoto(chatId, photoUrl, caption, env) {
  const body = { chat_id: chatId, photo: photoUrl };
  if (caption) body.caption = caption;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendPhoto`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendTGDocument(chatId, docUrl, filename, caption, env) {
  const body = { chat_id: chatId, document: docUrl };
  if (caption) body.caption = caption;
  if (filename) body.filename = filename;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendDocument`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function buildPosterSvg(data) {
  const qr = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=600x600&format=svg&margin=4&data=${encodeURIComponent(data)}`);
  const qrSvg = await qr.text();
  const inner = extractSvgInner(qrSvg);
  const logoUrl = "https://i.imgant.com/v2/4pGdor9.png";
  const logoData = await fetchAsDataUri(logoUrl, "image/png");
  const partnerTencent = await fetchAsDataUri("https://i.imgant.com/v2/Lg3QrGT.png", "image/png");
  const partnerByte = await fetchAsDataUri("https://i.imgant.com/v2/SbQ2wKK.png", "image/png");
  const partnerKuaishou = await fetchAsDataUri("https://i.imgant.com/v2/8vUejKW.png", "image/png");
  const partnerNetease = await fetchAsDataUri("https://i.imgant.com/v2/VTMEzUx.png", "image/png");

  const canvasW = 1080, canvasH = 1280;
  const bg = "#f5f7fa";
  const centerX = canvasW / 2;
  const margin = 86;
  const contentW = canvasW - margin * 2;

  const headerY1 = 196;
  const headerY2 = 274;

  const cardW = 640;
  const cardPad = 52;
  const cardX = (canvasW - cardW) / 2;
  const cardY = 348;
  const cardR = 64;

  const qrSize = 500;
  const qrX = cardX + (cardW - qrSize) / 2;
  const qrY = cardY + cardPad;

  const logoPx = 112;
  const cx = qrX + qrSize / 2;
  const cy = qrY + qrSize / 2;
  const r = logoPx / 2;

  const partnersBoxW = contentW;
  const partnersBoxX = margin;
  const partnersBoxY = cardY + cardW + 72;
  const partnersBoxR = 28;

  const dividerY = partnersBoxY + 38;
  const gridY = dividerY + 58;
  const tileW = (partnersBoxW - 18) / 2;
  const tileH = 92;
  const gap = 18;
  const gridX1 = partnersBoxX;
  const gridX2 = partnersBoxX + tileW + gap;
  const row1Y = gridY;
  const row2Y = gridY + tileH + gap;

  const iconSize = 72;
  const iconGap = 20;
  const iconX1 = gridX1 + 8;
  const iconX2 = gridX2 + 8;
  const iconY1 = row1Y + (tileH - iconSize) / 2;
  const iconY2 = row2Y + (tileH - iconSize) / 2;
  const textX1 = iconX1 + iconSize + iconGap;
  const textX2 = iconX2 + iconSize + iconGap;
  const textY1 = row1Y + tileH / 2;
  const textY2 = row2Y + tileH / 2;

  const taglineY = row2Y + tileH + 66;
  const partnersBoxH = (taglineY + 44) - partnersBoxY;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="26" stdDeviation="22" flood-color="#000" flood-opacity="0.10"/>
    </filter>
    <filter id="shadow2" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#000" flood-opacity="0.10"/>
    </filter>
    <radialGradient id="bgGlow1" cx="20%" cy="10%" r="60%">
      <stop offset="0" stop-color="#7c3aed" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bgGlow2" cx="78%" cy="24%" r="55%">
      <stop offset="0" stop-color="#2563eb" stop-opacity="0.10"/>
      <stop offset="1" stop-color="#2563eb" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="100%" height="100%" fill="${bg}"/>
  <rect width="100%" height="100%" fill="url(#bgGlow1)"/>
  <rect width="100%" height="100%" fill="url(#bgGlow2)"/>

  <text x="${centerX}" y="${headerY1}" font-size="62" fill="#141414" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-weight="900">官方安全下载通道</text>
  <text x="${centerX}" y="${headerY2}" font-size="34" fill="#7c3aed" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-weight="900" letter-spacing="1">请使用手机浏览器扫描下方二维码</text>

  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardW}" rx="${cardR}" fill="#ffffff" filter="url(#shadow)"/>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardW}" rx="${cardR}" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="2"/>
  <g transform="translate(${qrX},${qrY}) scale(${qrSize/600})">
    ${inner}
  </g>

  <rect x="${cx - r}" y="${cy - r}" width="${logoPx}" height="${logoPx}" rx="24" fill="#ffffff" filter="url(#shadow2)"/>
  <rect x="${cx - r + 8}" y="${cy - r + 8}" width="${logoPx - 16}" height="${logoPx - 16}" rx="18" fill="#ffffff"/>
  <image x="${cx - r + 8}" y="${cy - r + 8}" width="${logoPx - 16}" height="${logoPx - 16}" href="${logoData}" preserveAspectRatio="xMidYMid meet"/>

  <!-- partners box frame removed -->
  <g>
    <line x1="${centerX - 300}" y1="${dividerY}" x2="${centerX - 132}" y2="${dividerY}" stroke="rgba(0,0,0,0.12)" stroke-width="2"/>
    <text x="${centerX}" y="${dividerY + 6}" font-size="30" fill="#4f5964" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" letter-spacing="4" font-weight="900">官方合作伙伴</text>
    <line x1="${centerX + 132}" y1="${dividerY}" x2="${centerX + 300}" y2="${dividerY}" stroke="rgba(0,0,0,0.12)" stroke-width="2"/>
  </g>

  <g>
    <!-- partner tiles: no background cards -->
    <image x="${iconX1}" y="${iconY1}" width="${iconSize}" height="${iconSize}" href="${partnerTencent}" preserveAspectRatio="xMidYMid meet"/>
    <text x="${textX1}" y="${textY1}" font-size="28" fill="#2a2f35" text-anchor="start" dominant-baseline="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-weight="900">腾讯</text>

    <image x="${iconX2}" y="${iconY1}" width="${iconSize}" height="${iconSize}" href="${partnerByte}" preserveAspectRatio="xMidYMid meet"/>
    <text x="${textX2}" y="${textY1}" font-size="28" fill="#2a2f35" text-anchor="start" dominant-baseline="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-weight="900">抖音</text>

    <image x="${iconX1}" y="${iconY2}" width="${iconSize}" height="${iconSize}" href="${partnerKuaishou}" preserveAspectRatio="xMidYMid meet"/>
    <text x="${textX1}" y="${textY2}" font-size="28" fill="#2a2f35" text-anchor="start" dominant-baseline="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-weight="900">快手</text>

    <image x="${iconX2}" y="${iconY2}" width="${iconSize}" height="${iconSize}" href="${partnerNetease}" preserveAspectRatio="xMidYMid meet"/>
    <text x="${textX2}" y="${textY2}" font-size="28" fill="#2a2f35" text-anchor="start" dominant-baseline="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-weight="900">网易</text>
  </g>

  <text x="50%" y="${taglineY}" font-size="24" fill="#7c3aed" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-weight="900">联合推荐 · 安全下载</text>

</svg>`;
}

function extractSvgInner(svg) {
  const m = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  return m ? m[1] : svg;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

async function fetchAsDataUri(url, mime) {
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const ct = res.headers.get("content-type") || "";
    const resolved = ct.split(";")[0].trim() || mime || "application/octet-stream";
    const buf = await res.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    return `data:${resolved};base64,${b64}`;
  } catch {
    return url;
  }
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function allowHotlink(request) {
  const allowDomains = [
    "https://jianliao.store",
    "https://xn--xyz11h.xn--fiqs8s",
    "https://zhhg.online"
  ];
  const referer = request.headers.get("referer") || "";
  const origin = request.headers.get("origin") || "";
  if (!referer && !origin) return true;
  for (const d of allowDomains) {
    if (referer.includes(d) || origin.includes(d)) return true;
  }
  return false;
}

async function getPublicDownloadLinks(env) {
  const defAndroid = "https://dl.zhhg.online/latest.apk";
  const defIos = "https://zhhg.online/";
  try {
    const android = (await env.DB.get("PUBLIC_DL_ANDROID")) || defAndroid;
    const ios = (await env.DB.get("PUBLIC_DL_IOS")) || defIos;
    return { android, ios };
  } catch {
    return { android: defAndroid, ios: defIos };
  }
}

async function verifyTurnstile(responseToken, request, secret) {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", responseToken);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.success;
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