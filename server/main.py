import os
import time
import json
import math
import hmac
import uuid
import threading
from collections import deque

import requests
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# 服务商密钥只在服务端使用，绝不下发客户端
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/chat/completions")
UPSTREAM_TIMEOUT = float(os.getenv("DEEPSEEK_TIMEOUT", "30"))

# 独立的项目网关访问凭证（与服务商密钥无关），客户端只能访问本项目网关
GATEWAY_TOKEN = os.getenv("GATEWAY_TOKEN", "").strip()
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))

app = FastAPI()


class TurnRequest(BaseModel):
    message: str
    context: dict = {}
    tools: list = []
    results: list = []


class RateLimiter:
    """滑动窗口内存限流，按客户端凭证分桶。仅适用于单进程演示部署，不保证跨进程一致。"""

    def __init__(self, limit: int, window_seconds: float = 60.0):
        self.limit = limit
        self.window = window_seconds
        self._buckets = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            hits = self._buckets.get(key)
            if hits is None:
                hits = deque()
                self._buckets[key] = hits
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True


limiter = RateLimiter(RATE_LIMIT_PER_MINUTE)


def _error(request_id: str, code: str, message: str, status: int, start: float) -> JSONResponse:
    """统一错误协议：type/errorCode/message/requestId/elapsedMs，客户端只按这一种格式处理。"""
    return JSONResponse(
        status_code=status,
        content={
            "type": "error",
            "errorCode": code,
            "message": message,
            "requestId": request_id,
            "elapsedMs": round((time.time() - start) * 1000),
        },
    )


def _ensure_json_finite(value) -> None:
    """递归检查数值有限性；非有限浮点会令 JSONResponse(allow_nan=False) 在序列化时抛错。"""
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("包含非有限数值")
    elif isinstance(value, dict):
        for item in value.values():
            _ensure_json_finite(item)
    elif isinstance(value, list):
        for item in value:
            _ensure_json_finite(item)


@app.exception_handler(RequestValidationError)
def validation_error_handler(request: Request, exc: RequestValidationError):
    """请求体校验失败也走统一错误协议，避免 FastAPI 默认 422/detail 泄漏字段与原文。"""
    request_id = uuid.uuid4().hex[:12]
    start = time.time()
    details = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err.get("loc", ()))
        msg = err.get("msg", "字段校验失败")
        details.append(f"{loc or 'body'}: {msg}")
    message = "请求体不符合接口约定：" + ("；".join(details) if details else "字段缺失或类型错误")
    return JSONResponse(
        status_code=400,
        content={
            "type": "error",
            "errorCode": "INVALID_REQUEST",
            "message": message,
            "requestId": request_id,
            "elapsedMs": round((time.time() - start) * 1000),
        },
    )


def _build_messages(req: TurnRequest) -> list:
    """把请求中的上下文、历史工具结果与当前消息转换为上游 messages。

    - context：任务/时区等必要上下文，作为 system 消息传给模型。
    - results：上一轮模型发起的工具调用及其真实执行结果；每个元素需携带
      id/action/params（用于映射上游 tool_call_id）与 success/data/errorCode/message。
    """
    messages = []
    if req.context:
        messages.append({
            "role": "system",
            "content": "任务与时区上下文：" + json.dumps(req.context, ensure_ascii=False),
        })
    if req.results:
        tool_calls = []
        tool_messages = []
        for item in req.results:
            if not isinstance(item, dict):
                raise ValueError("results 必须是对象数组")
            call_id = item.get("id")
            action = item.get("action")
            if not isinstance(call_id, str) or not call_id:
                raise ValueError("results 每个元素需要非空 id")
            if not isinstance(action, str) or not action:
                raise ValueError("results 每个元素需要非空 action")
            params = item.get("params", {})
            if params is None:
                params = {}
            if not isinstance(params, dict):
                raise ValueError("results.params 必须是对象")
            tool_calls.append({
                "id": call_id,
                "type": "function",
                "function": {"name": action, "arguments": json.dumps(params, ensure_ascii=False)},
            })
            # 把真实结果（含成功/失败）作为 tool 消息回传，模型才能读到实际查询结果或提交失败信息
            content = json.dumps({
                "success": item.get("success"),
                "data": item.get("data"),
                "errorCode": item.get("errorCode"),
                "message": item.get("message"),
            }, ensure_ascii=False)
            tool_messages.append({"role": "tool", "tool_call_id": call_id, "content": content})
        messages.append({"role": "assistant", "content": None, "tool_calls": tool_calls})
        messages.extend(tool_messages)
    messages.append({"role": "user", "content": req.message})
    return messages


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL}


