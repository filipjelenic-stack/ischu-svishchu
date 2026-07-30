// Extracts real function definitions out of index.html so unit tests run against
// PRODUCTION code, not copies. Brace-matching, not regex-to-the-end — handles nested
// braces, template literals and strings well enough for this codebase's style.
'use strict';
const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'index.html');

function readIndex() {
  return fs.readFileSync(INDEX, 'utf8');
}

function scriptBlocks(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

// Find `function NAME(` and return the full source through its matching closing brace.
function extractFunction(source, name) {
  const decl = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = source.match(decl);
  if (!m) throw new Error('function not found: ' + name);
  const start = m.index;
  let i = source.indexOf('{', start + m[0].length - 1);
  let depth = 0, inStr = null, inTpl = 0;
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1];
    if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; continue; }
    if (ch === '`') { inTpl = inTpl ? 0 : 1; continue; }
    if (inTpl) continue; // good enough: no ${`nested`} in this file's extracted fns
    if (ch === "'" || ch === '"') { inStr = ch; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces extracting: ' + name);
}

// Build a sandbox with the named production functions + provided stubs, and return it.
function loadSandbox(functionNames, stubs) {
  const vm = require('vm');
  const html = readIndex();
  const source = scriptBlocks(html).join('\n');
  const code = functionNames.map(n => extractFunction(source, n)).join('\n\n');
  const ctx = Object.assign({ console, Promise, JSON, Math, Date, Array, Object,
    String, Number, Boolean, RegExp, Error, Set, Map, Uint8Array, Blob, atob, btoa,
    setTimeout: (fn) => fn && fn(), // synchronous: tests never want real timers
  }, stubs || {});
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'extracted-from-index.html' });
  return ctx;
}

module.exports = { readIndex, scriptBlocks, extractFunction, loadSandbox, INDEX };
