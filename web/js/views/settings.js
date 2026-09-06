/* 视图：设置 —— AI、个人资料与热量目标（TDEE）、外观、数据管理、使用说明 */

import { $, $$, esc, toast, todayStr, getThemePref, setThemePref, enterConfirm } from '../ui.js';
import { DB, setDB, defaultDB, touch, ACTIVITY_LEVELS,
         profileReady, calcBMR, calcTDEE, latestMeasure } from '../store.js';
import { getKey, setKey, MODEL_DESC } from '../ai.js';
import * as api from '../api.js';
import { saveNow } from '../api.js';
import { rerender } from '../nav.js';

export function render(){
  const p = DB.profile || {};
  const lm = latestMeasure();

  /* BMR / TDEE 说明 */
  let tdeeHTML;
  if(profileReady() && lm && lm.weight != null){
    const bmr = calcBMR(), tdee = calcTDEE();
    tdeeHTML = '<div class="kv"><span class="k">基础代谢 BMR</span><span class="v">' + bmr + ' 千卡</span></div>'
      + '<div class="kv"><span class="k">每日消耗 TDEE</span><span class="v">' + tdee + ' 千卡</span></div>'
      + '<div class="xs" style="color:var(--muted);line-height:1.7;margin-top:8px;">按最新体重 ' + lm.weight + ' kg（' + lm.date + '）与 Mifflin-St Jeor 公式估算。减脂可把热量目标设为 TDEE - 300~500，增肌设为 TDEE + 200~300。</div>';
  }else{
    const lack = [];
    if(!p.sex) lack.push('性别');
    if(!p.age) lack.push('年龄');
    if(!p.height) lack.push('身高');
    if(!lm || lm.weight == null) lack.push('一条含体重的体测记录');
    tdeeHTML = '<div class="xs" style="color:var(--muted);line-height:1.7;">补全' + (lack.length ? '：' + lack.join('、') : '资料') + '后，这里会自动计算 BMR / TDEE 作为每日热量目标。</div>';
  }

  const themes = [['auto','跟随系统'], ['light','浅色'], ['dark','深色']];
  const cur = getThemePref();

  return '<div class="page-head input-head"><div><div class="page-eyebrow">偏好与资料</div><h1 class="page-title">设置</h1><div class="page-sub">让健康日志更适合你的日常。</div></div><button class="btn btn-soft" data-nav="today">查看首页总览</button></div><div class="cards settings-grid">'

    + '<div class="card"><h2>DeepSeek AI 设置</h2>'
    + '<div class="field"><label>API Key</label><input class="inp" type="password" id="keyInp" placeholder="sk-…（已配置过会自动填入）" autocomplete="off" spellcheck="false"></div>'
    + '<div style="display:flex;gap:8px;margin-bottom:10px;"><button class="btn btn-soft" id="toggleKey" style="flex:1;">显示 / 隐藏</button><button class="btn btn-primary" id="saveKey" style="flex:1;">保存 Key</button></div>'
    + '<div class="kv"><span class="k">模型（已固定）</span><span class="v" style="font-size:12px;">' + MODEL_DESC + '</span></div>'
    + '<div class="xs" style="color:var(--muted);line-height:1.7;margin-top:8px;">Key 保存在本机的 data/config.json，网页与命令行（cli.py）共用一份，不会写入导出备份。请在 DeepSeek 开放平台（platform.deepseek.com）申请。</div></div>'

    + '<div class="card"><h2>个人资料与热量目标</h2>'
    + '<div class="row"><div class="field"><label>性别</label><select class="sel" id="pSex">'
    + '<option value="male"' + (p.sex === 'male' ? ' selected' : '') + '>男</option>'
    + '<option value="female"' + (p.sex === 'female' ? ' selected' : '') + '>女</option>'
    + '</select></div>'
    + '<div class="field"><label>年龄</label><input class="inp" type="number" min="10" max="100" id="pAge" value="' + (p.age || '') + '" placeholder="如 28"></div>'
    + '<div class="field"><label>身高（cm）</label><input class="inp" type="number" min="100" max="230" id="pHeight" value="' + (p.height || '') + '" placeholder="如 172"></div></div>'
    + '<div class="field"><label>活动水平</label><select class="sel" id="pAct">'
    + ACTIVITY_LEVELS.map(([v, label]) => '<option value="' + v + '"' + (String(p.activity || '1.375') === v ? ' selected' : '') + '>' + label + '</option>').join('')
    + '</select></div>'
    + '<div class="field"><label>每日热量目标（千卡，留空用 TDEE）</label><input class="inp" type="number" min="800" max="5000" id="pGoal" value="' + (p.calorieGoal != null ? p.calorieGoal : '') + '" placeholder="如 1800"></div>'
    + tdeeHTML
    + '<button class="btn btn-primary btn-block" id="saveProfile" style="margin-top:10px;">保存资料</button></div>'

    + '<div class="card"><h2>外观</h2>'
    + '<div class="seg">' + themes.map(([v, label]) =>
        '<button class="' + (cur === v ? 'on' : '') + '" data-theme="' + v + '">' + label + '</button>').join('') + '</div>'
    + '<div class="xs" style="color:var(--muted);margin-top:10px;line-height:1.7;">深色模式会自动适配系统的明暗设置。</div></div>'

    + '<div class="card"><h2>数据管理</h2>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + '<button class="btn btn-line" id="exportBtn" style="flex:1;">导出 JSON</button>'
    + '<button class="btn btn-line" id="importBtn" style="flex:1;">导入 JSON</button>'
    + '<button class="btn btn-danger" id="clearBtn" style="flex:1;">清空全部数据</button></div>'
    + '<input type="file" id="impFile" accept=".json,application/json" hidden>'
    + '<div class="xs" style="color:var(--muted);margin-top:10px;line-height:1.7;">'
    + '所有记录都在电脑上的 <b>data/health.json</b>，随时可以直接复制这个文件备份。服务器每次写入还会自动备份到 data/backups/。'
    + '导出的 JSON 不含 API Key；导入会覆盖当前全部数据（导入前会自动备份）。</div></div>'

    + '<div class="card"><h2>怎么打开</h2><div class="small" style="line-height:2;color:var(--muted);">'
    + '双击项目文件夹里的「启动.command」，浏览器会自动打开本页面。<br>'
    + '或在项目文件夹的终端里运行 <b>python3 server.py</b>。<br>'
    + '关闭那个终端窗口即停止服务。</div></div>'

    + '<div class="card"><h2>关于</h2><div class="small" style="line-height:1.8;color:var(--muted);">个人健康日志：记录三餐并用 AI 估算热量与营养素、记录训练并由 AI 点评、追踪体重体脂并生成周度建议。数据全部保存在自己电脑上。</div></div>'

    + '</div>';
}

