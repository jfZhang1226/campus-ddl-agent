"""T12 通知提取与多轮补齐：纯逻辑模块（无网络、无模型依赖）。

本模块把 DeepSeek 的结构化输出校验、规范化成 Notice/Task/ChecklistItem 的
“可编辑草案”，并补上缺项追问（clarification）与多轮合并。字段遵循
docs/data-contract.md 与 docs/session-message-contract.md；正式保存仍由客户端在
T13/T16 完成，本模块只产出草案，不写入业务快照、不生成 id/importedAt/contentHash。

设计边界：
- 草案是可编辑的中间态，不包含 Notice.id / importedAt / contentHash、
  Task.id / status / version / createdAt / updatedAt / noticeIds 等保存期字段。
- priority 与 remainingMinutes 只能由用户确认（T13/T16），本模块强制置 null。
- rawText 永不被模型改写；publishedAt / sourceLabel 以显式入参优先，其次模型建议。
"""

from __future__ import annotations

import copy
import json
import re
from datetime import date, datetime

DEFAULT_TIMEZONE = "Asia/Shanghai"

TASK_KINDS = {"assignment", "report", "registration", "other"}
DEADLINE_PRECISIONS = {"exact", "date_only", "unknown"}

# 相对日期线索：用于在“只有周五/明天”且发布时间未知时生成更准确的追问。
_RELATIVE_DATE = re.compile(
    r"(今天|明天|后天|大后天|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]"
    r"|这周|本周|下周|下个?月|月底|月末|月初|几[天个]|下?周[一二三四五六日天])"
)

# 带偏移的 ISO 8601（对齐 T14 DateRules）：秒必填、小数最多 3 位（毫秒），可 Z 结尾。
_OFFSET_DATETIME = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$"
)
_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TZ = re.compile(r"^[A-Za-z_]+(?:/[A-Za-z_+\-0-9]+)*$")

SYSTEM_PROMPT = """你是校园通知提取助手。把用户提供的通知原文提取成结构化 JSON，只输出一个 JSON 对象，不要输出其他文字或 Markdown。

必须遵守以下规则：
1. 不改写通知原文；原文由调用方提供，你不需要在结果里重复输出原文。
2. 未知或不适用的单值用 null，不要用空字符串、0 或“未知”代替。
3. deadlinePrecision 只有三种：exact（有明确截止时刻，用 dueAt）、date_only（只知日期，用 deadlineDate）、unknown（无截止信息）。
4. 只写了日期、没有具体时刻时，deadlinePrecision 用 date_only，不要补成 23:59 或 00:00 的虚构时刻。
5. “当天提交”“周五交”这类相对日期，若没有明确日期，就保持 deadlinePrecision=unknown，不要自行推算。
6. priority 与 remainingMinutes 必须始终为 null：它们只能由用户确认，模型不得臆测。
7. dueAt/publishedAt 用带时区偏移的 ISO 8601，例如 2026-11-06T23:59:00+08:00；deadlineDate 用 YYYY-MM-DD。原文只给了时刻、没有时区偏移时，按调用方提供的时区解释。
8. kind 取值只允许 assignment/report/registration/other，不确定时用 null。
9. materials 是材料名称数组（可为空数组），例如 ["PDF 报告","源代码"]。
10. 课程名不确定时 course 用 null；提交渠道不确定时 submissionChannel 用 null。

输出 JSON 结构（以下字段全部都要出现）：
{
  "title": "任务标题或 null",
  "course": "课程名或 null",
  "kind": "assignment|report|registration|other|null",
  "deadlinePrecision": "exact|date_only|unknown",
  "deadlineDate": "YYYY-MM-DD 或 null",
  "dueAt": "ISO 8601 或 null",
  "submissionChannel": "渠道或 null",
  "sourceLabel": "来源标签或 null",
  "publishedAt": "ISO 8601 或 null",
  "materials": []
}"""


# --------------------------------------------------------------------------- 基础校验

def is_valid_offset_datetime(value) -> bool:
    """带明确 UTC 偏移的 ISO 8601 时间（对齐 T14 DateRules.isOffsetTimestamp）。

    秒必填、小数最多 3 位（毫秒）、数字偏移 ≤ ±14:00 且分钟 0–59、
    拒绝表示未知偏移的 -00:00；拒绝无偏移裸时间与带首尾空白的时间（不裁剪校验副本）。
    """
    if not isinstance(value, str) or not value:
        return False
    s = value  # 不裁剪：首尾空白视为非法，避免“校验裁了、输出仍保留原串”
    if not _OFFSET_DATETIME.fullmatch(s):
        return False
    if not s.endswith("Z"):
        offset = s[-6:]  # 形如 +HH:MM / -HH:MM（正则已保证）
        sign, hh, mm = offset[0], int(offset[1:3]), int(offset[4:6])
        if mm > 59:
            return False  # 偏移分钟必须 0–59（拒绝 +08:60 等）
        if sign == "-" and hh == 0 and mm == 0:
            return False  # -00:00 表示未知偏移
        if hh * 60 + mm > 14 * 60:
            return False  # 偏移超过 ±14:00
    normalized = s[:-1] + "+00:00" if s.endswith("Z") else s
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return False
    return dt.tzinfo is not None and dt.utcoffset() is not None


