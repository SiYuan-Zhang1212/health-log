/* 视图：三餐录入 —— 餐次切换、没吃标记、食物增删改（无分量）、AI 一键估算全天、AI 推荐食谱 */

import { $, $$, esc, toast, todayStr, addDays, weekdayCN, isNum, macroChips, setLoading, enterConfirm } from '../ui.js';
import { DB, state, dayMeals, dayCalories, dayMacro, mealTotal, mealMacro,
         isSkipped, markSkip, MEAL_ORDER, MEAL_CN, touch,
         combosFor, comboTotal, comboMacro } from '../store.js';
import { CAL_PROMPT, RECIPE_PROMPT, buildRecipeContext, dsChat, parseJson, needKey } from '../ai.js';
import { rerender } from '../nav.js';

export function render(){
  const d = state.selDate;
  const m = dayMeals(d);
  const tabs = MEAL_ORDER.map(k =>
    '<button class="' + (k === state.selMeal ? 'on' : '') + '" data-meal="' + k + '">'
    + MEAL_CN[k] + (isSkipped(d, k) ? '·没吃' : '') + '</button>').join('');
  const skipped = isSkipped(d, state.selMeal);
  const items = m[state.selMeal];
  const mTotal = mealTotal(items);
  const mk = mealMacro(items);

  const rows = skipped
    ? '<div class="empty">这餐标记了没吃。</div>'
    : items.map((it, i) => {
        const hasCal = isNum(it.calories);
        const editing = state.editingMeal === i;
        const row = '<div class="item" style="' + (editing ? 'background:var(--primary-soft);border-radius:10px;padding:10px;' : '') + '">'
          + '<div class="nm" data-editmeal="' + i + '" role="button" tabindex="0">'
          + '<div class="a">' + esc(it.name) + '</div>'
          + macroChips(it)
          + '</div>'
          + '<span class="cal ' + (hasCal ? '' : 'pending') + '">' + (hasCal ? it.calories + '<small>千卡</small>' : '待估算') + '</span>'
          + '<svg class="chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>'
          + '</div>';
        return row + (editing ? editFormHTML(it) : '');
      }).join('') || '<div class="empty">这一餐还没有记录。添加食物后可用 AI 一键估算，也可以点开条目手动填写。</div>';

  return '<div class="page-head input-head">'
    + '<div><div class="page-eyebrow">录入入口</div><h1 class="page-title">三餐录入</h1><div class="page-sub">记录食物，热量和营养素可以交给 AI 估算。</div></div>'
    + '<button class="btn btn-soft" data-nav="today">查看首页总览</button></div>'
    + datenavHTML(d)
    + '<div class="mealtabs">' + tabs + '</div>'
    + '<div class="duo">'
    + '<div class="card"><h2>' + MEAL_CN[state.selMeal] + '食物<span class="sp">点击条目编辑</span></h2>' + rows + '</div>'
    + '<div class="stack">'

    + comboCardHTML()

    + '<div class="card"><h2>本餐合计</h2>'
    + '<div class="meal-total" style="padding-top:0;"><span class="num big">' + mTotal + '</span><span class="u">千卡</span>'
    + (mk.protein || mk.carbs || mk.fat ? '<span class="u">P ' + Math.round(mk.protein) + 'g · C ' + Math.round(mk.carbs) + 'g · F ' + Math.round(mk.fat) + 'g</span>' : '')
    + '</div>'
    + (skipped
      ? '<button class="skipbtn on" id="skipBtn">已标记没吃 · 点击恢复</button>'
      : '<div style="display:flex;gap:8px;align-items:center;">'
        + '<input class="inp" id="fdName" placeholder="食物，如 白米饭" autocomplete="off" style="flex:1;">'
        + '<button class="btn btn-primary" id="addItem" style="flex:0 0 auto;">添加</button></div>'
        + '<div class="xs" style="color:var(--muted);margin-top:8px;">回车即可添加 · 分量按默认估算</div>'
        + '<button class="skipbtn" id="skipBtn" style="margin-top:10px;">这餐没吃</button>')
    + '</div>'

    + '<div class="card"><h2>AI 一键估算<span class="tag">全天</span></h2>'
    + '<div class="xs" style="color:var(--muted);line-height:1.7;margin-bottom:10px;">把今天所有餐里还没填热量的食物一次性估算补全（按默认分量）。</div>'
    + '<button class="btn btn-soft btn-block" id="aiMeal">一键估算全天未计算项</button>'
    + '</div>'

    + '<div class="card"><h2>AI 推荐食谱<span class="tag">点击才推荐</span></h2>'
    + '<input class="inp" id="prefInp" placeholder="口味 / 忌口（可选），如：少油、不吃辣" autocomplete="off" style="margin-bottom:8px;">'
    + '<button class="btn btn-primary btn-block" id="recipeBtn">推荐' + MEAL_CN[state.selMeal] + '吃什么</button>'
    + recipeHTML()
    + '</div>'

    + '</div>'
    + '</div>';
}

