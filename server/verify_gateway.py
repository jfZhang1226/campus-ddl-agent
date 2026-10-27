"""T07 模型网关自测脚本（无真实上游、无真实密钥、无网络调用）。

用 importlib 加载 server/main.py，通过打桩 requests.post 伪造上游响应，
逐项覆盖 C 评审提出的 5 类场景：访问凭证、限流、上下文与工具结果传递、
非法工具参数、异常上游响应。

运行方式（在 server 目录）：
    ./.venv/Scripts/python.exe verify_gateway.py

不发起任何收费模型调用。
"""
import os
import sys
import json
import importlib
import asyncio

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import requests

# 完整配置：先满足网关与服务商凭证，用于绝大多数场景
FULL_ENV = {
    "DEEPSEEK_API_KEY": "sk-test-not-real",
    "DEEPSEEK_MODEL": "deepseek-flash",
    "DEEPSEEK_BASE_URL": "http://127.0.0.1:1/unused",
    "DEEPSEEK_TIMEOUT": "5",
    "GATEWAY_TOKEN": "gw-test-token",
    "RATE_LIMIT_PER_MINUTE": "1000",
}
for k, v in FULL_ENV.items():
    os.environ[k] = v

import main  # noqa: E402

GOOD_AUTH = "Bearer gw-test-token"

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    mark = "PASS" if cond else "FAIL"
    suffix = f"  -> {detail}" if detail else ""
    print(f"[{mark}] {name}{suffix}")


class FakeResp:
    def __init__(self, status_code=200, json_body=None, text="", json_ok=True):
        self.status_code = status_code
        self._json_body = json_body
        self.text = text
        self._json_ok = json_ok

    def json(self):
        if not self._json_ok:
            raise ValueError("invalid json")
        return self._json_body


class StubRequest:
    def __init__(self, auth):
        self.headers = {"Authorization": auth} if auth is not None else {}


captured = {}


def install_post(status=200, json_body=None, text="", json_ok=True, exc=None):
    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = json
        captured["timeout"] = timeout
        if exc is not None:
            raise exc
        return FakeResp(status, json_body, text, json_ok)

    main.requests.post = fake_post


def clear_captured():
    captured.clear()


def call(req_dict, auth=GOOD_AUTH):
    req = main.TurnRequest(**req_dict)
    resp = main.model_turn(req, StubRequest(auth))
    return resp, json.loads(resp.body)


