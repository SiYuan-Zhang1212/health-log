/**
 * 健康日志 · Cloudflare Worker
 *
 * 一个 Worker 同时负责：
 *   - 静态资源：web/ 目录（Workers Static Assets，未登录也能打开外壳，但拿不到数据）
 *   - /api/*  ：登录鉴权 + D1 单文档读写 + DeepSeek 代理 + 快照备份
 *
 * 需要配置的 Secrets（wrangler secret put NAME）：
 *   APP_PASSWORD        登录密码（必须，没设就拒绝启动）
 *   SESSION_SECRET      会话签名密钥（强烈建议，未设时退化为用 APP_PASSWORD 签名）
 *   CLI_TOKEN           命令行工具用的 Bearer 令牌（可选）
 *   DEEPSEEK_API_KEY    DeepSeek Key（可选；不设则用网页里保存的那份）
 *
 * 数据存在 D1 的 docs 表单行里（id='main'），用 rev 做乐观锁，写入时原子自增。
 */

const COOKIE_NAME = 'hk_session';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 天
const MAX_BODY = 20 * 1024 * 1024;     // 20MB，和本地版一致
const MAX_SNAPSHOTS = 30;              // 保留最近 30 份快照
const LOGIN_WINDOW = 15 * 60;          // 登录失败统计窗口：15 分钟
const LOGIN_MAX_FAILS = 10;            // 同 IP 窗口内最多失败次数
const DEFAULT_MODEL = 'deepseek-v4-flash-vision-exp';

const DEFAULT_DB = {
  meals: {}, workouts: [], measures: [], conditions: {}, supplements: {},
  goals: { weight: null, bodyFat: null, targetDate: null },
  profile: {}, advices: [], coachTips: [],
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      // 静态资源：有 assets 绑定时由这里转发；没有绑定则由平台自动处理
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not Found', { status: 404 });
    }

    try {
      return await handleApi(request, env, ctx, url);
    } catch (e) {
      return json(500, { ok: false, error: '服务器错误：' + (e && e.message ? e.message : String(e)) });
    }
  },
};

async function handleApi(request, env, ctx, url) {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204 });

  /* ---------- 不需要登录的接口 ---------- */
  if (path === '/api/ping' && method === 'GET') {
    return json(200, { ok: true, app: 'health-log', cloud: true, time: Date.now() / 1000 });
  }

  if (path === '/api/login' && method === 'POST') {
    return login(request, env, url);
  }

  if (path === '/api/logout' && method === 'POST') {
    return jsonWithHeaders(200, { ok: true }, {
      'Set-Cookie': sessionCookie('', 0, url.protocol === 'https:'),
    });
  }

  /* ---------- 以下全部需要登录 ---------- */
  const auth = await authenticate(request, env);
  if (!auth) return json(401, { ok: false, error: '未登录或登录已过期', authRequired: true });

  switch (path) {
    case '/api/me':
      return json(200, {
        ok: true, authed: true, via: auth.via, cloud: true,
        aiConfigured: !!(env.DEEPSEEK_API_KEY || await getConfig(env, 'deepseek_key')),
      });

    case '/api/db':
      if (method === 'GET') return getDB(env);
      if (method === 'POST') return postDB(request, env, ctx);
      break;

    case '/api/key':
      if (method === 'GET') {
        // 永远不回传 Key 本身，只告诉前端「配没配」
        return json(200, { ok: true, configured: !!(env.DEEPSEEK_API_KEY || await getConfig(env, 'deepseek_key')) });
      }
      if (method === 'POST') return setKey(request, env);
      if (method === 'DELETE') {
        await putConfig(env, 'deepseek_key', '');
        return json(200, { ok: true, configured: !!env.DEEPSEEK_API_KEY });
      }
      break;

    case '/api/ai/chat':
      if (method === 'POST') return aiChat(request, env);
      break;

    case '/api/export':
      if (method === 'GET') return exportDB(env);
      break;

    case '/api/snapshots':
      if (method === 'GET') return listSnapshots(env);
      break;

    case '/api/restore':
      if (method === 'POST') return restoreSnapshot(request, env, ctx);
      break;

    default:
      break;
  }

  return json(404, { ok: false, error: '接口不存在：' + method + ' ' + path });
}

/* ================= 鉴权 ================= */

async function authenticate(request, env) {
  if (!env.APP_PASSWORD) return null;

  // 1) 命令行 / 脚本用 Bearer 令牌
  const header = request.headers.get('Authorization') || '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (env.CLI_TOKEN && token && await sameSecret(token, env.CLI_TOKEN)) return { via: 'token' };
    if (token && await sameSecret(token, env.APP_PASSWORD)) return { via: 'token' };
  }

  // 2) 浏览器用签名 Cookie
  const cookie = getCookie(request, COOKIE_NAME);
  if (cookie && await verifySession(cookie, env)) return { via: 'cookie' };

  return null;
}

