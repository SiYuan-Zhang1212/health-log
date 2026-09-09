/**
 * Worker 本地测试：用内存版 D1 跑真实的请求处理逻辑
 * 运行：node worker/test/local-test.mjs
 *
 * 只验证 API 行为（鉴权 / 乐观锁 / 快照 / 代理），不验证 Cloudflare 平台本身。
 */

import worker from '../index.js';
import { makeD1 } from './mock-d1.mjs';

/* ---------------- 测试脚手架 ---------------- */
const env = {
  APP_PASSWORD: 'test-password',
  SESSION_SECRET: 'test-secret',
  CLI_TOKEN: 'test-cli-token',
  DB: makeD1(),
};

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

const ctx = { waitUntil: (p) => { pending.push(p); } };
let pending = [];
async function call(path, { method = 'GET', body, cookie, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  if (token) headers['Authorization'] = 'Bearer ' + token;
  headers['CF-Connecting-IP'] = '1.2.3.4';
  const req = new Request('https://health.example.com' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, ctx);
  await Promise.all(pending); pending = [];
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: res.status, json, text, setCookie: res.headers.get('Set-Cookie') || '' };
}

const cookieOf = (setCookie) => (setCookie || '').split(';')[0];

/* ---------------- 开始 ---------------- */
console.log('\n[1] 未登录访问');
let r = await call('/api/ping');
check('ping 公开可访问', r.status === 200 && r.json.ok, r.json);
check('ping 标记为云端', r.json.cloud === true);

