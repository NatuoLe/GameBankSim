// 表达式输入框自动补全 + 引用插入
import { S } from '../app/state.js';
import * as A from '../app/actions.js';
import { FUNCS, FUNC_DOC, ID_PATTERN } from '../core/expr.js';
import { normKey, keyLit, toNum, fmt, trunc } from '../core/util.js';
import { resolveTable, baseName, rowRefText, unquote, RE_ROW_REF } from '../core/edit.js';
import { $, esc, toast } from './dom.js';

/** 带补全的输入框：表达式框 data-expr；资源池名称框 data-acrow（只补全 表.主键 用于绑定） */
const AC_SEL = 'input[data-expr],input[data-acrow]';
const AC = { inp: null, items: [], idx: 0, start: 0, end: 0, force: false };
let box;
const KIND = { table: ['表', '#1f3a35', '#5fe0c4'], row: ['行', '#253553', '#9ec1ff'], field: ['字段', '#3a3320', '#e8c46a'], pool: ['池', '#1e2d4d', '#7fb0ff'], formula: ['公式', '#163a3a', '#2ad4d4'], func: ['函数', '#30364a', '#aab'], var: ['变量', '#30364a', '#aab'] };

/** 把引用文本插入到最近聚焦的表达式输入框（光标处） */
export function insertRef(text) {
  const inp = S.ui.exprTarget;
  if (inp && document.body.contains(inp)) {
    const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s;
    inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
    inp.focus(); inp.setSelectionRange(s + text.length, s + text.length);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    toast('已插入 ' + text);
  } else {
    navigator.clipboard?.writeText(text).catch(() => {});
    toast(`已复制 ${text}（先点击右侧某个表达式输入框，可直接插入到光标处）`);
  }
}

/* ---------- 候选计算 ---------- */
function matchScore(text, q) {
  if (!q) return 2;
  const t = String(text ?? '').toLowerCase(), s = q.toLowerCase();
  return t === s ? 0 : t.startsWith(s) ? 1 : t.includes(s) ? 2 : -1;
}
function rankBy(list, q, keysFn) {
  const out = [];
  for (const it of list) {
    let best = -1;
    for (const k of keysFn(it)) { const sc = matchScore(k, q); if (sc >= 0 && (best < 0 || sc < best)) best = sc; }
    if (best >= 0) out.push([best, it]);
  }
  return out.sort((a, b) => a[0] - b[0]).map(x => x[1]);
}
function fieldItems(t, d, row, q) {
  return rankBy(t.cols, q, c => [c]).map(c => ({
    kind: 'field', label: c + (c === d.keyField ? ' 🔑' : c === d.labelField ? ' 🏷' : ''), insert: c,
    desc: row ? String(row[c] ?? '') : '', bad: row ? Number.isNaN(toNum(row[c])) : false,
  }));
}
function rowCtx(d, q, start, end) {
  const t = S.tables.ok(d.alias);
  if (!t) return null;
  const scored = [];
  for (const r of t.rows) {
    const k = normKey(r[d.keyField]); if (k === '') continue;
    let sc = matchScore(k, q), hit = null;
    if (sc < 0) { hit = t.cols.find(c => c !== d.keyField && matchScore(r[c], q) >= 0); if (hit) sc = 3; }
    if (sc >= 0) scored.push([sc, r, hit]);
    if (!q && scored.length >= 200) break;
  }
  scored.sort((a, b) => a[0] - b[0]);
  const items = scored.slice(0, 60).map(([, r, hit]) => {
    const k = r[d.keyField], ref = `${d.alias}[${keyLit(k)}]`;
    const pool = S.G.nodes.find(n => n.type === 'pool' && n.row && n.row.table === d.alias && normKey(n.row.key) === normKey(k));
    let desc = hit ? `${hit}=${r[hit]}` : d.labelField ? String(r[d.labelField] ?? '') : t.cols.filter(c => c !== d.keyField).slice(0, 3).map(c => `${c}=${r[c]}`).join('  ');
    if (pool) desc = `⛓${pool.id}·${pool.name}  ` + desc;
    return { kind: 'row', label: ref, desc, insert: ref + '.', chain: true, alias: d.alias, key: k };
  });
  return { start, end, title: `${d.alias}（${baseName(d.path)}）的行 · 主键 ${d.keyField}${q ? ` 含 "${q}"，或单元格含 "${q}"` : ''}`, items };
}
function tableItem(d, suffix, desc) {
  const t = S.tables.ok(d.alias);
  return { kind: 'table', label: d.alias, desc: `${baseName(d.path)}${t ? ` · ${t.rows.length} 行` : ''}${desc}`, insert: d.alias + suffix, chain: true };
}
function identItems(q) {
  const { G, sim } = S, items = [];
  for (const d of rankBy(G.tables, q, d => [d.alias, baseName(d.path)])) items.push(tableItem(d, '[', ''));
  for (const n of rankBy(G.nodes.filter(n => n.type === 'pool'), q, n => [n.id, n.name, A.rowLabelOf(n)]))
    items.push({ kind: 'pool', label: n.id, desc: [n.name, n.row ? '⛓' + rowRefText(n.row) : '', sim ? '= ' + fmt(sim.val[n.id]) : ''].filter(Boolean).join(' · '), insert: n.id });
  for (const n of rankBy(G.nodes.filter(n => n.type === 'formula'), q, n => [n.id, n.name]))
    items.push({ kind: 'formula', label: n.id, desc: `${n.name} = ${trunc(n.expr, 30)}`, insert: n.id });
  if (matchScore('tick', q) >= 0) items.push({ kind: 'var', label: 'tick', desc: '当前 tick', insert: 'tick' });
  for (const f of rankBy(Object.keys(FUNCS), q, f => [f])) items.push({ kind: 'func', label: f + '()', desc: FUNC_DOC[f] || '', insert: f + '(' });
  return items.slice(0, 80);
}

