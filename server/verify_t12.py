"""T12 通知提取与多轮补齐自测（无真实上游、无密钥、无网络调用）。

用 importlib 加载 server/main.py 与 notice_extraction.py，通过打桩 requests.post
伪造上游 JSON 输出，覆盖：访问凭证/限流、原文与发布时间/来源保留、截止精度规范化、
虚构时刻拒绝、priority/remainingMinutes 不臆测、缺项追问、相对日期追问、
多轮 answers 合并、模型非法输出回退人工录入草案。

运行方式（在 server 目录）：
    ./.venv/Scripts/python.exe verify_t12.py

不发起任何收费模型调用。
"""
import os
import sys
import json
import importlib

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import requests  # noqa: E402

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
import notice_extraction as ne  # noqa: E402

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


def model_answer(obj):
    """把模型输出的 dict 包成上游 content 文本（JSON 字符串）。"""
    return {"choices": [{"message": {"content": json.dumps(obj, ensure_ascii=False)}}], "usage": {}}


def call_extract(req_dict, auth=GOOD_AUTH):
    req = main.ExtractNoticeRequest(**req_dict)
    resp = main.extract_notice(req, StubRequest(auth))
    return resp, json.loads(resp.body)


# ---------------------------------------------------------------- 纯函数：基础校验
check("is_valid_offset_datetime 接受带偏移时间",
      ne.is_valid_offset_datetime("2026-11-06T23:59:00+08:00") and ne.is_valid_offset_datetime("2026-11-06T23:59:00Z"))
check("is_valid_offset_datetime 拒绝无偏移/仅日期",
      not ne.is_valid_offset_datetime("2026-11-06T23:59:00") and not ne.is_valid_offset_datetime("2026-11-06"))
check("is_valid_offset_datetime 对齐 T14：拒绝缺秒/超范围偏移/-00:00/超毫秒精度",
      not ne.is_valid_offset_datetime("2026-11-06T20:00+08:00")
      and not ne.is_valid_offset_datetime("2026-11-06T20:00:00-00:00")
      and not ne.is_valid_offset_datetime("2026-11-06T20:00:00+15:00")
      and not ne.is_valid_offset_datetime("2026-11-06T20:00:00.123456+08:00"))
check("is_valid_offset_datetime 对齐 T14：接受标准时间与毫秒精度",
      ne.is_valid_offset_datetime("2026-11-06T20:00:00+08:00")
      and ne.is_valid_offset_datetime("2026-11-06T20:00:00.123Z"))
check("is_valid_offset_datetime 拒绝偏移分钟越界（+08:60/-13:60）",
      not ne.is_valid_offset_datetime("2026-11-06T20:00:00+08:60")
      and not ne.is_valid_offset_datetime("2026-11-06T20:00:00-13:60"))
check("is_valid_offset_datetime 接受 ±13:59 / ±14:00 边界",
      ne.is_valid_offset_datetime("2026-11-06T20:00:00+13:59")
      and ne.is_valid_offset_datetime("2026-11-06T20:00:00+14:00")
      and ne.is_valid_offset_datetime("2026-11-06T20:00:00-14:00"))
check("is_valid_offset_datetime 拒绝带首/尾空格的时间",
      not ne.is_valid_offset_datetime(" 2026-11-06T20:00:00+08:00")
      and not ne.is_valid_offset_datetime("2026-11-06T20:00:00+08:00 "))
check("is_valid_date 接受/拒绝边界",
      ne.is_valid_date("2026-11-08") and not ne.is_valid_date("2026-13-01") and not ne.is_valid_date("2026/11/08"))
check("_is_fabricated_time 识别 23:59/00:00，放过正常时刻与原文已写时刻",
      ne._is_fabricated_time("2026-11-06T23:59:00+08:00")
      and ne._is_fabricated_time("2026-11-06T00:00:00+08:00")
      and not ne._is_fabricated_time("2026-11-06T14:30:00+08:00")
      and not ne._is_fabricated_time("2026-11-06T23:58:00+08:00")
      and not ne._is_fabricated_time("2026-11-06T23:59:00+08:00", "请于23:59前提交"))
check("_is_fabricated_time 其他时钟线索不放行 23:59（如“答疑14:00”）",
      ne._is_fabricated_time("2026-11-06T23:59:00+08:00", "11月6日提交报告，答疑14:00"))
check("_is_fabricated_time 原文明写 0:00（单零）保留 exact",
      not ne._is_fabricated_time("2026-11-06T00:00:00+08:00", "11月6日0:00前提交"))