def asgi_request(path, body_bytes, auth=None):
    """经 ASGI 入口发送原始请求，覆盖 FastAPI 路由与请求体校验路径（不经 model_turn 直接调用）。"""
    headers = [(b"content-type", b"application/json")]
    if auth is not None:
        headers.append((b"authorization", auth.encode()))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 8000),
        "root_path": "",
    }
    received = []
    sent = []

    async def receive():
        if not received:
            received.append(True)
            return {"type": "http.request", "body": body_bytes, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    asyncio.run(main.app(scope, receive, send))

    status = sent[0]["status"]
    headers_out = {k.decode(): v.decode() for k, v in sent[0].get("headers", [])}
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, headers_out, body


def reset_limiter():
    main.limiter._buckets.clear()


def set_env(**kw):
    for k, v in kw.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


# ---------------------------------------------------------------- 配置错误
set_env(GATEWAY_TOKEN="")
importlib.reload(main)
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("缺 GATEWAY_TOKEN -> CONFIG_ERROR", resp.status_code == 500 and body["errorCode"] == "CONFIG_ERROR", body)

set_env(GATEWAY_TOKEN="gw-test-token", DEEPSEEK_API_KEY="")
importlib.reload(main)
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("缺 DEEPSEEK_API_KEY -> CONFIG_ERROR", resp.status_code == 500 and body["errorCode"] == "CONFIG_ERROR", body)

set_env(DEEPSEEK_API_KEY="sk-test-not-real")
importlib.reload(main)

# ---------------------------------------------------------------- 访问凭证
install_post(json_body={"choices": [{"message": {"content": "ok"}}], "usage": {}})
clear_captured()
resp, body = call({"message": "hi"}, None)
check("缺 Authorization 头 -> 401 UNAUTHORIZED 且不调上游",
      resp.status_code == 401 and body["errorCode"] == "UNAUTHORIZED" and "url" not in captured, body)

clear_captured()
resp, body = call({"message": "hi"}, "Bearer wrong-token")
check("错误凭证 -> 401 UNAUTHORIZED 且不调上游",
      resp.status_code == 401 and body["errorCode"] == "UNAUTHORIZED" and "url" not in captured, body)

# ---------------------------------------------------------------- 限流
rl = main.RateLimiter(3, 60)
ok = rl.allow("k") and rl.allow("k") and rl.allow("k") and not rl.allow("k")
check("RateLimiter 每窗口 3 次，第 4 次拒绝", ok)

orig_allow = main.limiter.allow
main.limiter.allow = lambda k: False
clear_captured()
resp, body = call({"message": "hi"}, GOOD_AUTH)
main.limiter.allow = orig_allow
check("限流触发 -> 429 RATE_LIMITED 且不调上游",
      resp.status_code == 429 and body["errorCode"] == "RATE_LIMITED" and "url" not in captured, body)

# ---------------------------------------------------------------- 上下文与工具结果传递
install_post(json_body={"choices": [{"message": {"content": "ok"}}], "usage": {}})
clear_captured()
call({"message": "帮我查一下", "context": {"taskId": "t1", "timezone": "Asia/Shanghai"}}, GOOD_AUTH)
sys_msg = captured["body"]["messages"][0]
check("context 作为 system 消息传入上游",
      sys_msg["role"] == "system" and "taskId" in sys_msg["content"] and "Asia/Shanghai" in sys_msg["content"],
      sys_msg)

results_entry_success = [{"id": "call_1", "action": "get_tasks", "params": {"course": "数据库"},
                          "success": True, "data": {"tasks": []}, "errorCode": None, "message": ""}]
results_entry_fail = [{"id": "call_1", "action": "get_tasks", "params": {"course": "数据库"},
                       "success": False, "data": None, "errorCode": "STORAGE_FAILED", "message": "本地存储失败"}]

clear_captured()
call({"message": "继续", "results": results_entry_success}, GOOD_AUTH)
body_a = json.dumps(captured["body"]["messages"], ensure_ascii=False)

clear_captured()
call({"message": "继续", "results": results_entry_fail}, GOOD_AUTH)
body_b = json.dumps(captured["body"]["messages"], ensure_ascii=False)

msgs = captured["body"]["messages"]
asst = next(m for m in msgs if m["role"] == "assistant")
tool = next(m for m in msgs if m["role"] == "tool")
check("results 重建 assistant tool_calls 且保留调用 id",
      asst["tool_calls"][0]["id"] == "call_1" and asst["tool_calls"][0]["function"]["name"] == "get_tasks", asst)
check("results 转成 tool 消息并携带失败信息",
      tool["tool_call_id"] == "call_1" and "STORAGE_FAILED" in tool["content"], tool)
check("成功/失败结果会改变上游请求（不再静默忽略）", body_a != body_b)

clear_captured()
resp, body = call({"message": "继续", "results": [{"success": True}]}, GOOD_AUTH)
check("results 缺 id/action -> 400 INVALID_REQUEST",
      resp.status_code == 400 and body["errorCode"] == "INVALID_REQUEST", body)

# ---------------------------------------------------------------- 工具参数校验
install_post(json_body={"choices": [{"message": {"tool_calls": [
    {"id": "c1", "function": {"name": "get_tasks", "arguments": '{"course": '}}
]}}], "usage": {}})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("截断 JSON 参数 -> 502 MODEL_ERROR 而非 tool_calls",
      resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(json_body={"choices": [{"message": {"tool_calls": [
    {"id": "c2", "function": {"name": "get_tasks", "arguments": "[1,2]"}}
]}}], "usage": {}})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("数组参数 -> 502 MODEL_ERROR 而非 tool_calls",
      resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(json_body={"choices": [{"message": {"tool_calls": [
    {"id": "c3", "function": {"name": "get_tasks", "arguments": '{"course": "数据库"}'}}
]}}], "usage": {"total_tokens": 10}})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("合法工具调用 -> 200 tool_calls 且参数为对象、保留 id",
      resp.status_code == 200 and body["type"] == "tool_calls"
      and body["calls"][0]["action"] == "get_tasks"
      and body["calls"][0]["params"] == {"course": "数据库"}
      and body["calls"][0]["id"] == "c3", body)

# ---------------------------------------------------------------- 异常上游响应
install_post(status=200, text="not-json", json_ok=False)
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("上游 200 非 JSON -> 502 MODEL_ERROR", resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(status=200, json_body={"choices": []})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("上游 choices 空 -> 502 MODEL_ERROR", resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(status=200, json_body={"choices": [{}]})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("上游缺 message -> 502 MODEL_ERROR", resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(status=200, json_body={"choices": ["x"]})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("上游 choices[0] 非对象 -> 502 MODEL_ERROR", resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(status=200, json_body={"choices": [{"message": {"tool_calls": "oops"}}]})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("上游 tool_calls 非数组 -> 502 MODEL_ERROR", resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(status=200, json_body={"choices": [{"message": {"tool_calls": [{"id": "c5", "function": {}}]}}]})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("上游工具调用缺 name -> 502 MODEL_ERROR", resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(status=200, json_body={"choices": [{"message": {"tool_calls": [{"id": "c6", "function": {"name": "noop", "arguments": ""}}]}}], "usage": {}})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("空参数字符串 -> 200 tool_calls 且 params 为空对象",
      resp.status_code == 200 and body["type"] == "tool_calls" and body["calls"][0]["params"] == {}, body)

install_post(status=200, json_body={"not": "a dict"})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("上游非对象响应 -> 502 MODEL_ERROR", resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(status=429, text="upstream rate limited")
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("上游 429 -> 502 MODEL_ERROR（保留映射）", resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(exc=requests.Timeout("timed out"))
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("上游网络异常 -> 502 MODEL_ERROR", resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

# ---------------------------------------------------------------- 正常 answer
install_post(json_body={"choices": [{"message": {"content": "好的，已记录"}}], "usage": {"total_tokens": 20}})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("正常 answer -> 200 且含 requestId",
      resp.status_code == 200 and body["type"] == "answer" and body["text"] == "好的，已记录"
      and bool(body.get("requestId")), body)

# ---------------------------------------------------------------- HTTP 入口校验（P2-1）
# 请求体在进入 model_turn 前就被 FastAPI 校验，需走 RequestValidationError 处理器而非 422/detail。
status, _, raw = asgi_request("/api/model/turn", b"{}", GOOD_AUTH)
body = json.loads(raw)
check("HTTP 缺字段 -> 400 INVALID_REQUEST 统一错误结构",
      status == 400 and body["type"] == "error" and body["errorCode"] == "INVALID_REQUEST"
      and bool(body.get("requestId")) and "elapsedMs" in body and "detail" not in body, body)

status, _, raw = asgi_request("/api/model/turn", json.dumps({"message": 123}).encode(), GOOD_AUTH)
body = json.loads(raw)
check("HTTP message 错类型 -> 400 INVALID_REQUEST 统一错误结构",
      status == 400 and body["type"] == "error" and body["errorCode"] == "INVALID_REQUEST", body)

status, _, raw = asgi_request("/api/model/turn", json.dumps({"message": "hi", "context": "x"}).encode(), GOOD_AUTH)
body = json.loads(raw)
check("HTTP context 错类型 -> 400 INVALID_REQUEST 统一错误结构",
      status == 400 and body["type"] == "error" and body["errorCode"] == "INVALID_REQUEST", body)

status, _, raw = asgi_request("/api/model/turn", b'{"message":', GOOD_AUTH)
body = json.loads(raw)
check("HTTP 截断 JSON -> 400 INVALID_REQUEST 统一错误结构",
      status == 400 and body["type"] == "error" and body["errorCode"] == "INVALID_REQUEST"
      and "detail" not in body, body)

# ---------------------------------------------------------------- 原生非对象工具参数（P2-2）
for label, native in [("空数组", []), ("布尔 false", False), ("数值 0", 0)]:
    install_post(json_body={"choices": [{"message": {"tool_calls": [
        {"id": "c7", "function": {"name": "get_tasks", "arguments": native}}
    ]}}], "usage": {}})
    resp, body = call({"message": "hi"}, GOOD_AUTH)
    check(f"原生非对象参数 {label} -> 502 MODEL_ERROR 而非归一为 {{}}",
          resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

# ---------------------------------------------------------------- 回答文本边界（P2-3）
install_post(json_body={"choices": [{"message": {"content": {"a": 1}}}]})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("content 为对象 -> 502 MODEL_ERROR 而非 answer",
      resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(json_body={"choices": [{"message": {"content": ["x"]}}]})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("content 为数组 -> 502 MODEL_ERROR 而非 answer",
      resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(json_body={"choices": [{"message": {}}]})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("缺 content 且无工具调用 -> 502 MODEL_ERROR 而非空 answer",
      resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

install_post(json_body={"choices": [{"message": {"tool_calls": {}}}]})
resp, body = call({"message": "hi"}, GOOD_AUTH)
check("tool_calls 为空对象 -> 502 MODEL_ERROR 而非落入 answer",
      resp.status_code == 502 and body["errorCode"] == "MODEL_ERROR", body)

# ---------------------------------------------------------------- 汇总
print("\n" + "=" * 60)
failed = [n for n, ok in results if not ok]
print(f"共 {len(results)} 项，通过 {len(results) - len(failed)}，失败 {len(failed)}")
if failed:
    print("失败项：")
    for n in failed:
        print("  -", n)
    sys.exit(1)
print("全部通过")
