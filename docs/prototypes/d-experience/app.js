(function () {
  'use strict';
  const M = window.DExperienceModel;
  const F = window.DExperienceForm;
  const samples = window.DExperienceSamples.samples;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  let sample = samples[0], session = null, tasks = [], token = 0, deadlineInputs = [];
  $('sample-select').innerHTML = samples.map(s => `<option value="${s.id}">${s.id} · ${esc(s.label)}</option>`).join('');
  function feedback(text, error = false) {
    $('input-feedback').textContent = text;
    $('input-feedback').classList.toggle('error', error);
  }
  function sourceMarkup(notice, quote) {
    return `<details><summary>查看原通知${quote ? '与依据' : '与材料'}</summary><p class="source-copy">${esc(notice.rawText)}</p>${quote ? `<blockquote>${esc(quote)}</blockquote>` : ''}<p class="source-meta">来源：${esc(notice.sourceLabel)}<br>发布时间：${esc(notice.publishedAt || '未知')}<br>导入时间：${esc(notice.importedAt)}</p></details>`;
  }
  function page(name) {
    const assistant = name === 'assistant';
    $('assistant-page').hidden = !assistant;
    $('tasks-page').hidden = assistant;
    $('assistant-tab').setAttribute('aria-selected', String(assistant));
    $('tasks-tab').setAttribute('aria-selected', String(!assistant));
    if (!assistant) renderTasks();
  }
  function loadSample() {
    token++;
    session = null;
    deadlineInputs = [];
    $('extract-button').disabled = false;
    $('notice-input').disabled = false;
    sample = samples.find(s => s.id === $('sample-select').value) || samples[0];
    $('notice-input').value = sample.notice.rawText;
    $('notice-meta').textContent = sample.notice.sourceLabel + ' · 发布时间：' + (sample.notice.publishedAt ? sample.notice.publishedAt.slice(0,16).replace('T',' ') : '未知');
    $('draft-area').replaceChildren();
    feedback('');
    page('assistant');
  }
  function cardMarkup(d, i) {
    const { date, time } = deadlineInputs[i];
    return `<section class="draft-card"><label for="title-${i}">任务名称</label><input id="title-${i}" data-field="title" data-index="${i}" type="text" value="${esc(d.title)}"><div class="field-pair"><div><label for="course-${i}">课程</label><input id="course-${i}" data-field="course" data-index="${i}" type="text" value="${esc(d.course)}"></div><div><label for="precision-${i}">截止日期精度</label><select id="precision-${i}" data-field="precision" data-index="${i}">${[['exact','精确到时刻'],['date_only','只有日期'],['unknown','待补充']].map(([v,t])=>`<option value="${v}" ${d.deadlinePrecision===v?'selected':''}>${t}</option>`).join('')}</select></div></div><div class="field-pair" ${d.deadlinePrecision==='unknown'?'hidden':''}><div><label for="date-${i}">截止日期</label><input id="date-${i}" data-field="date" data-index="${i}" type="date" value="${date}"></div><div ${d.deadlinePrecision!=='exact'?'hidden':''}><label for="time-${i}">截止时刻</label><input id="time-${i}" data-field="time" data-index="${i}" type="time" value="${time}"></div></div><p class="deadline-hint">${esc(M.deadlineLabel(d))}</p><p class="material-line">提交渠道：${esc(d.submissionChannel || '待补充')}<br>材料：${esc(d.materials.join('、') || '原通知未列出')}<br>准备状态与实际提交分别记录</p>${sourceMarkup(sample.notice, d.evidenceQuote)}</section>`;
  }
  function renderDraft() {
    const area = $('draft-area');
    if (!session || session.state === 'cancelled') { area.replaceChildren(); return; }
    if (session.state === 'clarifying') {
      area.innerHTML = `<div class="clarification"><strong>先确认适用对象</strong><p>${esc(session.questions.join(' '))}</p><p>此场景用于讨论变更交互，本版不执行任务更新。</p></div>`;
      return;
    }
    if (session.state === 'saved') {
      area.innerHTML = `<div class="success" role="status"><strong>已加入本次预演的任务列表</strong><p>${session.savedTaskIds.length} 个事项 · 刷新页面后重置</p><button type="button" class="secondary" id="view-tasks">查看任务</button></div>`;
      $('view-tasks').onclick = () => page('tasks');
      return;
    }
    const dateAdvice = session.drafts.some(d => d.deadlinePrecision === 'unknown')
      ? '也可以保留“截止日期待补充”，稍后再核对。'
      : '已知日期会保留，原通知未说明的具体时刻不自动补齐。';
    area.innerHTML = `${session.questions.length ? `<div class="clarification"><strong>有一项需要核对</strong><p>${esc(session.questions.join(' '))}</p><p>${dateAdvice}</p></div>` : ''}<div class="draft-group"><div class="draft-heading"><strong>核对 ${session.drafts.length} 个事项</strong><span class="pill">待你确认</span></div>${session.drafts.map(cardMarkup).join('')}<div class="group-footer"><p>以上草案尚未加入列表。确认范围：${session.drafts.length} 个事项。修改字段以你的确认为准，原通知保持不变。</p><div class="card-actions"><button type="button" class="secondary" id="cancel-draft">取消</button><button type="button" class="primary" id="confirm-draft">确认并加入列表</button></div>${session.error ? `<div class="error-box" role="alert">${esc(session.error)}</div>`:''}</div></div>`;
    $('cancel-draft').onclick = () => { session = M.cancel(session); renderDraft(); feedback('已取消，原文保留，任务列表未改变。'); };
    $('confirm-draft').onclick = () => {
      // Capture the current form values even when a platform has not emitted blur/change yet.
      session.drafts.forEach((draft, i) => {
        captureDraft(i);
      });
      const result = M.confirm(session, tasks, { failSave: $('save-failure').checked });
      session = result.session; tasks = result.tasks;
      $('task-count').textContent = tasks.length;
      renderDraft();
    };
    area.querySelectorAll('[data-field]').forEach(input => {
      if (input.dataset.field === 'title' || input.dataset.field === 'course') {
        input.addEventListener('input', () => {
          const draft = session.drafts[Number(input.dataset.index)];
          draft[input.dataset.field] = input.dataset.field === 'course' ? (input.value.trim() || null) : input.value;
          session.error = null;
        });
      } else input.addEventListener('change', editDraft);
    });
  }
  function captureDraft(i) {
    const draft = session.drafts[i];
    draft.title = $('title-'+i).value;
    draft.course = $('course-'+i).value.trim() || null;
    const fields = { precision: $('precision-'+i).value, date: $('date-'+i).value, time: $('time-'+i).value };
    deadlineInputs[i] = fields;
    F.applyDeadline(draft, fields);
  }
  function editDraft() {
    if (!session || session.state !== 'draft') return;
    session.drafts.forEach((draft, i) => captureDraft(i));
    session.error = null;
    renderDraft();
  }
  function renderTasks() {
    if (!tasks.length) {
      $('task-list').innerHTML = '<div class="empty-state"><strong>还没有确认的任务</strong>去助手整理一条通知，核对后再加入。</div>';
      return;
    }
    $('task-list').innerHTML = tasks.map(t => `<article class="task-item"><div class="task-top"><span class="task-bullet" aria-hidden="true"></span><div><h3>${esc(t.title)}</h3><p>${esc(t.course || '课程待补充')} · 尚未开始</p></div></div><p class="task-deadline">${esc(M.deadlineLabel(t))}</p><details><summary>原通知与材料</summary><p class="source-copy">${esc(t.notice.rawText)}</p><p class="source-meta">${esc(t.notice.sourceLabel)}<br>发布时间：${esc(t.notice.publishedAt || '未知')}<br>导入时间：${esc(t.notice.importedAt)}</p><ul>${t.materials.map(m=>`<li>${esc(m.label)} · 待准备</li>`).join('') || '<li>原通知未列出材料，需后续核对。</li>'}</ul><p class="source-meta">提交渠道：${esc(t.submissionChannel || '待补充')}<br>尚未记录用户确认提交；材料准备不等于平台已收到。</p></details></article>`).join('');
  }
  $('extract-button').onclick = () => {
    if ($('notice-input').value !== sample.notice.rawText) {
      feedback('本原型只预演所选合成样例，不分析任意文本。请重新选择样例；修改后的文字不会发送到外部。', true); return;
    }
    const current = ++token;
    session = null; deadlineInputs = []; $('draft-area').replaceChildren();
    $('extract-button').disabled = true; $('notice-input').disabled = true;
    feedback('正在理解通知（预设返回）…');
    setTimeout(() => {
      if (current !== token) return;
      $('extract-button').disabled = false; $('notice-input').disabled = false;
      if ($('network-failure').checked) { feedback('请求未完成，原文已保留。关闭失败演示后可以重试。', true); return; }
      session = M.makeSession(sample, current);
      deadlineInputs = session.drafts.map(F.deadlineFields);
      feedback('请核对以下内容；确认前不会改变任务列表。');
      renderDraft();
    }, 350);
  };
  $('voice-button').onclick = () => feedback('语音入口已预留。本原型不录音；真实权限、识别与播报将在 T09 探测。');
  $('notice-input').addEventListener('input', () => {
    if (session) { token++; session = null; renderDraft(); feedback('原文已更改，旧草案已作废。'); }
  });
  $('sample-select').onchange = loadSample;
  $('assistant-tab').onclick = () => page('assistant');
  $('tasks-tab').onclick = () => page('tasks');
  loadSample();
})();
