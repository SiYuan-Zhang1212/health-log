/* 视图：训练 —— 计划卡、极简录入（力量/有氧/力量+有氧/乒乓球）、历史列表、AI 点评 */

import { $, $$, esc, toast, todayStr, isNum, setLoading, enterConfirm, uid } from '../ui.js';
import { DB, state, sortedWorkouts, planSuggestion, PLAN, workoutLabel,
         WORKOUT_KINDS, PLAN_DAY_OPTS, PLAN_DAY_MAP, CARDIO_OPTS, touch } from '../store.js';
import { TRAIN_PROMPT, buildPlanContext, dsChat, needKey } from '../ai.js';
import { rerender } from '../nav.js';

/* 表单状态（模块级，切类型时不丢已选） */
let form = null;
function getForm(){
  if(!form){
    const sug = {'下肢':'臀腿','上肢A':'胸肩','上肢B':'背臂'}[planSuggestion().suggested] || '臀腿';
    form = { type:'力量', plan:sug, cardio:'爬坡', date:state.selDate, id:null };
  }
  return form;
}

export function render(){
  const editing = state.editingWorkout
    ? (DB.workouts || []).find(w => w.id === state.editingWorkout) : null;
  const f = getForm();
  if(!editing && f.id == null) f.date = state.selDate;
  if(editing && form.id !== editing.id){
    form.type = editing.type || '力量';
    form.plan = editing.plan || PLAN_DAY_OPTS[0];
    form.cardio = editing.cardio || CARDIO_OPTS[0];
    form.date = editing.date;
    form.id = editing.id;
  }

  const hasStr = f.type.indexOf('力量') >= 0;
  const hasCardio = f.type.indexOf('有氧') >= 0;

  const list = sortedWorkouts();
  const rows = list.map(x => {
    const icon = String(x.type).indexOf('力量') >= 0
      ? '<path d="M6.5 9v6M4 10.5v3M17.5 9v6M20 10.5v3M6.5 12h11"/>'
      : '<path d="M7 6h10v12H7z"/><path d="M10 9h4M10 12.5h4M10 16h2.5"/>';
    const editingCls = editing && editing.id === x.id ? ' editing' : '';
    return '<div class="wentry' + editingCls + '">'
      + '<div class="who"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg></div>'
      + '<div class="bd"><div class="t">' + x.date + ' · ' + esc(workoutLabel(x)) + '</div>'
      + (x.note ? '<div class="m">备注：' + esc(x.note) + '</div>' : '')
      + '<div class="acts">'
      + '<button class="linkbtn" data-aiw="' + x.id + '">' + (x.analysis ? '重新 AI 分析' : 'AI 分析本次训练') + '</button>'
      + '<button class="linkbtn" data-editw="' + x.id + '">编辑</button>'
      + '<button class="linkbtn danger" data-delw="' + x.id + '">删除</button>'
      + '</div></div></div>';
  }).join('') || '<div class="empty">还没有训练记录。</div>';

  return '<div class="page-head input-head">'
    + '<div><div class="page-eyebrow">录入入口</div><h1 class="page-title">训练录入</h1><div class="page-sub">选择训练类型并保存，首页会显示计划、历史和完成情况。</div></div>'
    + '<button class="btn btn-soft" data-nav="today">查看首页总览</button></div>'
    + '<div class="duo input-layout">'
    + '<div class="card"><h2>' + (editing ? '修改训练' : '记录训练') + '</h2>'
    + '<div class="field"><label>日期</label><input class="inp" type="date" id="wDate" value="' + (f.date || todayStr()) + '"></div>'
    + '<div class="field"><label>类型</label><div class="seg">'
    + WORKOUT_KINDS.map(k => '<button class="' + (f.type === k ? 'on' : '') + '" data-wkind="' + k + '">' + k + '</button>').join('')
    + '</div></div>'
    + (hasStr
      ? '<div class="field"><label>力量部位<span class="xs" style="font-weight:400;">（按计划三选一）</span></label><div class="seg">'
        + PLAN_DAY_OPTS.map(p => '<button class="' + (f.plan === p ? 'on' : '') + '" data-wplan="' + p + '">' + p + '</button>').join('')
        + '</div><div class="xs" style="color:var(--muted);margin-top:6px;">'
        + esc('主项：' + PLAN.days[PLAN_DAY_MAP[f.plan]].main.map(m => m.name).join('、')) + '</div></div>'
      : '')
    + (hasCardio
      ? '<div class="field"><label>有氧方式</label><div class="seg">'
        + CARDIO_OPTS.map(c => '<button class="' + (f.cardio === c ? 'on' : '') + '" data-wcardio="' + c + '">' + c + '</button>').join('')
        + '</div></div>'
      : '')
    + (f.type === '乒乓球' ? '<div class="xs" style="color:var(--muted);">乒乓球 ✓ 记一笔就行</div>' : '')
    + (editing
      ? '<div style="display:flex;gap:8px;"><button class="btn btn-primary" id="addWorkout" style="flex:1;">保存修改</button>'
        + '<button class="btn btn-line" id="cancelEdit" style="flex:1;">取消</button></div>'
      : '<button class="btn btn-primary btn-block" id="addWorkout">保存训练记录</button>')
    + '</div>'
    + '<div class="card"><h2>历史记录<span class="sp">共 ' + list.length + ' 条</span></h2>' + rows + '</div>'
    + '</div>';
}

