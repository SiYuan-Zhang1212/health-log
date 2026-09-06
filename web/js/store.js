/* 内存数据 + 派生计算：所有视图通过 DB 读写，修改后调用 touch() 触发自动保存 */

import { scheduleSave, setDBRef } from './api.js';
import { todayStr, addDays, fmtDate, uid, isNum } from './ui.js';

export const MEAL_CN = { breakfast:'早餐', lunch:'午餐', dinner:'晚餐', snack:'加餐' };
export const MEAL_ORDER = ['breakfast','lunch','dinner','snack'];

/* 每日在吃的补剂 */
export const SUPPS = ['蛋白粉', '肌酸', '鱼油', '维生素', '益生菌'];

/* ---------- 固定搭配（三餐页一键加入；热量营养为常用分量估算，加入后可点条目修改） ---------- */
export const COMBOS = {
  breakfast: [
    { name: '猪柳蛋麦满分 + 黑咖啡', items: [
      { name: '猪柳蛋麦满分', calories: 425, protein: 21, carbs: 31, fat: 23 },
      { name: '黑咖啡', calories: 5, protein: 0, carbs: 0, fat: 0 },
    ]},
    { name: '猪柳炒双蛋麦满分 + 黑咖啡', items: [
      { name: '猪柳炒双蛋麦满分', calories: 505, protein: 27, carbs: 32, fat: 29 },
      { name: '黑咖啡', calories: 5, protein: 0, carbs: 0, fat: 0 },
    ]},
    { name: '板烧鸡腿麦满分 + 黑咖啡', items: [
      { name: '板烧鸡腿麦满分', calories: 330, protein: 24, carbs: 30, fat: 11 },
      { name: '黑咖啡', calories: 5, protein: 0, carbs: 0, fat: 0 },
    ]},
    { name: '板烧鸡腿炒双蛋麦满分 + 黑咖啡', items: [
      { name: '板烧鸡腿炒双蛋麦满分', calories: 410, protein: 30, carbs: 31, fat: 17 },
      { name: '黑咖啡', calories: 5, protein: 0, carbs: 0, fat: 0 },
    ]},
  ],
  meal: [
    { name: '赛百味金枪鱼三明治', items: [
      { name: '赛百味金枪鱼三明治', calories: 480, protein: 23, carbs: 44, fat: 24 },
    ]},
    { name: '麦当劳双层吉士汉堡 ×2 + 玉米 + 无糖可乐', items: [
      { name: '双层吉士汉堡 ×2', calories: 880, protein: 50, carbs: 66, fat: 48 },
      { name: '煮玉米', calories: 120, protein: 4, carbs: 25, fat: 2 },
      { name: '无糖可乐', calories: 0, protein: 0, carbs: 0, fat: 0 },
    ]},
    { name: '食堂自选：杂粮饭 + 鸡腿 + 青菜', items: [
      { name: '杂粮饭', calories: 220, protein: 6, carbs: 45, fat: 1.5 },
      { name: '鸡腿', calories: 180, protein: 20, carbs: 0, fat: 10 },
      { name: '青菜', calories: 80, protein: 3, carbs: 6, fat: 5 },
    ]},
  ],
};
/* 某一餐可用的固定搭配：早餐用早餐组，午餐/晚餐共用午晚组 */
export function combosFor(meal){
  if(meal === 'breakfast') return COMBOS.breakfast;
  if(meal === 'lunch' || meal === 'dinner') return COMBOS.meal;
  return [];
}
export function comboTotal(c){
  return c.items.reduce((s, it) => s + (isNum(it.calories) ? it.calories : 0), 0);
}
export function comboMacro(c){
  return c.items.reduce((a, it) => {
    a.protein += isNum(it.protein) ? it.protein : 0;
    a.carbs += isNum(it.carbs) ? it.carbs : 0;
    a.fat += isNum(it.fat) ? it.fat : 0;
    return a;
  }, { protein: 0, carbs: 0, fat: 0 });
}

/* 蛋白粉一天一勺（勾选补剂后自动计入当日热量与蛋白质） */
export const WHEY = { calories: 120, protein: 24, carbs: 3, fat: 1.5 };
export function wheyTaken(date){
  return !!(DB && DB.supplements && DB.supplements[date] && DB.supplements[date]['蛋白粉']);
}

