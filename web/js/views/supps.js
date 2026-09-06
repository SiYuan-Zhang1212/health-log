/* 视图：补剂录入 —— 每日打卡，附近 7 天概览防漏记 */

import { $, todayStr, addDays, weekdayCN } from '../ui.js';
import { DB, state, daySupps, toggleSupp, SUPPS, touch } from '../store.js';
import { rerender } from '../nav.js';

export function render(){
  const d = state.selDate;
  const supp = daySupps(d);
  const taken = SUPPS.filter(s => supp[s]);

  return '<div class="page-head">'
    + '<div><div class="page-eyebrow">补</div><h1 class="page-title">补剂录入</h1><div class="page-sub">吃到哪种点哪种，蛋白粉打卡会自动计入当天热量与蛋白质。</div></div>'
    + '<button class="btn btn-soft" data-nav="today">查看首页总览</button></div>'
    + datenavHTML(d)
    + '<div class="entry-grid">'
    + '<div class="card entry-card"><h2>补剂打卡<span class="sp">' + taken.length + '/' + SUPPS.length + ' 已完成</span></h2>'
    + '<div class="supps">' + SUPPS.map(s => '<button class="supp' + (supp[s] ? ' on' : '') + '" data-supp="' + s + '">' + (supp[s] ? '✓ ' : '') + s + '</button>').join('') + '</div>'
    + '<div class="xs muted" style="margin-top:12px;line-height:1.7;">蛋白粉打卡会自动计入当天 120 千卡和 24g 蛋白质。</div>'
    + '</div>'
    + '<div class="card entry-card"><h2>近 7 天概览<span class="sp">左旧右今</span></h2>'
    + overviewHTML()
    + '</div>'
    + '</div>';
}

/* 每种补剂最近 7 天的打卡情况（以今天为终点，与选中日期无关） */
function overviewHTML(){
  const days = [];
  for(let i = 6; i >= 0; i--) days.push(addDays(todayStr(), -i));
  const head = '<div class="sg-row sg-head"><span></span>'
    + days.map(x => '<span' + (x === todayStr() ? ' class="sg-today"' : '') + '>' + String(+x.slice(8)) + '</span>').join('')
    + '</div>';
  const rows = SUPPS.map(s => '<div class="sg-row"><span class="sg-name">' + s + '</span>'
    + days.map(x => {
      const on = !!(DB.supplements && DB.supplements[x] && DB.supplements[x][s]);
      return '<span class="sg-cell' + (on ? ' on' : '') + '">' + (on ? '✓' : '·') + '</span>';
    }).join('') + '</div>').join('');
  return '<div class="supp-grid">' + head + rows + '</div>'
    + '<div class="xs muted" style="margin-top:10px;">圆点表示那天没打卡；数字是日期，绿色高亮为今天。</div>';
}

function datenavHTML(d){
  return '<div class="datenav">'
    + '<button class="iconbtn" id="dPrev" aria-label="前一天"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>'
    + '<div class="mid"><div class="d">' + d + ' · ' + weekdayCN(d) + '</div><div class="sub">选择日期后，打卡记到这一天</div></div>'
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

  document.querySelectorAll('#view [data-supp]').forEach(b => b.addEventListener('click', () => {
    const name = b.getAttribute('data-supp');
    toggleSupp(d, name, !daySupps(d)[name]);
    touch();
    rerender(true);
  }));
}
