// 图模型：状态（资源池 / 公式）+ 行为。纯数据 + 查询方法，可直接 JSON 序列化。
//
// 引用约定（v4 起）：表达式里的变量一律写节点 id（画布自动分配、全图唯一、不可改，如 n1 / f2），
// 节点 name 只是显示标签，可随意修改、可重复，改名不影响任何表达式。
import { IDENT_RE, RESERVED, replaceIdents } from './expr.js';

export const TYPES = {
  pool: { label: '资源池', color: '#4f8cff' },
  formula: { label: '公式', color: '#2ad4d4' },
  action: { label: '行为', color: '#f5c542' },
};
export const TRIGGERS = { tick: '每 tick', every: '每 N tick', rise: '条件变为真时（边沿触发）' };
export const MODES = { all: '全有或全无', partial: '尽量执行（按比例）' };
/** 节点上所有表达式字段 */
export const NODE_EXPR = ['init', 'cap', 'expr', 'every', 'condition', 'chance', 'times'];
export const GRAPH_VERSION = 4;
/** 可在表达式中作为变量引用的节点类型 */
export const isVarNode = n => !!n && (n.type === 'pool' || n.type === 'formula');
const PREFIX = { pool: 'n', formula: 'f', action: 'a' };

export function actionDefaults(a) {
  for (const f of ['every', 'condition', 'chance', 'times']) a[f] = a[f] === undefined || a[f] === null ? '' : String(a[f]);
  if (!TRIGGERS[a.trigger]) a.trigger = 'tick';
  if (!MODES[a.mode]) a.mode = 'all';
  a.compact = !!a.compact;
  return a;
}

export function actionSummary(a) {
  const p = [a.trigger === 'every' ? `每${a.every || '?'}tick` : a.trigger === 'rise' ? '变真时' : '每tick'];
  if (a.chance.trim()) p.push(`p=${a.chance.trim()}`);
  if (a.times.trim() && a.times.trim() !== '1') p.push(`×${a.times.trim()}`);
  p.push(a.mode === 'all' ? '全有' : '尽量');
  return p.join(' · ');
}

export class Graph {
  constructor(data) { Object.assign(this, data); }
  node(id) { return this.nodes.find(n => n.id === id); }
  edge(id) { return this.edges.find(e => e.id === id); }
  table(alias) { return this.tables.find(t => t.alias === alias); }
  /** 生成全图唯一 id（与节点、连线、数据表别名都不冲突） */
  genId(prefix) {
    let id;
    do id = prefix + (this.nextId++); while (this.node(id) || this.edge(id) || this.table(id));
    return id;
  }
  /** 可引用变量（资源池 / 公式）按 id 查找 */
  varNode(id) { const n = this.node(id); return isVarNode(n) ? n : null; }
  forEachExpr(cb) {
    for (const n of this.nodes) for (const f of NODE_EXPR) if (typeof n[f] === 'string') n[f] = cb(n[f]);
    for (const e of this.edges) e.amount = cb(e.amount);
  }
  /** 连线语义：in = 资源池→行为（消耗），out = 行为→资源池（产出） */
  edgeKind(e) {
    const a = this.node(e.from), b = this.node(e.to);
    if (!a || !b) return { k: 'bad', msg: '端点不存在' };
    if (a.type === 'pool' && b.type === 'action') return { k: 'in' };
    if (a.type === 'action' && b.type === 'pool') return { k: 'out' };
    if (a.type === 'formula' || b.type === 'formula') return { k: 'bad', msg: '公式不参与资源流动，直接在表达式中引用其 id 即可' };
    if (a.type === 'pool' && b.type === 'pool') return { k: 'bad', msg: '资源池之间需要通过行为连接（连线模式下依次点两个资源池会自动创建「转移」行为）' };
    return { k: 'bad', msg: '行为之间不能直接相连，中间需要资源池' };
  }
  ownerAction(e) {
    const a = this.node(e.from), b = this.node(e.to);
    return a && a.type === 'action' ? a : b && b.type === 'action' ? b : null;
  }
}

