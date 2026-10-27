import os
import time
import json
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
BASE_URL = "https://api.deepseek.com/chat/completions"

app = FastAPI()


class TurnRequest(BaseModel):
    message: str
    context: dict = {}
    tools: list = []
    results: list = []


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL}


@app.post("/api/model/turn")
def model_turn(req: TurnRequest):
    if not API_KEY:
        raise HTTPException(status_code=500, detail="DEEPSEEK_API_KEY 未配置")
    # 默认关闭思考：实测 thinking=disabled 去掉 reasoning_content，降低延迟与费用
    body = {"model": MODEL, "messages": [{"role": "user", "content": req.message}], "thinking": {"type": "disabled"}, "stream": False}
    if req.tools:
        body["tools"] = req.tools
    start = time.time()
    try:
        r = requests.post(BASE_URL, headers={"Authorization": f"Bearer {API_KEY}"}, json=body, timeout=30)
    except requests.RequestException as e:
        return {"type": "error", "errorCode": "MODEL_ERROR", "message": str(e)}
    ms = round((time.time() - start) * 1000)
    if r.status_code != 200:
        return {"type": "error", "errorCode": "MODEL_ERROR", "message": r.text[:200], "elapsedMs": ms}
    data = r.json()
    msg = data["choices"][0]["message"]
    usage = data.get("usage", {})
    if msg.get("tool_calls"):
        calls = []
        for c in msg["tool_calls"]:
            args = c["function"].get("arguments", "{}")
            try:
                args = json.loads(args)
            except Exception:
                pass
            calls.append({"action": c["function"]["name"], "params": args})
        return {"type": "tool_calls", "calls": calls, "usage": usage, "elapsedMs": ms}
    return {"type": "answer", "text": msg.get("content") or "", "usage": usage, "elapsedMs": ms}
