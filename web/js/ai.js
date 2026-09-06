/* DeepSeek AI：热量估算、训练点评、周度建议 */

import { toast, todayStr, addDays, fmtDate, isNum } from './ui.js';
import { DB, MEAL_ORDER, MEAL_CN, state, dayMeals, dayCalories, dayMacro,
         dayWorkout, sortedMeasures, calorieGoal, nutrientTargets,
         calcTDEE, bodyFatTrend, latestMeasure, daySupps,
         PLAN, planSuggestion, workoutDayType, workoutLabel } from './store.js';

/* ---------- 模型（固定） ---------- */
export const MODEL = 'deepseek-v4-flash-vision-exp';
export const MODEL_DESC = 'deepseek-v4-flash-vision-exp · V4 Flash 多模态实验版';

/* ---------- API Key：统一存在服务器端（data/config.json），CLI / 各设备共用 ---------- */
let cachedKey = null;

export async function getKey(){
  if(cachedKey != null) return cachedKey;
  try{
    const r = await fetch('/api/key', { cache: 'no-store' });
    const j = await r.json();
    cachedKey = j.key || '';
    /* 老版本存在浏览器 localStorage 的 key 自动迁移到服务器 */
    if(!cachedKey){
      try{
        const old = localStorage.getItem('hk_api_key');
        if(old){ await setKey(old); cachedKey = old; }
      }catch(e){}
    }
    return cachedKey;
  }catch(e){ return ''; }
}
export async function setKey(k){
  const r = await fetch('/api/key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: k }),
  });
  const j = await r.json().catch(() => ({}));
  if(!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
  cachedKey = k;
}
export async function needKey(){
  const k = await getKey();
  if(!k){ toast('请先在「设置」填写 DeepSeek API Key'); location.hash = '#/settings'; return false; }
  return true;
}
export function getModel(){ return MODEL; }

export const CAL_PROMPT = '你是营养热量估算助手。用户给出一天各餐的食物名称（分量按常见默认分量估）。估算每个食物的热量（千卡）与蛋白质、碳水、脂肪（克）。只返回 JSON，不要任何其他文字，格式严格为：{"breakfast":[{"name":"食物名","calories":数字,"protein":数字,"carbs":数字,"fat":数字}],"lunch":[],"dinner":[],"snack":[]}。每餐内 name 必须与输入一致且保持顺序；没提到或没吃的那餐返回空数组。无法精确的食物给合理估计值。';
export const TRAIN_PROMPT = '你是健身训练分析教练。用户有一份私教制定的分部位训练计划（上肢A胸肩/上肢B背臂/下肢臀腿轮换）。根据用户一次训练记录，结合计划给出简短点评（150字以内）：这次练的内容在计划里属于哪个训练日、完成度如何、动作选择可调整点、下次按计划该练什么。用中文，不要寒暄，不要用列表符号以外的格式。';