check("_is_fabricated_time 原文明写 0点00分（单零）保留 exact",
      not ne._is_fabricated_time("2026-11-06T00:00:00+08:00", "11月6日0点00分前提交"))
check("_is_fabricated_time 原文明写 00:00（双零）保留 exact",
      not ne._is_fabricated_time("2026-11-06T00:00:00+08:00", "11月6日00:00前提交"))

# ---------------------------------------------------------------- 纯函数：截止规范化
p, d, u = ne._normalize_deadline("exact", None, "2026-11-06T14:30:00+08:00")
check("exact + 正常时刻 -> exact", p == "exact" and d is None and u == "2026-11-06T14:30:00+08:00", (p, d, u))
p, d, u = ne._normalize_deadline("exact", None, "2026-11-06T23:59:00+08:00")
check("exact + 23:59（原文无时刻）-> 降级 date_only", p == "date_only" and d == "2026-11-06" and u is None, (p, d, u))
p, d, u = ne._normalize_deadline("exact", None, "2026-11-06T23:59:00+08:00", "请于11月6日23:59前提交")
check("exact + 23:59（原文写了 23:59）-> 保留 exact", p == "exact" and d is None and u == "2026-11-06T23:59:00+08:00", (p, d, u))
p, d, u = ne._normalize_deadline("date_only", "2026-11-08", "2026-11-08T00:00:00+08:00")
check("date_only + 有效日期 -> date_only 且清空 dueAt", p == "date_only" and d == "2026-11-08" and u is None, (p, d, u))
p, d, u = ne._normalize_deadline("unknown", "2026-11-08", None)
check("unknown -> unknown 清空日期", p == "unknown" and d is None and u is None, (p, d, u))
p, d, u = ne._normalize_deadline(None, None, "2026-11-06T14:30:00+08:00")
check("精度缺失 -> 按字段推断 exact", p == "exact" and u == "2026-11-06T14:30:00+08:00", (p, d, u))

# ---------------------------------------------------------------- 纯函数：解析
check("parse_model_json 解析代码块包裹的 JSON",
      ne.parse_model_json('```json\n{"title":"a"}\n```') == {"title": "a"})
check("parse_model_json 解析夹带文字的 JSON",
      ne.parse_model_json('好的，结果是 {"title":"a"} 就这些') == {"title": "a"})
try:
    ne.parse_model_json("完全没有 JSON")
    check("parse_model_json 无 JSON -> 抛 ValueError", False)
except ValueError:
    check("parse_model_json 无 JSON -> 抛 ValueError", True)

# ---------------------------------------------------------------- 纯函数：规范化
raw_text = "数据库实验报告请于2026年11月6日23:59前提交，材料包括PDF报告和源代码，上传学习通。"
draft = ne.normalize_draft({
    "title": "提交数据库实验报告", "course": "数据库", "kind": "report",
    "deadlinePrecision": "exact", "dueAt": "2026-11-06T23:59:00+08:00", "deadlineDate": None,
    "submissionChannel": "学习通", "priority": "high", "remainingMinutes": 120,
    "materials": ["PDF 报告", "源代码"],
}, raw_text, published_at="2026-11-01T09:00:00+08:00", source_label="数据库课程群")
check("rawText 永不被模型改写", draft["notice"]["rawText"] == raw_text)
check("priority/remainingMinutes 强制为 null（不臆测）",
      draft["task"]["priority"] is None and draft["task"]["remainingMinutes"] is None)
check("原文写了 23:59 -> 保留 exact 不降级",
      draft["task"]["deadlinePrecision"] == "exact" and draft["task"]["dueAt"] == "2026-11-06T23:59:00+08:00")
check("材料 -> checklistItems pending",
      [i["label"] for i in draft["checklistItems"]] == ["PDF 报告", "源代码"]
      and all(i["state"] == "pending" for i in draft["checklistItems"]))
check("发布时间/来源被保留", draft["notice"]["publishedAt"] == "2026-11-01T09:00:00+08:00"
      and draft["notice"]["sourceLabel"] == "数据库课程群")
check("字段齐全 -> 无缺项追问", draft["missingFields"] == [] and draft["clarification"] == [])

draft = ne.normalize_draft({"title": "交作业", "deadlinePrecision": "unknown"}, "周五交作业")
check("缺截止 -> missingFields 含 deadline 且生成追问",
      "deadline" in draft["missingFields"] and any(c["field"] == "deadline" for c in draft["clarification"]))
check("相对日期+未知发布时间 -> 追问提及发布时间",
      any("发布时间" in c["question"] for c in draft["clarification"] if c["field"] == "deadline"))

