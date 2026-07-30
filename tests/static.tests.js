// Static gates: syntax, element-ID integrity, and source-shape checks that pin
// audit assumptions (e.g. the search-filter expression the unit tests mirror).
'use strict';
const { readIndex, scriptBlocks } = require('./extract');

module.exports = function (t) {
  const html = readIndex();
  const blocks = scriptBlocks(html);

  // ── Syntax gate: every inline <script> block must parse ──
  blocks.forEach((s, i) => {
    let err = null;
    try { new Function(s); } catch (e) { err = e; }
    t.eq(err, null, 'syntax: script block #' + i + ' parses' + (err ? ' — ' + err.message : ''));
  });

  // ── Element-ID integrity: every literal getElementById target must be rendered somewhere ──
  {
    const source = blocks.join('\n');
    const ids = new Set(
      [...source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])
    );
    // IDs that are legitimately absent from static markup, plus known orphans.
    // Each entry here was manually verified during the 2026-07 audit — extend only
    // after checking why the ID is not rendered.
    const RUNTIME_OK = new Set([
      // Audit finding: orphans inside dead, never-called aiSmartImport() —
      // kept until removal of the dead function is approved.
      'imp-text-area', 'ai-import-btn',
    ]);
    const missing = [];
    for (const id of ids) {
      if (RUNTIME_OK.has(id)) continue;
      const rendered =
        source.includes('id="' + id + '"') ||
        source.includes("id='" + id + "'") ||
        source.includes('id=&quot;' + id + '&quot;') ||
        html.includes('id="' + id + '"') ||
        // helper-rendered fields: fieldRow('label','the-id',...) / selectRow(...)
        new RegExp("(fieldRow|selectRow)\\(\\s*'[^']*'\\s*,\\s*'" + id + "'").test(source) ||
        // runtime-created elements: el.id = 'the-id'
        new RegExp("\\.id\\s*=\\s*['\"]" + id + "['\"]").test(source);
      if (!rendered) missing.push(id);
    }
    t.eq(missing.length, 0, 'element IDs: every getElementById target is rendered (missing: ' + (missing.join(', ') || 'none') + ')');
  }

  // ── Recently reworked teaser modal: removed IDs must have no remaining JS references ──
  {
    const source = blocks.join('\n');
    for (const dead of ['pt-exp', 'pt-s1', 'pt-s2', 'pt-s3', 'pt-note', "'pt-lang'"]) {
      const needle = dead.startsWith("'") ? dead : "'" + dead + "'";
      const refs = [...source.matchAll(new RegExp("getElementById\\(" + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
      t.eq(refs.length, 0, 'teaser modal: no stale reference to removed ' + needle);
    }
    for (const alive of ['pt-reloc', 'pt-lang-chips', 'pt-lang-other']) {
      t.ok(source.includes("'" + alive + "'") || source.includes('"' + alive + '"'),
        'teaser modal: new field ' + alive + ' referenced');
    }
  }

  // ── Pin the search-match expression that unit tests mirror ──
  // If someone rewrites the filter in renderCandidates, this fails and tells them
  // to update tests/unit.tests.js accordingly.
  {
    const source = blocks.join('\n');
    t.ok(source.includes("qDigits.length>=4 && hay.indexOf(qDigits)>=0"), 'pin: digits-tolerant phone search expression present');
    t.ok(source.includes("qDigits.length===11&&qDigits[0]==='8'"), 'pin: 8→7 prefix swap present');
  }

  // ── The known-good hardened patterns must not regress ──
  {
    const source = blocks.join('\n');
    t.ok(/const bodyText = await resp\.text\(\)/.test(source), 'pin: callAI reads text before JSON.parse');
  }

  // ── No duplicate top-level function declarations (hoisting: last one silently wins) ──
  {
    const source = blocks.join('\n');
    const names = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
    const seen = new Set(), dups = new Set();
    for (const n of names) { if (seen.has(n)) dups.add(n); seen.add(n); }
    t.eq(dups.size, 0, 'no duplicate function declarations (dups: ' + ([...dups].join(', ') || 'none') + ')');
  }
};