/* ---------- 训练类型（简化录入） ---------- */
export const WORKOUT_KINDS = ['力量', '有氧', '力量+有氧', '乒乓球'];
export const PLAN_DAY_OPTS = ['臀腿', '胸肩', '背臂']; // 力量项目 = 计划的三个训练日
export const PLAN_DAY_MAP = { '臀腿': '下肢', '胸肩': '上肢A', '背臂': '上肢B' };
export const CARDIO_OPTS = ['爬坡', '椭圆机', '团课'];

/* 一条训练的展示文案（兼容旧版记录） */
export function workoutLabel(w){
  if(w.plan || w.cardio){
    const parts = [];
    if(w.plan) parts.push('力量 · ' + w.plan);
    if(w.cardio) parts.push('有氧 · ' + w.cardio);
    return parts.join(' ＋ ');
  }
  return (w.type || '') + (w.name && w.name !== w.type ? ' · ' + w.name : '');
}

/* ---------- 私教训练计划（2026-08-31 最终版） ----------
   结构：上肢日（A 胸肩 / B 背臂 二选一）与下肢日轮换，不绑定星期；
   每次训练前做最伟大拉伸与松解激活，训练后做对应拉伸放松。 */
export const PLAN = {
  warmup: {
    common: ['最伟大拉伸（弓步 → 双手上举到极限 → 支撑腿外倾 → 转胸椎，两侧）'],
    upper: ['胸小肌/肩前侧球松解', '背部与上背泡沫轴', '肩部/三角肌靠墙球松解',
      'Dead bug（腹式呼吸控制四肢）', '四足支撑肩胛控制', '四足支撑胸椎旋转',
      '弹力带肩部激活（外旋 / Y / D 绕肩）'],
    lower: ['下肢松解：小腿 → 腘绳肌 → 臀部 → 大腿内侧 → 大腿外侧', 'Dead bug 抗阻版（吸气伸腿、呼气收回）'],
  },
  post: {
    upper: ['背部拉伸（前屈双手交握，左右偏移）', '单侧背部拉伸', '胸部/肩前侧拉伸（抵墙转体）',
      '后三角肌横向拉伸', '上斜方肌拉伸（拉哪侧→头转哪侧→对侧侧倾）', '手臂放松（三头侧卧、二头俯卧轻压）'],
    lower: ['90/90 髋部拉伸', '臀部拉伸', '站姿股四头肌拉伸（扶墙，膝盖并拢）',
      '腘绳肌：深度松解需教练辅助，暂不自行按压'],
  },
  days: {
    '上肢A': {
      label: '上肢 A · 胸 + 肩',
      focus: ['胸', '肩'],
      main: [
        { name: '小角度上斜卧推', cue: '凳子调小角度上斜；全握拇指包杠、手腕中立，杠落掌根；下放到胸大肌下缘，推起呼气。' },
        { name: '史密斯推肩', cue: '核心躯干稳定、手腕中立；不耸肩、不腰后仰借力；推起呼气、回程吸气。' },
      ],
      assist: [
        { name: '站姿哑铃侧平举', cue: '身体略前倾，手臂从两侧向外“甩开”；重量轻优先，不靠躯干摆动。' },
        { name: '反向蝴蝶机 / 后三角飞鸟', cue: '半握、手肘微屈；肩胛略分开不刻意夹；幅度小而可控，打开呼气。' },
      ],
    },
    '上肢B': {
      label: '上肢 B · 背 + 臂',
      focus: ['背', '臂'],
      main: [
        { name: '高位下拉', cue: '坐稍深、腿垫压大腿，先预拉紧；想“肘部向下”，躯干像铁板不后仰。' },
        { name: '坐姿划船', cue: '握低位把手、手腕略内旋；拉回呼气可略爆发，回程慢控感受背部拉长；不晃身。' },
      ],
      assist: [
        { name: '绳索直臂下压', cue: '髋部后移小髋铰链、背部中立；下压时想象把绳向下并向两侧分开。' },
        { name: '绳索下压（肱三头）', cue: '上臂略前并固定，只让前臂绕肘向下；手腕中立。' },
        { name: '绳索弯举（肱二头）', cue: '固定上臂只做肘屈；躯干稳定，不后仰借力。' },
      ],
    },
    '下肢': {
      label: '下肢 · 臀 + 腿',
      focus: ['臀', '腿'],
      main: [
        { name: '史密斯臀推', cue: '上背靠凳、双脚肩宽脚尖朝前；顶端膝角略小于 90°、躯干大腿接近平行；臀发力，不用腰椎顶。' },
        { name: '罗马尼亚硬拉（RDL）', cue: '是髋铰链不是深蹲：核心收紧 → 髋向后 → 中足承重 → 负重贴腿 → 臀发力回站。' },
        { name: '保加利亚分腿蹲', cue: '后脚搭腘窝高度只管平衡；身体直上直下，前侧臀腿发力推起。' },
      ],
      assist: [
        { name: '坡度走（可选收尾）', cue: '30 分钟坡度走作为有氧收尾，不是固定要求。' },
      ],
    },
  },
};