const RE_FIELD = new RegExp(`(${ID_PATTERN})\\[([^\\[\\]]*)\\]\\.([\\p{L}\\p{N}_.]*)$`, 'u');
const RE_KEY = new RegExp(`(${ID_PATTERN})\\[([^\\[\\]]*)$`, 'u');
const RE_DOT = new RegExp(`(${ID_PATTERN})\\.([\\p{L}\\p{N}_-]*)$`, 'u');
const RE_ID = new RegExp(`(${ID_PATTERN})$`, 'u');
const RE_BIND_TBL = new RegExp(`^\\s*(${ID_PATTERN})$`, 'u');

/** 表达式框 */
function exprCtx(inp) {
  const G = S.G, caret = inp.selectionStart ?? inp.value.length, pre = inp.value.slice(0, caret);
  const before = i => i > 0 ? pre[i - 1] : '';
  let m;
  if ((m = RE_FIELD.exec(pre))) {
    const d = resolveTable(G, m[1]), t = d && S.tables.ok(d.alias);
    if (!t) return null;
    const row = t.index.get(normKey(unquote(m[2])));
    return { start: caret - m[3].length, end: caret, title: `${d.alias}[${m[2]}] 的字段`, items: fieldItems(t, d, row, m[3]) };
  }
  if ((m = RE_KEY.exec(pre)) && before(m.index) !== '.') {
    const d = resolveTable(G, m[1]);
    return d ? rowCtx(d, unquote(m[2]), m.index, caret) : null;
  }
  if ((m = RE_DOT.exec(pre)) && !/[.\]]/.test(before(m.index))) {
    const id = m[1], q = m[2];
    const pool = G.nodes.find(n => n.type === 'pool' && n.id === id);
    if (pool && pool.row) {
      const d = G.table(pool.row.table), t = d && S.tables.ok(d.alias);
      if (!t) return null;
      return { start: caret - q.length, end: caret, title: `${id}（${pool.name}）→ ${rowRefText(pool.row)} 的字段`, items: fieldItems(t, d, A.boundRowOf(pool), q) };
    }
    const d = resolveTable(G, id);
    return d ? rowCtx(d, q, m.index, caret) : null;
  }
  m = RE_ID.exec(pre);
  if (m && /[.\]]/.test(before(m.index))) return null;
  const q = m ? m[1] : '';
  if (!q && !AC.force) return null;
  return { start: caret - q.length, end: caret, title: '', items: identItems(q) };
}
/** 资源池名称框：只补全 表.主键，选中即绑定 */
function rowBindCtx(inp) {
  const G = S.G, caret = inp.selectionStart ?? inp.value.length, pre = inp.value.slice(0, caret);
  let m = RE_ROW_REF.exec(pre);
  if (m) {
    const d = resolveTable(G, m[1]); if (!d) return null;
    const ctx = rowCtx(d, unquote(m[2]), 0, caret); if (!ctx) return null;
    ctx.title = `绑定到 ${d.alias}（${baseName(d.path)}）的哪一行？id 不变，显示名称取该行的名称`;
    ctx.items.forEach(it => { it.label = `${d.alias}.${normKey(it.key)}`; it.bindRow = true; });
    return ctx;
  }
  m = RE_BIND_TBL.exec(pre);
  if (!m && !AC.force) return null;
  const items = rankBy(G.tables, m ? m[1] : '', d => [d.alias, baseName(d.path)]).map(d => tableItem(d, '.', ' · 继续输入 .主键'));
  return items.length ? { start: 0, end: caret, title: '输入 表名.主键 绑定数据行（表名可用别名或文件名）', items } : null;
}