async function login(request, env, url) {
  if (!env.APP_PASSWORD) {
    return json(500, { ok: false, error: '服务器未设置 APP_PASSWORD，请先执行 wrangler secret put APP_PASSWORD' });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await loginAllowed(env, ip))) {
    return json(429, { ok: false, error: '登录失败次数过多，请 15 分钟后再试' });
  }

  let password = '';
  try {
    const body = await readJson(request, 4096);
    password = String(body.password || '');
  } catch (e) {
    return json(400, { ok: false, error: e.message });
  }

  if (!password || !(await sameSecret(password, env.APP_PASSWORD))) {
    await recordFailure(env, ip);
    await sleep(400); // 稍微拖慢暴力破解
    return json(401, { ok: false, error: '密码不对' });
  }

  await clearFailures(env, ip);
  const token = await makeSession(env);
  return jsonWithHeaders(200, { ok: true }, {
    'Set-Cookie': sessionCookie(token, SESSION_TTL, url.protocol === 'https:'),
  });
}

async function makeSession(env) {
  const payload = b64u(new TextEncoder().encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  })));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(payload)));
  return payload + '.' + sig;
}

async function verifySession(token, env) {
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), new TextEncoder().encode(payload)));
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(enc(sig), enc(expected))) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return typeof data.exp === 'number' && data.exp > Math.floor(Date.now() / 1000);
  } catch (e) {
    return false;
  }
}

async function hmacKey(env) {
  const secret = env.SESSION_SECRET || env.APP_PASSWORD || '';
  return crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** 常数时间比较两个字符串（先摘要成等长，避免长度泄漏） */
async function sameSecret(a, b) {
  const da = new Uint8Array(await crypto.subtle.digest('SHA-256', enc(String(a))));
  const db = new Uint8Array(await crypto.subtle.digest('SHA-256', enc(String(b))));
  return timingSafeEqual(da, db);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---------- 登录失败限流（D1 记一笔，防跨实例绕过） ---------- */

async function loginAllowed(env, ip) {
  const since = Math.floor(Date.now() / 1000) - LOGIN_WINDOW;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ?1 AND ts > ?2'
  ).bind(ip, since).first();
  return !row || (row.n || 0) < LOGIN_MAX_FAILS;
}

async function recordFailure(env, ip) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?1, ?2)').bind(ip, now).run();
  await env.DB.prepare('DELETE FROM login_attempts WHERE ts < ?1').bind(now - 86400).run();
}

async function clearFailures(env, ip) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?1').bind(ip).run();
}

/* ================= 数据读写 ================= */

async function getDB(env) {
  const row = await env.DB.prepare('SELECT rev, data FROM docs WHERE id = ?1').bind('main').first();
  if (!row) return json(200, { ok: true, rev: 0, db: DEFAULT_DB });
  let db;
  try {
    db = JSON.parse(row.data);
  } catch (e) {
    return json(500, { ok: false, error: '服务器数据损坏，请用快照恢复' });
  }
  return json(200, { ok: true, rev: row.rev || 0, db });
}

async function postDB(request, env, ctx) {
  let payload;
  try {
    payload = await readJson(request, MAX_BODY);
  } catch (e) {
    return json(400, { ok: false, error: e.message });
  }

  let expectedRev = null;
  let db = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'db' in payload) {
    expectedRev = payload.rev === undefined ? null : payload.rev;
    db = payload.db;
  }
  if (!validDB(db)) return json(400, { ok: false, error: '数据结构不合法' });

  const result = await writeDoc(env, db, expectedRev);
  if (!result.ok) return json(409, { ok: false, error: 'conflict', rev: result.rev });

  // 快照放到响应之后做，不拖慢保存
  ctx.waitUntil(saveSnapshot(env, result.rev, db));
  return json(200, { ok: true, rev: result.rev });
}

function validDB(db) {
  if (!db || typeof db !== 'object' || Array.isArray(db)) return false;
  const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  return isPlainObj(db.meals) && isPlainObj(db.conditions) && isPlainObj(db.goals)
    && Array.isArray(db.workouts) && Array.isArray(db.measures);
}

/** 写入：rev 匹配才写（乐观锁），rev 为 null 时强制覆盖 */
async function writeDoc(env, db, expectedRev) {
  const data = JSON.stringify(db);
  const now = Date.now();

  if (expectedRev === null || expectedRev === undefined) {
    await env.DB.prepare(
      `INSERT INTO docs (id, rev, data, updated_at) VALUES ('main', 1, ?1, ?2)
       ON CONFLICT(id) DO UPDATE SET rev = docs.rev + 1, data = excluded.data, updated_at = excluded.updated_at`
    ).bind(data, now).run();
    const row = await env.DB.prepare('SELECT rev FROM docs WHERE id = ?1').bind('main').first();
    return { ok: true, rev: (row && row.rev) || 1 };
  }

  const res = await env.DB.prepare(
    'UPDATE docs SET rev = rev + 1, data = ?1, updated_at = ?2 WHERE id = ?3 AND rev = ?4'
  ).bind(data, now, 'main', expectedRev).run();

  if (!res.meta || res.meta.changes === 0) {
    const row = await env.DB.prepare('SELECT rev FROM docs WHERE id = ?1').bind('main').first();
    if (!row && Number(expectedRev) === 0) {
      // 首次写入
      await env.DB.prepare(
        'INSERT INTO docs (id, rev, data, updated_at) VALUES (?1, 1, ?2, ?3)'
      ).bind('main', data, now).run();
      return { ok: true, rev: 1 };
    }
    return { ok: false, rev: (row && row.rev) || 0 };
  }

  return { ok: true, rev: Number(expectedRev) + 1 };
}

