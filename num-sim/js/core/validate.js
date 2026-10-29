// 校验与编译：Graph + TableStore → V（错误表、编译后的表达式、连线语义、公式求值顺序…）
// 表达式中的变量按节点 id 解析；节点名称只是显示标签，不参与校验。
import { compile } from './expr.js';
import { normKey, keyLit, toNum } from './util.js';

/**
 * @returns {{
 *   err: Record<string,string>, ids: Set<string>, comp: Record<string,Function|null>,
 *   kind: Record<string,'in'|'out'|'bad'>, rowOf: Record<string,{table,key}>, order: string[],
 *   io: Record<string,{ins,outs}>, compact: Set<string>, actions: object[]
 * }}
 * err / comp 的键为 `${节点或连线id}:${字段}`；rowOf 的键为资源池 id
 */
export function validate(G, tables) {
  const err = {}, ids = new Set(), comp = {}, kind = {}, rowOf = {}, io = {}, compact = new Set();
  const put = (id, f, msg) => { if (!err[id + ':' + f]) err[id + ':' + f] = msg; ids.add(id); };
  const pools = G.nodes.filter(n => n.type === 'pool'), forms = G.nodes.filter(n => n.type === 'formula');
  const actions = G.nodes.filter(n => n.type === 'action');
  const poolById = {}; pools.forEach(p => { poolById[p.id] = p; if (p.row) rowOf[p.id] = p.row; });
  const formById = {}; forms.forEach(f => formById[f.id] = f);
  const aliases = new Set(G.tables.map(t => t.alias));
  const known = new Set(['tick', ...pools.map(p => p.id), ...forms.map(f => f.id)]);
  const label = n => (n.name && n.name !== n.id ? `${n.id}（${n.name}）` : n.id);
  /** 用户误写了名称时给出对应 id 的提示 */
  const nameHint = x => {
    const hit = G.nodes.filter(n => (n.type === 'pool' || n.type === 'formula') && n.name === x);
    return hit.length ? `"${x}" 是节点名称，表达式中请用 id 引用：${hit.map(n => n.id).join(' / ')}` : null;
  };

  const refErr = r => {
    let alias, key;
    if (r.kind === 'member') {
      const p = poolById[r.name];
      if (!p) return aliases.has(r.name) ? `数据表需写主键：${r.name}[主键].${r.field}`
        : nameHint(r.name) || (formById[r.name] ? `${r.name} 是公式，不能使用 .${r.field}` : `"${r.name}" 不是资源池 id，不能使用 .${r.field}`);
      if (!p.row) return `资源池 ${label(p)} 未绑定数据行，不能使用 .${r.field}`;
      alias = p.row.table; key = p.row.key;
    } else { alias = r.alias; key = r.keyConst; }
    if (!aliases.has(alias)) return `未注册的数据表 "${alias}"`;
    const t = tables.get(alias);
    if (!t || t.status === 'loading') return `数据表 ${alias} 加载中`;
    if (t.status === 'error') return `数据表 ${alias} 加载失败：${t.error}`;
    if (!t.cols.includes(r.field)) return `${alias} 没有字段 "${r.field}"`;
    if (key !== undefined) {
      const row = t.index.get(normKey(key));
      if (!row) return `${alias} 中不存在主键 ${keyLit(key)}`;
      if (Number.isNaN(toNum(row[r.field]))) return `${alias}[${keyLit(key)}].${r.field} = "${row[r.field]}" 不是数字`;
    }
    return null;
  };
  const cc = (id, f, src, opt = {}) => {
    const s = String(src ?? '').trim();
    if (!s) { if (opt.allowEmpty) comp[id + ':' + f] = null; else put(id, f, opt.emptyMsg || '不能为空'); return null; }
    try {
      const c = compile(s);
      if (opt.init && c.ids.length) throw new Error(`初始值只能使用常量和数据表字段，不能引用 ${c.ids.join('、')}`);
      const unk = c.ids.filter(x => !known.has(x));
      if (unk.length) {
        const tb = unk.find(x => aliases.has(x));
        if (tb) throw new Error(`${tb} 是数据表，用法：${tb}[主键].字段`);
        throw new Error(unk.map(nameHint).find(Boolean) || '未知变量 id：' + unk.join('、'));
      }
      for (const r of c.refs) { const m = refErr(r); if (m) throw new Error(m); }
      comp[id + ':' + f] = c.fn;
      return c;
    } catch (e) { put(id, f, e.message); return null; }
  };

  for (const e of G.edges) {
    const ki = G.edgeKind(e); kind[e.id] = ki.k;
    if (ki.k === 'bad') { put(e.id, 'kind', ki.msg); continue; }
    cc(e.id, 'amount', e.amount, { emptyMsg: '数量不能为空' });
  }
  const deps = {};
  for (const n of G.nodes) {
    if (n.type === 'pool') {
      if (n.row) {
        if (!aliases.has(n.row.table)) put(n.id, 'row', `数据表 ${n.row.table} 未注册`);
        else {
          const t = tables.ok(n.row.table);
          if (t && !t.index.has(normKey(n.row.key))) put(n.id, 'row', `${n.row.table} 中不存在主键 ${keyLit(n.row.key)}`);
        }
      }
      cc(n.id, 'init', n.init, { init: true, allowEmpty: true });
      cc(n.id, 'cap', n.cap, { allowEmpty: true });
    }
    if (n.type === 'formula') {
      const c = cc(n.id, 'expr', n.expr);
      deps[n.id] = c ? c.ids.filter(x => formById[x]) : [];
    }
    if (n.type === 'action') {
      const ins = G.edges.filter(e => e.to === n.id && kind[e.id] === 'in');
      const outs = G.edges.filter(e => e.from === n.id && kind[e.id] === 'out');
      io[n.id] = { ins, outs };
      if (n.compact && ins.length === 1 && outs.length === 1 && ins[0].from !== outs[0].to) compact.add(n.id);
      if (!ins.length && !outs.length) put(n.id, 'kind', '行为没有连接任何资源：资源池 → 行为 = 消耗，行为 → 资源池 = 产出');
      if (n.trigger === 'every') cc(n.id, 'every', n.every, { emptyMsg: '请填写间隔 N' });
      cc(n.id, 'condition', n.condition, { allowEmpty: n.trigger !== 'rise', emptyMsg: '「条件变为真时」触发需要填写条件' });
      cc(n.id, 'chance', n.chance, { allowEmpty: true });
      cc(n.id, 'times', n.times, { allowEmpty: true });
    }
  }
  const state = {}, order = [];
  const visit = (id, stack) => {
    if (state[id] === 2) return;
    if (state[id] === 1) {
      const cyc = stack.slice(stack.indexOf(id));
      const txt = [...cyc, id].map(i => label(G.node(i))).join(' → ');
      cyc.forEach(i => put(i, 'expr', '循环依赖：' + txt));
      return;
    }
    state[id] = 1; stack.push(id);
    for (const d of deps[id] || []) visit(d, stack);
    stack.pop(); state[id] = 2; order.push(id);
  };
  forms.forEach(f => visit(f.id, []));
  return { err, ids, comp, kind, rowOf, order, io, compact, actions };
}