/* 训练记录 → 匹配计划日类型（新版直接按 plan 字段；旧记录按动作名识别） */
export function workoutDayType(w){
  if(w.plan && PLAN_DAY_MAP[w.plan]) return PLAN_DAY_MAP[w.plan];
  const t = String(w.type || '');
  if(t === '乒乓球' || t === '有氧') return null;
  if(t === '力量+有氧' || t === '力量') return '上肢A'; // 新版没存 plan 时兜底
  const s = [t, w.name || ''].join(' ');
  if(/臀推|臀桥|硬拉|rdl|深蹲|分腿蹲|腿举|腿弯举|腿屈伸|提踵/i.test(s)) return '下肢';
  if(/卧推|推肩|肩推|侧平举|蝴蝶机|飞鸟|胸|肩/i.test(s)) return '上肢A';
  if(/下拉|划船|直臂下压|弯举|下压|引体|背|臂|二头|三头/i.test(s)) return '上肢B';
  if(t === '力量') return '上肢A';
  return null; // 有氧/跑步等不计入轮换
}

/* 基于最近训练记录推荐 ref 当天该练什么（计划不绑星期，看恢复节奏）。
   关键：推荐只看「ref 之前」的记录（w.date < ref），这样看过去日期时
   显示的是那天按计划该练的内容，而不是练完之后的下一次。 */
export function planSuggestion(ref){
  ref = ref || todayStr();
  const all = (DB.workouts || [])
    .filter(w => workoutDayType(w))
    .sort((a, b) => a.date < b.date ? 1 : -1);
  const before = all.filter(w => w.date < ref);   // 当天开始前
  const upto = all.filter(w => w.date <= ref);    // 含当天（用于“当天已练”提示）

  function daysSince(ds){
    const p = ds.split('-').map(Number), r = ref.split('-').map(Number);
    return Math.round((new Date(r[0], r[1]-1, r[2]) - new Date(p[0], p[1]-1, p[2])) / 86400000);
  }
  const UPPER_CYCLE = { '上肢A': '上肢B', '上肢B': '下肢', '下肢': '上肢A' };

  const prev = before[0] ? workoutDayType(before[0]) : null;
  const prevSame = prev ? before.filter(w => workoutDayType(w) === prev).slice(0, 3) : [];
  let suggested;
  if(!prev) suggested = '下肢';
  else if(prev === '上肢A' && prevSame.length >= 2 && prevSame.every(w => workoutDayType(w) === '上肢A')) suggested = '上肢B';
  else if(prev === '下肢') suggested = '上肢A';
  else suggested = UPPER_CYCLE[prev];

  const last = upto[0] || null;
  const lastType = last ? workoutDayType(last) : null;
  const lastDate = last ? last.date : null;
  const gap = lastDate != null ? daysSince(lastDate) : null;

  const dayWord = ref === todayStr() ? '今天' : ref.slice(5);
  let reason;
  if(!prev){
    reason = '还没有力量训练记录，从下肢日开始（主项：史密斯臀推、RDL、保加利亚分腿蹲）。';
  } else if(gap === 0){
    reason = dayWord + '已练 ' + PLAN.days[lastType].label + '；下一次建议：' + PLAN.days[UPPER_CYCLE[lastType]].label + '。';
  } else if(gap === 1){
    reason = '上次' + PLAN.days[lastType].label + '在 ' + lastDate.slice(5) + '，' + dayWord + '换 ' + PLAN.days[suggested].label + '，让上次练的部位恢复。';
  } else if(gap <= 3){
    reason = '上次' + PLAN.days[lastType].label + '是 ' + gap + ' 天前，按轮换' + dayWord + '安排 ' + PLAN.days[suggested].label + '。';
  } else {
    reason = '距离上次训练已经 ' + gap + ' 天，' + dayWord + '从 ' + PLAN.days[suggested].label + ' 重新启动。';
  }

  /* 连续训练天数 */
  let streak = 0;
  for(let i = 0; i < 10; i++){
    const dd = addDays(ref, -i);
    if((DB.workouts || []).some(w => w.date === dd && workoutDayType(w))) streak++;
    else if(i > 0) break;
  }

  return {
    suggested,
    lastType, lastDate, gap, streak,
    reason,
  };
}

