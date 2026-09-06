/* 入口：启动、路由、迁移、离线引导、全局错误兜底、PWA */

import * as api from './api.js';
import { setDB, DB, hasAnyData } from './store.js';
import { $, toast, applyTheme, getThemePref, esc, escNL, todayStr } from './ui.js';
import { navBus } from './nav.js';
import * as vToday from './views/today.js';
import * as vMeals from './views/meals.js';
import * as vWorkout from './views/workout.js?v=9';
import * as vSleep from './views/sleep.js';
import * as vSupps from './views/supps.js';
import * as vTrends from './views/trends.js';
import * as vSettings from './views/settings.js';

const VIEWS = { today: vToday, meals: vMeals, workout: vWorkout, sleep: vSleep, supps: vSupps, trends: vTrends, settings: vSettings };
const TABS = [['today','首页'], ['meals','三餐录入'], ['workout','训练录入'], ['sleep','睡眠录入'], ['supps','补剂录入'], ['trends','体测录入'], ['settings','设置']];
const ICONS = {
  today: '<path d="M4 11 12 4l8 7"/><path d="M6.5 9.6V20h11V9.6"/>',
  meals: '<path d="M4 10h16v2a8 8 0 0 1-16 0z"/><path d="M12 4.5V8M9 5.5V8M15 5.5V8"/>',
  workout: '<path d="M6.5 9v6M4 10.5v3M17.5 9v6M20 10.5v3M6.5 12h11"/>',
  sleep: '<path d="M12 3a6.2 6.2 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  supps: '<rect x="3.5" y="9" width="17" height="6" rx="3"/><path d="M12 9v6"/>',
  trends: '<path d="M4 17 9 11l3.5 3.5L20 7"/><path d="M15 7h5v5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>',
};

let booted = false;
let lastRoute = null;

function currentRoute(){
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return VIEWS[h] ? h : 'today';
}

function nav(route){
  if(currentRoute() !== route) location.hash = '#/' + route;
  else render(true);
}

function render(keepScroll){
  if(!booted) return;
  const r = currentRoute();
  const v = VIEWS[r];
  $('#view').innerHTML = v.render();
  v.bind();
  renderNav(r);
  if(!keepScroll && r !== lastRoute) window.scrollTo(0, 0);
  lastRoute = r;
}

function renderNav(r){
  const nav = $('#nav');
  nav.innerHTML = TABS.map(([key, label]) =>
    '<button class="' + (key === r ? 'on' : '') + '" aria-current="' + (key === r ? 'page' : 'false') + '" data-nav="' + key + '">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[key] + '</svg>'
    + '<span>' + label + '</span></button>').join('');
  document.querySelector('.sidebar').classList.remove('nav-off');
}

/* ---------- 服务器未启动 / 离线 ---------- */
function renderGuide(err){
  booted = false;
  document.querySelector('.sidebar').classList.add('nav-off');
  const cached = api.readCachedDB();
  $('#view').innerHTML = '<div class="card guide">'
    + '<h2>连不上本地服务器</h2>'
    + '<div class="small" style="color:var(--muted);line-height:1.7;margin-bottom:6px;">这个页面的数据都存在自己电脑上，需要先启动随附的小服务器：</div>'
    + '<ol>'
    + '<li>在电脑上打开本项目文件夹，双击 <code>启动.command</code></li>'
    + '<li>或在此文件夹的终端里运行 <code>python3 server.py</code></li>'
    + '<li>启动后浏览器会自动打开；本页点下方按钮重试</li>'
    + '</ol>'
    + '<div style="display:flex;gap:8px;">'
    + '<button class="btn btn-primary" id="retryBtn" style="flex:1;">重试连接</button>'
    + (cached ? '<button class="btn btn-line" id="previewBtn" style="flex:1;">离线预览上次数据</button>' : '')
    + '</div>'
    + '<div class="xs" style="color:var(--muted);margin-top:12px;">技术信息：' + esc(err && err.message ? err.message : String(err)) + '</div>'
    + '</div>';
  $('#retryBtn').addEventListener('click', () => { $('#view').innerHTML = '<div class="card"><div class="empty">正在连接服务器…</div></div>'; boot(); });
  const pv = $('#previewBtn');
  if(pv) pv.addEventListener('click', () => renderOffline(cached));
}