draft = ne.normalize_draft({"title": "", "kind": "not-a-kind"}, "某通知")
check("非法 kind -> null；缺标题 -> 追问 title",
      draft["task"]["kind"] is None and any(c["field"] == "title" for c in draft["clarification"]))
draft = ne.normalize_draft({"title": "x", "kind": [], "deadlinePrecision": "unknown"}, "某通知")
check("模型 kind=[] -> 安全降级 null 而非 TypeError/500", draft["task"]["kind"] is None, draft["task"]["kind"])
draft = ne.normalize_draft({"title": "x", "kind": {}, "deadlinePrecision": "unknown"}, "某通知")
check("模型 kind={} -> 安全降级 null 而非 TypeError/500", draft["task"]["kind"] is None, draft["task"]["kind"])

# ---------------------------------------------------------------- 纯函数：多轮合并
draft = ne.empty_draft("周五交作业")
check("empty_draft 缺 title+deadline 双追问",
      set(draft["missingFields"]) == {"title", "deadline"} and len(draft["clarification"]) == 2)
ne.apply_answers(draft, [{"field": "title", "value": "交作业"}, {"field": "deadline", "value": "2026-11-08"}])
check("answers 合并 title+deadline -> 仅 date_only 且无缺项",
      draft["task"]["title"] == "交作业" and draft["task"]["deadlinePrecision"] == "date_only"
      and draft["task"]["deadlineDate"] == "2026-11-08" and draft["missingFields"] == [])
ne.apply_answers(draft, [{"field": "deadline", "value": "2026-11-08T20:00:00+08:00"}])
check("answers 改为精确时刻 -> exact",
      draft["task"]["deadlinePrecision"] == "exact" and draft["task"]["dueAt"] == "2026-11-08T20:00:00+08:00")
_pd = ne.empty_draft("周五交作业")
ne.apply_answers(_pd, [{"field": "publishedAt", "value": "2026-11-02T10:00:00+08:00"}])
ne.apply_answers(_pd, [{"field": "publishedAt", "value": "2026-11-02T10:00:00+08:00"},
                       {"field": "publishedAt", "value": None}])
check("累计 answers 最后值 null 清空 publishedAt", _pd["notice"]["publishedAt"] is None, _pd["notice"]["publishedAt"])
ne.apply_answers(_pd, [{"field": "publishedAt", "value": "2026-11-02T10:00:00+08:00"},
                       {"field": "publishedAt", "value": ""}])
check("累计 answers 最后值空串清空 publishedAt", _pd["notice"]["publishedAt"] is None, _pd["notice"]["publishedAt"])
_d2 = ne.empty_draft("某通知")
ne.apply_answers(_d2, [{"field": "deadline", "value": "2026-11-06T20:00:00+08:60"}])
check("deadline 回答偏移分钟越界 -> unknown 待补充", _d2["task"]["deadlinePrecision"] == "unknown", _d2["task"])
ne.apply_answers(_d2, [{"field": "publishedAt", "value": " 2026-11-06T20:00:00+08:00"}])
check("publishedAt 回答带前导空格 -> 清空 null", _d2["notice"]["publishedAt"] is None, _d2["notice"])
_d3 = ne.normalize_draft({"title": "x", "deadlinePrecision": "exact", "dueAt": "2026-11-06T20:00:00+08:00 "}, "某通知")
check("模型 dueAt 带尾空格 -> 安全降级而非保留", _d3["task"]["deadlinePrecision"] == "unknown", _d3["task"])

# 累计 answers：跨轮保留用户修改（模型每轮仍输出原标题/原截止）
_model_out = {"title": "原标题", "deadlinePrecision": "exact", "dueAt": "2026-11-06T23:59:00+08:00"}
d1 = ne.normalize_draft(_model_out, "报告11月6日23:59前交",
                        answers=[{"field": "title", "value": "用户修改的标题"},
                                 {"field": "deadline", "value": "2026-11-08"}])
cumulative = [{"field": "title", "value": "用户修改的标题"},
              {"field": "deadline", "value": "2026-11-08"},
              {"field": "course", "value": "数学"}]
d2 = ne.normalize_draft(_model_out, "报告11月6日23:59前交", draft=d1, answers=cumulative)
check("第 2 轮累计 answers 保住标题/截止并新增 course",
      d2["task"]["title"] == "用户修改的标题" and d2["task"]["deadlinePrecision"] == "date_only"
      and d2["task"]["deadlineDate"] == "2026-11-08" and d2["task"]["course"] == "数学", d2["task"])