/* 推荐结果（保存在模块状态里，切页后失效） */
let recipe = null;
function recipeHTML(){
  if(!recipe) return '';
  const rows = recipe.items.map(it =>
    '<div class="kv"><span class="k">' + esc(it.name) + (it.reason ? '<span class="xs" style="color:var(--muted);"> · ' + esc(it.reason) + '</span>' : '')
    + '<span class="xs" style="display:block;color:var(--muted);">'
    + (it.calories != null ? it.calories + ' 千卡' : '热量待估算')
    + (it.protein != null ? ' · P' + it.protein + ' C' + it.carbs + ' F' + it.fat : '') + '</span></span></div>').join('');
  return (recipe.summary ? '<div class="advice-meta" style="margin-top:10px;">' + esc(recipe.summary) + '</div>' : '')
    + '<div style="margin-top:6px;">' + rows + '</div>'
    + '<button class="btn btn-soft btn-block" id="adoptRecipe" style="margin-top:10px;">全部加入' + MEAL_CN[state.selMeal] + '</button>';
}

/* 固定搭配卡：早餐 / 午晚餐各一组，点击整份加入当餐（营养已按估算填好） */
function comboCardHTML(){
  const combos = combosFor(state.selMeal);
  const body = combos.length
    ? '<div class="combo-list">' + combos.map((c, i) => {
        const mk = comboMacro(c);
        return '<button class="combo" data-combo="' + i + '" title="点击整份加入' + MEAL_CN[state.selMeal] + '">'
          + '<span class="combo-nm">' + esc(c.name) + '</span>'
          + '<span class="combo-val">' + comboTotal(c) + '<small>千卡</small></span>'
          + '<span class="combo-meta">P ' + Math.round(mk.protein) + ' · C ' + Math.round(mk.carbs) + ' · F ' + Math.round(mk.fat) + '</span>'
          + '</button>';
      }).join('') + '</div>'
      + '<div class="xs" style="color:var(--muted);margin-top:9px;">点击整份加入 · 数值为估算，加入后可点条目修改</div>'
    : '<div class="empty">加餐暂无固定搭配，用下方输入框手动添加。</div>';
  return '<div class="card"><h2>固定搭配<span class="tag">一键加入</span></h2>' + body + '</div>';
}

function datenavHTML(d){
  return '<div class="datenav">'
    + '<button class="iconbtn" id="dPrev" aria-label="前一天"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>'
    + '<div class="mid"><div class="d">' + d + ' · ' + weekdayCN(d) + '</div><div class="sub">全天 ' + dayCalories(d) + ' 千卡</div></div>'
    + '<div style="display:flex;align-items:center;">'
    + '<button class="todaybtn' + (d === todayStr() ? ' hide' : '') + '" id="dToday">今天</button>'
    + '<button class="iconbtn" id="dNext" aria-label="后一天"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button></div>'
    + '</div>';
}