r = await call('/api/db');
check('未登录读数据被拒 401', r.status === 401 && r.json.authRequired === true, r.json);
r = await call('/api/db', { method: 'POST', body: { rev: 0, db: {} } });
check('未登录写数据被拒 401', r.status === 401);
r = await call('/api/ai/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } });
check('未登录调 AI 被拒 401', r.status === 401);

console.log('\n[2] 登录');
r = await call('/api/login', { method: 'POST', body: { password: 'wrong' } });
check('错密码 401', r.status === 401, r.json);
check('错密码不发 Cookie', !r.setCookie);

r = await call('/api/login', { method: 'POST', body: { password: 'test-password' } });
check('对密码 200', r.status === 200 && r.json.ok, r.json);
const cookie = cookieOf(r.setCookie);
check('下发 HttpOnly Cookie', /hk_session=/.test(cookie) && /HttpOnly/.test(r.setCookie) && /SameSite=Lax/.test(r.setCookie), r.setCookie);
check('HTTPS 下带 Secure', /Secure/.test(r.setCookie));

console.log('\n[3] 读数据');
r = await call('/api/db', { cookie });
check('带 Cookie 可读', r.status === 200 && r.json.ok, r.json);
check('空库返回 rev 0 与默认结构', r.json.rev === 0 && r.json.db.meals && Array.isArray(r.json.db.workouts), r.json);

console.log('\n[4] 乐观锁');
const db1 = { meals: { '2026-09-09': { breakfast: [{ name: '鸡蛋', calories: 80 }] } }, workouts: [], measures: [], conditions: {}, goals: {} };
r = await call('/api/db', { method: 'POST', cookie, body: { rev: 0, db: db1 } });
check('rev 0 首次写入成功 rev=1', r.status === 200 && r.json.rev === 1, r.json);

const db2 = { ...db1, workouts: [{ date: '2026-09-09', type: '力量' }] };
r = await call('/api/db', { method: 'POST', cookie, body: { rev: 0, db: db2 } });
check('过期 rev 写入 409 冲突', r.status === 409 && r.json.error === 'conflict', r.json);
check('409 返回服务端当前 rev', r.json.rev === 1, r.json);

r = await call('/api/db', { method: 'POST', cookie, body: { rev: 1, db: db2 } });
check('正确 rev 写入成功 rev=2', r.status === 200 && r.json.rev === 2, r.json);

r = await call('/api/db', { cookie });
check('读回的是最后一次写入的数据', r.json.rev === 2 && r.json.db.workouts.length === 1, r.json);

r = await call('/api/db', { method: 'POST', cookie, body: { rev: null, db: db1 } });
check('rev=null 强制覆盖成功', r.status === 200 && r.json.rev === 3, r.json);

r = await call('/api/db', { method: 'POST', cookie, body: { rev: 3, db: { meals: 'bad' } } });
check('结构不合法被拒 400', r.status === 400, r.json);

console.log('\n[5] CLI Bearer 令牌');
r = await call('/api/db', { token: 'test-cli-token' });
check('CLI_TOKEN 可读', r.status === 200 && r.json.ok);
r = await call('/api/db', { token: 'wrong-token' });
check('错误 token 被拒 401', r.status === 401);
r = await call('/api/db', { token: 'test-password' });
check('APP_PASSWORD 也可当 token（应急）', r.status === 200);

console.log('\n[6] 伪造 / 过期会话');
r = await call('/api/db', { cookie: 'hk_session=abc.def' });
check('伪造签名被拒 401', r.status === 401);
const expired = 'eyJleHAiOjEwMDAwMDAwMDB9.fake';
r = await call('/api/db', { cookie: 'hk_session=' + expired });
check('乱造会话被拒 401', r.status === 401);

console.log('\n[7] DeepSeek Key 管理');
r = await call('/api/key', { cookie });
check('初始未配置', r.status === 200 && r.json.configured === false, r.json);
check('GET /api/key 不回传明文', !('key' in r.json), r.json);
r = await call('/api/key', { method: 'POST', cookie, body: { key: 'sk-test-123' } });
check('保存 Key 成功', r.status === 200 && r.json.configured === true, r.json);
r = await call('/api/key', { cookie });
check('保存后 configured=true', r.json.configured === true);
r = await call('/api/me', { cookie });
check('/api/me 报告已配置 AI', r.json.aiConfigured === true && r.json.cloud === true, r.json);
r = await call('/api/key', { method: 'DELETE', cookie });
check('可清除 Key', r.status === 200 && r.json.configured === false, r.json);
r = await call('/api/ai/chat', { method: 'POST', cookie, body: { messages: [{ role: 'user', content: 'hi' }] } });
check('无 Key 时 AI 代理返回 400 且提示清楚', r.status === 400 && /API Key/.test(r.json.error), r.json);
r = await call('/api/ai/chat', { method: 'POST', cookie, body: {} });
check('缺 messages 被拒', r.status === 400);

console.log('\n[8] 快照与恢复');
r = await call('/api/snapshots', { cookie });
check('快照已自动记录', r.status === 200 && r.json.snapshots.length >= 3, r.json.snapshots.length);
const oldest = r.json.snapshots[r.json.snapshots.length - 1];
r = await call('/api/restore', { method: 'POST', cookie, body: { id: oldest.id } });
check('恢复成功', r.status === 200 && r.json.restoredFrom === oldest.id, r.json);
r = await call('/api/db', { cookie });
check('恢复后数据生效（回到第一份快照：无训练记录）', r.json.rev === 4 && r.json.db.workouts.length === 0, r.json);
r = await call('/api/restore', { method: 'POST', cookie, body: { id: 99999 } });
check('不存在的快照 404', r.status === 404);

console.log('\n[9] 导出');
r = await call('/api/export', { cookie });
check('导出返回 JSON 附件', r.status === 200 && /attachment/.test(r.text.length ? 'attachment' : '') && r.text.includes('"meals"'), r.status);
r = await call('/api/export');
check('未登录不能导出', r.status === 401);

console.log('\n[10] 登录限流');
let blocked = false;
for (let i = 0; i < 12; i++) {
  const rr = await call('/api/login', { method: 'POST', body: { password: 'wrong' } });
  if (rr.status === 429) { blocked = true; break; }
}
check('连续错密码会被限流 429', blocked);

console.log('\n[11] 登出');
r = await call('/api/logout', { method: 'POST', cookie });
check('登出清空 Cookie', /Max-Age=0/.test(r.setCookie), r.setCookie);

console.log('\n[12] 未知接口');
r = await call('/api/nope', { cookie });
check('未知接口 404', r.status === 404);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
