// 静态检查：所有 ES 模块语法正确、每个 import 的名字都真实导出、HTML 中的 id 都存在。
// 用法：node tests/check-modules.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = path.join(root, 'js');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(jsDir);

let errors = 0;
const fail = m => { errors++; console.error('  ✗', m); };
const rel = p => path.relative(root, p).replace(/\\/g, '/');

const exportsOf = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  try { new vm.SourceTextModule(src, { identifier: f }); } catch (e) { fail(`${rel(f)} 语法错误：${e.message}`); }
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  exportsOf[f] = names;
}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s+(?:(\*\s+as\s+[\w$]+)|\{([^}]*)\}|([\w$]+))\s+from\s+['"]([^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(f), m[4]);
    if (!fs.existsSync(target)) { fail(`${rel(f)} 导入不存在的文件 ${m[4]}`); continue; }
    if (m[2]) for (const part of m[2].split(',')) {
      const n = part.trim().split(/\s+as\s+/)[0]; if (!n) continue;
      if (!exportsOf[target]?.has(n)) fail(`${rel(f)} 导入 { ${n} }，但 ${rel(target)} 未导出`);
    }
    if (m[1]) {
      const ns = m[1].split(/\s+as\s+/)[1].trim();
      const body = src.replace(/^\s*import\s[^;]*;?$/gm, '');
      for (const u of new Set([...body.matchAll(new RegExp(`\\b${ns}\\.([\\w$]+)`, 'g'))].map(x => x[1])))
        if (!exportsOf[target]?.has(u)) fail(`${rel(f)} 使用 ${ns}.${u}，但 ${rel(target)} 未导出`);
    }
  }
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const dynamicIds = new Set(['ac', 'diagBox', 'regAlias', 'regKey', 'regBtn', 'regLabel']);
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\$\('#([\w-]+)/g)) if (!ids.has(m[1]) && !dynamicIds.has(m[1])) fail(`${rel(f)} 引用了 #${m[1]}，index.html 中不存在`);
}
console.log(`${files.length} 个模块，${errors ? errors + ' 个问题' : '全部通过'}`);
process.exitCode = errors ? 1 : 0;