function editFormHTML(it){
  const v = k => it[k] != null ? it[k] : '';
  return '<div class="editform">'
    + '<div style="margin-bottom:9px;">'
    + '<input class="inp" id="edName" placeholder="食物名" value="' + esc(it.name) + '">'
    + '</div>'
    + '<div class="row4">'
    + '<div><label class="xs" style="color:var(--muted);display:block;margin-bottom:3px;">千卡</label><input class="inp" id="edCal" type="number" min="0" inputmode="decimal" value="' + v('calories') + '"></div>'
    + '<div><label class="xs" style="color:var(--p);display:block;margin-bottom:3px;">蛋白g</label><input class="inp" id="edP" type="number" min="0" step="0.1" inputmode="decimal" value="' + v('protein') + '"></div>'
    + '<div><label class="xs" style="color:var(--c);display:block;margin-bottom:3px;">碳水g</label><input class="inp" id="edC" type="number" min="0" step="0.1" inputmode="decimal" value="' + v('carbs') + '"></div>'
    + '<div><label class="xs" style="color:var(--f);display:block;margin-bottom:3px;">脂肪g</label><input class="inp" id="edF" type="number" min="0" step="0.1" inputmode="decimal" value="' + v('fat') + '"></div>'
    + '</div>'
    + '<div class="btns">'
    + '<button class="btn btn-primary" id="edSave">保存</button>'
    + '<button class="btn btn-line" id="edCancel">取消</button>'
    + '<button class="btn btn-danger" id="edDel">删除</button>'
    + '</div></div>';
}

export function bind(){
  const d = state.selDate;
  const items = () => dayMeals(d)[state.selMeal];

  $('#dPrev').addEventListener('click', () => { state.selDate = addDays(state.selDate, -1); rerender(); });
  $('#dNext').addEventListener('click', () => { state.selDate = addDays(state.selDate, 1); rerender(); });
  const t = $('#dToday');
  if(t) t.addEventListener('click', () => { state.selDate = todayStr(); rerender(); });

  $$('#view [data-meal]').forEach(b => b.addEventListener('click', () => {
    state.selMeal = b.getAttribute('data-meal');
    state.editingMeal = -1;
    rerender();
  }));

  /* 固定搭配一键加入 */
  $$('#view [data-combo]').forEach(b => b.addEventListener('click', () => {
    const c = combosFor(state.selMeal)[+b.getAttribute('data-combo')];
    if(!c) return;
    const arr = dayMeals(d)[state.selMeal];
    c.items.forEach(it => arr.push({ name: it.name, calories: it.calories, protein: it.protein, carbs: it.carbs, fat: it.fat }));
    if(isSkipped(d, state.selMeal)) markSkip(d, state.selMeal, false); // 记了吃的就取消"没吃"
    touch();
    toast('已把「' + c.name + '」加入' + MEAL_CN[state.selMeal]);
    rerender(true);
  }));

  /* 没吃标记 */
  $('#skipBtn').addEventListener('click', () => {
    const on = !isSkipped(d, state.selMeal);
    markSkip(d, state.selMeal, on);
    touch();
    toast(on ? '已标记「' + MEAL_CN[state.selMeal] + '没吃」' : '已恢复，可以继续记录');
    rerender(true);
  });

  /* 打开/关闭行内编辑 */
  $$('#view [data-editmeal]').forEach(el => el.addEventListener('click', () => {
    const i = +el.getAttribute('data-editmeal');
    state.editingMeal = state.editingMeal === i ? -1 : i;
    rerender(true);
  }));

  /* 编辑表单 */
  const saveBtn = $('#edSave');
  if(saveBtn){
    const i = state.editingMeal;
    saveBtn.addEventListener('click', () => {
      const it = items()[i];
      const name = $('#edName').value.trim();
      if(!name){ toast('食物名不能为空'); return; }
      it.name = name;
      it.calories = numOrNull($('#edCal').value, true);
      it.protein = numOrNull($('#edP').value);
      it.carbs = numOrNull($('#edC').value);
      it.fat = numOrNull($('#edF').value);
      state.editingMeal = -1;
      touch();
      rerender(true);
    });
    $('#edCancel').addEventListener('click', () => { state.editingMeal = -1; rerender(true); });
    $('#edDel').addEventListener('click', () => {
      if(!confirm('删除「' + items()[i].name + '」？')) return;
      items().splice(i, 1);
      state.editingMeal = -1;
      touch();
      rerender(true);
    });
    enterConfirm($('.editform'), '#edSave');
  }

  /* 添加 */
  const addBtn = $('#addItem');
  if(addBtn) addBtn.addEventListener('click', () => {
    const nm = $('#fdName').value.trim();
    if(!nm){ toast('请填写食物名称'); return; }
    items().push({ name: nm, calories: null, protein: null, carbs: null, fat: null });
    touch();
    rerender(true);
  });
  const fdName = $('#fdName');
  if(fdName) enterConfirm(fdName.closest('.card'), '#addItem');

  /* AI 一键估算全天 */
  $('#aiMeal').addEventListener('click', aiEstimateDay);

  /* AI 推荐食谱 */
  $('#recipeBtn').addEventListener('click', aiRecipe);
  const adopt = $('#adoptRecipe');
  if(adopt) adopt.addEventListener('click', () => {
    if(!recipe) return;
    const arr = dayMeals(d)[state.selMeal];
    recipe.items.forEach(it => arr.push({ name: it.name, calories: it.calories, protein: it.protein, carbs: it.carbs, fat: it.fat }));
    recipe = null;
    touch();
    toast('已加入' + MEAL_CN[state.selMeal]);
    rerender(true);
  });
}