def is_valid_date(value) -> bool:
    if not isinstance(value, str) or not _DATE_ONLY.fullmatch(value.strip()):
        return False
    try:
        date.fromisoformat(value.strip())
        return True
    except ValueError:
        return False


def is_valid_timezone(value) -> bool:
    return isinstance(value, str) and bool(_TZ.fullmatch(value.strip()))


def contains_relative_date(raw_text: str) -> bool:
    return bool(raw_text) and bool(_RELATIVE_DATE.search(raw_text))


def _has_specific_clock(raw_text: str, hour: str, minute: str) -> bool:
    """原文是否明确写了与 dueAt 相同的时刻（如 23:59 / 00:00）。

    按数值比较小时与分钟，兼容单零/双零等价写法（0:00 与 00:00 同值、0点00分），
    不把其他时钟线索（例如“答疑14:00”）当作截止 23:59 的依据。
    """
    if not raw_text:
        return False
    target_h, target_m = int(hour), int(minute)
    for m in re.finditer(r"(\d{1,2})[:：点时](\d{1,2})", raw_text):
        if int(m.group(1)) == target_h and int(m.group(2)) == target_m:
            return True
    return False


def _is_fabricated_time(due_at: str, raw_text: str = "") -> bool:
    """把“当天到期”补成 23:59 或 00:00 视为模型虚构，应降级为 date_only。

    仅当原文没有明确写出同一时刻（23:59 / 00:00）时才视为虚构；
    原文真的写了 23:59 时保留为 exact，不降级。其他时钟线索（如“答疑14:00”）
    不再放行虚构的 23:59。
    """
    if not isinstance(due_at, str) or "T" not in due_at:
        return False
    time_and_zone = due_at.split("T", 1)[1]
    for sep in ("Z", "+", "-"):
        idx = time_and_zone.find(sep)
        if idx >= 0:
            time_and_zone = time_and_zone[:idx]
            break
    parts = time_and_zone.split(":")
    if len(parts) < 2:
        return False
    hour, minute = parts[0], parts[1]
    if not ((hour == "00" and minute == "00") or (hour == "23" and minute == "59")):
        return False
    return not _has_specific_clock(raw_text, hour, minute)


# --------------------------------------------------------------------------- 解析与规范化