export function bind(){
  const f = getForm();

  const dateInput = $('#wDate');
  if(dateInput) dateInput.addEventListener('change', () => {
    f.date = dateInput.value || state.selDate;
    state.selDate = f.date;
  });

  /* 类型 / 部位 / 有氧方式切换 */
  $$('#view [data-wkind]').forEach(b => b.addEventListener('click', () => { f.type = b.getAttribute('data-wkind'); rerender(true); }));
  $$('#view [data-wplan]').forEach(b => b.addEventListener('click', () => { f.plan = b.getAttribute('data-wplan'); rerender(true); }));
  $$('#view [data-wcardio]').forEach(b => b.addEventListener('click', () => { f.cardio = b.getAttribute('data-wcardio'); rerender(true); }));

  $('#addWorkout').addEventListener('click', () => {
    const date = $('#wDate').value || todayStr();
    const rec = { type: f.type };
    if(f.type.indexOf('力量') >= 0) rec.plan = f.plan;
    if(f.type.indexOf('有氧') >= 0) rec.cardio = f.cardio;

    if(state.editingWorkout){
      const w = DB.workouts.find(x => x.id === state.editingWorkout);
      if(w){ w.date = date; w.type = rec.type; w.plan = rec.plan || null; w.cardio = rec.cardio || null; }
      state.editingWorkout = null;
      form = null;
      toast('修改已保存');
    }else{
      rec.id = uid();
      rec.date = date;
      DB.workouts.push(rec);
      state.selDate = date;
      form = null;
      toast('训练已保存');
    }
    touch();
    rerender();
  });

  const cancel = $('#cancelEdit');
  if(cancel) cancel.addEventListener('click', () => { state.editingWorkout = null; form = null; rerender(); });

  $$('#view [data-aiw]').forEach(b => b.addEventListener('click', () => aiAnalyze(b.getAttribute('data-aiw'))));

  $$('#view [data-editw]').forEach(b => b.addEventListener('click', () => {
    state.editingWorkout = b.getAttribute('data-editw');
    rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  $$('#view [data-delw]').forEach(b => b.addEventListener('click', () => {
    const id = b.getAttribute('data-delw');
    const w = DB.workouts.find(x => x.id === id);
    if(!confirm('删除 ' + (w ? w.date + ' 的训练记录' : '这条训练记录') + '？')) return;
    DB.workouts = DB.workouts.filter(x => x.id !== id);
    if(state.editingWorkout === id) state.editingWorkout = null;
    touch();
    rerender(true);
  }));
}

function positiveOrNull(v){
  const n = Number(v);
  return v !== '' && isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function aiAnalyze(id){
  if(!(await needKey())) return;
  const w = DB.workouts.find(x => x.id === id);
  if(!w) return;
  setLoading(true, 'AI 分析本次训练…');
  const desc = '日期 ' + w.date + '；训练内容：' + workoutLabel(w);
  try{
    const c = await dsChat([{ role:'system', content: TRAIN_PROMPT }, { role:'user', content: desc + '\n\n' + buildPlanContext() }], false);
    w.analysis = String(c).trim();
    touch();
    rerender(true);
    toast('分析完成');
  }catch(e){
    toast('分析失败：' + e.message);
  }finally{
    setLoading(false);
  }
}
