/**
 * 本地模拟云端：静态文件 + Worker API（内存 D1），用来验证「登录 → 记录 → 保存」整条链路。
 * 不连真实 Cloudflare，重启即清空。
 *
 * 运行：node worker/test/serve-mock.mjs [端口]
 * 默认端口 8788，默认密码 dev-password（可用环境变量 APP_PASSWORD 覆盖）
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../index.js';
import { makeD1 } from './mock-d1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../web');
const port = Number(process.argv[2] || 8788);

const env = {
  APP_PASSWORD: process.env.APP_PASSWORD || 'dev-password',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret',
  CLI_TOKEN: process.env.CLI_TOKEN || 'dev-cli-token',
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DB: makeD1(),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + port);

  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url.toString(), {
      method: req.method,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const response = await worker.fetch(request, env, { waitUntil: (p) => p });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(WEB, rel);
  if (!full.startsWith(WEB) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(fs.readFileSync(full));
}).listen(port, () => {
  console.log('模拟云端已启动：http://127.0.0.1:' + port + '（密码 ' + env.APP_PASSWORD + '）');
});
