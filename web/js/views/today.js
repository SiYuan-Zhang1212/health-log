/* 视图：首页总览 —— 按「吃 / 练 / 睡 / 补」四大块排版的只读仪表盘；写入操作通过各录入页完成 */

import { $, $$, esc, toast, todayStr, addDays, fmtDate, weekdayCN, animateNumber, isNum, uid, setLoading } from '../ui.js';
import { DB, state, dayCalories, dayMacro, dayWorkout, daySupps, calorieGoal, bodyFatTrend,
         calcBMR, calcTDEE, workoutCalories, nutrientTargets, wheyTaken, SUPPS,
         MEAL_ORDER, MEAL_CN, measuresInRange, touch,
         lastCoachTip, lastAdvice, PLAN, PLAN_DAY_OPTS, PLAN_DAY_MAP, planSuggestion, sortedWorkouts,
         workoutLabel } from '../store.js';
import { COACH_PROMPT, buildCoachContext, dayPartCN, dsChat, needKey } from '../ai.js';
import { ringSVG, animateRing, nutrientBarsHTML, lineChartSVG } from '../charts.js';
import { rerender } from '../nav.js';

const RANGES = [[7, '7天'], [30, '30天'], [90, '90天'], [0, '全部']];

export function render(){
  const d = state.selDate;
  const total = dayCalories(d);
  const macro = dayMacro(d);
  const goal = calorieGoal();
  const tr = bodyFatTrend();
  const s = planSuggestion(d);

  return '<div class="page-head dashboard-head">'
    + '<div><div class="page-eyebrow">健康日志</div><h1 class="page-title">首页总览</h1><div class="page-sub">每一天的记录，都在让改变发生。</div></div>'
    + '<div class="dashboard-tools">' + datenavHTML(d, total) + '<div class="page-actions"><button class="btn btn-soft" data-nav="workout">记录训练</button><button class="btn btn-primary" data-nav="meals">＋ 记录三餐</button></div></div>'
    + '</div>'
    + goalCardHTML(tr)
    + '<div class="dashboard">'
    /* 记录日历：吃练睡补录入情况一览 */
    + '<section class="dashboard-section"><div class="section-head"><div><div class="section-kicker">月度回顾</div><h2 class="section-title">记录日历</h2></div><div class="cal-tools"><span class="section-note">亮了才算记过 · 点日期查看当天</span>' + calNavHTML(d) + '</div></div>'
    + calendarHTML(d, goal)
    + '</section>'
    /* 吃 */
    + '<section class="dashboard-section"><div class="section-head"><div><div class="section-kicker">吃</div><h2 class="section-title">能量与三餐</h2></div><span class="section-note">所有数据均来自 ' + d + '</span></div>'
    + '<div class="dashboard-grid dashboard-grid-main">'
    + energyCardHTML(d, total, macro, goal)
    + mealsCardHTML(d)
    + '</div></section>'
    /* 练 */
    + '<section class="dashboard-section"><div class="section-head"><div><div class="section-kicker">练</div><h2 class="section-title">今天练什么</h2></div></div>'
    + trainingCardHTML(d, s)
    + '</section>'
    /* 睡 + 补 */
    + '<div class="dashboard-pair">'
    + '<section class="dashboard-section"><div class="section-head"><div><div class="section-kicker">睡</div><h2 class="section-title">睡眠恢复</h2></div></div>'
    + sleepCardHTML(d)
    + '</section>'
    + '<section class="dashboard-section"><div class="section-head"><div><div class="section-kicker">补</div><h2 class="section-title">补剂打卡</h2></div></div>'
    + suppsCardHTML(d)
    + '</section>'
    + '</div>'
    /* 长期趋势 */
    + '<section class="dashboard-section"><div class="section-head"><div><div class="section-kicker">长期变化</div><h2 class="section-title">体重与趋势</h2></div><div class="range-tabs dashboard-ranges">' + RANGES.map(([v, label]) => '<button class="' + (state.chartRange === v ? 'on' : '') + '" data-range="' + v + '">' + label + '</button>').join('') + '</div></div>'
    + trendChartsHTML()
    + '</section>'
    /* AI 反馈 */
    + '<section class="dashboard-section"><div class="section-head"><div><div class="section-kicker">AI 反馈</div><h2 class="section-title">最近建议</h2></div></div>'
    + aiResultsHTML()
    + '</section>'
    + '</div>';
}