function renderOffline(db){
  document.querySelector('.sidebar').classList.add('nav-off');
  setDB(db); // 只读预览：不触发保存
  let body = '<div class="banner">离线只读预览：显示的是最后一次成功加载的数据，修改不会被保存。联网并启动服务器后即可正常使用。</div>';

  const meals = db.meals || {};
  const days = Object.keys(meals).sort().slice(-7).reverse();
  if(days.length){
    body += '<div class="card"><h2>最近记录的三餐</h2>'
      + days.map(d => {
        const m = meals[d] || {};
        const cal = ['breakfast','lunch','dinner','snack'].reduce((s, k) => s + (m[k] || []).reduce((x, y) => x + (y.calories || 0), 0), 0);
        return '<div class="kv"><span class="k">' + d + '</span><span class="v">' + cal + ' 千卡</span></div>';
      }).join('') + '</div>';
  }
  const ms = (db.measures || []).slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 5);
  if(ms.length){
    body += '<div class="card"><h2>最近体测</h2>'
      + ms.map(m => '<div class="kv"><span class="k">' + m.date + '</span><span class="v">'
        + (m.weight != null ? m.weight + ' kg' : '—') + ' ｜ ' + (m.bodyFat != null ? m.bodyFat + ' %' : '—') + '</span></div>').join('')
      + '</div>';
  }
  const adv = (db.advices || [])[0];
  if(adv) body += '<div class="card"><h2>最近 AI 建议（' + adv.date + '）</h2><div class="advice">' + escNL(adv.text) + '</div></div>';
  if(!days.length && !ms.length && !adv) body += '<div class="card"><div class="empty">还没有任何数据记录。</div></div>';

  body += '<button class="btn btn-primary btn-block" id="backRetry">返回并重试连接</button>';
  $('#view').innerHTML = body;
  $('#backRetry').addEventListener('click', () => { $('#view').innerHTML = '<div class="card"><div class="empty">正在连接服务器…</div></div>'; boot(); });
}

/* ---------- 旧版数据迁移 ---------- */
function oldLocalDB(){
  try{
    const s = localStorage.getItem('hk_db_v1');
    return s ? JSON.parse(s) : null;
  }catch(e){ return null; }
}
function oldStats(db){
  const meals = db.meals || {};
  const mealDays = Object.keys(meals).filter(k => Object.keys(meals[k] || {}).some(m => ((meals[k] || {})[m] || []).length)).length;
  return { mealDays, workouts: (db.workouts || []).length, measures: (db.measures || []).length };
}
function showMigrateModal(info){
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = '<div class="modal"><h3>发现旧版数据</h3>'
      + '<p>本机浏览器里存有旧版记录：三餐 ' + info.mealDays + ' 天、训练 ' + info.workouts + ' 条、体测 ' + info.measures + ' 条。<br>迁移到新版本吗？</p>'
      + '<div class="btns"><button class="btn btn-line" id="migNo">跳过</button><button class="btn btn-primary" id="migYes">迁移</button></div></div>';
    document.body.appendChild(ov);
    const done = v => { ov.remove(); resolve(v); };
    ov.querySelector('#migYes').addEventListener('click', () => done(true));
    ov.querySelector('#migNo').addEventListener('click', () => done(false));
  });
}
async function maybeMigrate(){
  try{
    if(localStorage.getItem('hk_migrate_done')) return;
    const old = oldLocalDB();
    if(!old || !hasAnyData(old)) return;
    if(hasAnyData(DB)){ localStorage.setItem('hk_migrate_done', '1'); return; } // 服务器已有数据，以服务器为准
    const ok = await showMigrateModal(oldStats(old));
    localStorage.setItem('hk_migrate_done', '1');
    if(ok){
      setDB(old);
      api.scheduleSave();
      await api.saveNow();
      api.cacheLast(DB);
      toast('旧数据已迁移到新版本');
    }
  }catch(e){ /* 迁移失败不阻塞启动 */ }
}

/* ---------- 全局错误兜底 ---------- */
let lastErrAt = 0;
function reportErr(prefix, e){
  const now = Date.now();
  if(now - lastErrAt < 2500) return;
  lastErrAt = now;
  toast(prefix + (e && e.message ? e.message : '未知错误，请查看控制台'));
}
window.addEventListener('error', e => reportErr('出错了：', e.error || new Error(e.message)));
window.addEventListener('unhandledrejection', e => reportErr('处理失败：', e.reason));

/* ---------- 启动 ---------- */
async function boot(){
  applyTheme();
  let res;
  try{
    res = await api.fetchDB();
  }catch(e){
    renderGuide(e);
    return;
  }
  setDB(res.db);
  api.setRev(res.rev);
  api.cacheLast(res.db);
  booted = true;
  await maybeMigrate();
  registerSW();
  if(!location.hash) location.hash = '#/today'; // 触发 hashchange → render
  render();
}

/* 多设备冲突：自动拉取最新数据刷新 */
api.setConflictHandler(async () => {
  try{
    const res = await api.fetchDB();
    setDB(res.db);
    api.setRev(res.rev);
    render(true);
    toast('数据刚在其他设备更新过，已为你刷新');
  }catch(e){ /* 下次保存会再提示 */ }
});

/* PWA */
function registerSW(){
  if('serviceWorker' in navigator && location.protocol.indexOf('http') === 0){
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

/* ---------- 事件 ---------- */
document.addEventListener('click', e => {
  const navBtn = e.target.closest('[data-nav]');
  if(navBtn) nav(navBtn.getAttribute('data-nav'));
});
window.addEventListener('hashchange', () => render());
$('#logoBtn').addEventListener('click', () => nav('today'));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if(getThemePref() === 'auto') applyTheme();
});

navBus.nav = nav;
navBus.rerender = render;

boot();