export const ACTIVITY_LEVELS = [
  ['1.2',   '久坐（几乎不运动）'],
  ['1.375', '轻度活动（每周 1-3 次）'],
  ['1.55',  '中度活动（每周 3-5 次）'],
  ['1.725', '高强度（每周 6-7 次）'],
  ['1.9',   '极高（体力劳动/每天两练）'],
];

export let DB = null;

/* 页面级状态 */
export const state = {
  selDate: todayStr(),
  selMeal: 'breakfast',
  chartRange: 30,        // 7 / 30 / 90 / 0(全部)
  editingWorkout: null,  // 正在编辑的训练 id
  editingMeal: -1,       // 正在编辑的食物下标（-1 无）
};

export function defaultDB(){
  return { meals:{}, workouts:[], measures:[], conditions:{}, supplements:{},
           goals:{ weight:null, bodyFat:null, targetDate:null }, profile:{}, advices:[], coachTips:[] };
}

export function setDB(db){
  DB = Object.assign(defaultDB(), db || {});
  DB.goals = Object.assign({ weight:null, bodyFat:null, targetDate:null }, DB.goals || {});
  DB.profile = DB.profile || {};
  DB.advices = Array.isArray(DB.advices) ? DB.advices : [];
  DB.coachTips = Array.isArray(DB.coachTips) ? DB.coachTips : [];
  DB.supplements = DB.supplements && typeof DB.supplements === 'object' ? DB.supplements : {};
  setDBRef(DB); // 保持 api 模块持有最新引用
  return DB;
}

export function touch(){ scheduleSave(); }

/* ---------- 三餐 ---------- */
export function dayMeals(date){
  if(!DB.meals[date]) DB.meals[date] = { breakfast:[], lunch:[], dinner:[], snack:[] };
  return DB.meals[date];
}
function n(v){ return isNum(v) ? v : 0; }
export function mealTotal(items){ return items.reduce((s,i) => s + n(i.calories), 0); }
export function mealMacro(items){
  return items.reduce((a,i) => {
    a.protein += n(i.protein); a.carbs += n(i.carbs); a.fat += n(i.fat);
    return a;
  }, { protein:0, carbs:0, fat:0 });
}
export function dayCalories(date){
  const m = DB.meals[date];
  let total = m ? MEAL_ORDER.reduce((s,k) => s + (m[k] ? mealTotal(m[k]) : 0), 0) : 0;
  if(wheyTaken(date)) total += WHEY.calories; // 蛋白粉一勺
  return total;
}
export function dayMacro(date){
  const m = DB.meals[date] || {};
  const a = MEAL_ORDER.reduce((acc,k) => {
    const mm = m[k] ? mealMacro(m[k]) : { protein:0, carbs:0, fat:0 };
    acc.protein += mm.protein; acc.carbs += mm.carbs; acc.fat += mm.fat;
    return acc;
  }, { protein:0, carbs:0, fat:0 });
  if(wheyTaken(date)){
    a.protein += WHEY.protein; a.carbs += WHEY.carbs; a.fat += WHEY.fat;
  }
  return a;
}

/* ---------- 训练 ---------- */
export function dayWorkout(date){ return (DB.workouts||[]).filter(w => w.date === date); }
export function sortedWorkouts(){
  return (DB.workouts||[]).slice().sort((a,b) => a.date < b.date ? 1 : -1);
}

/* ---------- 体测 ---------- */
export function sortedMeasures(){
  return (DB.measures||[]).slice().sort((a,b) => a.date < b.date ? -1 : 1);
}
export function latestMeasure(){
  const s = sortedMeasures();
  return s.length ? s[s.length-1] : null;
}
export function measuresInRange(days){ // days=0 表示全部；否则取最近 days 天
  const ms = sortedMeasures();
  if(!days) return ms;
  const cutoff = addDays(todayStr(), -(days - 1));
  return ms.filter(m => m.date >= cutoff);
}