function goalCardHTML(tr){
  const g = DB.goals || {};
  if(!isNum(g.bodyFat) && !isNum(g.weight)){
    return '<div class="goalcard empty-goal"><div class="gc-k">年度目标</div><div class="gc-v">还没有设定目标</div><div class="gc-sub">到“体测录入”写下目标，这里会持续显示进度。</div><button class="btn btn-soft" data-nav="trends" style="margin-top:12px;">去设置目标</button></div>';
  }
  const title = isNum(g.bodyFat) ? '体脂率降到 <b>' + g.bodyFat + '%</b> 以下' : '体重降到 <b>' + g.weight + ' kg</b> 以下';
  const year = g.targetDate ? g.targetDate.slice(0, 4) + ' ' : '';
  if(!tr){
    return '<div class="goalcard"><div class="gc-heading"><div class="gc-k">' + year + '目标</div><div class="gc-v">' + title + '</div><div class="gc-sub">先记录一次体脂率，目标进度和预计达标时间就会出现在这里。</div></div></div>';
  }
  const stats = ['当前 <b>' + tr.current + '%</b>'];
  if(tr.gap != null && tr.gap > 0) stats.push('还差 <b>' + tr.gap + '</b> 个百分点');
  if(tr.gap != null && tr.gap <= 0) stats.push('已达标 🎉');
  if(tr.daysLeft != null && tr.gap > 0) stats.push('剩 <b>' + tr.daysLeft + '</b> 天');
  const trendBits = [];
  if(tr.perWeek != null){
    trendBits.push('近期趋势 每周 <b>' + (tr.perWeek > 0 ? '+' : '') + tr.perWeek.toFixed(2) + '%</b>');
    if(tr.etaDate) trendBits.push('预计 <b>' + tr.etaDate + '</b> 达标');
  }else if(tr.needPerWeek != null){
    trendBits.push('需平均每周降 <b>' + tr.needPerWeek + '%</b>');
  }
  const cheer = tr.reached ? '已经达标！现在的重点是保持住。' : tr.perWeek == null ? '连着记录几周体脂，这里就能算出你的趋势。' : tr.perWeek >= 0 ? '体脂最近在上升，从下一顿饭和今天的一次训练开始扭回来。' : '一步一个脚印，每一餐、每一次训练都算数。';
  return '<div class="goalcard"><div class="gc-heading"><div class="gc-k">' + year + '目标</div><div class="gc-v">' + title + '</div></div><div class="gc-progress"><div class="gc-stats">' + stats.join('<span class="gc-sep">·</span>') + '</div>' + (trendBits.length ? '<div class="gc-trend">' + trendBits.join(' · ') + '</div>' : '') + '</div><details class="goal-note"><summary>进度提示</summary><div class="gc-cheer">' + cheer + '</div></details></div>';
}

function datenavHTML(d, total){
  return '<div class="datenav dashboard-date">'
    + '<button class="iconbtn" id="dPrev" aria-label="前一天"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>'
    + '<div class="mid"><div class="d">' + d + ' · ' + weekdayCN(d) + '</div><div class="sub">全天 ' + total + ' 千卡</div></div>'
    + '<div style="display:flex;align-items:center;"><button class="todaybtn' + (d === todayStr() ? ' hide' : '') + '" id="dToday">回到今天</button><button class="iconbtn" id="dNext" aria-label="后一天"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button></div>'
    + '</div>';
}

/* ---------- 记录日历（月历） ----------
   每天用「吃 / 练 / 睡 / 补」四个小标记展示录入情况，点某天选中该日期，‹ › 翻月（保持日号） */
function calNavHTML(d){
  const ym = d.split('-').map(Number);
  return '<div class="cal-nav">'
    + '<button class="iconbtn" id="calPrev" aria-label="上一月"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>'
    + '<span class="cal-ym">' + ym[0] + ' 年 ' + ym[1] + ' 月</span>'
    + '<button class="iconbtn" id="calNext" aria-label="下一月"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>'
    + '</div>';
}