/* AI 推荐这一餐吃什么（点击才触发） */
async function aiRecipe(){
  if(!(await needKey())) return;
  const pref = $('#prefInp') ? $('#prefInp').value.trim() : '';
  setLoading(true, '营养师正在想吃什么…');
  try{
    const c = await dsChat([
      { role: 'system', content: RECIPE_PROMPT },
      { role: 'user', content: buildRecipeContext(state.selMeal, pref) },
    ], true);
    const j = parseJson(c);
    const list = Array.isArray(j.items) ? j.items : [];
    if(!list.length) throw new Error('没有返回推荐');
    recipe = {
      items: list.filter(x => x && x.name).map(x => ({
        name: String(x.name).slice(0, 30),
        calories: isNum(x.calories) ? Math.round(x.calories) : null,
        protein: isNum(x.protein) ? Math.round(x.protein * 10) / 10 : null,
        carbs: isNum(x.carbs) ? Math.round(x.carbs * 10) / 10 : null,
        fat: isNum(x.fat) ? Math.round(x.fat * 10) / 10 : null,
        reason: x.reason ? String(x.reason).slice(0, 30) : '',
      })),
      summary: j.summary ? String(j.summary).slice(0, 40) : '',
    };
    rerender(true);
  }catch(e){
    toast('推荐失败：' + e.message);
  }finally{
    setLoading(false);
  }
}

function numOrNull(v, round){
  if(v === '' || v == null) return null;
  const n = Number(v);
  if(!isFinite(n) || n < 0) return null;
  return round ? Math.round(n) : Math.round(n * 10) / 10;
}

/* 一键估算：当天所有餐里 calories 为空的食物，一次请求补全 */
async function aiEstimateDay(){
  if(!(await needKey())) return;
  const d = state.selDate;
  const day = dayMeals(d);
  const pending = MEAL_ORDER.map(k => ({ k, items: (day[k] || []).filter(i => i.name && !isNum(i.calories)) }))
    .filter(x => x.items.length);
  if(!pending.length){ toast('今天没有待估算的食物'); return; }

  const desc = pending.map(x => MEAL_CN[x.k] + '：' + x.items.map(i => i.name).join('；')).join('\n');
  setLoading(true, 'AI 一键估算全天…');
  try{
    const content = await dsChat([{ role:'system', content: CAL_PROMPT }, { role:'user', content: desc }], true);
    const j = parseJson(content);
    let filled = 0;
    pending.forEach(x => {
      const list = Array.isArray(j && j[x.k]) ? j[x.k] : [];
      const byName = {};
      list.forEach(r => { if(r && r.name) byName[String(r.name).trim()] = r; });
      x.items.forEach((it, idx) => {
        const r = byName[it.name.trim()] || list[idx];
        if(!r) return;
        if(isNum(r.calories)){ it.calories = Math.round(r.calories); filled++; }
        if(!isNum(it.protein) && isNum(r.protein)) it.protein = Math.round(r.protein * 10) / 10;
        if(!isNum(it.carbs) && isNum(r.carbs)) it.carbs = Math.round(r.carbs * 10) / 10;
        if(!isNum(it.fat) && isNum(r.fat)) it.fat = Math.round(r.fat * 10) / 10;
      });
    });
    touch();
    rerender();
    toast(filled ? '已估算 ' + filled + ' 项' : '估算完成');
  }catch(e){
    toast('估算失败：' + e.message);
  }finally{
    setLoading(false);
  }
}
