#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
健康日志 · 命令行工具（供远程终端 / AI 助手调用）

数据与 server.py 共用（data/health.json）。服务器在跑就走 HTTP API，
没跑就直接读写文件（自动备份 + 版本号递增），两边都安全。

用法：
  python3 cli.py key sk-xxx                          # 保存 DeepSeek API Key
  python3 cli.py log "早上两个鸡蛋，练了40分钟力量"     # AI 大白话录入（三餐/训练/睡眠/体重）
  python3 cli.py meal 午餐 鸡胸肉 米饭 [--ai]         # 添加食物（--ai 顺便估算热量营养素）
  python3 cli.py weight 62.4 [18.5]                  # 记录体重 [体脂率]
  python3 cli.py train 力量 深蹲 45 [--sets 5 --reps 8 --intensity 高 --note 备注]
  python3 cli.py sleep 7.5                           # 记录昨晚睡眠
  python3 cli.py supp                                # 补剂 5 种全部打卡
  python3 cli.py supp 蛋白粉 肌酸                     # 只打卡指定的
  python3 cli.py supp --undo 蛋白粉                   # 撤销打卡
  python3 cli.py skip 午餐                            # 标记这餐没吃
  python3 cli.py today                               # 今日摘要（热量/营养/训练/目标进度）
  python3 cli.py coach                               # AI 今日教练建议（情境感知）
  python3 cli.py suggest 午餐 [--pref 少油不吃辣]     # AI 推荐这一餐吃什么