function calendarHTML(d, goal){
  const [y, m] = d.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 周一开头
  const today = todayStr();
  let cells = '';
  for(let i = 0; i < lead; i++) cells += '<span class="cal-cell blank"></span>';
  for(let day = 1; day <= daysInMonth; day++){
    const ds = y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const cal = dayCalories(ds);
    const cond = DB.conditions[ds];
    const supp = daySupps(ds);
    const marks = [
      [!!cal, 'on-eat', '吃'],
      [dayWorkout(ds).length > 0, 'on-train', '练'],
      [!!(cond && isNum(cond.sleep)), 'on-sleep', '睡'],
      [SUPPS.some(s => supp[s]), 'on-supp', '补'],
    ].map(([on, cls, ch]) => '<i class="' + (on ? cls : '') + '">' + ch + '</i>').join('');
    cells += '<button type="button" class="cal-cell'
      + (ds === d ? ' sel' : '') + (ds === today ? ' today' : '') + (ds > today ? ' future' : '')
      + '" data-caldate="' + ds + '" aria-label="' + ds + '">'
      + '<span class="cal-d">' + day + '</span>'
      + (cal ? '<span class="cal-kcal' + (goal != null && cal > goal ? ' over' : '') + '">' + cal + '</span>' : '<span class="cal-kcal">&nbsp;</span>')
      + '<span class="cal-marks">' + marks + '</span>'
      + '</button>';
  }
  return '<div class="card calendar-card"><div class="cal-week">'
    + ['一', '二', '三', '四', '五', '六', '日'].map(w => '<span>' + w + '</span>').join('')
    + '</div><div class="cal-grid">' + cells + '</div>'
    + '<div class="cal-legend xs"><span class="cal-marks cal-marks-demo"><i class="on-eat">吃</i><i class="on-train">练</i><i class="on-sleep">睡</i><i class="on-supp">补</i></span><span class="muted">亮起 = 当天已记录 · 数字为摄入千卡，<b class="over-tx">红色</b>为超出目标</span></div></div>';
}

function energyCardHTML(d, total, macro, goal){
  const over = goal != null && total > goal;
  const bmr = calcBMR(), tdee = calcTDEE(), trainCal = workoutCalories(d);
  const burn = tdee != null
    ? '<div class="chips3"><div class="c3"><span>基础代谢 BMR</span><b>' + bmr + '</b><small>千卡</small></div><div class="c3"><span>训练消耗（估）</span><b>' + (trainCal || 0) + '</b><small>千卡</small></div><div class="c3"><span>' + ((tdee + (trainCal || 0) - total) >= 0 ? '热量缺口' : '热量盈余') + '</span><b>' + Math.abs(tdee + (trainCal || 0) - total) + '</b><small>千卡</small></div></div>'
    : '<div class="empty">补全资料并记录体重后，这里会显示基础代谢、训练消耗与热量缺口。</div>';
  const ringRight = goal != null
    ? '<div class="rc"><div class="rowline"><span class="num big' + (over ? ' over' : '') + ' count-anim" id="calNum">' + total + '</span><span class="u">千卡 · 已摄入</span></div><div class="u" style="margin-top:2px;">目标 ' + goal + ' 千卡</div><div class="rem' + (over ? ' over' : '') + '">' + (over ? '超出 ' + (total - goal) : '还剩 ' + Math.max(0, goal - total)) + ' 千卡</div></div>'
    : '<div class="rc"><div class="rowline"><span class="num big count-anim" id="calNum">' + total + '</span><span class="u">千卡 · 今日摄入</span></div><div class="hint">还没设置热量目标，到“体测录入”或“设置”补全资料即可自动计算。</div></div>';
  const kcalP = macro.protein * 4, kcalC = macro.carbs * 4, kcalF = macro.fat * 9, kcalSum = kcalP + kcalC + kcalF;
  const share = kcalSum > 0 ? '<div class="mbar"><span class="sp" style="width:' + (kcalP / kcalSum * 100).toFixed(1) + '%"></span><span class="sc" style="width:' + (kcalC / kcalSum * 100).toFixed(1) + '%"></span><span class="sf" style="width:' + (kcalF / kcalSum * 100).toFixed(1) + '%"></span></div>' : '';
  const whey = wheyTaken(d) ? '<div class="xs supplement-note">✓ 已含蛋白粉一勺（蛋白质 +24g · 120 千卡）</div>' : '';
  const days7 = [];
  for(let i = 6; i >= 0; i--) days7.push(addDays(d, -i));
  const max7 = Math.max.apply(null, days7.map(dayCalories).concat([1]));
  const bars = days7.map(x => { const v = dayCalories(x), hh = Math.max(4, Math.round(v / max7 * 52)), label = x === todayStr() ? '今' : String(+x.slice(8)); return '<div class="bar-day"><div class="bar-value">' + (v || '') + '</div><div class="bar ' + (v ? 'filled' : '') + '" style="height:' + hh + 'px"></div><div class="bar-label">' + label + '</div></div>'; }).join('');
  return '<div class="card dashboard-card dashboard-energy"><h2>今日能量 <span class="sp">目标 ' + (goal != null ? goal + ' 千卡' : '未设置') + '</span></h2><div class="ringwrap"><div class="ringbox">' + ringSVG() + '</div>' + ringRight + '</div>' + burn + '<div class="macros">' + share + whey + nutrientBarsHTML(macro, nutrientTargets()) + '</div><div class="bars dashboard-bars">' + bars + '</div><div class="xs muted" style="margin-top:6px;">近 7 天摄入</div></div>';
}