/* 计划上下文：注入给训练点评 / 今日教练 */
export function buildPlanContext(){
  const s = planSuggestion();
  const recent = (DB.workouts || [])
    .filter(w => workoutDayType(w))
    .sort((a, b) => a.date < b.date ? 1 : -1)
    .slice(0, 6)
    .map(w => w.date.slice(5) + ' ' + (w.name || w.type) + (w.duration ? ' ' + w.duration + 'min' : '') + '（' + (workoutDayType(w) || '') + '）');
  const lines = ['私教计划：上肢日（A 胸肩 / B 背臂 二选一）与下肢日（臀腿）轮换，不绑星期；主项——上肢A：小角度上斜卧推+史密斯推肩；上肢B：高位下拉+坐姿划船；下肢：史密斯臀推+RDL+保加利亚分腿蹲。每次训练前最伟大拉伸与松解激活，训练后拉伸放松。'];
  lines.push('计划推荐今天：' + PLAN.days[s.suggested].label + '。理由：' + s.reason);
  if(recent.length) lines.push('近期力量训练（新→旧）：' + recent.join('；'));
  return lines.join('\n');
}
export const ADVICE_PROMPT = '你是私人健康教练兼营养师。用户有一份私教分部位训练计划（上肢A胸肩/上肢B背臂/下肢臀腿轮换）。根据用户最近一段时间的三餐热量与营养素、训练记录（对照计划的完成情况）、睡眠、体重和体脂数据，以及目标，给出周度建议（400字以内，分点）：1)当前进展与目标差距；2)饮食热量与营养素调整建议；3)训练计划执行情况与下周安排建议；4)睡眠恢复与重点关注。用中文，语气客观务实，基于提供的数据说话，不要编造没有的数据。';
export const COACH_PROMPT = '你是私人健康教练。用户有一份私教分部位训练计划（上肢A胸肩/上肢B背臂/下肢臀腿轮换）。根据用户当前情境与计划进度，给出一条简短建议（100字以内）：聚焦当下最值得做的一件事（今天按计划该练什么 / 饮食缺口怎么补 / 恢复提醒）。要具体可执行，结合数据，语气亲切带点鼓励，不要分点罗列、不要面面俱到。';
export const RECIPE_PROMPT = '你是营养师。用户即将吃某一餐，根据当天已摄入情况与目标缺口推荐这一餐吃什么。只返回 JSON，格式严格为：{"items":[{"name":"食物名","calories":数字,"protein":数字,"carbs":数字,"fat":数字,"reason":"15字内的推荐理由"}],"summary":"25字内的整体说明"}。推荐 2-3 样常见食物（食堂/便利店/外卖容易买到），总热量尽量贴近给出的可用热量，优先补足蛋白质缺口；尊重用户的口味偏好与忌口。';

/* ---------- 今日教练：情境构建（时段 / 当日摄入 / 是否训练 / 目标进度） ---------- */
export function dayPartCN(){
  const h = new Date().getHours();
  if(h < 6) return '凌晨';
  if(h < 10) return '早晨（早餐前后）';
  if(h < 11.5) return '上午（餐间）';
  if(h < 13.5) return '中午（午餐时段）';
  if(h < 17) return '下午（餐间，适合加餐）';
  if(h < 20) return '傍晚（晚餐时段）';
  return '夜间';
}
export function buildCoachContext(){
  const d = state.selDate || todayStr();
  const total = dayCalories(d);
  const macro = dayMacro(d);
  const goal = calorieGoal();
  const ws = dayWorkout(d);
  const T = nutrientTargets();
  const conds = DB.conditions && DB.conditions[d];
  const lines = [];
  lines.push('当前时段：' + dayPartCN());
  lines.push('今日已摄入 ' + total + ' 千卡' + (goal ? '（目标 ' + goal + ' 千卡，' + (total > goal ? '已超 ' + (total - goal) : '还剩 ' + (goal - total)) + '）' : ''));
  lines.push('今日营养素：蛋白质 ' + Math.round(macro.protein) + 'g' + (T ? '（目标 ' + T.proteinTarget + 'g）' : '')
    + '、碳水 ' + Math.round(macro.carbs) + 'g、脂肪 ' + Math.round(macro.fat) + 'g');
  const eaten = MEAL_ORDER.filter(k => (dayMeals(d)[k] || []).length || (DB.meals[d] && DB.meals[d]._skip && DB.meals[d]._skip[k]));
  lines.push('今日餐次：' + (eaten.length
    ? eaten.map(k => (DB.meals[d]._skip && DB.meals[d]._skip[k]) ? MEAL_CN[k] + '（标记没吃）' : MEAL_CN[k] + '已吃').join('、')
    : '还没有吃'));
  if(!eaten.includes('snack')) lines.push('（加餐未吃）');
  if(ws.length){
    lines.push('今日已训练：' + ws.map(workoutLabel).join('、'));
  }else{
    lines.push('今日还没有训练');
  }
  if(conds && isNum(conds.sleep)) lines.push('昨晚睡眠 ' + conds.sleep + ' 小时');
  const supps = Object.keys(daySupps(d));
  if(supps.length) lines.push('今日补剂已吃：' + supps.join('、'));
  const lm = latestMeasure();
  if(lm) lines.push('最近体测（' + lm.date + '）：体重 ' + (lm.weight != null ? lm.weight + 'kg' : '—') + '，体脂 ' + (lm.bodyFat != null ? lm.bodyFat + '%' : '未记录'));
  lines.push(buildPlanContext());
  const tr = bodyFatTrend();
  const g = DB.goals || {};
  if(tr && isNum(g.bodyFat)){
    lines.push('体脂目标 ' + g.bodyFat + '%（' + (g.targetDate ? '期限 ' + g.targetDate : '无期限') + '），当前 ' + tr.current + '%，'
      + (tr.perWeek != null ? '最近趋势每周 ' + (tr.perWeek > 0 ? '+' : '') + tr.perWeek.toFixed(2) + ' 个百分点' : '暂无可算趋势'));
  }
  return lines.join('\n');
}

