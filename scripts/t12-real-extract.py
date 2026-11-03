"""T12 通知提取真实 DeepSeek 调用（会产生少量费用）。

读取 server/.env（DEEPSEEK_API_KEY 等），对若干条通知原文走与网关提取端点相同的
消息构造与规范化逻辑（notice_extraction），打印归一化草案、耗时与用量。

运行方式：
    cd server && ./.venv/Scripts/python.exe ../scripts/t12-real-extract.py

注意：本脚本会发起真实收费调用，按需运行，不要把输出里的密钥或原文外传。
"""
import os
import sys
import json
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent
SERVER = HERE.parent / "server"
sys.path.insert(0, str(SERVER))

import requests  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv(SERVER / ".env")

import notice_extraction as ne  # noqa: E402

MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/chat/completions")
TIMEOUT = float(os.getenv("DEEPSEEK_TIMEOUT", "30"))

CASES = [
    {
        "name": "exact-deadline",
        "rawText": "数据库实验报告请于2026年11月6日23:59前提交，材料包括PDF报告和源代码，上传学习通。",
        "publishedAt": "2026-11-01T09:00:00+08:00",
        "sourceLabel": "数据库课程群",
    },
    {
        "name": "date-only-deadline",
        "rawText": "高等数学作业请于2026年11月8日当天提交，需准备作业PDF和解题过程截图，上传课程平台。",
        "publishedAt": "2026-11-02T10:00:00+08:00",
        "sourceLabel": "高等数学课程群",
    },
    {
        "name": "relative-date-missing",
        "rawText": "下周五前把实验报告交到学习通。",
        "publishedAt": None,
        "sourceLabel": None,
    },
]


def extract(raw_text, published_at=None, source_label=None):
    messages = ne.build_extraction_messages(raw_text, "Asia/Shanghai", published_at, source_label)
    body = {
        "model": MODEL,
        "messages": messages,
        "thinking": {"type": "disabled"},
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    start = time.time()
    r = requests.post(BASE_URL, headers={"Authorization": f"Bearer {API_KEY}"}, json=body, timeout=TIMEOUT)
    ms = round((time.time() - start) * 1000)
    if r.status_code != 200:
        return None, ms, {"status": r.status_code, "text": r.text[:200]}
    data = r.json()
    choices = data.get("choices") or []
    content = choices[0]["message"]["content"] if choices else ""
    try:
        raw = ne.parse_model_json(content)
        draft = ne.normalize_draft(raw, raw_text, "Asia/Shanghai", published_at, source_label)
    except ValueError as e:
        return None, ms, {"parse_error": str(e), "content": content}
    return draft, ms, data.get("usage", {})


def main():
    if not API_KEY:
        print("未配置 DEEPSEEK_API_KEY，请先在 server/.env 填写。")
        return 1
    print(f"model={MODEL} base_url={BASE_URL}")
    for case in CASES:
        draft, ms, meta = extract(case["rawText"], case.get("publishedAt"), case.get("sourceLabel"))
        print("\n" + "=" * 70)
        print(f"case={case['name']} elapsedMs={ms} usage={json.dumps(meta, ensure_ascii=False)}")
        if draft is None:
            print("ERROR:", json.dumps(meta, ensure_ascii=False))
        else:
            print(json.dumps(draft, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
