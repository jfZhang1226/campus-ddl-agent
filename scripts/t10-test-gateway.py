"""Loopback-only device fixture. No provider credentials, external requests or real model.

Run with --log-path outside the repository, then adb reverse tcp:18765 tcp:18765.
Client config: http://127.0.0.1:18765, token t10-device-check, timeout 5 seconds.
Every successful response visibly identifies itself as a local test fixture.
"""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18765)
    parser.add_argument('--log-path', type=Path, required=True)
    args = parser.parse_args()
    lock = threading.Lock()
    counts = {}
    sequence = 0

    def log(event, **fields):
        with lock:
            with args.log_path.open('a', encoding='utf-8') as stream:
                stream.write(json.dumps({'time': time.time(), 'event': event, **fields}, ensure_ascii=False) + '\n')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send_json(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode('utf-8')
            try:
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def do_GET(self):
            if self.path == '/__shutdown':
                self.send_json(200, {'status': 'stopping-test-fixture'})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            else:
                self.send_json(200, {'status': 'local-test-fixture', 'realModel': False})

        def do_POST(self):
            nonlocal sequence
            if self.path != '/api/model/turn':
                self.send_json(404, {'type': 'error', 'errorCode': 'NOT_FOUND'})
                return
            with lock:
                sequence += 1
                request_id = f'fixture-{sequence}'
            if self.headers.get('Authorization') != 'Bearer t10-device-check':
                log('unauthorized', requestId=request_id)
                self.send_json(401, {'type': 'error', 'errorCode': 'UNAUTHORIZED', 'requestId': request_id})
                return
            try:
                body = json.loads(self.rfile.read(min(int(self.headers.get('Content-Length', '0')), 20000)))
                message = body['message']
                assert isinstance(message, str)
                assert body['tools'] == [] and body['results'] == []
                assert body['context']['timezone'] == 'Asia/Shanghai'
            except (ValueError, KeyError, TypeError, AssertionError):
                self.send_json(400, {'type': 'error', 'errorCode': 'INVALID_REQUEST', 'requestId': request_id})
                return
            known = {'T10 OK', 'T10 LONG', 'T10 SLOW', 'T10 TIMEOUT', 'T10 FAIL', 'T10 RETRY', 'T10 RATE'}
            # Underscore aliases also work with device input tools that split text on spaces.
            scenario = message.replace('_', ' ')
            case = scenario if scenario in known else 'default-text'
            with lock:
                counts[case] = counts.get(case, 0) + 1
                attempt = counts[case]
            # Do not log headers, credentials, device IDs or arbitrary message text.
            log('start', case=case, attempt=attempt, requestId=request_id, characters=len(message))
            if case in {'T10 SLOW', 'T10 TIMEOUT'}:
                time.sleep(4 if case == 'T10 SLOW' else 8)
            status, code = 200, ''
            if case == 'T10 FAIL' or (case == 'T10 RETRY' and attempt == 1):
                status, code = 502, 'MODEL_ERROR'
            elif case == 'T10 RATE':
                status, code = 429, 'RATE_LIMITED'
            if code:
                self.send_json(status, {'type': 'error', 'errorCode': code, 'requestId': request_id})
            else:
                text = '【本机测试服务】中文与 emoji 😀 显示检查通过。此回复仅用于客户端链路验证，不是真实模型返回。'
                text += f'\n测试场景：{case}；测试请求：{request_id}'
                if case == 'T10 LONG':
                    text += '\n\n' + '\n\n'.join(f'第{i}段：这是一条用于检查长回复滚动的人工文本。请核对输入区仍可使用，内容可上下滚动。' for i in range(1, 13))
                self.send_json(200, {'type': 'answer', 'text': text, 'requestId': request_id, 'elapsedMs': 1})
            log('complete', case=case, attempt=attempt, requestId=request_id, status=status)

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'LOCAL TEST FIXTURE READY 127.0.0.1:{args.port}; no real model', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
