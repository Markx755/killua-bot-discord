'use strict';
/*
 * ตรวจว่าทุกไฟล์ใน src/ + index.js ไม่มีตัวแปรที่ "ใช้แต่ไม่ได้ประกาศ/ไม่ได้ require" (ลืม import หลังแยกไฟล์)
 * รัน:  node --expose-internals scripts/check-imports.js
 * (ใช้ acorn ที่ติดมากับ Node เอง ไม่ต้องติดตั้งอะไรเพิ่ม)
 */
let acorn;
try {
  acorn = require('internal/deps/acorn/acorn/dist/acorn');
} catch {
  console.log('⚠ ข้ามการตรวจ import (ต้องรันด้วย: node --expose-internals scripts/check-imports.js)');
  process.exit(0);
}
const fs = require('fs');
const path = require('path');

const GLOBALS = new Set(
  ('console process Buffer setTimeout setInterval clearTimeout clearInterval setImmediate queueMicrotask Math Date JSON Set Map WeakMap WeakSet Object Array String Number Boolean Symbol Promise Error TypeError RangeError RegExp URL URLSearchParams parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI require module exports __dirname __filename undefined NaN Infinity BigInt Intl TextEncoder TextDecoder AbortController fetch globalThis arguments Reflect Proxy').split(' '),
);

function patternNames(p, out) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': out.add(p.name); break;
    case 'ObjectPattern': p.properties.forEach((x) => patternNames(x.type === 'RestElement' ? x.argument : x.value, out)); break;
    case 'ArrayPattern': p.elements.forEach((x) => patternNames(x, out)); break;
    case 'RestElement': patternNames(p.argument, out); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
  }
}
const isFn = (n) => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';

function walkChildren(node, cb) {
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === 'string' && cb(x, node, k));
    else if (v && typeof v.type === 'string') cb(v, node, k);
  }
}
// var + function ที่ hoist ขึ้นมาในฟังก์ชัน/โปรแกรม
function collectVars(node, out, top = true) {
  if (!top && isFn(node)) { if (node.type === 'FunctionDeclaration' && node.id) out.add(node.id.name); return; }
  if (node.type === 'VariableDeclaration' && node.kind === 'var') node.declarations.forEach((d) => patternNames(d.id, out));
  walkChildren(node, (c) => collectVars(c, out, false));
}
function lexicalOf(stmts, out) {
  for (const s of stmts) {
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') s.declarations.forEach((d) => patternNames(d.id, out));
    else if (s.type === 'FunctionDeclaration' && s.id) out.add(s.id.name);
    else if (s.type === 'ClassDeclaration' && s.id) out.add(s.id.name);
  }
}

function freeIdentifiers(code) {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  const free = new Set();
  const declared = new Set();
  const lookup = (name, scopes) => scopes.some((s) => s.has(name));

  function visit(node, scopes) {
    switch (node.type) {
      case 'Identifier':
        if (!lookup(node.name, scopes)) free.add(node.name);
        return;
      case 'MemberExpression':
        visit(node.object, scopes);
        if (node.computed) visit(node.property, scopes);
        return;
      case 'Property':
        if (node.computed) visit(node.key, scopes);
        visit(node.value, scopes);
        return;
      case 'PropertyDefinition':
      case 'MethodDefinition':
        if (node.computed) visit(node.key, scopes);
        if (node.value) visit(node.value, scopes);
        return;
      case 'LabeledStatement': visit(node.body, scopes); return;
      case 'BreakStatement': case 'ContinueStatement': return;
      case 'VariableDeclarator':
        visitPattern(node.id, scopes);
        if (node.init) visit(node.init, scopes);
        return;
    }
    if (isFn(node)) {
      const s = new Set();
      if (node.type === 'FunctionExpression' && node.id) s.add(node.id.name);
      node.params.forEach((p) => patternNames(p, s));
      if (node.body.type === 'BlockStatement') { collectVars(node.body, s); lexicalOf(node.body.body, s); }
      const inner = [...scopes, s];
      node.params.forEach((p) => visitPattern(p, inner));
      visit(node.body, inner);
      return;
    }
    if (node.type === 'BlockStatement' || node.type === 'StaticBlock') {
      const s = new Set(); lexicalOf(node.body, s);
      node.body.forEach((c) => visit(c, [...scopes, s]));
      return;
    }
    if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const s = new Set();
      const d = node.init ?? node.left;
      if (d && d.type === 'VariableDeclaration' && d.kind !== 'var') d.declarations.forEach((x) => patternNames(x.id, s));
      walkChildren(node, (c) => visit(c, [...scopes, s]));
      return;
    }
    if (node.type === 'SwitchStatement') {
      visit(node.discriminant, scopes);
      const s = new Set(); node.cases.forEach((c) => lexicalOf(c.consequent, s));
      node.cases.forEach((c) => { if (c.test) visit(c.test, [...scopes, s]); c.consequent.forEach((x) => visit(x, [...scopes, s])); });
      return;
    }
    if (node.type === 'CatchClause') {
      const s = new Set(); patternNames(node.param, s);
      visit(node.body, [...scopes, s]);
      return;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const s = new Set(); if (node.id) s.add(node.id.name);
      if (node.superClass) visit(node.superClass, scopes);
      visit(node.body, [...scopes, s]);
      return;
    }
    walkChildren(node, (c) => visit(c, scopes));
  }
  function visitPattern(p, scopes) {
    if (!p) return;
    if (p.type === 'AssignmentPattern') { visitPattern(p.left, scopes); visit(p.right, scopes); }
    else if (p.type === 'ObjectPattern') p.properties.forEach((x) => { if (x.type === 'RestElement') visitPattern(x.argument, scopes); else { if (x.computed) visit(x.key, scopes); visitPattern(x.value, scopes); } });
    else if (p.type === 'ArrayPattern') p.elements.forEach((x) => visitPattern(x, scopes));
    else if (p.type === 'RestElement') visitPattern(p.argument, scopes);
    // Identifier ในตำแหน่งประกาศ ไม่นับเป็นการอ้างอิง
  }

  collectVars(ast, declared);
  lexicalOf(ast.body, declared);
  const top = [declared];
  ast.body.forEach((n) => visit(n, top));
  return { free: [...free].filter((n) => !GLOBALS.has(n)), declared: [...declared], ast };
}

module.exports = { freeIdentifiers, patternNames };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const files = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (!['node_modules', '.git', 'test'].includes(f.name)) walk(p); }
      else if (f.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(root, 'src'));
  files.push(path.join(root, 'index.js'));
  let bad = 0;
  for (const f of files) {
    const { free } = freeIdentifiers(fs.readFileSync(f, 'utf8'));
    if (free.length) { bad++; console.log(`✗ ${path.relative(root, f)}: ใช้แต่ไม่ได้ประกาศ → ${free.join(', ')}`); }
  }
  if (bad) process.exit(1);
  console.log(`✓ ตรวจ ${files.length} ไฟล์ ไม่มีตัวแปรที่ลืม import`);
}
