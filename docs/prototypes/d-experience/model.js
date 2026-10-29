(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DExperienceModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return y >= 1000 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }
  function validateDraft(draft) {
    if (!draft || typeof draft.title !== 'string' || !draft.title.trim()) return '请填写任务名称。';
    if (draft.deadlinePrecision === 'unknown') {
      if (draft.deadlineDate !== null || draft.dueAt !== null) return '待补充日期不能带有确定的截止时间。';
    } else if (draft.deadlinePrecision === 'date_only') {
      if (!validDate(draft.deadlineDate) || draft.dueAt !== null) return '请填写有效日期，保留具体时刻未知。';
    } else if (draft.deadlinePrecision === 'exact') {
      const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:00\+08:00$/.exec(draft.dueAt || '');
      if (!match || !validDate(match[1]) || draft.deadlineDate !== null) return '请填写有效的截止日期和时刻。';
    } else return '截止日期精度无效。';
    return null;
  }
  function deadlineLabel(draft) {
    if (draft.deadlinePrecision === 'unknown') return '截止日期待补充';
    if (validateDraft({ ...draft, title: draft.title || 'task' })) return '请补齐有效的截止日期与时刻';
    if (draft.deadlinePrecision === 'date_only') return draft.deadlineDate + ' 当天到期 · 时刻待确认';
    return draft.dueAt.slice(0, 10) + ' ' + draft.dueAt.slice(11, 16) + ' 截止';
  }
  function makeSession(sample, token) {
    return { token, state: sample.expectedAction === 'clarify_target' ? 'clarifying' : 'draft',
      sampleId: sample.id, notice: copy(sample.notice), drafts: copy(sample.drafts),
      questions: copy(sample.questions), savedTaskIds: [], error: null };
  }
  function cancel(session) {
    return { ...copy(session), state: 'cancelled', error: null };
  }
  // Presentation-only memory transaction. This is NOT C's LocalStore/Proposal/operationId protocol.
  function confirm(session, tasks, options = {}) {
    if (session.state === 'saved') return { session: copy(session), tasks: copy(tasks), changed: false };
    if (session.state !== 'draft') return { session: copy(session), tasks: copy(tasks), changed: false };
    const error = session.drafts.length ? session.drafts.map(validateDraft).find(Boolean) : '没有可确认的草案。';
    if (error) return { session: { ...copy(session), error }, tasks: copy(tasks), changed: false };
    if (options.failSave) return { session: { ...copy(session), error: '未能保存，草案已保留。可关闭失败演示后重试。' }, tasks: copy(tasks), changed: false };
    const added = session.drafts.map((draft, index) => ({ ...copy(draft),
      id: 'preview-' + session.token + '-' + index, notice: copy(session.notice),
      status: 'todo', materials: draft.materials.map(label => ({ label, state: 'pending' })) }));
    return { session: { ...copy(session), state: 'saved', error: null, savedTaskIds: added.map(t => t.id) },
      tasks: copy(tasks).concat(added), changed: true };
  }
  return { copy, validDate, validateDraft, deadlineLabel, makeSession, cancel, confirm };
});
