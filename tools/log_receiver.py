"""局域网诊断接收器：日志固定写入 releases/logs，静态下载仅提供 mobile-install。"""
import argparse
import http.server
import ipaddress
import json
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlsplit
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 4 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, logs_dir=None, **kwargs):
        self.logs_dir = Path(logs_dir or ROOT / 'releases/logs')
        super().__init__(*args, **kwargs)

    def origin_allowed(self):
        origin = self.headers.get('Origin')
        if not origin:
            return True  # Android原生上传没有浏览器Origin头。
        try:
            url = urlsplit(origin)
            host = url.hostname
            return url.scheme in ('http', 'https') and (host == 'localhost' or
                (ipaddress.ip_address(host).version == 4 and
                 (ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback)))
        except ValueError:
            return False

    def end_headers(self):
        if self.headers.get('Origin') and self.origin_allowed():
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Vary', 'Origin')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if self.path != '/api/logs' or not self.origin_allowed():
            self.reply(403, {'error': '不允许此上传来源'})
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

    def do_POST(self):
        if self.path != '/api/logs':
            self.reply(404, {'error': '接口不存在'})
            return
        if not self.origin_allowed():
            self.reply(403, {'error': '不允许此上传来源'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.reply(400, {'error': '日志长度无效'})
            return
        if not 0 < size <= MAX_BYTES:
            self.reply(413, {'error': '日志为空或超过4MiB'})
            return
        if self.headers.get_content_type() != 'application/json':
            self.reply(415, {'error': '只接收JSON诊断日志'})
            return
        self.connection.settimeout(20)
        temporary = None
        try:
            body = self.rfile.read(size)
            if len(body) != size:
                raise ValueError('日志传输不完整')
            report = json.loads(body)
            if not isinstance(report, dict) or report.get('format') != 'inkwave-android-diagnostics-v1' or not isinstance(report.get('current'), dict):
                raise ValueError('不是INKWAVE诊断日志')
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
            filename = f'INKWAVE-logs-{stamp}-{uuid4().hex[:8]}.json'
            # 文件名只由服务端生成；先写临时文件，成功后原子改名，不覆盖旧日志。
            temporary = self.logs_dir / (filename + '.part')
            temporary.write_bytes(body)
            temporary.replace(self.logs_dir / filename)
            print(f'日志已保存：{self.logs_dir / filename}', flush=True)
            self.reply(201, {'ok': True, 'filename': filename, 'bytes': len(body)})
        except (ValueError, UnicodeDecodeError) as error:
            self.reply(400, {'error': str(error)})
        except OSError:
            self.reply(500, {'error': '电脑保存失败，请检查目录权限和磁盘空间'})
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    from functools import partial
    downloads = ROOT / 'releases/mobile-install'
    downloads.mkdir(parents=True, exist_ok=True)
    (ROOT / 'releases/logs').mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('0.0.0.0', args.port), partial(Handler, directory=str(downloads)))
    print(f'日志接收端口：{args.port}；保存目录：{ROOT / "releases/logs"}', flush=True)
    server.serve_forever()
