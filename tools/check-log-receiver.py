"""通过真实HTTP验证日志落盘、拒绝无效请求和服务端文件名隔离。"""
import http.client
import json
from pathlib import Path
from functools import partial
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from http.server import ThreadingHTTPServer
from log_receiver import Handler, MAX_BYTES


class ReceiverTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.logs = Path(self.temp.name) / 'logs'
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=self.temp.name, logs_dir=self.logs))
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def post(self, body, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            conn.request('POST', '/api/logs', body, headers or {'Content-Type': 'application/json'})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def test_saved_exactly_unique_and_no_client_path(self):
        body = json.dumps({'format': 'inkwave-android-diagnostics-v1', 'current': {'message': '中文日志'}, 'filename': '../../escape.json'}, ensure_ascii=False).encode()
        names = []
        for _ in range(2):
            status, result = self.post(body)
            self.assertEqual(status, 201)
            self.assertTrue(result['ok'])
            names.append(result['filename'])
            self.assertEqual((self.logs / result['filename']).read_bytes(), body)
        self.assertNotEqual(*names)
        self.assertEqual(len(list(self.logs.iterdir())), 2)
        self.assertFalse((Path(self.temp.name) / 'escape.json').exists())

    def test_reject_invalid_without_writing(self):
        for body in (b'broken', b'{}', b'[]', b'{"format":"inkwave-android-diagnostics-v1","current":[]}'):
            self.assertEqual(self.post(body)[0], 400)
        self.assertEqual(self.post(b'{}', {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.post(b'', {'Content-Type': 'application/json', 'Content-Length': str(MAX_BYTES + 1)})[0], 413)
        self.assertEqual(self.post(b'{}', {'Content-Type': 'application/json', 'Origin': 'https://example.com'})[0], 403)
        self.assertFalse(self.logs.exists())


if __name__ == '__main__':
    unittest.main()
