#!/usr/bin/env node
// Single entrypoint: node tests/run.js
// Exit code 0 = all green; 1 = failures. Run this BEFORE any push to main.
'use strict';

const suites = [
  ['static gates', require('./static.tests')],
  ['unit (production functions)', require('./unit.tests')],
  ['regressions (5 past bugs)', require('./regression.tests')],
  ['api/ai.js (prompt hardening)', require('./ai-api.tests')],
];

let pass = 0, fail = 0;
const failures = [];

function makeT(suite) {
  return {
    ok(cond, label) {
      if (cond) { pass++; } else { fail++; failures.push(suite + ' → ' + label); }
    },
    eq(a, b, label) {
      this.ok(Object.is(a, b) || a === b, label + (Object.is(a, b) || a === b ? '' : ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'));
    },
  };
}

(async () => {
  for (const [name, fn] of suites) {
    const before = fail;
    try {
      await fn(makeT(name));
    } catch (e) {
      fail++;
      failures.push(name + ' → suite crashed: ' + e.message);
    }
    const suiteFails = fail - before;
    console.log((suiteFails ? '✗' : '✓') + ' ' + name + (suiteFails ? ' — ' + suiteFails + ' failed' : ''));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  ✗ ' + f);
  }
  process.exit(fail ? 1 : 0);
})();