def parse_model_json(text) -> dict:
    """尽力从模型输出中取出一个 JSON 对象（对应“最多做一次结构修复”）。失败抛 ValueError。"""
    if not isinstance(text, str):
        raise ValueError("模型输出不是文本")
    s = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", s, re.DOTALL)
    if fenced:
        s = fenced.group(1).strip()
    try:
        obj = json.loads(s)
    except ValueError:
        start = s.find("{")
        if start < 0:
            raise ValueError("模型输出中没有 JSON 对象")
        depth = 0
        end = -1
        for i in range(start, len(s)):
            if s[i] == "{":
                depth += 1
            elif s[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end < 0:
            raise ValueError("模型输出的 JSON 对象未闭合")
        obj = json.loads(s[start:end + 1])
    if not isinstance(obj, dict):
        raise ValueError("模型输出不是 JSON 对象")
    return obj


def _normalize_deadline(precision, deadline_date, due_at, raw_text: str = ""):
    """按 data-contract 第 5 节规范化截止字段，返回 (precision, deadlineDate, dueAt)。"""
    valid_date = is_valid_date(deadline_date)
    valid_due = is_valid_offset_datetime(due_at)
    if precision == "exact":
        if valid_due and not _is_fabricated_time(due_at, raw_text):
            return ("exact", None, due_at)
        if valid_due:
            return ("date_only", due_at[:10], None)
        if valid_date:
            return ("date_only", deadline_date, None)
        return ("unknown", None, None)
    if precision == "date_only":
        if valid_date:
            return ("date_only", deadline_date, None)
        if valid_due:
            return ("date_only", due_at[:10], None)
        return ("unknown", None, None)
    if precision == "unknown":
        return ("unknown", None, None)
    # 精度缺失或非法：按字段推断
    if valid_due and not _is_fabricated_time(due_at, raw_text):
        return ("exact", None, due_at)
    if valid_due:
        return ("date_only", due_at[:10], None)
    if valid_date:
        return ("date_only", deadline_date, None)
    return ("unknown", None, None)


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _optional_text(value):
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _new_draft(raw_text: str, timezone: str) -> dict:
    return {
        "schemaVersion": 1,
        "kind": "notice_draft",
        "notice": {
            "rawText": raw_text,
            "sourceLabel": None,
            "publishedAt": None,
            "timezone": timezone,
        },
        "task": {
            "title": "",
            "course": None,
            "kind": None,
            "deadlinePrecision": "unknown",
            "deadlineDate": None,
            "dueAt": None,
            "timezone": timezone,
            "priority": None,
            "submissionChannel": None,
            "remainingMinutes": None,
        },
        "checklistItems": [],
        "missingFields": [],
        "clarification": [],
    }


def compute_missing(draft: dict):
    """返回 (missingFields, clarification)：标题与截止是唯一会触发追问的字段，其余缺项标记 null 未知。"""
    missing = []
    clarification = []
    task = draft.get("task", {})
    notice = draft.get("notice", {})
    if not _text(task.get("title")):
        missing.append("title")
        clarification.append({"field": "title", "question": "这份通知对应什么任务？请给一个标题。"})
    if task.get("deadlinePrecision") == "unknown":
        missing.append("deadline")
        if contains_relative_date(notice.get("rawText", "")) and not notice.get("publishedAt"):
            clarification.append({
                "field": "deadline",
                "question": "通知里只有相对日期（如“周五”），且发布时间未知。请补充发布时间，或直接选择截止日期。",
            })
        else:
            clarification.append({
                "field": "deadline",
                "question": "这份通知的截止时间是什么？暂不确定也可以先保存为待补充任务。",
            })
    return missing, clarification


def _recompute(draft: dict) -> dict:
    missing, clarification = compute_missing(draft)
    draft["missingFields"] = missing
    draft["clarification"] = clarification
    return draft


def empty_draft(raw_text: str, timezone: str = DEFAULT_TIMEZONE, published_at=None, source_label=None) -> dict:
    draft = _new_draft(raw_text, timezone)
    if is_valid_offset_datetime(published_at):
        draft["notice"]["publishedAt"] = published_at
    draft["notice"]["sourceLabel"] = _optional_text(source_label)
    return _recompute(draft)


def _deadline_from_answer(value):
    # 用户的回答是显式选择，即使 23:59/00:00 也按其选择保留为 exact，不降级。
    if is_valid_offset_datetime(value):
        return ("exact", None, value)
    if isinstance(value, str) and is_valid_date(value.strip()):
        return ("date_only", value.strip(), None)
    return ("unknown", None, None)


def apply_answers(draft: dict, answers) -> dict:
    """把用户的结构化回答合并进草案（确定性，不调用模型）。就地修改并返回同一草案。"""
    if not isinstance(answers, list):
        return _recompute(draft)
    task = draft.setdefault("task", {})
    notice = draft.setdefault("notice", {})
    for item in answers:
        if not isinstance(item, dict):
            continue
        field = _text(item.get("field"))
        value = item.get("value")
        if field == "title":
            task["title"] = _text(value)
        elif field == "course":
            task["course"] = _optional_text(value)
        elif field == "kind":
            task["kind"] = value if (isinstance(value, str) and value in TASK_KINDS) else None
        elif field == "deadline":
            prec, dd, due = _deadline_from_answer(value)
            task["deadlinePrecision"] = prec
            task["deadlineDate"] = dd
            task["dueAt"] = due
        elif field == "publishedAt":
            # 最后值生效：合法时间覆盖，null/空串/非法值显式清空（不静默保留旧锚点）
            notice["publishedAt"] = value if is_valid_offset_datetime(value) else None
        elif field == "sourceLabel":
            notice["sourceLabel"] = _optional_text(value)
        elif field == "submissionChannel":
            task["submissionChannel"] = _optional_text(value)
    return _recompute(draft)


def validate_answers(answers) -> None:
    """校验客户端 answers；非法时抛 ValueError，由端点转 INVALID_REQUEST。

    仅拦截会触发类型异常/裸 500 的取值：kind 的 value 必须是字符串或 null。
    其余字段与非对象条目保持宽松（apply_answers 安全忽略）。
    """
    if answers is None:
        return
    if not isinstance(answers, list):
        raise ValueError("answers 必须是数组")
    for item in answers:
        if not isinstance(item, dict):
            continue  # 非对象条目按既有约定忽略
        if item.get("field") == "kind":
            value = item.get("value")
            if value is not None and not isinstance(value, str):
                raise ValueError("answers 中 kind 取值必须是字符串或 null")


def _is_prior_draft(value) -> bool:
    """回传的上一轮草案必须是结构完整的对象，否则视为无上一轮、重新提取。"""
    return (isinstance(value, dict) and isinstance(value.get("notice"), dict)
            and isinstance(value.get("task"), dict) and isinstance(value.get("checklistItems"), list))


def _draft_for_prompt(draft: dict) -> dict:
    task = draft.get("task", {})
    notice = draft.get("notice", {})
    return {
        "title": task.get("title"),
        "course": task.get("course"),
        "kind": task.get("kind"),
        "deadlinePrecision": task.get("deadlinePrecision"),
        "deadlineDate": task.get("deadlineDate"),
        "dueAt": task.get("dueAt"),
        "submissionChannel": task.get("submissionChannel"),
        "sourceLabel": notice.get("sourceLabel"),
        "publishedAt": notice.get("publishedAt"),
        "materials": [i.get("label") for i in draft.get("checklistItems", []) if isinstance(i, dict)],
    }


def build_extraction_messages(raw_text: str, timezone: str, published_at=None, source_label=None,
                              draft=None, answers=None) -> list:
    """构造给 DeepSeek 的 messages；多轮时把上一轮草案与用户回答作为上下文，便于模型细化。"""
    parts = [f"通知原文：\n{raw_text}", f"时区：{timezone}"]
    if published_at:
        parts.append(f"已知发布时间：{published_at}")
    if source_label:
        parts.append(f"已知来源：{source_label}")
    if _is_prior_draft(draft):
        parts.append("上一轮已提取的草案：" + json.dumps(_draft_for_prompt(draft), ensure_ascii=False))
    if answers:
        parts.append("用户补充信息：" + json.dumps(answers, ensure_ascii=False))
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


def normalize_draft(raw, raw_text: str, timezone: str = DEFAULT_TIMEZONE, published_at=None,
                    source_label=None, draft=None, answers=None) -> dict:
    """把模型输出校验、规范化成草案。优先级：回答 > 显式入参 > 模型输出 > 上一轮草案 > null。"""
    if not isinstance(raw, dict):
        raw = {}
    prior = draft if _is_prior_draft(draft) else None
    result = copy.deepcopy(prior) if prior is not None else _new_draft(raw_text, timezone)
    result["notice"]["rawText"] = raw_text
    result["notice"]["timezone"] = timezone
    result["task"]["timezone"] = timezone

    # 模型可提取字段：模型给了非空值就覆盖；否则保留上一轮
    if _text(raw.get("title")):
        result["task"]["title"] = _text(raw.get("title"))
    if _optional_text(raw.get("course")) is not None:
        result["task"]["course"] = _optional_text(raw.get("course"))
    if _optional_text(raw.get("submissionChannel")) is not None:
        result["task"]["submissionChannel"] = _optional_text(raw.get("submissionChannel"))
    kind = raw.get("kind")
    if isinstance(kind, str) and kind in TASK_KINDS:
        result["task"]["kind"] = kind

    # sourceLabel / publishedAt：模型建议仅在无显式入参时采用
    if source_label is None and _optional_text(raw.get("sourceLabel")) is not None:
        result["notice"]["sourceLabel"] = _optional_text(raw.get("sourceLabel"))
    if published_at is None and is_valid_offset_datetime(raw.get("publishedAt")):
        result["notice"]["publishedAt"] = raw.get("publishedAt")
    # 显式入参覆盖模型
    if published_at is not None:
        if is_valid_offset_datetime(published_at):
            result["notice"]["publishedAt"] = published_at
        else:
            result["notice"]["publishedAt"] = None
    if source_label is not None:
        result["notice"]["sourceLabel"] = _optional_text(source_label)

    # 截止字段
    prec, dd, due = _normalize_deadline(raw.get("deadlinePrecision"), raw.get("deadlineDate"), raw.get("dueAt"), raw_text)
    if prec != "unknown":
        result["task"]["deadlinePrecision"] = prec
        result["task"]["deadlineDate"] = dd
        result["task"]["dueAt"] = due
    elif prior is None or result["task"].get("deadlinePrecision") in (None, "unknown"):
        result["task"]["deadlinePrecision"] = "unknown"
        result["task"]["deadlineDate"] = None
        result["task"]["dueAt"] = None

    # 材料清单
    mats = raw.get("materials")
    if isinstance(mats, list):
        items = []
        for m in mats:
            label = _optional_text(m)
            if label:
                items.append({"label": label, "state": "pending"})
        if items:
            result["checklistItems"] = items

    # 用户确认字段绝不模型臆测
    result["task"]["priority"] = None
    result["task"]["remainingMinutes"] = None

    return apply_answers(result, answers)
