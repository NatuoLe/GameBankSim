// 图编辑操作：只修改 Graph 数据并返回结果/错误信息，不触碰 DOM、不弹提示。
// 节点 id 由画布自动分配、全图唯一、不可修改，是表达式引用变量的唯一方式；name 只是显示标签。
import { IDENT_RE, RESERVED, ID_START, ID_PATTERN, renameInExpr } from './expr.js';
import { TYPES, NODE_EXPR, actionDefaults } from './model.js';
import { normKey, keyLit, keyVal, toNum } from './util.js';

export const baseName = p => String(p).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

export function toIdent(s) {
  let r = String(s ?? '').trim().replace(/[^\p{L}\p{N}_]/gu, '_');
  if (!r) r = '_';
  if (!ID_START.test(r[0])) r = '_' + r;
  if (RESERVED.has(r)) r = r + '_';
  return r;
}
/** 生成一个尚未使用的默认显示名（名称允许重复，这里只是为了好区分） */
export function uniqueName(G, base, numbered = true) {
  const names = new Set(G.nodes.map(n => n.name));
  if (!numbered && !names.has(base)) return base;
  for (let i = numbered ? 1 : 2; ; i++) { const nm = base + (numbered ? i : '_' + i); if (!names.has(nm)) return nm; }
}

