// Regression tests for the five production bugs that already happened once.
// Each test pins the FIX in place; if any of these fail, do not deploy.
'use strict';
const { loadSandbox, readIndex, scriptBlocks, extractFunction } = require('./extract');

module.exports = function (t) {
  const html = readIndex();
  const source = scriptBlocks(html).join('\n');

  // ── Bug 1 (2026-07): _blobToDataUrl had no Promise wrapper → backups lost all files ──
  {
    // Functional: with a stubbed FileReader the function must return a real Promise
    // that resolves to reader.result.
    function FileReaderStub() {
      this.readAsDataURL = () => { this.result = 'data:x;base64,QQ=='; this.onload && this.onload(); };
    }
    const ctx = loadSandbox(['_blobToDataUrl'], { FileReader: FileReaderStub });
    const p = ctx._blobToDataUrl({});
    t.ok(p && typeof p.then === 'function', 'bug1: _blobToDataUrl returns a Promise');
    return p.then(v => {
      t.eq(v, 'data:x;base64,QQ==', 'bug1: resolves with FileReader result');

      // ── Bug 2 (2026-07): _detectKind called without await → 62/62 import failures ──
      {
        const calls = [...source.matchAll(/(.{10})_detectKind\s*\(/g)]
          .filter(m => !/function\s*$/.test(m[1]));
        t.ok(calls.length >= 1, 'bug2: _detectKind has call sites');
        for (const m of calls) {
          t.ok(/await\s+$/.test(m[1]), 'bug2: _detectKind call is awaited ("' + m[1].trim() + '_detectKind(")');
        }
      }

      // ── Bug 3 (2026-06): inline files[].data survived into candidate records ──
      // ── Bug 4 (2026-07): _searchHay cache persisted to IndexedDB ──
      {
        // Functional: run the REAL saveData with a fake db and inspect what it writes.
        const written = {};
        const table = name => ({
          clear: async () => {},
          bulkAdd: async rows => { written[name] = rows; },
          bulkPut: async rows => { written[name] = rows; },
        });
        const db = {
          candidates: table('candidates'), vacancies: table('vacancies'), tasks: table('tasks'),
          transaction: (...args) => args[args.length - 1](),
        };
        const dirty = {
          id: 'c1', name: 'Тест', _searchHay: 'STALE', _posHay: 'STALE',
          files: [{ id: 'f1', name: 'cv.pdf', size: 3, data: 'data:application/pdf;base64,AAA' }],
        };
        const ctx2 = loadSandbox(['saveData'], {
          db, candidates: [dirty], vacancies: [], tasks: [],
          showToast: () => {}, alert: () => {},
        });
        return ctx2.saveData().then(() => {
          const row = written.candidates[0];
          t.ok(row, 'bug3/4: saveData wrote the candidate');
          t.eq(row.files[0].data, undefined, 'bug3: inline files[].data stripped before persist');
          t.eq(row.files[0].name, 'cv.pdf', 'bug3: file metadata preserved');
          t.eq(row._searchHay, undefined, 'bug4: _searchHay never persisted');
          t.eq(row._posHay, undefined, 'bug4: _posHay never persisted');
          t.eq(dirty._searchHay, 'STALE', 'bug4: in-memory cache left intact (perf)');

          // loadData side: dropped on read for records saved by older versions
          const loadSrc = extractFunction(source, 'loadData');
          t.ok(/delete\s+c\._searchHay/.test(loadSrc), 'bug4: loadData drops persisted _searchHay');

          // ── Bug 5 (2026-06): duplicate addLog('Файл удалён') in deleteCandFile ──
          const delSrc = extractFunction(source, 'deleteCandFile');
          const n = (delSrc.match(/Файл удал/g) || []).length;
          t.eq(n, 1, 'bug5: exactly one "Файл удалён" log in deleteCandFile (found ' + n + ')');
        });
      }
    });
  }
};