export function bind(){
  enterConfirm($('#keyInp').closest('.card'), '#saveKey');
  enterConfirm($('#pAge').closest('.card'), '#saveProfile');

  /* 已配置的 Key 自动填入（从服务器读） */
  getKey().then(k => { if(k){ const i = $('#keyInp'); if(i) i.value = k; } }).catch(() => {});

  $('#toggleKey').addEventListener('click', () => {
    const i = $('#keyInp');
    i.type = i.type === 'password' ? 'text' : 'password';
  });
  $('#saveKey').addEventListener('click', async () => {
    const v = $('#keyInp').value.trim();
    if(!v){ toast('Key 不能为空'); return; }
    try{
      await setKey(v);
      toast('API Key 已保存到本机服务器');
    }catch(e){
      toast('保存失败：' + e.message);
    }
  });

  $('#saveProfile').addEventListener('click', () => {
    const age = $('#pAge').value === '' ? null : Number($('#pAge').value);
    const height = $('#pHeight').value === '' ? null : Number($('#pHeight').value);
    const goal = $('#pGoal').value === '' ? null : Number($('#pGoal').value);
    if(age != null && !(age >= 10 && age <= 100)){ toast('年龄请填 10-100'); return; }
    if(height != null && !(height >= 100 && height <= 230)){ toast('身高请填 100-230 cm'); return; }
    if(goal != null && !(goal >= 800 && goal <= 5000)){ toast('热量目标请填 800-5000 千卡'); return; }
    DB.profile = {
      sex: $('#pSex').value,
      age, height,
      activity: Number($('#pAct').value),
      calorieGoal: goal,
    };
    touch();
    toast('资料已保存');
    rerender(true);
  });

  $$('#view [data-theme]').forEach(b => b.addEventListener('click', () => {
    setThemePref(b.getAttribute('data-theme'));
    rerender(true);
  }));

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'health-backup-' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出备份文件（不含 API Key）');
  });

  $('#importBtn').addEventListener('click', () => $('#impFile').click());
  $('#impFile').addEventListener('change', function(){
    const f = this.files && this.files[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const db = JSON.parse(reader.result);
        if(typeof db !== 'object' || !db || typeof db.meals !== 'object' || !Array.isArray(db.workouts) || !Array.isArray(db.measures)){
          throw new Error('文件结构不像本应用的备份');
        }
        if(!confirm('导入会覆盖当前全部数据（服务器会先自动备份）。确定继续？')) return;
        setDB(db);
        touch();
        saveNow();
        api.cacheLast(db);
        toast('导入完成');
        rerender();
      }catch(e){
        toast('导入失败：' + e.message);
      }
      this.value = '';
    };
    reader.readAsText(f);
  });

  $('#clearBtn').addEventListener('click', () => {
    if(!confirm('确定清空全部记录（三餐/训练/体测/目标/资料/AI建议）？此操作不可恢复。')) return;
    setDB(defaultDB());
    touch();
    toast('已清空');
    rerender();
  });
}
