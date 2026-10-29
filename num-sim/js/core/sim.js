// 模拟引擎：输入 Graph + 校验结果 V + TableStore，按 tick 推进。不依赖 DOM。
//
// 每 tick：
//   1. 快照资源池 → 按依赖顺序计算公式与资源池上限
//   2. 按行为顺序（优先级）逐个执行：触发 → 条件 → 概率 → 资源检查 → 消耗 → 产出
//      每次执行后立即刷新变量与公式，后面的行为（以及同一行为的重复执行）看到最新状态
//   3. 记录快照
import { mulberry32, toNum, fmt } from './util.js';

export class SimError extends Error { constructor(id, msg) { super(msg); this.id = id; } }
const newStats = () => ({ fired: 0, trigger: 0, cond: 0, chance: 0, short: 0, full: 0, shortBy: {} });
/** 历史快照上限：超过后抽稀一半（采样间隔翻倍），保证无限运行时内存与绘制开销有界；最后一条始终是当前 tick */
export const HIST_MAX = 20000;

export class Simulator {
  constructor(G, V, tables) {
    this.G = G; this.V = V;
    this.rng = mulberry32((Math.floor(Number(G.seed)) || 0) >>> 0);
    /** 表达式运行时作用域：依赖通过这里注入给 expr 模块 */
    this.scope = {
      vars: { tick: 0 }, rng: this.rng,
      table: (alias, key, field) => tables.num(alias, key, field),
      member: (id, field) => {
        const r = V.rowOf[id];
        if (!r) throw new Error(`资源池 ${id} 未绑定数据行`);
        return tables.num(r.table, r.key, field);
      },
    };
    this.tick = 0;
    this.val = {}; this.fval = {}; this.cap = {};
    this.flows = {}; this.act = {}; this.stats = {}; this.prev = {};
    this.history = [];
    /** 历史采样间隔（tick），抽稀后翻倍 */
    this.histStride = 1;
    /** 运行时熔断：{ id, msg } */
    this.error = null;
    /** 最近一次 step() 失败原因：'invalid' | 'halted' | 'runtime' */
    this.lastFail = null;

    for (const n of G.nodes) {
      if (n.type === 'pool') this.val[n.id] = 0;
      if (n.type === 'action') this.stats[n.id] = newStats();
    }
    if (V.ids.size === 0) {
      try {
        for (const n of G.nodes) {
          if (n.type !== 'pool') continue;
          const f = V.comp[n.id + ':init'];
          if (f) this.val[n.id] = this.evalAt(f, n.id, '初始值');
        }
        this.scope.vars = this.snapshotVars(0);
        this.refreshDerived();
      } catch (e) {
        if (!(e instanceof SimError)) throw e;
        this.error = { id: e.id, msg: e.message };
      }
    } else {
      for (const n of G.nodes) if (n.type === 'pool') { const x = toNum(n.init); this.val[n.id] = Number.isNaN(x) ? 0 : x; }
    }
    this.record();
  }

  evalAt(fn, id, what) {
    let x;
    try { x = fn(this.scope); } catch (e) { throw new SimError(id, `${what}：${e.message}`); }
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new SimError(id, `${what} 结果为 ${x}（tick ${this.scope.vars.tick}）`);
    return x;
  }
  snapshotVars(t) {
    const vars = { tick: t };
    for (const n of this.G.nodes) if (n.type === 'pool') vars[n.id] = this.val[n.id];
    return vars;
  }
  /** 重新计算公式与上限（资源变化后调用） */
  refreshDerived() {
    const { G, V } = this, vars = this.scope.vars;
    for (const id of V.order) {
      vars[id] = this.evalAt(V.comp[id + ':expr'], id, '公式');
      this.fval[id] = vars[id];
    }
    for (const n of G.nodes) {
      if (n.type !== 'pool') continue;
      const f = V.comp[n.id + ':cap'];
      this.cap[n.id] = f ? Math.max(0, this.evalAt(f, n.id, '上限')) : Infinity;
    }
  }
  record() {
    const s = { tick: this.tick };
    for (const id in this.val) s[id] = this.val[id];
    for (const id in this.fval) s[id] = this.fval[id];
    for (const id in this.stats) s[id] = this.stats[id].fired;
    const H = this.history, last = H[H.length - 1];
    // 上一条若不在采样点上（只是「当前值」占位），用新快照替换
    if (last && last.tick % this.histStride !== 0) H.pop();
    H.push(s);
    if (H.length > HIST_MAX) {
      this.histStride *= 2;
      this.history = H.filter((h, i) => h.tick % this.histStride === 0 || i === H.length - 1);
    }
  }