/* ---------- 推荐食谱：情境构建 ---------- */
export function buildRecipeContext(mealKey, pref){
  const d = state.selDate || todayStr();
  const total = dayCalories(d);
  const macro = dayMacro(d);
  const goal = calorieGoal();
  const T = nutrientTargets();
  const remain = goal ? Math.max(150, goal - total) : null;
  const lines = [];
  lines.push('即将吃：' + (MEAL_CN[mealKey] || mealKey) + '（当前时段：' + dayPartCN() + '）');
  lines.push('今日已摄入 ' + total + ' 千卡' + (goal ? '，目标 ' + goal + ' 千卡，这一餐建议控制在 ' + remain + ' 千卡以内' : ''));
  lines.push('已摄入营养素：蛋白 ' + Math.round(macro.protein) + 'g、碳水 ' + Math.round(macro.carbs) + 'g、脂肪 ' + Math.round(macro.fat) + 'g'
    + (T ? '；蛋白目标 ' + T.proteinTarget + 'g，还差 ' + Math.max(0, T.proteinTarget - macro.protein) + 'g' : ''));
  const ws = dayWorkout(d);
  if(ws.length) lines.push('今天已训练：' + ws.map(workoutLabel).join('、'));
  if(pref) lines.push('用户口味/要求：' + pref);
  return lines.join('\n');
}

/* ---------- 请求 ---------- */
export async function dsChat(messages, jsonMode){
  const key = await getKey();
  const model = getModel();
  const body = { model, messages, stream: false };
  if(jsonMode) body.response_format = { type: 'json_object' }; // V4 系列支持 JSON Output
  let res;
  try{
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body),
    });
  }catch(e){
    throw new Error('无法连接 DeepSeek（检查网络）');
  }
  if(!res.ok){
    const t = await res.text().catch(() => '');
    throw new Error('DeepSeek HTTP ' + res.status + ' ' + (t || '').slice(0, 160));
  }
  const data = await res.json();
  const c = data && data.choices && data.choices[0];
  if(!c || !c.message) throw new Error('DeepSeek 返回异常');
  return c.message.content;
}

export function parseJson(text){
  text = String(text || '').trim();
  const f = text.indexOf('{'), l = text.lastIndexOf('}');
  if(f >= 0 && l > f){
    try{ return JSON.parse(text.slice(f, l + 1)); }catch(e){}
  }
  try{ return JSON.parse(text); }catch(e){ throw new Error('无法解析 AI 返回的 JSON'); }
}