/** 旧模型（产出源/消耗口/转换器/条件门 + rate 连线）→ 新模型（资源池 + 行为） */
function migrateOld(g) {
  const on = (g.nodes || []).filter(Boolean), oe = (g.edges || []).filter(Boolean);
  const byId = id => on.find(n => n.id === id);
  const isPool = n => n && n.type === 'pool';
  const nodes = [], edges = [];
  let seq = Math.max(1000, (Number(g.nextId) || 0) + 1000);
  const gen = p => p + (seq++);
  for (const n of on) if (n.type === 'pool' || n.type === 'formula') nodes.push({ ...n });
  const act = (name, x, y, o) => { const a = actionDefaults({ id: gen('a'), type: 'action', name, x: Math.round(x), y: Math.round(y), ...o }); nodes.push(a); return a; };
  const link = (from, to, amount) => edges.push({ id: gen('e'), from, to, amount: String(amount ?? '').trim() || '1' });
  const mid = (a, b) => [(a.x + b.x) / 2, (a.y + b.y) / 2];
  for (const e of oe) {
    const a = byId(e.from), b = byId(e.to); if (!a || !b) continue;
    const rate = String(e.rate ?? '').trim() || '1';
    if (a.type === 'source' && isPool(b)) link(act(a.name, ...mid(a, b), {}).id, b.id, rate);
    else if (isPool(a) && b.type === 'drain') { const x = act(b.name, ...mid(a, b), { mode: 'partial' }); link(a.id, x.id, rate); }
    else if (isPool(a) && isPool(b)) { const x = act(`${a.name}转${b.name}`, ...mid(a, b), { mode: 'partial', compact: true }); link(a.id, x.id, rate); link(x.id, b.id, rate); }
  }
  for (const c of on.filter(n => n.type === 'converter')) {
    const ins = oe.filter(e => e.to === c.id).map(e => byId(e.from)).filter(isPool);
    const outs = oe.filter(e => e.from === c.id).map(e => byId(e.to)).filter(isPool);
    const x = act(c.name, c.x, c.y, { mode: 'all', compact: ins.length === 1 && outs.length === 1 });
    ins.forEach(p => link(p.id, x.id, c.rateIn)); outs.forEach(p => link(x.id, p.id, c.rateOut));
  }
  for (const gt of on.filter(n => n.type === 'gate')) {
    const targets = oe.filter(e => e.from === gt.id).map(e => ({ n: byId(e.to), lim: String(e.rate ?? '').trim() })).filter(t => isPool(t.n));
    for (const ein of oe.filter(e => e.to === gt.id)) {
      const src = byId(ein.from); if (!src) continue;
      const rate = String(ein.rate ?? '').trim() || '1';
      const x = act(gt.name, gt.x, gt.y, { mode: 'partial', condition: gt.condition || '' });
      if (isPool(src)) link(src.id, x.id, rate);
      targets.forEach(t => link(x.id, t.n.id, t.lim || rate));
    }
  }
  const seen = new Set();
  for (const n of nodes) {
    const base = String(n.name || TYPES[n.type].label); let nm = base, i = 2;
    while (seen.has(nm)) nm = base + '_' + i++;
    n.name = nm; seen.add(nm);
  }
  return { ...g, version: 3, nodes, edges, nextId: seq };
}

const forEachExprOf = (g, cb) => {
  for (const n of g.nodes) for (const f of NODE_EXPR) if (typeof n[f] === 'string') n[f] = cb(n[f]);
  for (const e of g.edges) if (typeof e.amount === 'string') e.amount = cb(e.amount);
};
/** v3 → v4：表达式中按名称引用的变量改为按节点 id 引用 */
function namesToIds(g) {
  const byName = new Map();
  for (const n of g.nodes) if (isVarNode(n) && n.name && !byName.has(n.name)) byName.set(n.name, n.id);
  forEachExprOf(g, s => replaceIdents(s, v => byName.get(v)));
}
/** 保证节点 id 是合法、唯一、不与保留字/数据表别名冲突的标识符（表达式要用它引用） */
function sanitizeIds(g) {
  const used = new Set(), aliases = new Set(g.tables.map(t => t.alias)), remap = new Map();
  let seq = Number(g.nextId) || 1;
  const fresh = p => { let id; do id = p + (seq++); while (used.has(id) || aliases.has(id) || g.edges.some(e => e.id === id)); return id; };
  for (const n of g.nodes) {
    const id = String(n.id);
    if (IDENT_RE.test(id) && !RESERVED.has(id) && !used.has(id) && !aliases.has(id)) { used.add(id); continue; }
    n.id = fresh(PREFIX[n.type]); used.add(n.id);
    if (!remap.has(id)) remap.set(id, n.id);
  }
  if (remap.size) {
    for (const e of g.edges) { if (remap.has(e.from)) e.from = remap.get(e.from); if (remap.has(e.to)) e.to = remap.get(e.to); }
    forEachExprOf(g, s => replaceIdents(s, v => remap.get(v)));
  }
  g.nextId = seq;
}

/** 任意来源的图数据（localStorage / 导入 JSON / 旧版本）→ 规范化的 Graph；migrated 为迁移说明（无迁移时为空串） */
export function normalizeGraph(raw) {
  let g = { ...raw };
  const notes = [];
  if (!g.version || g.version < 3) { g = migrateOld(g); notes.push('旧模型已自动转换为「资源池 + 行为」'); }
  g.nodes = (g.nodes || []).filter(n => n && n.id && TYPES[n.type]).map(n => ({ ...n }));
  g.tables = Array.isArray(g.tables) ? g.tables.filter(t => t && t.alias && t.path) : [];
  g.edges = (g.edges || []).filter(e => e && e.id).map(e => ({ ...e }));
  sanitizeIds(g);
  const ids = new Set(g.nodes.map(n => n.id));
  g.edges = g.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  if (!Number.isFinite(Number(g.seed))) g.seed = 1;
  for (const n of g.nodes) {
    n.x = Number(n.x) || 0; n.y = Number(n.y) || 0;
    if (n.type === 'pool') {
      n.init = n.init === undefined || n.init === null ? '0' : String(n.init);
      n.cap = n.cap === undefined || n.cap === null ? '' : String(n.cap);
      if (n.row && (!n.row.table || n.row.key === undefined)) delete n.row;
      delete n.bind;
    }
    if (n.type === 'formula' && (n.expr === undefined || n.expr === null)) n.expr = '0';
    if (n.type === 'action') actionDefaults(n);
  }
  for (const e of g.edges) { e.amount = e.amount === undefined || e.amount === null ? '' : String(e.amount); delete e.rate; delete e.bind; }
  if (g.version < 4) { namesToIds(g); notes.push('表达式中的变量已从「名称」改为「节点 id」引用'); }
  g.version = GRAPH_VERSION;
  let mx = 0;
  for (const o of [...g.nodes, ...g.edges]) { const m = /\d+$/.exec(o.id); if (m) mx = Math.max(mx, +m[0]); }
  g.nextId = Math.max(Number(g.nextId) || 0, mx + 1);
  return { graph: new Graph(g), migrated: notes.join('；') };
}