function mealsCardHTML(d){
  const m = (DB.meals && DB.meals[d]) || {};
  const rows = MEAL_ORDER.map(k => {
    const it = Array.isArray(m[k]) ? m[k] : [], skipped = isSkippedSafe(d, k), cal = it.reduce((s, x) => s + (isNum(x.calories) ? x.calories : 0), 0);
    const mk = it.reduce((a, x) => { a.protein += isNum(x.protein) ? x.protein : 0; a.carbs += isNum(x.carbs) ? x.carbs : 0; a.fat += isNum(x.fat) ? x.fat : 0; return a; }, { protein:0, carbs:0, fat:0 });
    const sub = skipped ? '没吃' : it.length ? it.length + ' 项 · P' + Math.round(mk.protein) + ' C' + Math.round(mk.carbs) + ' F' + Math.round(mk.fat) : '未记录';
    return '<div class="readonly-row"><div><div class="readonly-title">' + MEAL_CN[k] + '</div><div class="readonly-meta">' + sub + '</div></div><div class="readonly-value">' + (skipped ? '—' : cal || '—') + '<small>' + (skipped ? '' : '千卡') + '</small></div></div>';
  }).join('');
  return '<div class="card dashboard-card dashboard-meals"><h2>今日三餐<span class="sp">' + dayCalories(d) + ' 千卡</span></h2><div class="readonly-list">' + rows + '</div><button class="btn btn-soft btn-block" data-nav="meals">去录入三餐</button></div>';
}

/* DB.meals[d]._skip 直读（避免引入 markSkip 的写入依赖） */
function isSkippedSafe(date, meal){
  const m = DB.meals[date];
  return !!(m && m._skip && m._skip[meal]);
}

function trainingCardHTML(d, s){
  const view = state.planDayView || s.suggested;
  const day = PLAN.days[view] || PLAN.days['下肢'];
  const lower = view === '下肢';
  const warmups = PLAN.warmup.common.concat(lower ? PLAN.warmup.lower : PLAN.warmup.upper);
  const posts = lower ? PLAN.post.lower : PLAN.post.upper;
  const moves = day.main.concat(day.assist); // 主辅不分：全部需要完成
  const ws = dayWorkout(d);
  const logged = ws.length
    ? ws.map(w => '<div class="readonly-row"><div><div class="readonly-title">' + esc(workoutLabel(w)) + '</div><div class="readonly-meta">已记录</div></div><div class="readonly-value">✓</div></div>').join('')
    : '<div class="empty">今天还没有训练记录。</div>';
  const pill = t => '<span class="plan-pill">' + esc(t) + '</span>';
  const mpill = t => '<span class="plan-pill muted-pill">' + esc(t) + '</span>';
  const tabs = '<div class="seg plan-seg">' + PLAN_DAY_OPTS.map(p => {
    const key = PLAN_DAY_MAP[p];
    return '<button class="' + (view === key ? 'on' : '') + '" data-planday="' + key + '"' + (key === s.suggested ? ' title="今天建议"' : '') + '>' + p + '</button>';
  }).join('') + '</div>';
  return '<div class="card dashboard-card"><h2>今日训练<span class="tag">' + esc(day.label) + '</span></h2>'
    + '<div class="plan-reason">' + esc(s.reason) + '</div>'
    + tabs
    + '<div class="plan-block"><div class="plan-label">训练动作 · 都需要完成</div><div class="plan-pills move-list">' + moves.map(m => pill(m.name)).join('') + '</div></div>'
    + '<details class="home-details"><summary>热身、拉伸与训练记录</summary>'
    + '<div class="plan-block"><div class="plan-label">' + (s.gap === 0 && s.lastType ? '当天已练' : '上次力量训练') + '</div><div class="readonly-list compact-list">'
    + (s.lastType
      ? '<div class="readonly-row"><div><div class="readonly-title">' + PLAN.days[s.lastType].label + '</div><div class="readonly-meta">' + s.lastDate + (s.gap != null ? ' · ' + (s.gap === 0 ? '当天' : s.gap + ' 天前') : '') + '</div></div></div>'
      : '<div class="empty">暂无力量训练记录。</div>')
    + '</div></div>'
    + '<div class="plan-block"><div class="plan-label">① 松解与激活 · 训练前</div><div class="plan-pills">' + warmups.map(mpill).join('') + '</div></div>'
    + '<div class="plan-block"><div class="plan-label">③ 拉伸放松 · 训练后</div><div class="plan-pills">' + posts.map(mpill).join('') + '</div></div>'
    + '<div class="plan-block"><div class="plan-label">当天已记录的训练</div><div class="readonly-list compact-list">' + logged + '</div></div>'
    + '</details><button class="btn btn-soft btn-block" data-nav="workout">去录入训练</button>'
    + '</div>';
}