d3 = ne.normalize_draft(_model_out, "报告11月6日23:59前交", draft=d2, answers=cumulative)
check("第 3 轮累计 answers 仍保住用户修改",
      d3["task"]["title"] == "用户修改的标题" and d3["task"]["course"] == "数学"
      and d3["task"]["deadlineDate"] == "2026-11-08", d3["task"])
msgs = ne.build_extraction_messages("某通知", "Asia/Shanghai")
check("build_extraction_messages 含时区上下文",
      any("Asia/Shanghai" in m["content"] for m in msgs if m["role"] == "user"))

# ---------------------------------------------------------------- 端点：访问凭证/限流
install_post(json_body=model_answer({"title": "x", "deadlinePrecision": "unknown"}))
clear_captured()
resp, body = call_extract({"rawText": "hi"}, None)
check("缺 Authorization -> 401 且不调上游",
      resp.status_code == 401 and body["errorCode"] == "UNAUTHORIZED" and "url" not in captured, body)
clear_captured()
resp, body = call_extract({"rawText": "hi"}, "Bearer wrong")
check("错误凭证 -> 401 且不调上游",
      resp.status_code == 401 and body["errorCode"] == "UNAUTHORIZED" and "url" not in captured, body)

orig_allow = main.limiter.allow
main.limiter.allow = lambda k: False
clear_captured()
resp, body = call_extract({"rawText": "hi"}, GOOD_AUTH)
main.limiter.allow = orig_allow
check("限流 -> 429 且不调上游",
      resp.status_code == 429 and body["errorCode"] == "RATE_LIMITED" and "url" not in captured, body)

# ---------------------------------------------------------------- 端点：入参校验
resp, body = call_extract({"rawText": "   "}, GOOD_AUTH)
check("rawText 为空 -> 400 INVALID_REQUEST", resp.status_code == 400 and body["errorCode"] == "INVALID_REQUEST", body)
resp, body = call_extract({"rawText": "hi", "publishedAt": "2026-11-01 09:00"}, GOOD_AUTH)
check("publishedAt 非法 -> 400 INVALID_REQUEST", resp.status_code == 400 and body["errorCode"] == "INVALID_REQUEST", body)
resp, body = call_extract({"rawText": "hi", "timezone": "../etc"}, GOOD_AUTH)
check("timezone 非法 -> 400 INVALID_REQUEST", resp.status_code == 400 and body["errorCode"] == "INVALID_REQUEST", body)
install_post(json_body=model_answer({"title": "x", "deadlinePrecision": "unknown"}))
resp, body = call_extract({"rawText": "hi", "answers": [{"field": "kind", "value": []}]}, GOOD_AUTH)
check("回答 kind=[] -> 400 INVALID_REQUEST 而非 500", resp.status_code == 400 and body["errorCode"] == "INVALID_REQUEST", body)
resp, body = call_extract({"rawText": "hi", "answers": [{"field": "kind", "value": {}}]}, GOOD_AUTH)
check("回答 kind={} -> 400 INVALID_REQUEST 而非 500", resp.status_code == 400 and body["errorCode"] == "INVALID_REQUEST", body)
install_post(json_body=model_answer({"title": "x", "kind": [], "deadlinePrecision": "unknown"}))
resp, body = call_extract({"rawText": "hi"}, GOOD_AUTH)
check("模型 kind=[] -> 200 且 kind null 而非 500", resp.status_code == 200 and body["draft"]["task"]["kind"] is None, body)
install_post(json_body=model_answer({"title": "x", "kind": {}, "deadlinePrecision": "unknown"}))
resp, body = call_extract({"rawText": "hi"}, GOOD_AUTH)
check("模型 kind={} -> 200 且 kind null 而非 500", resp.status_code == 200 and body["draft"]["task"]["kind"] is None, body)

# ---------------------------------------------------------------- 端点：正常提取
install_post(json_body=model_answer({
    "title": "提交数据库实验报告", "course": "数据库", "kind": "report",
    "deadlinePrecision": "exact", "dueAt": "2026-11-06T14:00:00+08:00",
    "submissionChannel": "学习通", "priority": "high", "remainingMinutes": 60,
    "materials": ["PDF 报告"],
}))
clear_captured()
resp, body = call_extract({
    "rawText": raw_text, "publishedAt": "2026-11-01T09:00:00+08:00", "sourceLabel": "数据库课程群",
}, GOOD_AUTH)
check("端点正常 -> 200 draft",
      resp.status_code == 200 and body["type"] == "draft" and body["degraded"] is False, body)
