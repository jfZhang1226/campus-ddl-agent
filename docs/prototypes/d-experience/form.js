(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.DExperienceForm = factory(root.DExperienceModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  // UI-only values survive redraws and failed confirmation, including incomplete input.
  function deadlineFields(draft) {
    const exact = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):00\+08:00$/.exec(draft.dueAt || '');
    return { precision: draft.deadlinePrecision,
      date: exact ? exact[1] : (draft.deadlineDate || ''), time: exact ? exact[2] : '' };
  }
  function applyDeadline(draft, fields) {
    draft.deadlinePrecision = fields.precision;
    draft.deadlineDate = fields.precision === 'date_only' ? (fields.date || null) : null;
    const complete = M.validDate(fields.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(fields.time);
    draft.dueAt = fields.precision === 'exact' && complete ? fields.date + 'T' + fields.time + ':00+08:00' : null;
  }
  return { deadlineFields, applyDeadline };
});