/* ---------- 目标 / TDEE ---------- */
export function profileReady(){
  const p = DB.profile || {};
  return !!(p.sex && n(p.age) > 0 && n(p.height) > 0);
}
export function calcBMR(){
  const m = latestMeasure();
  if(!m) return null;
  if(isNum(m.bmr)) return m.bmr; // 体测实测的基础代谢优先
  const p = DB.profile || {};
  if(!profileReady() || !isNum(m.weight)) return null;
  const base = 10 * m.weight + 6.25 * p.height - 5 * p.age;
  return Math.round(p.sex === 'female' ? base - 161 : base + 5);
}
export function calcTDEE(){
  const b = calcBMR();
  return b == null ? null : Math.round(b * Number(DB.profile.activity || 1.375));
}
export function calorieGoal(){
  const p = DB.profile || {};
  if(n(p.calorieGoal) > 0) return Math.round(p.calorieGoal);
  return calcTDEE(); // 未自定义时用 TDEE（维持体重）作参考目标
}

/* ---------- 营养素目标（按体重） ---------- */
export function nutrientTargets(){
  const m = latestMeasure();
  if(!m || !isNum(m.weight)) return null;
  const w = m.weight;
  return {
    weight: w,
    proteinMin: Math.round(w * 1.2), proteinTarget: Math.round(w * 1.5), proteinMax: Math.round(w * 2.0),
    carbsMin: Math.round(w * 3), carbsMax: Math.round(w * 5),
    fatMin: Math.round(w * 0.6), fatMax: Math.round(w * 1.0),
  };
}

/* ---------- 训练消耗估算（MET 法；新版不记时长，用各类型默认时长） ---------- */
const MET_BY_TYPE = { 力量:5, 有氧:6, '力量+有氧':6, 乒乓球:4, 跑步:8, 游泳:7, 骑行:6.5, 瑜伽:3, 球类:7, 其他:5 };
const DEFAULT_MIN = { 力量:45, 有氧:30, '力量+有氧':75, 乒乓球:45 };
const INT_MULT = { 低:0.75, 中:1, 高:1.25 };
export function workoutCalories(date){
  const m = latestMeasure();
  if(!m || !isNum(m.weight)) return null;
  const ws = dayWorkout(date);
  if(!ws.length) return 0;
  return Math.round(ws.reduce((s, w) => {
    const met = MET_BY_TYPE[w.type] || 5;
    const mult = INT_MULT[w.intensity] != null ? INT_MULT[w.intensity] : 1;
    const min = (w.duration && w.duration > 0) ? w.duration : (DEFAULT_MIN[w.type] || 40);
    return s + met * mult * m.weight * (min / 60);
  }, 0));
}

/* ---------- 没吃标记（存在 dayMeals._skip） ---------- */
export function isSkipped(date, meal){
  const m = DB.meals[date];
  return !!(m && m._skip && m._skip[meal]);
}
export function markSkip(date, meal, on){
  const m = dayMeals(date);
  m._skip = m._skip || {};
  if(on) m._skip[meal] = true;
  else delete m._skip[meal];
}

/* ---------- 补剂打卡（DB.supplements[date][名称]=true） ---------- */
export function daySupps(date){
  return (DB.supplements && DB.supplements[date]) || {};
}
export function toggleSupp(date, name, on){
  DB.supplements = DB.supplements || {};
  const d = DB.supplements[date] = DB.supplements[date] || {};
  if(on) d[name] = true;
  else delete d[name];
}

/* ---------- 周统计（周一为一周开始） ---------- */
function mondayOf(ds){
  const p = ds.split('-').map(Number);
  const d = new Date(p[0], p[1]-1, p[2]);
  return fmtDate(new Date(p[0], p[1]-1, p[2] - (d.getDay()+6)%7));
}
export function weekStats(ref){
  const start = mondayOf(ref);
  const days = [];
  for(let i = 0; i < 7; i++) days.push(addDays(start, i));
  const recorded = days.filter(d => dayCalories(d) > 0);
  const sum = recorded.reduce((acc,d) => {
    const m = dayMacro(d);
    acc.cal += dayCalories(d);
    acc.p += m.protein; acc.c += m.carbs; acc.f += m.fat;
    return acc;
  }, { cal:0, p:0, c:0, f:0 });
  const ws = (DB.workouts||[]).filter(w => w.date >= start && w.date <= days[6]);
  const conds = days.map(d => DB.conditions[d]).filter(Boolean);
  const sleeps = conds.map(c => c.sleep).filter(isNum);
  const ms = sortedMeasures().filter(m => m.date >= start && m.date <= days[6] && isNum(m.weight));
  return {
    start, end: days[6],
    daysCounted: recorded.length,
    avgCal: recorded.length ? Math.round(sum.cal / recorded.length) : null,
    avgP: recorded.length ? Math.round(sum.p / recorded.length) : null,
    avgC: recorded.length ? Math.round(sum.c / recorded.length) : null,
    avgF: recorded.length ? Math.round(sum.f / recorded.length) : null,
    workoutCount: ws.length,
    workoutMin: ws.reduce((s,w) => s + n(w.duration), 0),
    avgSleep: sleeps.length ? +(sleeps.reduce((a,b)=>a+b,0) / sleeps.length).toFixed(1) : null,
    weightDelta: ms.length >= 2 ? +(ms[ms.length-1].weight - ms[0].weight).toFixed(1) : null,
  };
}

