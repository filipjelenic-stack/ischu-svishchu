// Unit tests against REAL production functions extracted from index.html.
'use strict';
const { loadSandbox } = require('./extract');

function genIdStub() { return 'id_' + Math.random().toString(36).slice(2, 10); }
const baseStubs = () => ({
  genId: genIdStub,
  todayStr: () => '2026-07-30',
  DIRECTIONS: { it: 'IT / Разработка', finance: 'Финансы', other: 'Прочее' },
  candidates: [],
});

module.exports = function (t) {
  // ── _norm / _normPhone / _normEmail ──
  {
    const ctx = loadSandbox(['_norm', '_normPhone', '_normEmail'], baseStubs());
    t.eq(ctx._norm('  Иванова   МАРИЯ '), ctx._norm('иванова мария'), '_norm: case/space insensitive');
    t.ok(ctx._normPhone('+7 (916) 123-45-67') === ctx._normPhone('89161234567'), '_normPhone: +7/8 formats equal');
    t.eq(ctx._normEmail(' Ivan@Mail.RU '), 'ivan@mail.ru', '_normEmail lowercases/trims');
  }

  // ── findDuplicate ──
  {
    const ctx = loadSandbox(['_norm', '_normPhone', '_normEmail', 'findDuplicate'], baseStubs());
    const existing = { id: 'e1', name: 'Иванова Мария', phones: [{ type: 'mobile', value: '+7 (916) 123-45-67' }], emails: [{ type: 'work', value: 'ivanova@mail.ru' }] };
    ctx.candidates = [existing];
    t.eq(ctx.findDuplicate({ name: 'ИВАНОВА  мария', phones: [], emails: [] }), existing, 'dup by normalized name');
    t.eq(ctx.findDuplicate({ name: 'Петрова Мария', phones: [{ value: '8 916 123 45 67' }], emails: [] }), existing, 'dup by phone across 8/+7 formats');
    t.eq(ctx.findDuplicate({ name: 'Петрова Мария', phones: [], emails: [{ value: 'IVANOVA@MAIL.RU' }] }), existing, 'dup by email case-insensitive');
    t.eq(ctx.findDuplicate({ name: 'Сидорова Анна', phones: [{ value: '+7 900 000 00 00' }], emails: [] }), null, 'no dup → null');
    t.eq(ctx.findDuplicate({ name: '', phones: [{ value: '12345' }], emails: [] }), null, 'short phone (<7 digits) never matches');
  }

  // ── mergeCandidate: every opts combination ──
  {
    const mk = () => ({
      id: 'e1', name: 'Иванова Мария', position: 'Бухгалтер', company: 'Ромашка',
      status: 'contacted', rating: 3, salaryMin: 100000, salaryMax: 150000,
      phones: [{ type: 'mobile', value: '+7 916 111-11-11' }],
      emails: [{ type: 'work', value: 'old@mail.ru' }],
      socials: [], files: [], notes: 'старая заметка', photo: null, activityLog: [],
      citizenship: '', currentCompany: '', currentRole: '', currentTenure: '', sourcedAt: '', vacancyText: '', vacancy: '',
    });
    const incoming = () => ({
      name: 'Петрова Мария', position: 'Главный бухгалтер', company: 'ТехноПром',
      salaryMin: 120000, salaryMax: 200000,
      phones: [{ type: 'mobile', value: '+7 916 222-22-22' }],
      emails: [{ type: 'work', value: 'new@mail.ru' }],
      socials: [{ type: 'Telegram', value: '@petrova' }], files: [], notes: 'из нового CV', photo: 'data:image/jpeg;base64,x',
    });
    const ctx = loadSandbox(['_norm', '_normPhone', '_normEmail', 'mergeCandidate'], baseStubs());

    // default opts: additive, никогда не трогает имя
    let e = mk(); ctx.mergeCandidate(e, incoming());
    t.eq(e.name, 'Иванова Мария', 'default merge: name untouched');
    t.eq(e.phones.length, 2, 'default merge: phones additive');
    t.eq(e.salaryMin, 100000, 'default merge: salaryMin keeps lower bound');
    t.eq(e.salaryMax, 200000, 'default merge: salaryMax widens');
    t.ok(e.notes.includes('старая') && e.notes.includes('из нового CV'), 'notes appended, not replaced');
    t.eq(e.photo, 'data:image/jpeg;base64,x', 'photo filled when empty');

    // CV-import opts: overwrite salary + replace contacts + update name
    e = mk(); ctx.mergeCandidate(e, incoming(), { overwriteSalary: true, replaceContacts: true, updateName: true });
    t.eq(e.name, 'Петрова Мария', 'updateName: surname change applied');
    t.ok(e.activityLog.some(l => l.text.includes('Имя обновлено')), 'updateName: old name logged');
    t.eq(e.salaryMin, 120000, 'overwriteSalary: min replaced');
    t.eq(e.phones.length, 1, 'replaceContacts: phones replaced');
    t.eq(e.phones[0].value, '+7 916 222-22-22', 'replaceContacts: new phone wins');
    t.eq(e.socials.length, 1, 'socials stay additive under replaceContacts');

    // updateName must NOT rename when names normalize equal
    e = mk(); ctx.mergeCandidate(e, { ...incoming(), name: ' иванова  МАРИЯ ' }, { updateName: true });
    t.eq(e.name, 'Иванова Мария', 'updateName: same normalized name → untouched');
    t.ok(!e.activityLog.some(l => l.text.includes('Имя обновлено')), 'updateName: no bogus rename log');

    // updateName must NOT rename to empty
    e = mk(); ctx.mergeCandidate(e, { ...incoming(), name: '  ' }, { updateName: true });
    t.eq(e.name, 'Иванова Мария', 'updateName: blank incoming name → untouched');

    // replaceContacts with EMPTY incoming lists keeps old contacts
    e = mk(); ctx.mergeCandidate(e, { ...incoming(), phones: [], emails: [] }, { replaceContacts: true });
    t.eq(e.phones[0].value, '+7 916 111-11-11', 'replaceContacts: empty incoming keeps existing');
  }

  // ── migrateCandidate on legacy shapes ──
  {
    const ctx = loadSandbox(['migrateCandidate'], baseStubs());
    t.eq(ctx.migrateCandidate(null), null, 'migrate: null → null');
    t.eq(ctx.migrateCandidate('str'), null, 'migrate: non-object → null');
    const c = ctx.migrateCandidate({ name: 'Тест' });
    t.ok(c.id && c.status === 'new' && Array.isArray(c.phones) && Array.isArray(c.activityLog), 'migrate: fills all defaults');
    t.eq(c.rating, 3, 'migrate: default rating 3');
    t.eq(c.consentStatus, '', 'migrate: consent fields exist');
    const legacy = ctx.migrateCandidate({ id: 'x', name: 'Y', rating: 0, salaryMin: 0 });
    t.eq(legacy.rating, 0, 'migrate: rating 0 preserved (not reset to 3)');
  }

  // ── _candSearchHay includes phones/emails in both raw and digits form ──
  {
    const ctx = loadSandbox(['_candSearchHay'], baseStubs());
    const c = { name: 'Иванова', position: 'CFO', company: '', citizenship: '', notes: '',
      direction: 'finance', teaserCode: 'FIN-01',
      phones: [{ value: '+7 (916) 123-45-67' }], emails: [{ value: 'Ivanova@Mail.ru' }],
      socials: [{ value: '@ivanchik' }] };
    const hay = ctx._candSearchHay(c);
    t.ok(hay.includes('79161234567'), 'hay: digits-only phone searchable');
    t.ok(hay.includes('ivanova@mail.ru'), 'hay: email lowercased');
    t.ok(hay.includes('@ivanchik'), 'hay: telegram handle searchable');
    t.ok(hay.includes('fin-01'), 'hay: teaser code searchable');
    t.eq(c._searchHay, hay, 'hay: cached on object');
    c.name = 'Изменилась'; // cache means stale until cleared — documents the contract
    t.eq(ctx._candSearchHay(c), hay, 'hay: cache honored until explicitly cleared');
  }

  // ── _dataUrlToBlobSync round-trip ──
  {
    const ctx = loadSandbox(['_dataUrlToBlobSync'], baseStubs());
    const b = ctx._dataUrlToBlobSync('data:application/pdf;base64,' + Buffer.from('PDFDATA').toString('base64'));
    t.ok(b && b.type === 'application/pdf' && b.size === 7, 'dataUrl→Blob: MIME + bytes preserved');
    t.eq(ctx._dataUrlToBlobSync('not a data url'), null, 'dataUrl→Blob: garbage → null');
    t.eq(ctx._dataUrlToBlobSync(undefined), null, 'dataUrl→Blob: undefined → null');
    // KNOWN EDGE (audit finding): charset-параметр в MIME не матчится текущим regex.
    const charset = ctx._dataUrlToBlobSync('data:text/plain;charset=utf-8;base64,' + Buffer.from('hi').toString('base64'));
    t.eq(charset, null, 'dataUrl→Blob: documents known charset-param limitation');
  }
};