check("端点返回 rawText 与 priority null",
      body["draft"]["notice"]["rawText"] == raw_text and body["draft"]["task"]["priority"] is None)
check("端点请求带上 response_format=json_object 且关闭思考",
      captured["body"].get("response_format") == {"type": "json_object"}
      and captured["body"].get("thinking") == {"type": "disabled"})
check("端点 messages 含系统规则与原文",
      captured["body"]["messages"][0]["role"] == "system"
      and raw_text in captured["body"]["messages"][1]["content"])

# ---------------------------------------------------------------- 端点：非法模型输出回退
install_post(json_body={"choices": [{"message": {"content": "抱歉我没听清"}}], "usage": {}})
resp, body = call_extract({"rawText": "某通知"}, GOOD_AUTH)
check("模型输出非 JSON -> 200 降级草案（人工录入）",
      resp.status_code == 200 and body["type"] == "draft" and body["degraded"] is True, body)
check("降级草案保留原文并双追问",
      body["draft"]["notice"]["rawText"] == "某通知"
      and set(body["draft"]["missingFields"]) == {"title", "deadline"}, body["draft"])

# ---------------------------------------------------------------- 端点：多轮合并
install_post(json_body=model_answer({"title": "交作业", "deadlinePrecision": "unknown"}))
resp, body = call_extract({"rawText": "周五交作业"}, GOOD_AUTH)
first_draft = body["draft"]
check("首轮相对日期 -> 追问提及发布时间",
      any("发布时间" in c["question"] for c in first_draft["clarification"]))
install_post(json_body=model_answer({"title": "交作业", "deadlinePrecision": "unknown"}))
resp, body = call_extract({
    "rawText": "周五交作业",
    "draft": first_draft,
    "answers": [{"field": "publishedAt", "value": "2026-11-02T10:00:00+08:00"},
                {"field": "deadline", "value": "2026-11-07"}],
}, GOOD_AUTH)
check("多轮 answers 合并 -> deadline date_only 且不再追问",
      body["draft"]["task"]["deadlinePrecision"] == "date_only"
      and body["draft"]["task"]["deadlineDate"] == "2026-11-07"
      and body["draft"]["notice"]["publishedAt"] == "2026-11-02T10:00:00+08:00"
      and "deadline" not in body["draft"]["missingFields"], body["draft"])

# 端点：先填发布时间，后用 null 撤回
install_post(json_body=model_answer({"title": "交作业", "deadlinePrecision": "unknown"}))
resp, body = call_extract({
    "rawText": "周五交作业",
    "answers": [{"field": "publishedAt", "value": "2026-11-02T10:00:00+08:00"}],
}, GOOD_AUTH)
_first = body["draft"]
check("端点设置 publishedAt 后保留",
      _first["notice"]["publishedAt"] == "2026-11-02T10:00:00+08:00", _first["notice"])
install_post(json_body=model_answer({"title": "交作业", "deadlinePrecision": "unknown"}))
resp, body = call_extract({
    "rawText": "周五交作业",
    "draft": _first,
    "answers": [{"field": "publishedAt", "value": "2026-11-02T10:00:00+08:00"},
                {"field": "publishedAt", "value": None}],
}, GOOD_AUTH)
check("端点累计 answers 撤回 publishedAt -> null 且重问发布时间",
      body["draft"]["notice"]["publishedAt"] is None
      and any(c["field"] == "deadline" and "发布时间" in c["question"] for c in body["draft"]["clarification"]), body["draft"])

# ---------------------------------------------------------------- 端点/纯函数：畸形上一轮草案安全降级
install_post(json_body=model_answer({"title": "交作业", "deadlinePrecision": "unknown"}))
resp, body = call_extract({"rawText": "周五交作业", "draft": {"notice": "bad", "task": 1, "checklistItems": "x"}}, GOOD_AUTH)
check("畸形 draft -> 200 重新提取而非 500",
      resp.status_code == 200 and body["type"] == "draft"
      and body["draft"]["notice"]["rawText"] == "周五交作业"
      and isinstance(body["draft"]["checklistItems"], list)
      and body["draft"]["task"]["title"] == "交作业", body["draft"])

draft = ne.normalize_draft({"title": "x", "deadlinePrecision": "unknown"}, "某通知",
                           draft={"notice": "bad", "task": None, "checklistItems": {}})
check("normalize_draft 畸形 prior -> 重新提取且结构完整",
      draft["notice"]["rawText"] == "某通知" and isinstance(draft["checklistItems"], list)
      and draft["task"]["title"] == "x", draft)

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