/* ---------- 数据行绑定 ---------- */
export const rowVarName = (alias, key) => toIdent(`${alias}_${normKey(key)}`);
export const rowRefText = r => `${r.table}[${keyLit(r.key)}]`;
export const boundRow = (tables, n) => n && n.row ? tables.find(n.row.table, n.row.key) : null;
export function rowLabel(G, tables, n) {
  const d = n && n.row && G.table(n.row.table), row = boundRow(tables, n);
  if (!d || !d.labelField || !row) return '';
  const v = row[d.labelField];
  return v === undefined || v === null ? '' : String(v);
}
/** 绑定行后的默认显示名称：行的显示字段（如 name=金币），没有则 表别名_主键 */
export function rowDisplayName(G, tables, alias, key) {
  const d = G.table(alias), row = tables.find(alias, key);
  const v = d && d.labelField && row ? row[d.labelField] : '';
  return v === undefined || v === null || String(v).trim() === '' ? rowVarName(alias, key) : String(v).trim();
}
/** 按别名或文件名（不含扩展名，忽略大小写）解析已注册的数据表 */
export function resolveTable(G, id) {
  if (!id) return null;
  const d = G.table(id); if (d) return d;
  const l = id.toLowerCase();
  return G.tables.find(t => baseName(t.path).toLowerCase() === l || t.alias.toLowerCase() === l) || null;
}
/** 匹配 `表.主键` / `表[主键]` */
export const RE_ROW_REF = new RegExp(`^\\s*(${ID_PATTERN})\\s*(?:\\.|\\[)\\s*([^\\]]*?)\\s*\\]?\\s*$`, 'u');
export const unquote = s => s.trim().replace(/^["']|["']$/g, '');
/** 解析 `tbitem.1001` 这类文本：非引用返回 null，出错返回 { err }，成功返回 { alias, key } */
export function resolveRowRef(G, tables, text) {
  const m = RE_ROW_REF.exec(text);
  if (!m || !/[.[]/.test(text)) return null;
  const d = resolveTable(G, m[1]);
  if (!d) return { err: `未找到数据表 "${m[1]}"（需先在左侧 ③ 注册）` };
  const t = tables.ok(d.alias);
  if (!t) return { err: `数据表 ${d.alias} 未加载` };
  const key = unquote(m[2]), row = t.index.get(normKey(key));
  if (!row) return { err: `${d.alias} 中不存在主键 ${keyLit(key)}` };
  return { alias: d.alias, key: row[d.keyField] };
}
/** 绑定资源池到数据行，并把显示名称改为该行的显示名（引用用的 id 不变，表达式无需改动） */
export function bindPoolToRow(G, tables, n, alias, key) {
  n.row = { table: alias, key: keyVal(key) };
  n.name = rowDisplayName(G, tables, alias, key);
}
/** 以数据行新建货币时的默认字段（id 为新节点的 id，用于 init/cap 引用本行字段） */
export function newCurrencySpec(G, tables, alias, cols, row, key, id) {
  const k = keyVal(key);
  const initF = cols.find(c => /^(init|initial|init_count|init_num|初始值|初始)$/i.test(c));
  const capF = cols.find(c => /^(max_stack|max|cap|max_count|limit|上限|堆叠上限)$/i.test(c) && toNum(row[c]) > 0);
  return { name: rowDisplayName(G, tables, alias, k), row: { table: alias, key: k }, init: initF && !Number.isNaN(toNum(row[initF])) ? `${id}.${initF}` : '0', cap: capF ? `${id}.${capF}` : '' };
}

/* ---------- 数据表定义 ---------- */
export function checkAlias(G, alias, self) {
  if (!IDENT_RE.test(alias)) return '别名需为合法标识符（中英文/数字/下划线，不以数字开头）';
  if (RESERVED.has(alias)) return `"${alias}" 是保留字`;
  if (G.tables.some(t => t !== self && t.alias === alias)) return `别名 "${alias}" 已存在`;
  if (G.node(alias)) return `"${alias}" 与节点 id 冲突`;
  return null;
}
export function makeTableDef(alias, path, keyField, sheet, cols) {
  return { alias, path, keyField, sheet: sheet || null, labelField: cols.find(c => c !== keyField && /^(name|名称|名字|title)$/i.test(c)) || null };
}
export function renameTable(G, tables, d, nv) {
  if (!nv || nv === d.alias) return null;
  const m = checkAlias(G, nv, d); if (m) return m;
  const old = d.alias;
  G.forEachExpr(s => renameInExpr(s, old, nv));
  for (const n of G.nodes) if (n.row && n.row.table === old) n.row.table = nv;
  tables.rename(old, nv); d.alias = nv;
  return null;
}

/* ---------- 节点 / 连线 ---------- */
/** 修改显示名称：不影响任何表达式（表达式按 id 引用）；成功返回 null，失败返回原因 */
export function applyRename(G, n, nv) {
  nv = String(nv ?? '').trim();
  if (!nv) return '名称不能为空';
  n.name = nv;
  return null;
}
const PREFIX = { pool: 'n', formula: 'f', action: 'a' };
/** extra 可以是对象，或 (新节点) => 对象（需要用到新 id 时） */
export function createNode(G, type, p, extra) {
  const n = { id: G.genId(PREFIX[type]), type, name: uniqueName(G, TYPES[type].label), x: Math.round(p.x), y: Math.round(p.y) };
  if (type === 'pool') { n.init = '0'; n.cap = ''; }
  if (type === 'formula') n.expr = '0';
  Object.assign(n, (typeof extra === 'function' ? extra(n) : extra) || {});
  if (type === 'action') actionDefaults(n);
  G.nodes.push(n);
  return n;
}
/** 折叠显示的行为展开为方块（放到两端中点） */
export function expandAction(G, V, a) {
  const io = V.io[a.id];
  if (V.compact.has(a.id) && io) {
    const p = G.node(io.ins[0].from), q = G.node(io.outs[0].to);
    a.x = Math.round((p.x + q.x) / 2); a.y = Math.round((p.y + q.y) / 2);
  }
  a.compact = false;
}
/** 连线：返回 { ok, msg?, selectId? } */
export function link(G, V, fromId, toId) {
  const a = G.node(fromId), b = G.node(toId);
  if (!a || !b) return { ok: false, msg: '端点不存在' };
  if (a === b) return { ok: false, msg: '不能连向自身' };
  if (a.type === 'formula' || b.type === 'formula') return { ok: false, msg: `公式不参与资源流动，直接在表达式中引用其 id（${(a.type === 'formula' ? a : b).id}）即可` };
  if (a.type === 'action' && b.type === 'action') return { ok: false, msg: '行为之间不能直接相连，中间需要资源池' };
  if (a.type === 'pool' && b.type === 'pool') {
    const act = actionDefaults({ id: G.genId('a'), type: 'action', name: uniqueName(G, '转移'), x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), mode: 'partial', compact: true });
    G.nodes.push(act);
    G.edges.push({ id: G.genId('e'), from: a.id, to: act.id, amount: '1' }, { id: G.genId('e'), from: act.id, to: b.id, amount: '1' });
    return { ok: true, selectId: act.id, msg: `已创建行为「${act.name}」：每 tick 从 ${a.name} 转移到 ${b.name}` };
  }
  if (G.edges.some(e => e.from === fromId && e.to === toId)) return { ok: false, msg: '已存在相同的连接' };
  const act = a.type === 'action' ? a : b;
  if (V.compact.has(act.id)) expandAction(G, V, act);
  G.edges.push({ id: G.genId('e'), from: fromId, to: toId, amount: '1' });
  return { ok: true, selectId: act.id };
}
export function removeNode(G, id) {
  G.nodes = G.nodes.filter(n => n.id !== id);
  G.edges = G.edges.filter(e => e.from !== id && e.to !== id);
}
export function removeEdge(G, id) { G.edges = G.edges.filter(e => e.id !== id); }
/** 哪些表达式引用了某个变量 id：[{ owner: 节点或连线, field }] */
export function refsTo(G, id) {
  const out = [], has = s => typeof s === 'string' && s.includes(id) && renameInExpr(s, id, '\u0000') !== s;
  for (const n of G.nodes) for (const f of NODE_EXPR) if (has(n[f])) out.push({ owner: n, field: f });
  for (const e of G.edges) if (has(e.amount)) out.push({ owner: e, field: 'amount' });
  return out;
}
/** 调整行为的结算顺序（在 nodes 数组中与相邻行为交换） */
export function moveAction(G, a, d) {
  const acts = G.nodes.filter(n => n.type === 'action'), i = acts.indexOf(a), j = i + d;
  if (j < 0 || j >= acts.length) return false;
  const ia = G.nodes.indexOf(a), ib = G.nodes.indexOf(acts[j]);
  G.nodes[ia] = acts[j]; G.nodes[ib] = a;
  return true;
}