所有记录命令支持 --date YYYY-MM-DD（默认今天）。
AI 命令（log --ai / coach / suggest）需要先用 key 命令配置 DeepSeek API Key。
"""
import argparse
import datetime
import fcntl
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, 'data')
DB_FILE = os.path.join(DATA_DIR, 'health.json')
REV_FILE = os.path.join(DATA_DIR, 'rev.txt')
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')
LOCK_FILE = os.path.join(DATA_DIR, '.cli.lock')
API = os.environ.get('HEALTH_LOG_API', 'http://127.0.0.1:8000')
MODEL = 'deepseek-v4-flash-vision-exp'
PLAN_FILE = os.path.join(DATA_DIR, '训练计划.md')

MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snack']
MEAL_CN = {'breakfast': '早餐', 'lunch': '午餐', 'dinner': '晚餐', 'snack': '加餐',
           '早餐': 'breakfast', '午餐': 'lunch', '晚餐': 'dinner', '加餐': 'snack'}
TYPES = ['力量', '有氧', '跑步', '游泳', '骑行', '瑜伽', '球类', '其他']
SUPPS = ['蛋白粉', '肌酸', '鱼油', '维生素', '益生菌']

FILL_PROMPT = '你是健康日志的录入助手。根据用户对一天生活的口语化描述，提取结构化健康数据。只返回 JSON，不要任何其他文字，格式严格为：{"meals":{"breakfast":[{"name":"食物名","calories":数字,"protein":数字,"carbs":数字,"fat":数字}],"lunch":[],"dinner":[],"snack":[]},"workouts":[{"type":"力量|有氧|跑步|游泳|骑行|瑜伽|球类|其他","name":"项目名","duration":分钟数字,"intensity":"低|中|高","sets":数字,"reps":数字,"note":""}],"sleep":小时数字,"weight":公斤数字,"skipped":["没吃的那餐"],"supplements":["蛋白粉|肌酸|鱼油|维生素|益生菌"],"summary":"40字以内的录入摘要"}。规则：食物按常见默认分量估算热量与营养素；只提取用户真的提到的东西，没提到的用空数组或 null（JSON 里写 null）；明确说某餐没吃且没提该餐食物时，把该餐的英文键（breakfast/lunch/dinner/snack）放进 skipped；sleep 是昨晚睡眠小时数；weight 是当天体重公斤数；workouts 里：力量训练必须给 plan（臀腿|胸肩|背臂），有氧必须给 cardio（爬坡|椭圆机|团课），乒乓球只给 type；supplements 只能从这5个里选：蛋白粉、肌酸、鱼油、维生素、益生菌，用户提到吃了才填。summary 用中文说明录入了什么。'
CAL_PROMPT = '你是营养热量估算助手。用户给出一天各餐的食物名称（分量按常见默认分量估）。估算每个食物的热量（千卡）与蛋白质、碳水、脂肪（克）。只返回 JSON，不要任何其他文字，格式严格为：{"breakfast":[{"name":"食物名","calories":数字,"protein":数字,"carbs":数字,"fat":数字}],"lunch":[],"dinner":[],"snack":[]}。每餐内 name 必须与输入一致且保持顺序；没提到或没吃的那餐返回空数组。无法精确的食物给合理估计值。'
COACH_PROMPT = '你是私人健康教练。根据用户当前情境，给出一条简短建议（100字以内）：聚焦当下最值得做的一件事（饮食缺口怎么补 / 现在没训练该练什么或怎么安排 / 或状态提醒）。要具体可执行，结合数据，语气亲切带点鼓励，不要分点罗列、不要面面俱到。'
RECIPE_PROMPT = '你是营养师。用户即将吃某一餐，根据当天已摄入情况与目标缺口推荐这一餐吃什么。只返回 JSON，格式严格为：{"items":[{"name":"食物名","calories":数字,"protein":数字,"carbs":数字,"fat":数字,"reason":"15字内的推荐理由"}],"summary":"25字内的整体说明"}。推荐 2-3 样常见食物（食堂/便利店/外卖容易买到），总热量尽量贴近给出的可用热量，优先补足蛋白质缺口；尊重用户的口味偏好与忌口。'


def fail(msg):
    print('✗ ' + msg)
    sys.exit(1)


def today():
    return datetime.date.today().isoformat()


def weekday_cn(ds):
    d = datetime.date.fromisoformat(ds)
    return '周' + '日一二三四五六'[d.weekday() + 1 if d.weekday() < 6 else 0]


# ---------- 数据读写：优先走服务器 API，失败则直接文件 ----------

def _http(method, path, payload=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def load_db():
    try:
        j = _http('GET', '/api/db')
        return j['db'], j.get('rev', 0)
    except Exception:
        return _read_file(), None


def save_db(db, rev):
    try:
        j = _http('POST', '/api/db', {'rev': rev, 'db': db})
        if not j.get('ok'):
            raise RuntimeError(j.get('error', 'unknown'))
        return
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:120]
        fail('服务器拒绝写入（%s）：%s' % (e.code, body))
    except Exception:
        _write_file(db)


def _read_file():
    try:
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            db = json.load(f)
        if isinstance(db, dict):
            return db
    except Exception:
        pass
    return {'meals': {}, 'workouts': [], 'measures': [], 'conditions': {},
            'goals': {'weight': None, 'bodyFat': None, 'targetDate': None},
            'profile': {}, 'advices': [], 'coachTips': []}


def _write_file(db):
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with open(LOCK_FILE, 'w') as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            if os.path.exists(DB_FILE):
                try:
                    with open(DB_FILE, 'rb') as f:
                        old = f.read()
                    with open(os.path.join(BACKUP_DIR, 'latest.json'), 'wb') as f:
                        f.write(old)
                except Exception:
                    pass
            tmp = DB_FILE + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(db, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, DB_FILE)
            # 版本号 +1，让打开着的浏览器下次保存时发现冲突并自动刷新
            try:
                rev = 0
                if os.path.exists(REV_FILE):
                    rev = int(open(REV_FILE).read().strip() or 0)
                open(REV_FILE, 'w').write(str(rev + 1))
            except Exception:
                pass
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


# ---------- AI ----------

def get_key():
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return str(json.load(f).get('api_key') or '')
    except Exception:
        return ''


def ds_chat(messages, json_mode=False):
    key = get_key()
    if not key:
        fail('还没有配置 DeepSeek API Key，先运行：python3 cli.py key sk-xxx')
    body = {'model': MODEL, 'messages': messages, 'stream': False}
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    req = urllib.request.Request(
        'https://api.deepseek.com/chat/completions', data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.load(r)
        return data['choices'][0]['message']['content']
    except urllib.error.HTTPError as e:
        fail('DeepSeek HTTP %d：%s' % (e.code, e.read().decode()[:160]))
    except Exception as e:
        fail('无法连接 DeepSeek：%s' % e)


def parse_json(text):
    text = str(text or '').strip()
    m = re.search(r'\{.*\}', text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    fail('无法解析 AI 返回的 JSON')


def num(v, rnd=False):
    if isinstance(v, (int, float)) and v == v:  # 排除 NaN
        return round(v) if rnd else round(v, 1)
    return None


# ---------- 业务函数 ----------

def day(db, d):
    meals = db.setdefault('meals', {})
    if d not in meals or not isinstance(meals[d], dict):
        meals[d] = {'breakfast': [], 'lunch': [], 'dinner': [], 'snack': []}
    for k in MEAL_KEYS:
        meals[d].setdefault(k, [])
    return meals[d]


def cmd_key(args):
    os.makedirs(DATA_DIR, exist_ok=True)
    cfg = {}
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
    except Exception:
        pass
    cfg['api_key'] = args.value.strip()
    tmp = CONFIG_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_FILE)
    try:
        _http('POST', '/api/key', {'key': args.value.strip()})
    except Exception:
        pass
    print('✓ API Key 已保存（data/config.json，网页与 CLI 共用）')


def cmd_log(args):
    db, rev = load_db()
    d = args.date or today()
    text = ' '.join(args.text)
    print('⏳ AI 正在解析…')
    j = parse_json(ds_chat([
        {'role': 'system', 'content': FILL_PROMPT},
        {'role': 'user', 'content': '日期：%s。用户描述：%s' % (d, text)},
    ], True))
    daym = day(db, d)
    parts = []
    foods = 0
    for k in MEAL_KEYS:
        arr = (j.get('meals') or {}).get(k) or []
        for r in arr:
            if isinstance(r, dict) and r.get('name'):
                daym[k].append({'name': str(r['name'])[:40], 'calories': num(r.get('calories'), True),
                                'protein': num(r.get('protein')), 'carbs': num(r.get('carbs')),
                                'fat': num(r.get('fat'))})
                foods += 1
    if foods:
        parts.append('%d 种食物' % foods)
    for k in (j.get('skipped') or []):
        if k in MEAL_KEYS and not daym[k]:
            daym.setdefault('_skip', {})[k] = True
            parts.append('%s没吃' % MEAL_CN[k])
    wos = 0
    KINDS = ('力量', '有氧', '力量+有氧', '乒乓球')
    for w in (j.get('workouts') or []):
        if isinstance(w, dict) and (w.get('type') or w.get('plan') or w.get('cardio')):
            plan = w.get('plan') if w.get('plan') in ('臀腿', '胸肩', '背臂') else None
            cardio = w.get('cardio') if w.get('cardio') in ('爬坡', '椭圆机', '团课') else None
            kind = w.get('type') if w.get('type') in KINDS else ('力量' if plan else '有氧')
            db.setdefault('workouts', []).append({
                'id': 'c%s' % int(time.time() * 1000), 'date': d,
                'type': kind, 'plan': plan, 'cardio': cardio, 'analysis': ''})
            wos += 1
    if wos:
        parts.append('%d 次训练' % wos)
    slp = num(j.get('sleep'))
    if slp is not None:
        db.setdefault('conditions', {}).setdefault(d, {})['sleep'] = slp
        parts.append('睡眠 %gh' % slp)
    supps = [s for s in (j.get('supplements') or []) if isinstance(s, str) and s.strip() in SUPPS]
    if supps:
        sd = db.setdefault('supplements', {}).setdefault(d, {})
        for s in supps:
            sd[s.strip()] = True
        parts.append('补剂 %d 种' % len(set(s.strip() for s in supps)))
    wt = num(j.get('weight'))
    if wt and 20 < wt < 300:
        ms = [m for m in db.setdefault('measures', []) if m.get('date') == d]
        if ms:
            ms[-1]['weight'] = wt
        else:
            db['measures'].append({'id': 'c%s' % int(time.time() * 1000), 'date': d,
                                   'weight': wt, 'bodyFat': None})
        parts.append('体重 %gkg' % wt)
    save_db(db, rev)
    print('✓ %s（%s）：%s' % (d, weekday_cn(d), j.get('summary') or '、'.join(parts) or '没有识别到内容'))


def cmd_meal(args):
    db, rev = load_db()
    d = args.date or today()
    key = MEAL_CN.get(args.meal)
    if not key:
        fail('餐次请用：早餐/午餐/晚餐/加餐')
    daym = day(db, d)
    daym['_skip'] = {k: v for k, v in (daym.get('_skip') or {}).items() if k != key}
    for name in args.foods:
        daym[key].append({'name': name, 'calories': None, 'protein': None, 'carbs': None, 'fat': None})
    save_db(db, rev)
    print('✓ %s（%s）%s 已添加 %d 项：%s'
          % (d, weekday_cn(d), MEAL_CN[key], len(args.foods), '、'.join(args.foods)))
    if args.ai:
        ai_estimate(db if False else None, d, rev)  # 重新加载后估算


def ai_estimate(_, d, rev):
    db, rev = load_db()
    daym = day(db, d)
    pending = [(k, [i for i in daym[k] if not isinstance(i.get('calories'), (int, float))])
               for k in MEAL_KEYS]
    pending = [(k, its) for k, its in pending if its]
    if not pending:
        print('· 没有需要估算的食物')
        return
    desc = '\n'.join('%s：%s' % (MEAL_CN[k], '；'.join(i['name'] for i in its)) for k, its in pending)
    print('⏳ AI 估算热量与营养素…')
    j = parse_json(ds_chat([{'role': 'system', 'content': CAL_PROMPT},
                            {'role': 'user', 'content': desc}], True))
    n = 0
    for k, its in pending:
        lst = [x for x in (j.get(k) or []) if isinstance(x, dict)]
        by_name = {str(x.get('name', '')).strip(): x for x in lst}
        for idx, it in enumerate(its):
            r = by_name.get(it['name'].strip()) or (lst[idx] if idx < len(lst) else None)
            if not r:
                continue
            if isinstance(r.get('calories'), (int, float)):
                it['calories'] = round(r['calories']); n += 1
            for f in ('protein', 'carbs', 'fat'):
                if not isinstance(it.get(f), (int, float)) and isinstance(r.get(f), (int, float)):
                    it[f] = round(r[f], 1)
    save_db(db, rev)
    print('✓ 已估算 %d 项' % n)


def cmd_weight(args):
    db, rev = load_db()
    d = args.date or today()
    bf = num(args.bodyfat) if args.bodyfat else None
    ms = db.setdefault('measures', [])
    exist = [m for m in ms if m.get('date') == d]
    if exist:
        exist[-1]['weight'] = num(args.weight)
        if bf is not None:
            exist[-1]['bodyFat'] = bf
        rec = exist[-1]
    else:
        rec = {'id': 'c%s' % int(time.time() * 1000), 'date': d,
               'weight': num(args.weight), 'bodyFat': bf}
        ms.append(rec)
    save_db(db, rev)
    print('✓ %s 体测：体重 %gkg%s' % (d, rec['weight'],
          (' · 体脂 %g%%' % rec['bodyFat']) if rec.get('bodyFat') is not None else ''))


def cmd_train(args):
    db, rev = load_db()
    d = args.date or today()
    kind = args.kind
    if kind not in ('力量', '有氧', '力量+有氧', '乒乓球'):
        fail('类型只能是：力量 / 有氧 / 力量+有氧 / 乒乓球')
    plan = cardio = None
    if '力量' in kind:
        plan = next((x for x in args.items if x in ('臀腿', '胸肩', '背臂')), None)
        if not plan:
            fail('力量训练要带部位：臀腿 / 胸肩 / 背臂（按私教计划三选一）')
    if '有氧' in kind:
        cardio = next((x for x in args.items if x in ('爬坡', '椭圆机', '团课')), None)
        if not cardio:
            fail('有氧要带方式：爬坡 / 椭圆机 / 团课')
    if kind == '乒乓球' and args.items:
        fail('乒乓球不用带项目')
    db.setdefault('workouts', []).append({
        'id': 'c%s' % int(time.time() * 1000), 'date': d,
        'type': kind, 'plan': plan, 'cardio': cardio, 'analysis': ''})
    save_db(db, rev)
    label = kind + (' · ' + plan if plan else '') + (' · ' + cardio if cardio else '')
    print('✓ %s 训练已记录：%s' % (d, label))


def cmd_sleep(args):
    db, rev = load_db()
    d = args.date or today()
    db.setdefault('conditions', {}).setdefault(d, {})['sleep'] = args.hours
    save_db(db, rev)
    print('✓ %s 昨晚睡眠 %g 小时' % (d, args.hours))


def cmd_supp(args):
    db, rev = load_db()
    d = args.date or today()
    sd = db.setdefault('supplements', {}).setdefault(d, {})
    if args.undo:
        names = [n for n in (args.names or SUPPS) if n in SUPPS]
        if not names:
            fail('补剂名只能是：' + '、'.join(SUPPS))
        for n in names:
            sd.pop(n, None)
        save_db(db, rev)
        print('✓ %s 已撤销：%s' % (d, '、'.join(names)))
        return
    names = [n.strip() for n in (args.names or SUPPS)]
    bad = [n for n in names if n not in SUPPS]
    if bad:
        fail('不认识的补剂：%s（可选：%s）' % ('、'.join(bad), '、'.join(SUPPS)))
    for n in names:
        sd[n] = True
    save_db(db, rev)
    already = '、'.join([])  # 展示用
    print('✓ %s 补剂已打卡：%s（今日共 %d/%d）' % (d, '、'.join(names), len(sd), len(SUPPS)))


def cmd_skip(args):
    db, rev = load_db()
    d = args.date or today()
    key = MEAL_CN.get(args.meal)
    if not key:
        fail('餐次请用：早餐/午餐/晚餐/加餐')
    daym = day(db, d)
    if daym[key]:
        fail('%s 已经有食物记录，先清掉才能标记没吃（网页上可删）' % MEAL_CN[key])
    daym.setdefault('_skip', {})[key] = True
    save_db(db, rev)
    print('✓ %s %s标记为没吃' % (d, MEAL_CN[key]))


# ---------- 查询 / 建议 ----------

PLAN_KNOWLEDGE = (
    '私教计划（2026-08-31 最终版）：上肢日（A 胸肩 / B 背臂 二选一）与下肢日（臀腿）轮换，不绑定星期，'
    '按恢复情况选；训练前做最伟大拉伸与松解激活，训练后拉伸放松。'
    '主项——上肢A：小角度上斜卧推、史密斯推肩（辅助：侧平举、反向蝴蝶机）；'
    '上肢B：高位下拉、坐姿划船（辅助：绳索直臂下压、绳索下压、绳索弯举）；'
    '下肢：史密斯臀推、罗马尼亚硬拉RDL、保加利亚分腿蹲（可选坡度走收尾）。'
    '底线：关节位置优先于重量，躯干稳定，发力呼气回程吸气，变形即减量。'
    '参考重量记录（非处方）：高位下拉 27kg、卧推每侧 5kg 片、臀推每侧 15kg、坡度走 30 分钟。'
)


def classify(w):
    if w.get('plan'):
        return {'臀腿': '下肢', '胸肩': '上肢A', '背臂': '上肢B'}.get(w['plan'])
    k = str(w.get('type', ''))
    if k in ('乒乓球', '有氧'):
        return None
    if '力量' in k:
        return '上肢A'  # 新版缺 plan 时兜底
    s = k + ' ' + str(w.get('name', ''))
    if re.search(r'臀推|臀桥|硬拉|RDL|深蹲|分腿蹲|腿举|腿弯举|腿屈伸|提踵', s, re.I):
        return '下肢'
    if re.search(r'卧推|推肩|肩推|侧平举|蝴蝶机|飞鸟|胸|肩', s, re.I):
        return '上肢A'
    if re.search(r'下拉|划船|直臂下压|弯举|下压|引体|背|臂|二头|三头', s, re.I):
        return '上肢B'
    return '上肢A' if k == '力量' else None


def plan_suggestion(d):
    db, _ = load_db()
    ref = d or today()
    recent = sorted([w for w in db.get('workouts', []) if classify(w) and w.get('date') <= ref],
                    key=lambda w: w['date'], reverse=True)
    cycle = {'上肢A': '上肢B', '上肢B': '下肢', '下肢': '上肢A'}
    if not recent:
        return '下肢', '还没有力量训练记录，从下肢日开始。', None, None
    last_t, last_d = classify(recent[0]), recent[0]['date']
    gap = (datetime.date.fromisoformat(ref) - datetime.date.fromisoformat(last_d)).days
    if last_t == '下肢':
        sug = '上肢A'
    else:
        sug = cycle[last_t]
    reason = ('今天已练过%s，明天建议%s。' % (last_t, cycle[last_t]) if gap == 0 else
              '上次%s是昨天，今天换 %s。' % (last_t, sug) if gap == 1 else
              '上次%s是 %d 天前，按轮换今天 %s。' % (last_t, gap, sug) if gap <= 3 else
              '已经 %d 天没练了，今天从 %s 重新启动。' % (gap, sug))
    return sug, reason, last_t, last_d


def cmd_plan(args):
    db, _ = load_db()
    d = args.date or today()
    sug, reason, last_t, last_d = plan_suggestion(d)
    days = {'上肢A': {'label': '上肢 A · 胸+肩', 'main': '小角度上斜卧推、史密斯推肩',
                      'assist': '站姿哑铃侧平举、反向蝴蝶机/后三角飞鸟'},
            '上肢B': {'label': '上肢 B · 背+臂', 'main': '高位下拉、坐姿划船',
                      'assist': '绳索直臂下压、绳索下压（三头）、绳索弯举（二头）'},
            '下肢': {'label': '下肢 · 臀+腿', 'main': '史密斯臀推、罗马尼亚硬拉RDL、保加利亚分腿蹲',
                      'assist': '（可选）30 分钟坡度走收尾'}}
    dd = days[sug]
    lines = ['📋 按你的私教计划（%s）' % d]
    if last_t:
        lines.append('上次：%s（%s）' % (last_t, last_d))
    lines.append('今天建议：%s' % dd['label'])
    lines.append('· ' + reason)
    lines.append('主项：%s' % dd['main'])
    lines.append('辅助（按需选）：%s' % dd['assist'])
    lines.append('训练前：最伟大拉伸（两侧）+ 对应部位松解激活；训练后：拉伸放松')
    print('\n'.join(lines))
    if args.detail:
        try:
            with open(PLAN_FILE, 'r', encoding='utf-8') as f:
                print('\n--- 完整手册 ---\n' + f.read())
        except Exception:
            print('（完整手册文件缺失：%s）' % PLAN_FILE)

def stats(db, d):
    daym = db.get('meals', {}).get(d, {})
    cal = 0
    macro = {'protein': 0.0, 'carbs': 0.0, 'fat': 0.0}
    for k in MEAL_KEYS:
        for it in daym.get(k, []):
            v = it.get('calories')
            cal += v if isinstance(v, (int, float)) else 0
            for f in macro:
                v = it.get(f)
                macro[f] += v if isinstance(v, (int, float)) else 0
    return cal, macro, daym


def cmd_today(args):
    db, _ = load_db()
    d = args.date or today()
    cal, macro, daym = stats(db, d)
    p = db.get('profile') or {}
    ms = sorted([m for m in db.get('measures', []) if isinstance(m.get('weight'), (int, float))],
                key=lambda m: m['date'])
    lm = sorted(db.get('measures', []), key=lambda m: m['date'])
    lm = lm[-1] if lm else None
    lines = ['📅 %s（%s）' % (d, weekday_cn(d))]

    def bmr_tdee():
        if not ms or not p.get('sex') or not p.get('age') or not p.get('height'):
            return None, None
        b = 10 * ms[-1]['weight'] + 6.25 * p['height'] - 5 * p['age'] + (5 if p['sex'] == 'male' else -161)
        return round(b), round(b * float(p.get('activity') or 1.375))

    bmr, tdee = bmr_tdee()
    goal = p.get('calorieGoal') if isinstance(p.get('calorieGoal'), (int, float)) else tdee
    if goal:
        gap = goal - cal
        lines.append('🔥 摄入 %d / %d 千卡（%s %d）' % (cal, goal, '还剩' if gap >= 0 else '已超', abs(gap)))
    else:
        lines.append('🔥 摄入 %d 千卡（未设目标）' % cal)
    if lm and isinstance(lm.get('weight'), (int, float)):
        w = lm['weight']
        lines.append('💪 蛋白 %.0fg（目标 %dg）· 碳水 %.0fg（%d–%d）· 脂肪 %.0fg（%d–%d）'
                     % (macro['protein'], round(w * 1.5), macro['carbs'], round(w * 3), round(w * 5),
                        macro['fat'], round(w * 0.6), round(w * 1.0)))
    meal_bits = []
    for k in MEAL_KEYS:
        items = daym.get(k, [])
        if (daym.get('_skip') or {}).get(k):
            meal_bits.append('%s：没吃' % MEAL_CN[k])
        elif items:
            c = sum(i.get('calories') or 0 for i in items)
            meal_bits.append('%s：%s（%d 千卡）' % (MEAL_CN[k], '、'.join(i['name'] for i in items), c))
    if meal_bits:
        lines.append('🍽 ' + '；'.join(meal_bits))
    else:
        lines.append('🍽 今天还没记录食物')
    ws = [w for w in db.get('workouts', []) if w.get('date') == d]
    if ws:
        def wlabel(w):
            if w.get('plan') or w.get('cardio'):
                parts = []
                if w.get('plan'):
                    parts.append('力量·' + w['plan'])
                if w.get('cardio'):
                    parts.append('有氧·' + w['cardio'])
                return ' ＋ '.join(parts)
            return w.get('type', '') + (('·' + w['name']) if w.get('name') and w['name'] != w.get('type') else '')
        lines.append('🏋️ 已训练：%s' % '、'.join(wlabel(w) for w in ws))
    else:
        lines.append('🏋️ 今天还没训练' + ('，练起来！' if tdee else ''))
    slp = (db.get('conditions', {}).get(d) or {}).get('sleep')
    if isinstance(slp, (int, float)):
        lines.append('😴 昨晚睡眠 %g 小时' % slp)
    sd = (db.get('supplements', {}).get(d) or {})
    taken = [s for s in SUPPS if sd.get(s)]
    if taken:
        lines.append('💊 补剂 %d/%d：%s' % (len(taken), len(SUPPS), '、'.join(taken)))
    else:
        lines.append('💊 补剂今天还没打卡（%s）' % '、'.join(SUPPS))
    g = db.get('goals') or {}
    bf_recs = [m for m in db.get('measures', []) if isinstance(m.get('bodyFat'), (int, float))]
    if g.get('bodyFat') and bf_recs:
        cur = bf_recs[-1]['bodyFat']
        s = '🎯 目标体脂 ≤%g%%，当前 %g%%' % (g['bodyFat'], cur)
        if cur > g['bodyFat']:
            s += '，还差 %.1f 个百分点' % (cur - g['bodyFat'])
        else:
            s += '，已达标 🎉'
        if g.get('targetDate'):
            days = (datetime.date.fromisoformat(g['targetDate']) - datetime.date.fromisoformat(today())).days
            if days > 0:
                s += '，剩 %d 天' % days
        lines.append(s)
    print('\n'.join(lines))


def cmd_coach(args):
    db, _ = load_db()
    d = args.date or today()
    cal, macro, daym = stats(db, d)
    h = datetime.datetime.now().hour
    part = ('凌晨' if h < 6 else '早晨' if h < 10 else '上午餐间' if h < 11.5 else '午餐时段'
            if h < 13.5 else '下午餐间' if h < 17 else '傍晚' if h < 20 else '夜间')
    ws = [w for w in db.get('workouts', []) if w.get('date') == d]
    g = db.get('goals') or {}
    lines = ['当前时段：' + part,
             '今日已摄入 %d 千卡' % cal,
             '今日营养素：蛋白质 %.0fg、碳水 %.0fg、脂肪 %.0fg' % (macro['protein'], macro['carbs'], macro['fat'])]
    eaten = [MEAL_CN[k] for k in MEAL_KEYS if daym.get(k)]
    skipped = [MEAL_CN[k] for k in MEAL_KEYS if (daym.get('_skip') or {}).get(k)]
    lines.append('已吃餐次：%s' % ('、'.join(eaten) if eaten else '还没吃')
                 + ('；标记没吃：' + '、'.join(skipped) if skipped else ''))
    lines.append('今日%s训练：%s' % ('已' if ws else '还没有',
             '、'.join(w.get('type', '') for w in ws) if ws else '建议安排一次'))
    slp = (db.get('conditions', {}).get(d) or {}).get('sleep')
    if isinstance(slp, (int, float)):
        lines.append('昨晚睡眠 %g 小时' % slp)
    sd = (db.get('supplements', {}).get(d) or {})
    taken = [s for s in SUPPS if sd.get(s)]
    lines.append('今日补剂：%s' % ('、'.join(taken) if taken else '还没吃'))
    if g.get('bodyFat'):
        bf = [m for m in db.get('measures', []) if isinstance(m.get('bodyFat'), (int, float))]
        if bf:
            lines.append('体脂目标 %g%%（期限 %s），当前 %g%%' % (g['bodyFat'], g.get('targetDate') or '未设', bf[-1]['bodyFat']))
    sug, reason, last_t, last_d = plan_suggestion(d)
    lines.append(PLAN_KNOWLEDGE)
    lines.append('计划推荐今天：%s。%s' % (sug, reason))
    print('⏳ 教练正在看你的数据…')
    tip = ds_chat([{'role': 'system', 'content': COACH_PROMPT},
                   {'role': 'user', 'content': '\n'.join(lines)}]).strip()
    print('\n🗣 ' + tip)


def cmd_suggest(args):
    db, _ = load_db()
    d = args.date or today()
    key = MEAL_CN.get(args.meal)
    if not key:
        fail('餐次请用：早餐/午餐/晚餐/加餐')
    cal, macro, daym = stats(db, d)
    lines = ['即将吃：%s' % MEAL_CN[key], '今日已摄入 %d 千卡' % cal,
             '已摄入营养素：蛋白 %.0fg、碳水 %.0fg、脂肪 %.0fg' % (macro['protein'], macro['carbs'], macro['fat'])]
    if args.pref:
        lines.append('用户口味/要求：' + args.pref)
    print('⏳ 营养师正在想…')
    j = parse_json(ds_chat([{'role': 'system', 'content': RECIPE_PROMPT},
                            {'role': 'user', 'content': '\n'.join(lines)}], True))
    print('\n🥗 %s推荐' % MEAL_CN[key] + ('：' + j['summary'] if j.get('summary') else ''))
    for it in j.get('items', []):
        if not isinstance(it, dict) or not it.get('name'):
            continue
        nut = ''
        if isinstance(it.get('calories'), (int, float)):
            nut = ' %d 千卡' % it['calories']
            if isinstance(it.get('protein'), (int, float)):
                nut += ' · P%.0f C%.0f F%.0f' % (it.get('protein') or 0, it.get('carbs') or 0, it.get('fat') or 0)
        print('  • %s%s%s' % (it['name'], nut, ('（%s）' % it['reason']) if it.get('reason') else ''))
    print('\n想直接记入？运行：python3 cli.py meal %s 食物1 食物2 --ai' % MEAL_CN[key])


def main():
    ap = argparse.ArgumentParser(description='健康日志命令行', add_help=True)
    sub = ap.add_subparsers(dest='cmd')

    p = sub.add_parser('key', help='保存 DeepSeek API Key')
    p.add_argument('value')
    p.set_defaults(fn=cmd_key)

    p = sub.add_parser('log', help='AI 大白话录入一天')
    p.add_argument('text', nargs='+')
    p.add_argument('--date')
    p.set_defaults(fn=cmd_log)

    p = sub.add_parser('meal', help='添加食物')
    p.add_argument('meal')
    p.add_argument('foods', nargs='+')
    p.add_argument('--ai', action='store_true', help='顺便让 AI 估算热量营养素')
    p.add_argument('--date')
    p.set_defaults(fn=cmd_meal)

    p = sub.add_parser('weight', help='记录体重 [体脂率]')
    p.add_argument('weight', type=float)
    p.add_argument('bodyfat', type=float, nargs='?')
    p.add_argument('--date')
    p.set_defaults(fn=cmd_weight)

    p = sub.add_parser('train', help='记录训练')
    p.add_argument('kind', help='力量 / 有氧 / 力量+有氧 / 乒乓球')
    p.add_argument('items', nargs='*', help='力量: 臀腿|胸肩|背臂；有氧: 爬坡|椭圆机|团课')
    p.add_argument('--date')
    p.set_defaults(fn=cmd_train)

    p = sub.add_parser('sleep', help='记录昨晚睡眠')
    p.add_argument('hours', type=float)
    p.add_argument('--date')
    p.set_defaults(fn=cmd_sleep)

    p = sub.add_parser('supp', help='补剂打卡（不带名字=5种全记；--undo 撤销）')
    p.add_argument('names', nargs='*', help='蛋白粉 肌酸 鱼油 维生素 益生菌 的任意组合')
    p.add_argument('--undo', action='store_true')
    p.add_argument('--date')
    p.set_defaults(fn=cmd_supp)

    p = sub.add_parser('skip', help='标记某餐没吃')
    p.add_argument('meal')
    p.add_argument('--date')
    p.set_defaults(fn=cmd_skip)

    p = sub.add_parser('today', help='今日摘要')
    p.add_argument('--date')
    p.set_defaults(fn=cmd_today)

    p = sub.add_parser('plan', help='按私教计划看今天该练什么')
    p.add_argument('--date')
    p.add_argument('--detail', action='store_true', help='附带完整训练手册')
    p.set_defaults(fn=cmd_plan)

    p = sub.add_parser('coach', help='AI 今日教练建议')
    p.add_argument('--date')
    p.set_defaults(fn=cmd_coach)

    p = sub.add_parser('suggest', help='AI 推荐这一餐吃什么')
    p.add_argument('meal')
    p.add_argument('--pref', default='')
    p.add_argument('--date')
    p.set_defaults(fn=cmd_suggest)

    args = ap.parse_args()
    if not args.cmd:
        ap.print_help()
        return
    args.fn(args)


if __name__ == '__main__':
    main()
