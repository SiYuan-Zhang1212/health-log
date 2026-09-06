#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
健康日志 · 本地服务器
- 托管 web/ 目录的静态页面
- 提供 /api/db 接口：数据保存在 data/health.json（原子写入 + 自动备份 + 版本号防覆盖）
- 零第三方依赖，仅用 Python 标准库

用法：
    python3 server.py                      # 默认端口 8000，启动后自动打开浏览器
    python3 server.py --port 9000 --no-open
"""
import json
import os
import struct
import sys
import threading
import time
import webbrowser
import zlib
import socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

BASE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE, 'web')
DATA_DIR = os.path.join(BASE, 'data')
DB_FILE = os.path.join(DATA_DIR, 'health.json')
REV_FILE = os.path.join(DATA_DIR, 'rev.txt')
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')  # 存 API Key 等，不在导出/备份范围
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')
ICON_DIR = os.path.join(WEB_DIR, 'icons')
MAX_BODY = 20 * 1024 * 1024
MAX_SNAPSHOTS = 14
DEFAULT_PORT = 8000

_lock = threading.RLock()

DEFAULT_DB = {
    'meals': {}, 'workouts': [], 'measures': [], 'conditions': {},
    'goals': {'weight': None, 'bodyFat': None}, 'profile': {}, 'advices': [],
}


def valid_db(db):
    if not isinstance(db, dict):
        return False
    checks = [('meals', dict), ('workouts', list), ('measures', list),
              ('conditions', dict), ('goals', dict)]
    return all(isinstance(db.get(k), t) for k, t in checks)


def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)


def read_rev():
    try:
        with open(REV_FILE, 'r', encoding='utf-8') as f:
            return int(f.read().strip())
    except Exception:
        return 0


def write_rev(rev):
    tmp = REV_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(str(rev))
    os.replace(tmp, REV_FILE)


def _write_file(db):
    tmp = DB_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, DB_FILE)


def read_db():
    with _lock:
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                db = json.load(f)
            if valid_db(db):
                return db
        except Exception:
            pass
        db = json.loads(json.dumps(DEFAULT_DB))
        _write_file(db)
        return db


def write_db(db, expected_rev=None):
    """原子写入 + 滚动备份。expected_rev 不匹配时拒绝写入（多设备防覆盖）。
    返回 (ok, rev_or_error)。"""
    with _lock:
        if expected_rev is not None and expected_rev != read_rev():
            return False, 'conflict'
        if os.path.exists(DB_FILE):
            _backup_current()
        _write_file(db)
        rev = read_rev() + 1
        write_rev(rev)
        return True, rev


def _backup_current():
    try:
        with open(DB_FILE, 'rb') as f:
            old = f.read()
        with open(os.path.join(BACKUP_DIR, 'latest.json'), 'wb') as f:
            f.write(old)
        # 每天第一笔写入留一份快照，保留最近 MAX_SNAPSHOTS 份
        snap = 'snapshot-' + time.strftime('%Y%m%d') + '.json'
        sp = os.path.join(BACKUP_DIR, snap)
        if not os.path.exists(sp):
            with open(sp, 'wb') as f:
                f.write(old)
            snaps = sorted(p for p in os.listdir(BACKUP_DIR) if p.startswith('snapshot-'))
            if len(snaps) > MAX_SNAPSHOTS:
                for p in snaps[:-MAX_SNAPSHOTS]:
                    try:
                        os.remove(os.path.join(BACKUP_DIR, p))
                    except OSError:
                        pass
    except Exception:
        pass


def read_config():
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        if isinstance(cfg, dict):
            return cfg
    except Exception:
        pass
    return {}


def write_config(cfg):
    tmp = CONFIG_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_FILE)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kw):
        super().__init__(*args, directory=WEB_DIR, **kw)

    def end_headers(self):
        # 应用文件始终要求浏览器重新验证，避免更新页面后仍在用旧缓存；
        # 图标这类不变资源不加，保留正常缓存。
        p = self.path.split('?')[0]
        if not p.startswith('/icons/'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('[%s] %s\n' % (time.strftime('%H:%M:%S'), fmt % args))

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/db':
            try:
                self._json(200, {'ok': True, 'rev': read_rev(), 'db': read_db()})
            except Exception as e:
                self._json(500, {'ok': False, 'error': str(e)})
        elif path == '/api/ping':
            self._json(200, {'ok': True, 'app': 'health-log', 'time': time.time()})
        elif path == '/api/key':
            # 本机个人工具：前端调用 AI 需要完整 key
            with _lock:
                key = str(read_config().get('api_key') or '')
            self._json(200, {'ok': True, 'key': key})
        else:
            super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        if path == '/api/key':
            try:
                n = int(self.headers.get('Content-Length') or 0)
                if n > 10240:
                    raise ValueError('请求体过大')
                payload = json.loads(self.rfile.read(n).decode('utf-8'))
                key = str(payload.get('key') or '').strip()
                if not key:
                    raise ValueError('key 不能为空')
                with _lock:
                    cfg = read_config()
                    cfg['api_key'] = key
                    write_config(cfg)
                self._json(200, {'ok': True})
            except Exception as e:
                self._json(400, {'ok': False, 'error': str(e)})
            return
        if path != '/api/db':
            self._json(404, {'ok': False, 'error': 'not found'})
            return
        try:
            n = int(self.headers.get('Content-Length') or 0)
            if n <= 0 or n > MAX_BODY:
                raise ValueError('请求体大小不合法')
            payload = json.loads(self.rfile.read(n).decode('utf-8'))
            if isinstance(payload, dict) and 'db' in payload:  # {rev, db} 包装格式
                expected = payload.get('rev')
                db = payload['db']
            else:  # 兼容裸 db（视为强制写入）
                expected = None
                db = payload
            if not valid_db(db):
                raise ValueError('数据结构不合法')
            ok, result = write_db(db, expected)
            if not ok:
                self._json(409, {'ok': False, 'error': result})
            else:
                self._json(200, {'ok': True, 'rev': result})
        except Exception as e:
            self._json(400, {'ok': False, 'error': str(e)})


def _png_bytes(width, height, rgba):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def gen_icons():
    """首次运行时用纯标准库生成 PWA 图标（绿底白色餐碗）。"""
    sizes = (192, 512)
    if all(os.path.exists(os.path.join(ICON_DIR, 'icon-%d.png' % s)) for s in sizes):
        return
    os.makedirs(ICON_DIR, exist_ok=True)
    bg, fg = (46, 125, 102), (255, 255, 255)
    for size in sizes:
        buf = bytearray(size * size * 4)
        for y in range(size):
            for x in range(size):
                u, v = (x + .5) / size, (y + .5) / size
                bowl = (0.30 <= u <= 0.70 and 0.42 <= v <= 0.52) or \
                       (v > 0.52 and (u - 0.5) ** 2 + (v - 0.52) ** 2 <= 0.16 ** 2)
                tick = ((0.43 <= u <= 0.46) or (0.54 <= u <= 0.57)) and 0.28 <= v <= 0.37
                c = fg if (bowl or tick) else bg
                i = (y * size + x) * 4
                buf[i], buf[i + 1], buf[i + 2], buf[i + 3] = c[0], c[1], c[2], 255
        with open(os.path.join(ICON_DIR, 'icon-%d.png' % size), 'wb') as f:
            f.write(_png_bytes(size, size, buf))


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(('8.8.8.8', 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith('127.'):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


def main():
    port, do_open = DEFAULT_PORT, True
    args = sys.argv[1:]
    if '--no-open' in args:
        do_open = False
    if '--port' in args:
        try:
            port = int(args[args.index('--port') + 1])
        except (IndexError, ValueError):
            print('参数 --port 需要一个端口号，例如 --port 9000')
            sys.exit(1)

    ensure_dirs()
    gen_icons()

    try:
        srv = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    except OSError as e:
        print('启动失败：端口 %d 可能被占用（%s）。' % (port, e))
        print('换一个端口试试：python3 server.py --port %d' % (port + 1))
        sys.exit(1)
    srv.daemon_threads = True

    print('=' * 46)
    print('  健康日志 · 本地服务器已启动')
    print('  本机访问：http://127.0.0.1:%d' % port)
    for ip in lan_ips():
        print('  手机访问：http://%s:%d（需同一 Wi-Fi）' % (ip, port))
    print('  数据文件：%s' % DB_FILE)
    print('  停止服务：按 Ctrl+C' if sys.stdin is not None else '')
    print('=' * 46)

    if do_open:
        threading.Timer(0.8, lambda: webbrowser.open('http://127.0.0.1:%d' % port)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    print('服务器已停止。')


if __name__ == '__main__':
    main()
