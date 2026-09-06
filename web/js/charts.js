/* 手写 SVG 图表：趋势折线图（日期轴/目标线/单点容错/入场动画）+ 热量环 */

/* ---------- 营养素达标进度条 ----------
   macro: {protein,carbs,fat} 当日摄入；T: nutrientTargets()（null 时返回提示） */
export function nutrientBarsHTML(macro, T){
  if(!T){
    return '<div class="xs" style="color:var(--muted);line-height:1.7;">记录一次体重后，这里会按你的体重显示蛋白质目标（1.2–2.0 g/kg）与碳水（3–5 g/kg）、脂肪（0.6–1.0 g/kg）的合理区间。</div>';
  }
  function row(label, val, min, max, target){
    const v = Math.round(val);
    const top = Math.max(max, v, 1) * 1.15;
    const P = x => Math.max(0, Math.min(100, x / top * 100));
    let st, cls;
    if(v < min){ st = '不足'; cls = 'under'; }
    else if(v > max){ st = '偏多'; cls = 'over'; }
    else { st = '合适'; cls = 'ok'; }
    const range = target != null ? '目标 ' + target : min + '–' + max;
    return '<div class="nrow">'
      + '<div class="nl">' + label + '</div>'
      + '<div class="ntrack">'
      + '<span class="nzone" style="left:' + P(min).toFixed(1) + '%;width:' + (P(max) - P(min)).toFixed(1) + '%"></span>'
      + '<span class="nfill ' + cls + '" style="width:' + P(v).toFixed(1) + '%"></span>'
      + '</div>'
      + '<div class="nv"><b>' + v + '</b><small>g / ' + range + 'g</small></div>'
      + '<div class="ns ' + cls + '">' + st + '</div>'
      + '</div>';
  }
  return '<div class="nbars">'
    + row('蛋白质', macro.protein, T.proteinMin, T.proteinMax, T.proteinTarget)
    + row('碳水', macro.carbs, T.carbsMin, T.carbsMax)
    + row('脂肪', macro.fat, T.fatMin, T.fatMax)
    + '</div>';
}

/* ---------- 折线图 ----------
   data: [{date:'2026-09-01', value:62.5}]
   返回 SVG 字符串；数据为空返回 ''（调用方自行展示空状态） */
export function lineChartSVG({ data, color, unit = '', goal = null }){
  const n = data.length;
  if(!n) return '';
  const W = 460, H = 186, PL = 42, PR = 16, PT = 16, PB = 30;

  const values = data.map(d => d.value);
  let lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
  if(typeof goal === 'number' && isFinite(goal)){ lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
  const pad = (hi - lo) * 0.15 || 1;
  lo -= pad; hi += pad;

  const X = i => n === 1 ? (PL + (W - PR) / 2) : PL + i * (W - PL - PR) / (n - 1);
  const Y = v => H - PB - (v - lo) * (H - PB - PT) / (hi - lo);
  const fx = v => v.toFixed(1);

  /* 网格与 Y 轴刻度 */
  let grid = '';
  for(let k = 0; k <= 3; k++){
    const v = lo + k * (hi - lo) / 3;
    const y = Y(v);
    grid += '<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1)
      + '" stroke="var(--chart-grid)" stroke-width="1"/>'
      + '<text x="' + (PL - 7) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="9.5" fill="var(--muted)" text-anchor="end">' + fx(v) + '</text>';
  }

  /* X 轴日期标签（最多 4 个，去重） */
  const maxT = Math.min(4, n);
  let idxs = [];
  if(n <= maxT){ idxs = data.map((_, i) => i); }
  else { for(let k = 0; k < maxT; k++) idxs.push(Math.round(k * (n - 1) / (maxT - 1))); }
  idxs = [...new Set(idxs)];
  let xlabels = idxs.map(i =>
    '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" font-size="9.5" fill="var(--muted)" text-anchor="middle">'
    + esc(data[i].date.slice(5)) + '</text>').join('');

  /* 目标虚线 */
  let goalLine = '';
  if(typeof goal === 'number' && isFinite(goal) && goal > lo && goal < hi){
    const y = Y(goal);
    goalLine = '<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1)
      + '" stroke="var(--accent)" stroke-width="1.4" stroke-dasharray="5 4" class="chart-fade"/>'
      + '<text x="' + (W - PR) + '" y="' + (y - 5).toFixed(1) + '" font-size="9.5" fill="var(--accent)" text-anchor="end">目标 ' + goal + unit + '</text>';
  }

  /* 面积 + 折线 + 点 */
  const pts = data.map((d, i) => X(i).toFixed(1) + ',' + Y(d.value).toFixed(1)).join(' ');
  const area = n > 1
    ? '<polygon points="' + PL + ',' + (H - PB) + ' ' + pts + ' ' + (W - PR) + ',' + (H - PB)
      + '" fill="' + color + '26" stroke="none" class="chart-fade"/>'
    : '';
  const line = '<polyline points="' + pts + '" fill="none" stroke="' + color
    + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" pathLength="1" class="chart-line"/>';
  const dots = data.map((d, i) => {
    const last = i === n - 1;
    const lx = Math.min(X(i), W - PR - 2);
    return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(d.value).toFixed(1) + '" r="' + (last ? 3.6 : 2.2)
      + '" fill="var(--surface)" stroke="' + color + '" stroke-width="1.8" class="chart-fade"/>'
      + (last ? '<text x="' + lx.toFixed(1) + '" y="' + (Y(d.value) - 9).toFixed(1) + '" font-size="11" fill="' + color
        + '" text-anchor="end" font-weight="600">' + d.value + ' ' + unit + '</text>' : '');
  }).join('');

  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">'
    + grid + xlabels + goalLine + area + line + dots + '</svg>';
}

/* ---------- 热量环 ----------
   pct: 摄入/目标；over 时变警示色；动画由 CSS transition 完成：
   初始画满偏移，绑定后下一帧设为 data-off（main 不需要处理，绑定方调用 animateRing） */
export function ringSVG(size = 138, stroke = 13){
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">'
    + '<circle cx="' + size/2 + '" cy="' + size/2 + '" r="' + r + '" fill="none" stroke="var(--ring-track)" stroke-width="' + stroke + '"/>'
    + '<circle id="ringVal" cx="' + size/2 + '" cy="' + size/2 + '" r="' + r + '" fill="none" stroke-width="' + stroke
    + '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + c.toFixed(1)
    + '" data-c="' + c.toFixed(1) + '" transform="rotate(-90 ' + size/2 + ' ' + size/2 + ')" class="ring-val"/>'
    + '</svg>';
}

/* 进度 0~1（超过 1 画满环并加 over 类） */
export function animateRing(pct){
  const el = document.getElementById('ringVal');
  if(!el) return;
  const c = parseFloat(el.getAttribute('data-c'));
  const p = Math.max(0, Math.min(1, pct));
  requestAnimationFrame(() => {
    el.classList.toggle('over', pct > 1);
    el.setAttribute('stroke-dashoffset', (c * (1 - p)).toFixed(1));
  });
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