/* 睡：昨晚睡眠 + 近 7 天条形回顾（跟随所选日期） */
function sleepCardHTML(d){
  const c = DB.conditions[d] || {};
  const days = [];
  for(let i = 6; i >= 0; i--) days.push(addDays(d, -i));
  const maxH = 12; // 条形满高对应的小时数
  const bars = days.map(x => {
    const v = (DB.conditions[x] && isNum(DB.conditions[x].sleep)) ? DB.conditions[x].sleep : null;
    const hh = v ? Math.max(4, Math.round(v / maxH * 52)) : 4;
    return '<div class="bar-day"><div class="bar-value">' + (v != null ? v : '') + '</div><div class="bar' + (v ? ' filled' : '') + (x === d ? ' sel' : '') + '" style="height:' + hh + 'px"></div><div class="bar-label">' + (x === todayStr() ? '今' : String(+x.slice(8))) + '</div></div>';
  }).join('');
  return '<div class="card dashboard-card recovery-card"><h2>昨晚睡眠<span class="sp">' + (isNum(c.sleep) ? c.sleep + ' 小时' : '未记录') + '</span></h2>'
    + '<div class="bars dashboard-bars sleep-bars">' + bars + '</div>'
    + '<div class="xs muted" style="margin-top:6px;">近 7 天睡眠（小时）· 空柱 = 漏记</div>'
    + '<button class="btn btn-soft btn-block" data-nav="sleep">去记录睡眠</button></div>';
}

/* 补：当天打卡完成度 */
function suppsCardHTML(d){
  const supp = daySupps(d), taken = SUPPS.filter(s => supp[s]);
  const rows = SUPPS.map(s => '<span class="status-pill ' + (supp[s] ? 'done' : '') + '">' + (supp[s] ? '✓ ' : '') + s + '</span>').join('');
  return '<div class="card dashboard-card recovery-card"><h2>补剂<span class="sp">' + taken.length + '/' + SUPPS.length + ' 已完成</span></h2>'
    + '<div class="status-pills">' + rows + '</div>'
    + '<button class="btn btn-soft btn-block" data-nav="supps">去打卡补剂</button></div>';
}

function trendChartsHTML(){
  const ms = measuresInRange(state.chartRange);
  const series = field => ms.filter(m => isNum(m[field])).map(m => ({ date:m.date, value:m[field] }));
  const goals = DB.goals || {};
  const charts = [['体重趋势', series('weight'), '#427763', 'kg', isNum(goals.weight) ? goals.weight : null], ['体脂率趋势', series('bodyFat'), '#99702C', '%', isNum(goals.bodyFat) ? goals.bodyFat : null], ['骨骼肌趋势', series('muscle'), '#527E98', 'kg', null]];
  return '<div class="dashboard-chart-grid">' + charts.map(([title, data, color, unit, goal]) => '<div class="card dashboard-card chart-card"><h2>' + title + (goal != null ? '<span class="tag">目标 ' + goal + unit + '</span>' : '') + '</h2><div class="chartbox">' + (data.length ? lineChartSVG({ data, color, unit, goal }) : '<div class="empty">记录后这里会显示趋势。</div>') + '</div></div>').join('') + '</div>';
}

