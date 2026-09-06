/* 视图：睡眠录入 —— 记录昨晚睡眠时长，附近 7 天回顾防漏记 */

import { $, toast, todayStr, addDays, weekdayCN, isNum, enterConfirm } from '../ui.js';
import { DB, state, touch } from '../store.js';
import { rerender } from '../nav.js';

export function render(){
  const d = state.selDate;
  const c = DB.conditions[d] || {};

  const days = [];
  for(let i = 6; i >= 0; i--) days.push(addDays(d, -i));
  const rows = days.map(dd => {
    const v = DB.conditions[dd] ? DB.conditions[dd].sleep : null;
    return '<div class="readonly-row' + (dd === d ? ' cur' : '') + '">'
      + '<div><div class="readonly-title">' + dd.slice(5) + ' · ' + weekdayCN(dd) + (dd === todayStr() ? '（今天）' : '') + '</div></div>'
      + '<div class="readonly-value">' + (isNum(v) ? v + '<small>小时</small>' : '<span class="pending-tx">未记录</span>') + '</div>'
      + '</div>';
  }).join('');

  return '<div class="page-head">'
    + '<div><div class="page-eyebrow">睡</div><h1 class="page-title">睡眠录入</h1><div class="page-sub">记下昨晚睡了多久，首页和日历会同步更新。</div></div>'
    + '<button class="btn btn-soft" data-nav="today">查看首页总览</button></div>'
    + datenavHTML(d)
    + '<div class="entry-grid">'
    + '<div class="card entry-card"><h2>昨晚睡眠<span class="sp">' + d + '</span></h2>'
    + '<div class="field"><label>睡眠时长（小时）</label><input class="inp" type="number" min="0" max="24" step="0.5" id="sleepInp" value="' + (c.sleep != null ? c.sleep : '') + '" placeholder="如 7.5"></div>'
    + '<button class="btn btn-primary btn-block" id="saveCond">保存睡眠</button>'
    + '</div>'
    + '<div class="card entry-card"><h2>近 7 天回顾<span class="sp">' + days[0].slice(5) + ' ~ ' + days[6].slice(5) + '</span></h2>'
    + '<div class="readonly-list compact-list">' + rows + '</div>'
    + '</div>'
    + '</div>';
}

function datenavHTML(d){
  return '<div class="datenav">'
    + '<button class="iconbtn" id="dPrev" aria-label="前一天"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>'
    + '<div class="mid"><div class="d">' + d + ' · ' + weekdayCN(d) + '</div><div class="sub">选择日期后，录入会写入这一天</div></div>'
    + '<div style="display:flex;align-items:center;">'
    + '<button class="todaybtn' + (d === todayStr() ? ' hide' : '') + '" id="dToday">今天</button>'
    + '<button class="iconbtn" id="dNext" aria-label="后一天"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button></div>'
    + '</div>';
}

export function bind(){
  const d = state.selDate;
  $('#dPrev').addEventListener('click', () => { state.selDate = addDays(state.selDate, -1); rerender(); });
  $('#dNext').addEventListener('click', () => { state.selDate = addDays(state.selDate, 1); rerender(); });
  const t = $('#dToday');
  if(t) t.addEventListener('click', () => { state.selDate = todayStr(); rerender(); });

  $('#saveCond').addEventListener('click', () => {
    const c = DB.conditions[d] = DB.conditions[d] || {};
    const s = $('#sleepInp').value;
    c.sleep = s === '' ? null : Number(s);
    touch();
    toast('睡眠已保存');
    rerender(true);
  });
  enterConfirm($('#sleepInp').closest('.card'), '#saveCond');
}