/* ---------- AI 周建议 ---------- */
export function lastAdvice(){ return DB.advices[0] || null; }
export function saveAdvice(text){
  DB.advices.unshift({ id: uid(), date: todayStr(), text: String(text).trim() });
  if(DB.advices.length > 12) DB.advices.length = 12;
  touch();
}

/* ---------- 今日教练建议（点击触发，存最近 10 条） ---------- */
export function lastCoachTip(){ return DB.coachTips[0] || null; }
export function saveCoachTip(text){
  DB.coachTips.unshift({ id: uid(), at: new Date().toISOString().slice(0, 16).replace('T', ' '), text: String(text).trim() });
  if(DB.coachTips.length > 10) DB.coachTips.length = 10;
  touch();
}

/* ---------- 体脂目标进度（趋势外推） ----------
   用最近 90 天内 ≥2 条体脂记录做线性回归，推算每周变化与预计达标日期 */
export function bodyFatTrend(){
  const g = DB.goals || {};
  const ms = sortedMeasures().filter(m => isNum(m.bodyFat));
  if(!ms.length) return null;
  const current = ms[ms.length - 1].bodyFat;
  const lastDate = ms[ms.length - 1].date;
  const out = { current, lastDate, perWeek: null, etaDate: null, needPerWeek: null, daysLeft: null, reached: false };
  if(isNum(g.bodyFat)){
    out.reached = current <= g.bodyFat;
    out.gap = +(current - g.bodyFat).toFixed(1);
    if(g.targetDate){
      const p = g.targetDate.split('-').map(Number);
      const days = Math.round((new Date(p[0], p[1] - 1, p[2]) - new Date(lastDate.slice(0, 4), +lastDate.slice(5, 7) - 1, +lastDate.slice(8, 10))) / 86400000);
      out.daysLeft = days;
      if(days > 0 && out.gap > 0) out.needPerWeek = +(out.gap / (days / 7)).toFixed(2);
    }
  }
  /* 线性回归（最近 90 天） */
  const recent = ms.filter(m => m.date >= addDays(lastDate, -90));
  if(recent.length >= 2){
    const t0 = new Date(recent[0].date.slice(0, 4), +recent[0].date.slice(5, 7) - 1, +recent[0].date.slice(8, 10)).getTime();
    const pts = recent.map(m => ({
      x: (new Date(m.date.slice(0, 4), +m.date.slice(5, 7) - 1, +m.date.slice(8, 10)).getTime() - t0) / 86400000 / 7, // 周
      y: m.bodyFat,
    }));
    const n = pts.length;
    const sx = pts.reduce((s, p) => s + p.x, 0), sy = pts.reduce((s, p) => s + p.y, 0);
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0), sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
    const denom = n * sxx - sx * sx;
    if(Math.abs(denom) > 1e-9){
      out.perWeek = +((n * sxy - sx * sy) / denom).toFixed(3);
      if(out.perWeek < 0 && isNum(g.bodyFat) && current > g.bodyFat){
        const weeks = (current - g.bodyFat) / -out.perWeek;
        if(weeks < 260){ // 超过 5 年视为不可信
          const eta = new Date(t0 + (pts[n - 1].x + weeks) * 7 * 86400000);
          out.etaDate = fmtDate(eta);
        }
      }
    }
  }
  return out;
}

/* ---------- 旧版数据检测（迁移用） ---------- */
export function hasAnyData(db){
  db = db || {};
  const meals = db.meals || {};
  const anyMeal = Object.keys(meals).some(k => MEAL_ORDER.some(m => ((meals[k]||{})[m]||[]).length));
  return anyMeal
    || (db.workouts && db.workouts.length)
    || (db.measures && db.measures.length)
    || !!(db.goals && (db.goals.weight != null || db.goals.bodyFat != null))
    || !!(db.conditions && Object.keys(db.conditions).length);
}
