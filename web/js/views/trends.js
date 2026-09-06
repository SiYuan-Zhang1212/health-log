/* 视图：体测录入 —— 目标、InBody 九项与 AI 周建议生成 */

import { $, enterConfirm, toast, todayStr, isNum, setLoading } from '../ui.js';
import { DB, saveAdvice, touch } from '../store.js';
import { ADVICE_PROMPT, buildHistorySummary, dsChat, needKey } from '../ai.js';
import { rerender, nav } from '../nav.js';

const MEA_FIELDS = [
  ['weight',   '体重 kg',      '76.2',  '0.1'],
  ['bodyFat',  '体脂率 %',     '19.4',  '0.1'],
  ['fatMass',  '体脂肪 kg',    '14.8',  '0.1'],
  ['bmi',      'BMI',          '23.5',  '0.1'],
  ['muscle',   '骨骼肌 kg',    '34.3',  '0.1'],
  ['water',    '身体水分 kg',  '45',    '0.1'],
  ['bmr',      '基础代谢 kcal','1696',  '1'],
  ['whr',      '腰臀比',       '0.88',  '0.01'],
  ['bodyAge',  '身体年龄 岁',  '24',    '1'],
];

function numOrNull(v){
  if(v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) && n >= 0 ? n : null;
}

export function render(){
  const goals = DB.goals || {};
  return '<div class="page-head input-head">'
    + '<div><div class="page-eyebrow">录入入口</div><h1 class="page-title">体测录入</h1><div class="page-sub">保存目标和 InBody 数据，首页会自动更新指标与趋势。</div></div>'
    + '<button class="btn btn-soft" data-nav="today">查看首页总览</button></div>'
    + '<div class="entry-grid input-layout">'
    + '<div class="card entry-card"><h2>目标设定</h2>'
    + '<div class="field"><label>目标体重（kg）</label><input class="inp" type="number" step="0.1" id="gWeight" value="' + (goals.weight != null ? goals.weight : '') + '" placeholder="如 70"></div>'
    + '<div class="field"><label>目标体脂率（%）</label><input class="inp" type="number" step="0.1" id="gFat" value="' + (goals.bodyFat != null ? goals.bodyFat : '') + '" placeholder="如 15"></div>'
    + '<div class="field"><label>目标期限</label><input class="inp" type="date" id="gDate" value="' + (goals.targetDate || '') + '"></div>'
    + '<button class="btn btn-primary btn-block" id="saveGoals">保存目标</button></div>'
    + '<div class="card entry-card"><h2>记录体测<span class="sp">InBody 九项，按需填</span></h2>'
    + '<div class="field"><label>日期</label><input class="inp" type="date" id="meaDate" value="' + todayStr() + '"></div>'
    + '<div class="mea-grid">' + MEA_FIELDS.map(([k, label, ph, step]) => '<div class="field"><label>' + label + '</label><input class="inp" type="number" step="' + step + '" id="mea_' + k + '" placeholder="' + ph + '"></div>').join('') + '</div>'
    + '<button class="btn btn-primary btn-block" id="addMea">保存本次体测</button></div>'
    + '<div class="card entry-card entry-card-wide"><h2>AI 周建议<span class="tag">生成后回首页查看</span></h2><div class="entry-context">根据最近 28 天的三餐、训练、睡眠、体重、体脂和目标，生成一份周度调整建议。</div><button class="btn btn-soft" id="aiAdvice">生成本周 AI 建议</button></div>'
    + '</div>';
}

export function bind(){
  enterConfirm($('#gDate').closest('.card'), '#saveGoals');
  enterConfirm($('#meaDate').closest('.card'), '#addMea');

  $('#saveGoals').addEventListener('click', () => {
    const gw = $('#gWeight').value, gf = $('#gFat').value, gd = $('#gDate').value;
    DB.goals.weight = gw === '' ? null : Number(gw);
    DB.goals.bodyFat = gf === '' ? null : Number(gf);
    DB.goals.targetDate = gd === '' ? null : gd;
    touch();
    toast('目标已保存');
    rerender(true);
  });

  $('#addMea').addEventListener('click', () => {
    const date = $('#meaDate').value || todayStr();
    const rec = {};
    let any = false;
    MEA_FIELDS.forEach(([k]) => { const v = numOrNull($('#mea_' + k).value); if(v != null){ rec[k] = v; any = true; } });
    if(!any){ toast('九项里至少填一项'); return; }
    if(DB.measures.some(m => m.date === date) && !confirm(date + ' 已有体测记录，把这次填的项覆盖进去？')) return;
    const exist = DB.measures.find(m => m.date === date);
    if(exist) Object.assign(exist, rec);
    else DB.measures.push(Object.assign({ id: 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), date }, rec));
    touch();
    toast('体测已保存');
    rerender(true);
  });

  $('#aiAdvice').addEventListener('click', aiWeeklyAdvice);
}

async function aiWeeklyAdvice(){
  if(!(await needKey())) return;
  setLoading(true, 'AI 生成周建议…');
  try{
    const c = await dsChat([{ role:'system', content: ADVICE_PROMPT }, { role:'user', content: buildHistorySummary() }], false);
    saveAdvice(c);
    nav('today');
    toast('建议已生成，已回到首页');
  }catch(e){
    toast('生成失败：' + e.message);
  }finally{
    setLoading(false);
  }
}