/* ---------- 快照 ---------- */

async function saveSnapshot(env, rev, db) {
  try {
    await env.DB.prepare('INSERT INTO snapshots (rev, data, created_at) VALUES (?1, ?2, ?3)')
      .bind(rev, JSON.stringify(db), Date.now()).run();
    await env.DB.prepare(
      'DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?1)'
    ).bind(MAX_SNAPSHOTS).run();
  } catch (e) {
    // 快照失败不影响主流程（D1 还有 Time Travel 兜底）
  }
}

async function listSnapshots(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, rev, created_at, LENGTH(data) AS size FROM snapshots ORDER BY id DESC LIMIT 50'
  ).all();
  return json(200, { ok: true, snapshots: results || [] });
}

async function restoreSnapshot(request, env, ctx) {
  let id;
  try {
    const body = await readJson(request, 4096);
    id = Number(body.id);
  } catch (e) {
    return json(400, { ok: false, error: e.message });
  }
  if (!Number.isFinite(id)) return json(400, { ok: false, error: '缺少快照 id' });

  const row = await env.DB.prepare('SELECT rev, data FROM snapshots WHERE id = ?1').bind(id).first();
  if (!row) return json(404, { ok: false, error: '快照不存在' });

  const current = await env.DB.prepare('SELECT rev, data FROM docs WHERE id = ?1').bind('main').first();
  if (current) {
    ctx.waitUntil(saveSnapshot(env, current.rev || 0, JSON.parse(current.data)));
  }

  const db = JSON.parse(row.data);
  const result = await writeDoc(env, db, null);
  return json(200, { ok: true, rev: result.rev, restoredFrom: id });
}

async function exportDB(env) {
  const row = await env.DB.prepare('SELECT rev, data FROM docs WHERE id = ?1').bind('main').first();
  const db = row ? JSON.parse(row.data) : DEFAULT_DB;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(db, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="health-log-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

/* ================= 配置（DeepSeek Key） ================= */

async function getConfig(env, key) {
  const row = await env.DB.prepare('SELECT value FROM config WHERE key = ?1').bind(key).first();
  return row ? row.value : '';
}

async function putConfig(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, Date.now()).run();
}

async function setKey(request, env) {
  let key = '';
  try {
    const body = await readJson(request, 4096);
    key = String(body.key || '').trim();
  } catch (e) {
    return json(400, { ok: false, error: e.message });
  }
  if (!key) return json(400, { ok: false, error: 'key 不能为空' });
  await putConfig(env, 'deepseek_key', key);
  return json(200, { ok: true, configured: true });
}

/* ================= DeepSeek 代理 ================= */

async function aiChat(request, env) {
  let body;
  try {
    body = await readJson(request, 1024 * 1024);
  } catch (e) {
    return json(400, { ok: false, error: e.message });
  }

  const key = env.DEEPSEEK_API_KEY || (await getConfig(env, 'deepseek_key'));
  if (!key) return json(400, { ok: false, error: '还没有配置 DeepSeek API Key，请在「设置」里填写' });

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length) return json(400, { ok: false, error: '缺少 messages' });

  const payload = {
    model: body.model || DEFAULT_MODEL,
    messages,
    stream: false,
  };
  if (body.jsonMode) payload.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json(502, { ok: false, error: '无法连接 DeepSeek：' + e.message });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return json(502, { ok: false, error: 'DeepSeek HTTP ' + res.status + ' ' + text.slice(0, 200) });
  }

  const data = await res.json().catch(() => null);
  const choice = data && data.choices && data.choices[0];
  if (!choice || !choice.message) return json(502, { ok: false, error: 'DeepSeek 返回异常' });
  return json(200, { ok: true, content: choice.message.content });
}

/* ================= 小工具 ================= */

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function jsonWithHeaders(status, obj, extra) {
  const res = json(status, obj);
  const headers = new Headers(res.headers);
  Object.keys(extra || {}).forEach((k) => headers.set(k, extra[k]));
  return new Response(res.body, { status, headers });
}

async function readJson(request, limit) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > limit) throw new Error('请求体过大');
  const text = await request.text();
  if (text.length > limit) throw new Error('请求体过大');
  if (!text) throw new Error('请求体为空');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('JSON 解析失败');
  }
}

function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function sessionCookie(value, maxAge, secure) {
  return COOKIE_NAME + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}

const enc = (s) => new TextEncoder().encode(s);

function b64u(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(pad + '==='.slice((pad.length + 3) % 4)), (c) => c.charCodeAt(0));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
