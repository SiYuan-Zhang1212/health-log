# 健康日志 · 三餐 / 训练 / 体测

个人健康记录工具（**电脑桌面使用**）：首页按「吃 / 练 / 睡 / 补」四大块总览（含月历，每天的吃练睡补录入情况一目了然），三餐、训练、睡眠、补剂、体测页面分别录入，三餐录入内置常用固定搭配一键加入，支持 AI 估算热量、训练点评与周度建议。

数据保存在本机磁盘文件上，界面为左侧导航 + 首页仪表盘 + 分页面录入的桌面形态。

## 快速开始

1. 双击 `启动.command`（首次双击若提示"无法验证开发者"，右键点它 → 打开）
   - 或在终端里运行：`python3 server.py`
2. 浏览器会自动打开 `http://127.0.0.1:8000`
3. 停止：关闭终端窗口，或按 `Ctrl+C`

零依赖：只需要 Python 3（macOS 自带或 `xcode-select --install` 后即有），无需安装任何包。

## AI 功能

- 三餐热量估算、训练点评、周度建议需要 DeepSeek API Key（platform.deepseek.com 申请，填入「设置」）
- 模型已固定为 **deepseek-v4-flash-vision-exp**（V4 Flash 多模态实验版）
- Key 只保存在当前设备的浏览器里，不会写入数据文件和导出文件

## 数据与备份

- 全部数据在 `data/health.json`，直接复制这个文件即可备份
- 服务器每次写入都会自动备份：`data/backups/latest.json`（上一版）、`data/backups/snapshot-日期.json`（每日快照，保留 14 份）
- 应用内「设置 → 数据管理」可导出 / 导入 JSON（导出不含 API Key）

## 旧版（单文件 index.html）数据迁移

- 旧版在 `python3 -m http.server` 方式下用过：新版首次打开会自动弹「迁移旧数据」提示
- 旧版是双击直接打开的：在旧浏览器里打开旧版 → 设置 → 导出 JSON，再在新版「设置 → 导入」
- 根目录旧 `index.html` 保留作迁移来源，确认数据迁好后可删

## 目录结构

```
├── 启动.command      # 双击启动
├── server.py         # 本地服务器（静态页面 + 数据接口）
├── index.html        # 旧版单文件（仅供数据迁移，可删）
├── data/             # 数据与自动备份
│   ├── health.json
│   └── backups/
└── web/              # 应用页面（侧边栏 + 桌面多列布局）
    ├── index.html
    ├── manifest.json / sw.js / icons/
    ├── css/app.css
    └── js/…
```

## 常见问题

- **端口被占用**：`python3 server.py --port 9000`
- **想彻底重置**：删除 `data/` 目录（建议先留个备份）
