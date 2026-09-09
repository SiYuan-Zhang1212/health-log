/* 与服务器通信：读取/保存数据、防抖自动保存、版本冲突处理、登录态、离线兜底 */

import { toast } from './ui.js';

const DB_URL = '/api/db';
const LAST_DB_KEY = 'hk_last_db'; // 离线预览用的只读快照

let dbRef = null;    // 当前数据引用（store.setDB 后通过 setDBRef 注入）
let rev = 0;         // 服务器数据版本号
let dirty = false;   // 有未保存的修改
let timer = null;
let cloud = false;   // 是否云端托管（决定设置页显示哪些东西）

export function setDBRef(db){ dbRef = db; }
export function getRev(){ return rev; }
export function setRev(r){ rev = r || 0; }
export function isDirty(){ return dirty; }
export function isCloud(){ return cloud; }

/* 保存状态指示（顶栏小字） */
function saveState(state){
  const el = document.getElementById('saveState');
  if(!el) return;
  clearTimeout(el._t);
  if(state === 'saving'){ el.textContent = '保存中'; el.className = 'show saving'; }
  else if(state === 'saved'){ el.textContent = '已保存'; el.className = 'show'; el._t = setTimeout(() => el.classList.remove('show'), 1600); }
  else { el.className = ''; }
}

/* ---------- 基础请求：401 统一交给登录页 ---------- */
const api = { onConflict: null, onAuthLost: null };
export function setConflictHandler(fn){ api.onConflict = fn; }
export function setAuthHandler(fn){ api.onAuthLost = fn; }

function authLost(){
  if(typeof api.onAuthLost === 'function') api.onAuthLost();
}

async function req(url, opts){
  let r;
  try{
    r = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {}));
  }catch(e){
    throw new Error('网络不可用');
  }
  if(r.status === 401){
    const e = new Error('需要登录');
    e.auth = true;
    authLost();
    throw e;
  }
  return r;
}

/* ---------- 登录 ---------- */
export async function login(password){
  const r = await fetch('/api/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const j = await r.json().catch(() => ({}));
  if(!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return true;
}

export async function logout(){
  try{ await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); }catch(e){}
}

/* 当前登录态；未登录返回 null（不触发 onAuthLost） */
export async function whoami(){
  try{
    const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if(!r.ok) return null;
    const j = await r.json();
    if(!j || !j.ok) return null;
    cloud = !!j.cloud;
    return j;
  }catch(e){ return null; }
}

/* ---------- 数据读写 ---------- */
export async function fetchDB(){
  const r = await req(DB_URL);
  const j = await r.json().catch(() => null);
  if(!r.ok || !j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j; // {ok, rev, db}
}

async function pushDB(){
  const r = await req(DB_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rev, db: dbRef }),
  });
  const j = await r.json().catch(() => ({}));
  if(r.status === 409){ throw Object.assign(new Error('conflict'), { conflict: true }); }
  if(!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

/* ---------- 自动保存 ---------- */
export function scheduleSave(){
  if(!dbRef) return;
  dirty = true;
  saveState('saving');
  clearTimeout(timer);
  timer = setTimeout(saveNow, 800);
}

export async function saveNow(){
  if(!dbRef || !dirty) return;
  clearTimeout(timer); timer = null;
  try{
    const j = await pushDB();
    rev = j.rev;
    dirty = false;
    saveState('saved');
    cacheLast(dbRef);
  }catch(e){
    if(e.auth) return;           // 登录页会接管
    if(e.conflict){
      // 其他设备先保存了：拉取最新数据，交给上层刷新界面
      dirty = false;
      saveState(null);
      if(typeof api.onConflict === 'function') api.onConflict();
    }else{
      saveState(null);
      toast('保存失败：' + e.message);
    }
  }
}

/* ---------- 页面隐藏/关闭时兜底保存 ---------- */
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden') flushBeacon();
});
window.addEventListener('pagehide', flushBeacon);

function flushBeacon(){
  if(!dbRef || !dirty || !navigator.sendBeacon) return;
  const blob = new Blob([JSON.stringify({ rev, db: dbRef })], { type: 'application/json' });
  // 同源请求会带上登录 Cookie
  if(navigator.sendBeacon(DB_URL, blob)){ dirty = false; }
}

/* ---------- 离线预览快照 ---------- */
export function cacheLast(db){
  try{
    const s = JSON.stringify(db);
    if(s.length < 2 * 1024 * 1024) localStorage.setItem(LAST_DB_KEY, s);
  }catch(e){}
}
export function readCachedDB(){
  try{
    const s = localStorage.getItem(LAST_DB_KEY);
    return s ? JSON.parse(s) : null;
  }catch(e){ return null; }
}

/* ---------- 云端备份 ---------- */
export async function listSnapshots(){
  const r = await req('/api/snapshots');
  const j = await r.json().catch(() => ({}));
  if(!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j.snapshots || [];
}

export async function restoreSnapshot(id){
  const r = await req('/api/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const j = await r.json().catch(() => ({}));
  if(!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

export default api;