function advicePreviewHTML(text){
  const full = String(text || '');
  if(full.length <= 100) return '<div class="ai-result-body">' + esc(full) + '</div>';
  return '<details class="advice-details"><summary><span class="advice-preview">' + esc(full.slice(0, 100)) + '…</span><span class="expand-label">展开完整建议</span><span class="collapse-label">收起建议</span></summary><div class="ai-result-body">' + esc(full) + '</div></details>';
}

function aiResultsHTML(){
  const coach = lastCoachTip(), adv = lastAdvice();
  const card = (title, result, date, inner) => '<div class="card dashboard-card ai-card"><h2>' + title + '<span class="tag">AI</span></h2>'
    + (result ? '<div class="ai-result"><div class="ai-result-k">' + esc(date || '') + '</div>' + advicePreviewHTML(result.text) + '</div>' : '<div class="empty">记录之后，让建议更了解你。<br>暂时还没有' + title + '。</div>')
    + inner + '</div>';
  return '<div class="dashboard-grid">'
    + card('今日教练', coach, coach && coach.at,
      '<div class="entry-context">根据当前时段、饮食、训练与恢复，给一条当下最值得做的建议。</div>'
      + '<button class="btn btn-soft btn-block" id="askCoach">问问教练 · ' + dayPartCN() + '</button>')
    + card('AI 周建议', adv, adv && adv.date,
      '<button class="btn btn-soft btn-block" data-nav="trends">获取本周建议</button>')
    + '</div>';
}

export function bind(){
  const d = state.selDate;
  const goal = calorieGoal();
  animateRing(goal ? dayCalories(d) / goal : 0);
  animateNumber($('#calNum'), dayCalories(d));
  /* 日期导航（切日期时重置计划卡的手动切换，让“今日训练”跟随所选日期的建议） */
  const setDate = ds => { state.selDate = ds; state.planDayView = null; rerender(); };
  $('#dPrev').addEventListener('click', () => setDate(addDays(state.selDate, -1)));
  $('#dNext').addEventListener('click', () => setDate(addDays(state.selDate, 1)));
  const t = $('#dToday');
  if(t) t.addEventListener('click', () => setDate(todayStr()));
  /* 月历：选日期 / 翻月（翻月保持日号，超出当月天数时收敛到最后一天） */
  const shiftMonth = n => {
    const [y, m, day] = state.selDate.split('-').map(Number);
    const first = new Date(y, m - 1 + n, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    setDate(fmtDate(new Date(first.getFullYear(), first.getMonth(), Math.min(day, last))));
  };
  $('#calPrev').addEventListener('click', () => shiftMonth(-1));
  $('#calNext').addEventListener('click', () => shiftMonth(1));
  $$('#view [data-caldate]').forEach(b => b.addEventListener('click', () => setDate(b.getAttribute('data-caldate'))));
  $$('#view [data-range]').forEach(b => b.addEventListener('click', () => { state.chartRange = +b.getAttribute('data-range'); rerender(true); }));
  $$('#view [data-planday]').forEach(b => b.addEventListener('click', () => { state.planDayView = b.getAttribute('data-planday'); rerender(true); }));
  const ask = $('#askCoach');
  if(ask) ask.addEventListener('click', askCoach);
}

/* 今日教练（存最近 10 条，与旧版 daily 页共用一套数据） */
async function askCoach(){
  if(!(await needKey())) return;
  setLoading(true, '教练正在看你的数据…');
  try{
    const c = await dsChat([
      { role: 'system', content: COACH_PROMPT },
      { role: 'user', content: buildCoachContext() },
    ], false);
    DB.coachTips.unshift({ id: uid(), at: new Date().toISOString().slice(0, 16).replace('T', ' '), text: String(c).trim() });
    if(DB.coachTips.length > 10) DB.coachTips.length = 10;
    touch();
    rerender(true);
    toast('教练建议已更新');
  }catch(e){
    toast('获取建议失败：' + e.message);
  }finally{
    setLoading(false);
  }
}
