/* 通用工具：DOM、日期、toast、loader、数字动画、主题 */

export function $(s, el){ return (el || document).querySelector(s); }
export function $$(s, el){ return Array.from((el || document).querySelectorAll(s)); }

export function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function escNL(s){ return esc(s).replace(/\n/g, '<br>'); }
export function uid(){ return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
export function isNum(v){ return typeof v === 'number' && isFinite(v); }

/* ---------- 日期 ---------- */
export function fmtDate(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
export function todayStr(){ return fmtDate(new Date()); }
export function addDays(s, n){
  const p = s.split('-').map(Number);
  return fmtDate(new Date(p[0], p[1]-1, p[2]+n));
}
export function weekdayCN(s){
  const p = s.split('-').map(Number);
  return '周' + '日一二三四五六'[new Date(p[0], p[1]-1, p[2]).getDay()];
}
export function isToday(s){ return s === todayStr(); }

/* ---------- 数字动画 ----------
   把元素里的数字从当前值平滑滚到目标值（整数） */
export function animateNumber(el, to, dur){
  if(!el) return;
  dur = dur || 500;
  const from = parseFloat(el.textContent.replace(/[^\d.-]/g, ''));
  const start = isNum(from) ? from : 0;
  if(start === to || !isNum(to)){ el.textContent = String(Math.round(to)); return; }
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){ el.textContent = String(Math.round(to)); return; }
  const t0 = performance.now();
  el.classList.add('count-anim');
  (function step(t){
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
    el.textContent = String(Math.round(start + (to - start) * e));
    if(k < 1) requestAnimationFrame(step);
    else el.classList.remove('count-anim');
  })(t0);
}

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(msg){
  const t = $('#toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Loader ---------- */
export function setLoading(on, tx){
  const l = $('#loader');
  if(!l) return;
  if(tx) $('#loaderTx').textContent = tx;
  l.style.display = on ? 'flex' : 'none';
}

/* ---------- 回车确认 ----------
   让容器内所有 input 在按回车时触发指定按钮（下拉框/文本域不参与） */
export function enterConfirm(container, selector){
  if(!container) return;
  const btn = container.querySelector(selector);
  if(!btn) return;
  container.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); btn.click(); }
    });
  });
}

/* ---------- 营养素小标签 ---------- */
export function round1(v){ return Math.round((isNum(v) ? v : 0) * 10) / 10; }
export function macroChips(m){
  if(!m || !(m.protein || m.carbs || m.fat)) return '';
  return '<div class="chips">'
    + '<span class="chip cp">蛋白 ' + round1(m.protein) + 'g</span>'
    + '<span class="chip cc">碳水 ' + round1(m.carbs) + 'g</span>'
    + '<span class="chip cf">脂肪 ' + round1(m.fat) + 'g</span>'
    + '</div>';
}

/* ---------- 主题 ---------- */
const THEME_BG = { light: '#F7F8F4', dark: '#101613' };
export function getThemePref(){
  try{ return localStorage.getItem('hk_theme') || 'auto'; }catch(e){ return 'auto'; }
}
export function setThemePref(pref){
  try{ localStorage.setItem('hk_theme', pref); }catch(e){}
  applyTheme();
}
export function applyTheme(){
  const pref = getThemePref();
  const t = pref === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : pref;
  document.documentElement.dataset.theme = t;
  const m = document.getElementById('themeColorMeta');
  if(m) m.content = THEME_BG[t] || THEME_BG.light;
}
