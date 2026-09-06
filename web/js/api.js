/* 与本地服务器通信：读取/保存数据、防抖自动保存、版本冲突处理、离线兜底 */

import { toast } from './ui.js';

const DB_URL = '/api/db';
const LAST_DB_KEY = 'hk_last_db'; // 离线预览用的只读快照

let dbRef = null;   // 当前数据引用（store.setDB 后通过 setDBRef 注入）
let rev = 0;        // 服务器数据版本号
let dirty = false;  // 有未保存的修改
let timer = null;

export function setDBRef(db){ dbRef = db; }
export function getRev(){ return rev; }
export function setRev(r){ rev = r || 0; }
export function isDirty(){ return dirty; }

/* 保存状态指示（顶栏小字） */
function saveState(state){
  const el = document.getElementById('saveState');
  if(!el) return;
  clearTimeout(el._t);
  if(state === 'saving'){ el.textContent = '保存中'; el.className = 'show saving'; }
  else if(state === 'saved'){ el.textContent = '已保存'; el.className = 'show'; el._t = setTimeout(() => el.classList.remove('show'), 1600); }
  else { el.className = ''; }
}

/* ---------- 基础请求 ---------- */
export async function fetchDB(){
  const r = await fetch(DB_URL, { cache: 'no-store' });
  if(!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if(!j || !j.ok) throw new Error((j && j.error) || '服务器返回异常');
  return j; // {ok, rev, db}
}

async function pushDB(){
  const r = await fetch(DB_URL, {
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

const api = { onConflict: null };
export function setConflictHandler(fn){ api.onConflict = fn; }
export default api;