  /** 执行一个行为（本 tick 内可能多次），返回 { n: 执行次数, reason, detail, shortPool } */
  runAction(a, t, flows) {
    const { G, V } = this, C = V.comp, io = V.io[a.id], vars = this.scope.vars;
    const info = { n: 0, reason: null, detail: '' };
    const condFn = C[a.id + ':condition'];
    const room = p => Math.max(0, this.cap[p.id] - this.val[p.id]);
    if (a.trigger === 'every') {
      const N = Math.round(this.evalAt(C[a.id + ':every'], a.id, '触发间隔'));
      if (N < 1) throw new SimError(a.id, `触发间隔 N=${N}，必须 ≥ 1`);
      if (t % N !== 0) { info.reason = 'trigger'; return info; }
    } else if (a.trigger === 'rise') {
      const c = !!this.evalAt(condFn, a.id, '条件');
      const fire = c && !this.prev[a.id];
      this.prev[a.id] = c;
      if (!fire) { info.reason = c ? 'trigger' : 'cond'; return info; }
    }
    const times = C[a.id + ':times'] ? Math.min(1000, Math.max(0, Math.floor(this.evalAt(C[a.id + ':times'], a.id, '执行次数')))) : 1;
    for (let k = 0; k < times; k++) {
      if (condFn && (a.trigger !== 'rise' || k > 0) && !this.evalAt(condFn, a.id, '条件')) { info.reason = 'cond'; break; }
      if (C[a.id + ':chance']) { const p = this.evalAt(C[a.id + ':chance'], a.id, '概率'); if (!(this.rng() < p)) { info.reason = 'chance'; break; } }
      const ins = io.ins.map(e => ({ e, p: G.node(e.from), amt: Math.max(0, this.evalAt(C[e.id + ':amount'], e.id, '消耗量')) }));
      const outs = io.outs.map(e => ({ e, p: G.node(e.to), amt: Math.max(0, this.evalAt(C[e.id + ':amount'], e.id, '产出量')) }));
      let ratio = 1, short = null;
      for (const i of ins) {
        const have = Math.max(0, this.val[i.p.id]);
        if (have + 1e-9 < i.amt) { const r = have / i.amt; if (r < ratio) { ratio = r; short = { i, have }; } }
      }
      const shortText = () => `${short.i.p.name} 需 ${fmt(short.i.amt)}，有 ${fmt(short.have)}`;
      if (short && (a.mode === 'all' || ratio <= 0)) { info.reason = 'short'; info.detail = shortText(); info.shortPool = short.i.p.name; break; }
      if (outs.length && outs.every(o => room(o.p) <= 0)) { info.reason = 'full'; info.detail = outs.map(o => o.p.name).join('、'); break; }
      for (const i of ins) { const take = i.amt * ratio; this.val[i.p.id] -= take; flows[i.e.id] = (flows[i.e.id] || 0) + take; vars[i.p.id] = this.val[i.p.id]; }
      for (const o of outs) { const give = Math.min(o.amt * ratio, room(o.p)); this.val[o.p.id] += give; flows[o.e.id] = (flows[o.e.id] || 0) + give; vars[o.p.id] = this.val[o.p.id]; }
      info.n++;
      this.refreshDerived();
      if (ratio < 1) { info.reason = 'short'; info.detail = shortText() + '（按比例执行）'; info.shortPool = short.i.p.name; break; }
    }
    return info;
  }

  /** 推进 1 tick；失败返回 false，原因见 lastFail / error */
  step() {
    const V = this.V;
    if (V.ids.size) { this.lastFail = 'invalid'; return false; }
    if (this.error) { this.lastFail = 'halted'; return false; }
    const t = this.tick + 1;
    const bak = { val: { ...this.val }, fval: { ...this.fval }, cap: { ...this.cap }, prev: { ...this.prev }, stats: JSON.parse(JSON.stringify(this.stats)) };
    const flows = {}, act = {};
    this.scope.vars = this.snapshotVars(t);
    try {
      this.refreshDerived();
      for (const a of V.actions) {
        const info = this.runAction(a, t, flows), st = this.stats[a.id], io = V.io[a.id];
        for (const e of [...io.ins, ...io.outs]) if (!(e.id in flows)) flows[e.id] = 0;
        st.fired += info.n;
        if (!info.n && info.reason) { st[info.reason]++; if (info.shortPool) st.shortBy[info.shortPool] = (st.shortBy[info.shortPool] || 0) + 1; }
        act[a.id] = info;
      }
      for (const id in this.val) if (!Number.isFinite(this.val[id])) throw new SimError(id, `数值溢出：${this.G.node(id)?.name} = ${this.val[id]}`);
    } catch (err) {
      Object.assign(this, bak);
      if (err instanceof SimError) { this.error = { id: err.id, msg: err.message }; this.lastFail = 'runtime'; return false; }
      throw err;
    }
    this.tick = t; this.flows = flows; this.act = act; this.record();
    return true;
  }

  run(n) { for (let i = 0; i < n; i++) if (!this.step()) break; return this; }
}

export function reasonText(info) {
  switch (info.reason) {
    case 'trigger': return '未到触发时机';
    case 'cond': return '条件不满足';
    case 'chance': return '概率未命中';
    case 'short': return '资源不足' + (info.detail ? `（${info.detail}）` : '');
    case 'full': return '产出目标已满' + (info.detail ? `（${info.detail}）` : '');
    default: return '';
  }
}
