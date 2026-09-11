# -*- coding: utf-8 -*-
# 本地预览服务：修正 Windows 注册表导致的 .svg MIME 错误（image/svg → image/svg+xml）
# 用法：python tools-dev/serve.py [目录] [端口]，默认 serve publish/ 于 8899
import http.server
import mimetypes
import os
import sys

mimetypes.add_type('image/svg+xml', '.svg')

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 本地预览禁缓存：避免旧的错误 MIME 响应驻留浏览器缓存
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
serve_dir = os.path.join(ROOT, 'publish')
if len(sys.argv) > 1:
    serve_dir = sys.argv[1]
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8899
os.chdir(serve_dir)

with http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler) as httpd:
    print(f'serving {serve_dir} at http://127.0.0.1:{port}/ (svg mime fixed, no-cache)')
    httpd.serve_forever()
