# 健康日志 · 三餐 / 训练 / 体测

个人健康记录工具。首页按「吃 / 练 / 睡 / 补」四大块总览（含月历），三餐、训练、睡眠、补剂、体测分页面录入，支持 AI 估算热量、训练点评与周度建议。

**两种运行方式，同一套前端：**

| | 本地模式 | 云端模式 |
|---|---|---|
| 怎么用 | 双击 `启动.command`，浏览器开 `127.0.0.1:8000` | 直接访问自己的域名，任何设备任何网络 |
| 数据在哪 | `data/health.json`（你的电脑上） | Cloudflare D1（你自己的账号下） |
| 鉴权 | 无（只监听本机 / 局域网） | 密码登录 + 签名 Cookie |
| AI Key | 存在本地 `data/config.json` | 存在服务端，浏览器不接触明文 |
| 适合 | 只在电脑上用、想完全离线 | 手机随手记、多设备同步 |

部署到云端见 **`部署.md`**（一次性，约 20 分钟，费用只有域名）。

## 本地模式

1. 双击 `启动.command`（首次若提示"无法验证开发者"，右键 → 打开）
   - 或在终端里运行：`python3 server.py`
2. 浏览器自动打开 `http://127.0.0.1:8000`
3. 停止：关闭终端窗口，或按 `Ctrl+C`

零依赖：只需要 Python 3。

## 云端模式（Cloudflare）

```bash
npm install
npx wrangler login
npx wrangler d1 create health-log        # 把 database_id 填进 wrangler.jsonc
npm run db:schema
npx wrangler secret put APP_PASSWORD     # 登录密码
npx wrangler secret put SESSION_SECRET   # openssl rand -base64 32
npx wrangler secret put CLI_TOKEN        # openssl rand -hex 24
npm run deploy
```

完整步骤、绑定域名、数据迁移、排错：见 `部署.md`。

## 命令行工具（cli.py）

给终端和 AI 助手用，读写同一份数据：

```bash
python3 cli.py log "早上两个鸡蛋一碗粥，练了40分钟力量，睡了7小时，62.4kg"
python3 cli.py today          # 今日摘要
python3 cli.py plan           # 按私教计划今天该练什么
python3 cli.py coach          # AI 教练建议
python3 cli.py remote https://health.你的域名.com <CLI_TOKEN>   # 切到云端
python3 cli.py sync           # 云端 → 本地
python3 cli.py push           # 本地 → 云端（强制覆盖）
```

不配 `remote` 时行为和以前完全一样：优先本地服务器，其次直接读写文件。

## AI 功能

- 热量估算、训练点评、周度建议需要 DeepSeek API Key（platform.deepseek.com 申请，填在「设置」）
- 模型固定为 **deepseek-v4-flash-vision-exp**
- 前端不直接调 DeepSeek：请求走服务器代理，Key 只存在服务端，也不会写进导出文件

## 数据与备份

- **本地模式**：全部数据在 `data/health.json`，复制这个文件即可备份；服务器每次写入自动备份到 `data/backups/`（`latest.json` + 每日快照，保留 14 份）
- **云端模式**：数据在 D1 的 `docs` 表（单行 JSON + rev 版本号做乐观锁）；每次保存自动留一份快照，保留最近 30 份，网页「设置 → 云端快照 / 恢复」可回滚
- 应用内「设置 → 数据管理」可导出 / 导入 JSON（导出不含 API Key）

## 目录结构

```
├── 启动.command          # 双击启动本地服务器
├── server.py             # 本地服务器（静态页面 + /api，零依赖）
├── cli.py                # 命令行工具（本地 / 云端双模式）
├── wrangler.jsonc        # Cloudflare Workers 配置
├── worker/
│   ├── index.js          # 云端 Worker：鉴权 + D1 读写 + AI 代理 + 快照
│   ├── schema.sql        # D1 表结构
│   └── test/             # 内存 D1 的 API 行为测试（npm test）
├── 部署.md                # 云端部署步骤
├── data/                 # 本地数据与备份（已 gitignore）
├── index.html            # 旧版单文件（仅供数据迁移，可删）
└── web/                  # 应用页面（本地与云端共用）
    ├── index.html / manifest.json / sw.js / icons/
    ├── css/app.css
    └── js/  main.js / api.js / store.js / ai.js / ui.js / charts.js / nav.js
         views/ today.js meals.js workout.js sleep.js supps.js trends.js settings.js
```

## 常见问题

- **端口被占用**：`python3 server.py --port 9000`
- **想彻底重置**：删除 `data/` 目录（建议先备份）
- **旧版（单文件 index.html）数据迁移**：首次打开会自动提示；或旧版里「设置 → 导出 JSON」，再在新版「设置 → 导入」

## 开发与验证

```bash
npm test          # 41 项 API 行为测试（内存 D1，不联网、不碰真实数据）
npm run mock      # 本地模拟云端：http://127.0.0.1:8788，密码 dev-password
npm run dev       # 真实 wrangler 本地开发（需先 npm install + 建表）
python3 server.py --port 8099 --no-open   # 本地模式回归
```

`npm run mock` 用内存 D1 跑真实的 Worker 代码，可以直接在浏览器里试「登录 → 记录 → 自动保存 → 退出」，
用来验证前端改动，不会写进 Cloudflare。改了 `worker/index.js` 里的 SQL，要同步更新 `worker/test/mock-d1.mjs`。