/* ---------- 下拉框 ---------- */
const visible = () => box.style.display === 'block';
function hide() { box.style.display = 'none'; AC.items = []; AC.force = false; }
function update(inp) {
  let ctx = null;
  try { ctx = inp.dataset.acrow ? rowBindCtx(inp) : exprCtx(inp); } catch (_) { ctx = null; }
  if (!ctx || !ctx.items.length) return hide();
  Object.assign(AC, { inp, items: ctx.items, idx: 0, start: ctx.start, end: ctx.end });
  box.innerHTML = (ctx.title ? `<div class="act">${esc(ctx.title)}</div>` : '') + ctx.items.map((it, i) => {
    const [k, bg, fg] = KIND[it.kind];
    return `<div class="aci" data-i="${i}"><span class="k" style="background:${bg};color:${fg}">${k}</span><span class="m">${esc(it.label)}</span><span class="d ${it.bad ? 'bad' : ''}" title="${esc(it.desc)}">${esc(it.desc)}</span></div>`;
  }).join('');
  box.style.display = 'block';
  const r = inp.getBoundingClientRect(), w = Math.max(r.width, 320);
  box.style.width = w + 'px';
  box.style.left = Math.max(4, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  const h = box.offsetHeight;
  box.style.top = (r.bottom + 2 + h > window.innerHeight - 4 ? Math.max(4, r.top - 2 - h) : r.bottom + 2) + 'px';
  mark();
}
function mark() {
  box.querySelectorAll('.aci').forEach((el, i) => el.classList.toggle('on', i === AC.idx));
  const on = box.querySelector('.aci.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function accept(i) {
  const it = AC.items[i], inp = AC.inp; if (!it || !inp) return;
  if (it.bindRow) {
    hide();
    const n = A.selectedNode();
    if (n && n.type === 'pool') A.bindByRef(n, it.alias, it.key);
    return;
  }
  const v = inp.value, pos = AC.start + it.insert.length;
  inp.value = v.slice(0, AC.start) + it.insert + v.slice(AC.end);
  inp.focus(); inp.setSelectionRange(pos, pos);
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  if (!it.chain) hide();
}

export function init() {
  box = document.createElement('div'); box.id = 'ac'; document.body.appendChild(box);
  box.addEventListener('mousedown', ev => {
    ev.preventDefault();
    const el = ev.target.closest('.aci'); if (el) accept(+el.dataset.i);
  });
  document.addEventListener('focusin', ev => { if (ev.target.matches && ev.target.matches('input[data-expr]')) S.ui.exprTarget = ev.target; });
  document.addEventListener('input', ev => { if (ev.target.matches && ev.target.matches(AC_SEL)) { AC.force = false; update(ev.target); } });
  document.addEventListener('keydown', ev => {
    const inp = ev.target;
    if (!inp.matches || !inp.matches(AC_SEL)) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.code === 'Space') { ev.preventDefault(); AC.force = true; update(inp); return; }
    if (!visible() || AC.inp !== inp) return;
    const n = AC.items.length;
    if (ev.key === 'ArrowDown') { AC.idx = (AC.idx + 1) % n; mark(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { AC.idx = (AC.idx - 1 + n) % n; mark(); ev.preventDefault(); }
    else if (ev.key === 'Enter' || ev.key === 'Tab') { accept(AC.idx); ev.preventDefault(); }
    else if (ev.key === 'Escape') { hide(); ev.preventDefault(); ev.stopPropagation(); }
    else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) setTimeout(() => update(inp), 0);
  }, true);
  document.addEventListener('focusout', ev => { if (ev.target === AC.inp) hide(); });
  document.addEventListener('mousedown', ev => { if (visible() && !box.contains(ev.target) && ev.target !== AC.inp) hide(); });
  $('#props').addEventListener('scroll', hide);
}
