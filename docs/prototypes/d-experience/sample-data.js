/* Generated from fixtures/development/d-notice-samples.json. */
window.DExperienceSamples = {
  "fixtureFormatVersion": "d-experience-1",
  "synthetic": true,
  "usage": "development-only",
  "modelExecuted": false,
  "interviewsConducted": 0,
  "timezone": "Asia/Shanghai",
  "description": "D 的交互开发样例。全部人工构造，不是真实脱敏通知、正式业务快照、模型测试结果或留出集。drafts 是页面展示投影，不代替 C 的完整实体与 B 的 Proposal 协议。",
  "samples": [
    {
      "id": "D-001",
      "label": "明确截止时间",
      "notice": {
        "id": "synthetic-notice-d001",
        "sourceLabel": "数据库课程群（合成）",
        "publishedAt": "2026-10-27T09:00:00+08:00",
        "importedAt": "2026-10-27T10:00:00+08:00",
        "rawText": "数据库课程通知：请于2026年11月6日18:00前在学习通提交实验三报告PDF和源代码ZIP。"
      },
      "expectedAction": "create",
      "drafts": [
        {
          "title": "实验三报告",
          "course": "数据库",
          "kind": "report",
          "deadlinePrecision": "exact",
          "deadlineDate": null,
          "dueAt": "2026-11-06T18:00:00+08:00",
          "timezone": "Asia/Shanghai",
          "submissionChannel": "学习通",
          "priority": null,
          "remainingMinutes": null,
          "materials": [
            "实验三报告PDF",
            "源代码ZIP"
          ],
          "evidenceQuote": "2026年11月6日18:00前在学习通提交实验三报告PDF和源代码ZIP"
        }
      ],
      "questions": [],
      "mustNot": [
        "确认前新增任务",
        "把原文替换为模型摘要",
        "把准备完成说成平台已收到"
      ]
    },
    {
      "id": "D-002",
      "label": "只有日期，没有时刻",
      "notice": {
        "id": "synthetic-notice-d002",
        "sourceLabel": "高等数学课程群（合成）",
        "publishedAt": "2026-10-27T09:10:00+08:00",
        "importedAt": "2026-10-27T10:01:00+08:00",
        "rawText": "高等数学：第八周习题请于2026年11月8日当天提交纸质版，具体截止时刻未说明。"
      },
      "expectedAction": "create",
      "drafts": [
        {
          "title": "第八周习题",
          "course": "高等数学",
          "kind": "assignment",
          "deadlinePrecision": "date_only",
          "deadlineDate": "2026-11-08",
          "dueAt": null,
          "timezone": "Asia/Shanghai",
          "submissionChannel": "纸质版",
          "priority": null,
          "remainingMinutes": null,
          "materials": [
            "纸质习题"
          ],
          "evidenceQuote": "2026年11月8日当天提交纸质版，具体截止时刻未说明"
        }
      ],
      "questions": [
        "如需精确到时刻的安排或提醒，再向用户确认具体时间。"
      ],
      "mustNot": [
        "补成23:59",
        "将提醒时间当正式截止时间"
      ]
    },
    {
      "id": "D-003",
      "label": "相对日期缺少发布时间",
      "notice": {
        "id": "synthetic-notice-d003",
        "sourceLabel": "数据库转发通知（合成）",
        "publishedAt": null,
        "importedAt": "2026-10-27T10:02:00+08:00",
        "rawText": "数据库：下周五交实验四报告PDF，提交渠道稍后通知。"
      },
      "expectedAction": "clarify_date",
      "drafts": [
        {
          "title": "实验四报告",
          "course": "数据库",
          "kind": "report",
          "deadlinePrecision": "unknown",
          "deadlineDate": null,
          "dueAt": null,
          "timezone": "Asia/Shanghai",
          "submissionChannel": null,
          "priority": null,
          "remainingMinutes": null,
          "materials": [
            "实验四报告PDF"
          ],
          "evidenceQuote": "下周五交实验四报告PDF，提交渠道稍后通知"
        }
      ],
      "questions": [
        "这条通知是哪一天发布的？也可以直接填写明确的截止日期。"
      ],
      "mustNot": [
        "用导入时间解释下周五",
        "编造提交渠道",
        "将未知工时写成0"
      ]
    },
    {
      "id": "D-004",
      "label": "一条通知，两个事项",
      "notice": {
        "id": "synthetic-notice-d004",
        "sourceLabel": "软件工程课程群（合成）",
        "publishedAt": "2026-10-27T09:20:00+08:00",
        "importedAt": "2026-10-27T10:03:00+08:00",
        "rawText": "软件工程：2026年11月2日当天完成汇报报名；2026年11月9日20:00前在课程平台提交需求分析报告PDF。"
      },
      "expectedAction": "create",
      "drafts": [
        {
          "title": "汇报报名",
          "course": "软件工程",
          "kind": "registration",
          "deadlinePrecision": "date_only",
          "deadlineDate": "2026-11-02",
          "dueAt": null,
          "timezone": "Asia/Shanghai",
          "submissionChannel": null,
          "priority": null,
          "remainingMinutes": null,
          "materials": [],
          "evidenceQuote": "2026年11月2日当天完成汇报报名"
        },
        {
          "title": "需求分析报告",
          "course": "软件工程",
          "kind": "report",
          "deadlinePrecision": "exact",
          "deadlineDate": null,
          "dueAt": "2026-11-09T20:00:00+08:00",
          "timezone": "Asia/Shanghai",
          "submissionChannel": "课程平台",
          "priority": null,
          "remainingMinutes": null,
          "materials": [
            "需求分析报告PDF"
          ],
          "evidenceQuote": "2026年11月9日20:00前在课程平台提交需求分析报告PDF"
        }
      ],
      "questions": [],
      "mustNot": [
        "合并成一个截止时间",
        "凭空增加报名材料",
        "不展示批量确认范围"
      ]
    },
    {
      "id": "D-005",
      "label": "补充通知，适用班级未确认",
      "notice": {
        "id": "synthetic-notice-d005",
        "sourceLabel": "数据库课程群（合成）",
        "publishedAt": "2026-10-28T09:00:00+08:00",
        "importedAt": "2026-10-28T09:05:00+08:00",
        "rawText": "补充通知：数据库1班实验三报告延至2026年11月10日18:00，增加运行截图；2班原截止时间与材料要求不变。"
      },
      "priorNoticeId": "synthetic-notice-d001",
      "userClass": null,
      "expectedAction": "clarify_target",
      "drafts": [],
      "questions": [
        "你属于1班还是2班？请先确认适用对象和原任务。"
      ],
      "expectedAfterClassConfirmation": {
        "class1": "对原任务展示旧值11月6日18:00、新值11月10日18:00和新增截图，确认后更新同一任务。",
        "class2": "原截止时间与材料要求保持不变。"
      },
      "mustNot": [
        "未经确认覆盖原任务",
        "给2班一起延期",
        "另建重复的实验三报告",
        "抹去原提交历史"
      ]
    }
  ]
};
