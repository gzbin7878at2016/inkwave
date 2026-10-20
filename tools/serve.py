#!/usr/bin/env python3
# 【运行说明】这是浏览器/局域网静态服务，默认8490端口；Electron的 npm start 不会启动此服务。
# Windows按本机Python命令使用 py -3 或 python；相对资源从配置的根目录提供，避免在tools目录误启动。
# 服务会监听局域网可达地址；no-cache要求重新验证模块，不等于禁止所有浏览器缓存。
"""INKWAVE dev/LAN server: static files from the repo root on 0.0.0.0 (reachable from other machines on the network).

【中文导读】浏览器形态(非 Electron)的启动方式:python3 tools/serve.py → 打开 http://localhost:8490。
本项目是"零构建"的 ES Modules——几十个 JS 文件各是一次 HTTP 请求,所以缓存策略必须正确:

Every response carries `Cache-Control: no-cache`, so browsers revalidate each module on load (cheap 304s via
Last-Modified) and can never mix a fresh main.js with a stale cached module — plain `python -m http.server` sends no
cache headers and browsers apply heuristic caching to ES modules.

usage: python3 tools/serve.py [port=8490] [--dir <root>]
"""
import http.server
import os
import socket
import sys
from functools import partial

port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8490
root = sys.argv[sys.argv.index('--dir') + 1] if '--dir' in sys.argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# 维护资源MIME和缓存头，尤其JS模块必须返回可被浏览器接受的脚本类型。
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
        '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):   # quiet: only errors
        if args and str(args[1] if len(args) > 1 else '').startswith(('4', '5')):
            super().log_message(fmt, *args)


# IPv6套接字尽量打开双栈，让localhost及IPv4局域网地址均可访问。
class Server(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6
    daemon_threads = True

    def handle_error(self, request, client_address):
        # a browser cancelling a download (tab closed, reload) is normal — don't print a traceback for it
        import sys as _s
        if isinstance(_s.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)

    def server_bind(self):
        # dual-stack: IPv6 + IPv4 on one socket, so both http://localhost and http://<lan-ip> work
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass
        super().server_bind()


# 枚举用于启动提示的局域网地址；探测失败不应阻断本地静态服务。
def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ips)


if __name__ == '__main__':
    httpd = Server(('::', port), partial(Handler, directory=root))
    print(f'INKWAVE serving {root}')
    print(f'  this machine : http://localhost:{port}')
    for ip in lan_ips():
        print(f'  your network : http://{ip}:{port}')
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