/* ---------- 喂给周建议的数据摘要 ---------- */
export function buildHistorySummary(){
  const now = new Date();
  const end = fmtDate(now);
  const startDate = new Date(); startDate.setDate(now.getDate() - 27);
  const start = fmtDate(startDate);
  const lines = ['数据范围：' + start + ' 至 ' + end];

  // 三餐热量与营养素
  const calRows = [];
  const daysP = [], daysC = [], daysF = [];
  for(let d = start; d <= end; d = addDays(d, 1)){
    const c = dayCalories(d);
    if(c > 0){
      calRows.push(d + ' ' + c + ' 千卡');
      const m = dayMacro(d);
      if(m.protein || m.carbs || m.fat){ daysP.push(m.protein); daysC.push(m.carbs); daysF.push(m.fat); }
    }
  }
  lines.push('每日摄入热量（仅记录过三餐的日子）：' + (calRows.join('；') || '无'));
  const avg = a => a.length ? Math.round(a.reduce((x,y)=>x+y,0) / a.length) : null;
  lines.push('日均摄入（有记录的日子）：' + (calRows.length
    ? Math.round(calRows.reduce((s,r) => s + Number(r.split(' ')[1]), 0) / calRows.length) + ' 千卡' : '无'));
  if(daysP.length){
    lines.push('日均营养素：蛋白质 ' + avg(daysP) + 'g、碳水 ' + avg(daysC) + 'g、脂肪 ' + avg(daysF) + 'g（' + daysP.length + ' 天有营养素记录）');
  }
  const goal = calorieGoal();
  if(goal) lines.push('每日热量目标：' + goal + ' 千卡' + (calRows.length
    ? '（近期实际摄入' + (Math.round(calRows.reduce((s,r)=>s+Number(r.split(' ')[1]),0)/calRows.length) > goal ? '高于' : '低于') + '目标）' : ''));

  // 训练（对照计划归档：上肢A/上肢B/下肢）
  const ws = (DB.workouts || []).filter(w => w.date >= start && w.date <= end);
  const planCount = {};
  ws.forEach(w => {
    const t = workoutDayType(w);
    if(t) planCount[t] = (planCount[t] || 0) + 1;
  });
  lines.push('训练共 ' + ws.length + ' 次、合计 ' + ws.reduce((s,w)=>s+(w.duration||0),0) + ' 分钟：'
    + (ws.map(w => w.date + ' ' + workoutLabel(w)).join('；') || '无'));
  if(ws.length){
    lines.push('按计划归档：上肢A×' + (planCount['上肢A'] || 0) + '、上肢B×' + (planCount['上肢B'] || 0) + '、下肢×' + (planCount['下肢'] || 0)
      + '；计划推荐今天：' + PLAN.days[planSuggestion().suggested].label);
  }

  // 睡眠与没吃的餐次
  const conds = Object.keys(DB.conditions || {})
    .filter(d => d >= start && d <= end)
    .map(d => DB.conditions[d]);
  const sleeps = conds.map(c => c.sleep).filter(isNum);
  if(sleeps.length) lines.push('平均睡眠 ' + (sleeps.reduce((a,b)=>a+b,0)/sleeps.length).toFixed(1) + ' 小时（' + sleeps.length + ' 天记录）');
  const skippedList = [];
  Object.keys(DB.meals || {}).forEach(date => {
    if(date < start || date > end) return;
    const s = (DB.meals[date] || {})._skip || {};
    MEAL_ORDER.forEach(k => { if(s[k]) skippedList.push(date.slice(5) + ' ' + MEAL_CN[k]); });
  });
  if(skippedList.length) lines.push('标记没吃的餐次：' + skippedList.join('、'));

  // 体测
  const ms = sortedMeasures().filter(m => m.date >= start && m.date <= end);
  lines.push('体测记录：' + (ms.map(m => m.date + ' 体重' + (m.weight != null ? m.weight + 'kg' : '—')
    + ' 体脂' + (m.bodyFat != null ? m.bodyFat + '%' : '—')).join('；') || '无'));
  if(ms.length >= 2){
    const a = ms[0], b = ms[ms.length-1];
    if(isNum(a.weight) && isNum(b.weight)){
      const dw = +(b.weight - a.weight).toFixed(1);
      lines.push('期间体重变化：' + (dw >= 0 ? '+' : '') + dw + ' kg');
    }
    if(isNum(a.bodyFat) && isNum(b.bodyFat)){
      const df = +(b.bodyFat - a.bodyFat).toFixed(1);
      lines.push('期间体脂变化：' + (df >= 0 ? '+' : '') + df + ' 个百分点');
    }
  }

  const g = DB.goals || {};
  const tdee = calcTDEE();
  lines.push('目标：体重 ' + (g.weight != null ? g.weight + 'kg' : '未设')
    + '，体脂率 ' + (g.bodyFat != null ? g.bodyFat + '%' : '未设')
    + (tdee ? '；估算 TDEE 约 ' + tdee + ' 千卡' : ''));
  return lines.join('\n');
}