@app.post("/api/model/turn")
def model_turn(req: TurnRequest, request: Request):
    request_id = uuid.uuid4().hex[:12]
    start = time.time()

    # 配置校验：网关凭证与服务商密钥缺一不可，未配置时拒绝服务（fail-closed）
    if not GATEWAY_TOKEN:
        return _error(request_id, "CONFIG_ERROR", "GATEWAY_TOKEN 未配置，网关拒绝提供服务", 500, start)
    if not GATEWAY_TOKEN.isascii():
        return _error(request_id, "CONFIG_ERROR", "GATEWAY_TOKEN 含非 ASCII 字符", 500, start)
    if not API_KEY:
        return _error(request_id, "CONFIG_ERROR", "DEEPSEEK_API_KEY 未配置", 500, start)

    # 网关访问凭证校验（独立于服务商密钥，客户端仅获得本项目凭证）
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return _error(request_id, "UNAUTHORIZED", "缺少网关访问凭证", 401, start)
    token = auth[len("Bearer "):].strip()
    if not token or not token.isascii() or not hmac.compare_digest(token, GATEWAY_TOKEN):
        return _error(request_id, "UNAUTHORIZED", "网关访问凭证无效", 401, start)

    # 基本限流：在调用上游前拦截，避免任何可达调用方消耗服务商额度
    if not limiter.allow(token):
        return _error(request_id, "RATE_LIMITED", "请求过于频繁，请稍后重试", 429, start)

    # 构造上游消息：上下文 + 工具续轮结果 + 当前用户输入
    try:
        messages = _build_messages(req)
    except ValueError as e:
        return _error(request_id, "INVALID_REQUEST", str(e), 400, start)

    # 默认关闭思考：实测 thinking=disabled 去掉 reasoning_content，降低延迟与费用
    body = {
        "model": MODEL,
        "messages": messages,
        "thinking": {"type": "disabled"},
        "stream": False,
    }
    if req.tools:
        body["tools"] = req.tools

    try:
        r = requests.post(BASE_URL, headers={"Authorization": f"Bearer {API_KEY}"}, json=body, timeout=UPSTREAM_TIMEOUT)
    except requests.RequestException as e:
        return _error(request_id, "MODEL_ERROR", f"上游请求失败：{e}", 502, start)

    ms = round((time.time() - start) * 1000)

    if r.status_code != 200:
        return _error(request_id, "MODEL_ERROR", f"上游返回 {r.status_code}：{r.text[:200]}", 502, start)

    # 上游 HTTP 200 也需校验响应结构，映射为统一错误协议
    try:
        data = r.json()
    except ValueError:
        return _error(request_id, "MODEL_ERROR", "上游响应不是合法 JSON", 502, start)
    if not isinstance(data, dict):
        return _error(request_id, "MODEL_ERROR", "上游响应不是 JSON 对象", 502, start)
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return _error(request_id, "MODEL_ERROR", "上游响应缺少 choices", 502, start)
    first = choices[0]
    if not isinstance(first, dict):
        return _error(request_id, "MODEL_ERROR", "上游响应 choices[0] 不是对象", 502, start)
    msg = first.get("message")
    if not isinstance(msg, dict):
        return _error(request_id, "MODEL_ERROR", "上游响应缺少 message", 502, start)

    usage = data.get("usage", {})
    try:
        _ensure_json_finite(usage)
    except ValueError:
        return _error(request_id, "MODEL_ERROR", "上游 usage 包含非有限数值", 502, start)

    if "tool_calls" in msg and msg["tool_calls"] is not None:
        tool_calls = msg["tool_calls"]
        if not isinstance(tool_calls, list):
            return _error(request_id, "MODEL_ERROR", "上游 tool_calls 不是数组", 502, start)
        if tool_calls:
            calls = []
            for c in tool_calls:
                if not isinstance(c, dict) or not isinstance(c.get("function"), dict):
                    return _error(request_id, "MODEL_ERROR", "上游工具调用结构异常", 502, start)
                fn = c["function"]
                name = fn.get("name")
                if not isinstance(name, str) or not name:
                    return _error(request_id, "MODEL_ERROR", "上游工具调用缺少 name", 502, start)
                # 仅缺失、null、空字符串归一为 "{}"；数组/布尔/数值等原生值保留类型并拒绝
                raw_args = fn.get("arguments")
                if raw_args is None or raw_args == "":
                    raw_args = "{}"
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except (ValueError, TypeError):
                    return _error(request_id, "MODEL_ERROR", "上游工具参数解析失败", 502, start)
                # 工具参数必须是对象；字符串/数组等非法参数不当作正常工具调用下发
                if not isinstance(args, dict):
                    return _error(request_id, "MODEL_ERROR", "上游工具参数不是对象", 502, start)
                try:
                    _ensure_json_finite(args)
                except ValueError:
                    return _error(request_id, "MODEL_ERROR", "上游工具参数包含非有限数值", 502, start)
                call_id = c.get("id")
                if call_id is None or call_id == "":
                    call_id = f"call_{uuid.uuid4().hex[:8]}"
                elif not isinstance(call_id, str):
                    return _error(request_id, "MODEL_ERROR", "上游工具调用 id 不是字符串", 502, start)
                calls.append({
                    "id": call_id,
                    "action": name,
                    "params": args,
                })
            return JSONResponse(status_code=200, content={
                "type": "tool_calls",
                "calls": calls,
                "usage": usage,
                "requestId": request_id,
                "elapsedMs": ms,
            })
        # 空 tool_calls 数组表示本轮无工具调用，落入下方文本回答分支

    content = msg.get("content")
    if not isinstance(content, str) or not content.strip():
        return _error(request_id, "MODEL_ERROR", "上游未返回有效文本回答", 502, start)
    return JSONResponse(status_code=200, content={
        "type": "answer",
        "text": content,
        "usage": usage,
        "requestId": request_id,
        "elapsedMs": ms,
    })
