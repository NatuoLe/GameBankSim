// 核心逻辑单元测试（无需浏览器）：node tests/selftest.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, renameInExpr } from '../js/core/expr.js';
import { normalizeGraph, actionDefaults } from '../js/core/model.js';
import { validate } from '../js/core/validate.js';
import { Simulator, HIST_MAX } from '../js/core/sim.js';
import { TableStore } from '../js/core/tables.js';
import { jsonToTable, lubanAoa, parseCSV } from '../js/core/parse.js';
import { mulberry32 } from '../js/core/util.js';
import * as E from '../js/core/edit.js';
import { exampleGraph } from '../js/examples.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ', name); }
  catch (e) { failed++; console.error('  FAIL ', name, '\n       ', e.message); }
}

const loadTables = G => {
  const T = new TableStore();
  for (const d of G.tables) {
    const t = jsonToTable(JSON.parse(fs.readFileSync(path.join(root, d.path), 'utf8')));
    T.put(d.alias, t.cols, t.rows, d.keyField);
  }
  return T;
};
const simulate = (raw, n, T) => {
  const { graph: G } = normalizeGraph(raw);
  T = T || loadTables(G);
  const V = validate(G, T);
  assert.deepEqual(V.err, {}, '校验错误：' + JSON.stringify(V.err));
  return { G, V, T, sim: new Simulator(G, V, T).run(n) };
};
const byName = (G, h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k === 'tick' ? k : G.node(k).name, v]));
const scope = (vars = {}, extra = {}) => ({ vars, rng: mulberry32(1), table: () => { throw new Error('no table'); }, member: () => { throw new Error('no member'); }, ...extra });
const ev = (src, vars, extra) => compile(src).fn(scope(vars, extra));
const evErr = src => { try { compile(src); return null; } catch (e) { return e.message; } };

console.log('表达式');
test('运算优先级 / 幂右结合 / 三元', () => {
  assert.equal(ev('-2^2'), -4);
  assert.equal(ev('2^3^2'), 512);
  assert.equal(ev('x>5 ? 1 : 2', { x: 6 }), 1);
  assert.equal(ev('clamp(15,0,10)+round(3.14159,2)'), 13.14);
  assert.equal(ev('if(0, 1, 2) + (1>=1 && 2)'), 3);
});
test('中文标识符与查表注入', () => {
  const table = (a, k, f) => (a === '等级表' && k === 3 && f === 'exp_need' ? 156 : NaN);
  assert.equal(ev('等级表[等级+1].exp_need*2', { 等级: 2 }, { table }), 312);
  const c = compile('道具表[1001].max_stack + 金币.init');
  assert.deepEqual(c.refs.map(r => r.kind), ['table', 'member']);
});
test('语法错误定位', () => {
  assert.match(evErr('1+*2'), /意外的 "\*" @3/);
  assert.match(evErr('等级表[1]'), /需要指定字段/);
  assert.match(evErr('foo(1)'), /未知函数/);
  assert.match(evErr('if(1,2)'), /需要 3 个参数/);
});
test('改名只替换变量，不碰字段与函数', () => {
  assert.equal(renameInExpr('金币*2+道具表[1].金币+金币.init+min(金币,3)', '金币', 'gold'), 'gold*2+道具表[1].金币+gold.init+min(gold,3)');
});
test('随机函数受种子控制', () => {
  const f = compile('randint(1,100)').fn;
  const a = [1, 2, 3].map(((s) => () => f(s))(scope({}, { rng: mulberry32(7) })));
  const b = [1, 2, 3].map(((s) => () => f(s))(scope({}, { rng: mulberry32(7) })));
  assert.deepEqual(a, b);
});

console.log('数据表');
test('Luban 源表 csv：识别 ##var，跳过 ##type/注释', () => {
  const t = lubanAoa(parseCSV(fs.readFileSync(path.join(root, 'sample/tbshop.csv'), 'utf8')));
  assert.deepEqual(t.cols, ['id', 'name', 'price', 'gain']);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[1].gain, '3500');
});
test('TableStore 主键归一化与报错', () => {
  const T = new TableStore();
  T.put('t', ['id', 'v', 's'], [{ id: '1001', v: '5', s: 'abc' }], 'id');
  assert.equal(T.num('t', 1001, 'v'), 5);
  assert.equal(T.num('t', '1001.0', 'v'), 5);
  assert.throws(() => T.num('t', 9, 'v'), /不存在主键 9/);
  assert.throws(() => T.num('t', 1001, 's'), /不是数字/);
});

console.log('模拟');
test('示例 200 tick 结果', () => {
  const { G, V, sim } = simulate(exampleGraph(), 200);
  const last = sim.history.at(-1);
  assert.equal(last.n4, 8);
  assert.equal(last.n1, 10);
  assert.equal(last.n3, 94);
  assert.equal(sim.history[0].n1, 500, '初始金币来自 道具表[1001].init');
  assert.deepEqual([...V.compact].map(id => G.node(id).name), ['兑换']);
  const st = id => sim.stats[id];
  assert.equal(st('a7').fired, 7);
  assert.equal(st('a7').shortBy.经验, 193);
  assert.equal(st('a4').trigger, 180);
  assert.equal(st('a5').fired + st('a5').chance, 40);
});
test('边沿触发 / 按比例执行 / 上限截断', () => {
  const { sim } = simulate({ version: 4, tables: [], nodes: [
    { id: 'p1', type: 'pool', name: '金', init: '0', cap: '50' },
    { id: 'p2', type: 'pool', name: '奖', init: '0' },
    { id: 'a1', type: 'action', name: '产' },
    { id: 'a2', type: 'action', name: '解锁', trigger: 'rise', condition: 'p1>=30' },
    { id: 'a3', type: 'action', name: '漏', mode: 'partial', trigger: 'every', every: '7' },
  ], edges: [
    { id: 'e1', from: 'a1', to: 'p1', amount: '10' },
    { id: 'e2', from: 'a2', to: 'p2', amount: '1' },
    { id: 'e3', from: 'p1', to: 'a3', amount: '100' },
  ] }, 20);
  assert.deepEqual(sim.history.map(h => h.p1), [0, 10, 20, 30, 40, 50, 50, 0, 10, 20, 30, 40, 50, 50, 0, 10, 20, 30, 40, 50, 50]);
  assert.deepEqual(sim.history.map(h => h.p2), [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3]);
  assert.equal(sim.stats.a1.full, 5);
});
test('全有或全无 + 同 tick 多次执行', () => {
  const { sim } = simulate({ version: 4, tables: [], nodes: [
    { id: 'p1', type: 'pool', name: '金', init: '350' },
    { id: 'p2', type: 'pool', name: '钻', init: '0' },
    { id: 'a1', type: 'action', name: '买', times: '10' },
  ], edges: [
    { id: 'e1', from: 'p1', to: 'a1', amount: '100' },
    { id: 'e2', from: 'a1', to: 'p2', amount: '1' },
  ] }, 1);
  assert.equal(sim.val.p1, 50);
  assert.equal(sim.val.p2, 3);
  assert.equal(sim.act.a1.n, 3);
  assert.equal(sim.act.a1.reason, 'short');
});
test('同一种子结果可复现', () => {
  const a = simulate(exampleGraph(), 100).sim.history, b = simulate(exampleGraph(), 100).sim.history;
  assert.deepEqual(a, b);
});
test('运行时熔断并回滚本 tick', () => {
  const { sim } = simulate({ version: 4, tables: [], nodes: [
    { id: 'p1', type: 'pool', name: '金', init: '1' },
    { id: 'a1', type: 'action', name: '炸' },
  ], edges: [{ id: 'e1', from: 'a1', to: 'p1', amount: '1/(2-tick)' }] }, 10);
  assert.equal(sim.tick, 1);
  assert.equal(sim.val.p1, 2, '第 2 tick 熔断，资源回滚到第 1 tick 结束时');
  assert.equal(sim.error.id, 'e1');
  assert.match(sim.error.msg, /结果为 Infinity/);
  assert.equal(sim.step(), false);
  assert.equal(sim.lastFail, 'halted');
});

console.log('校验 / 迁移 / 编辑');
test('公式循环依赖', () => {
  const { graph: G } = normalizeGraph({ version: 4, tables: [], edges: [], nodes: [
    { id: 'f1', type: 'formula', name: 'A', expr: 'f2+1' }, { id: 'f2', type: 'formula', name: 'B', expr: 'f1*2' }] });
  assert.match(validate(G, new TableStore()).err['f1:expr'], /循环依赖：f1（A） → f2（B） → f1（A）/);
});
test('按 id 引用：名称可重复/任意修改，不影响表达式；误用名称给出 id 提示', () => {
  const { graph: G } = normalizeGraph({ version: 4, tables: [], nodes: [
    { id: 'n1', type: 'pool', name: '金币', init: '100' },
    { id: 'n2', type: 'pool', name: '金币', init: '0' },
    { id: 'f1', type: 'formula', name: '双倍', expr: 'n1*2' },
    { id: 'a1', type: 'action', name: '转' },
  ], edges: [{ id: 'e1', from: 'n1', to: 'a1', amount: 'f1/20' }, { id: 'e2', from: 'a1', to: 'n2', amount: '1' }] });
  const T = new TableStore();
  let V = validate(G, T);
  assert.deepEqual(V.err, {}, '重名不再是错误');
  assert.equal(E.applyRename(G, G.node('f1'), '任意 名称!'), null);
  assert.equal(G.node('f1').name, '任意 名称!');
  assert.equal(G.edge('e1').amount, 'f1/20', '改名不改表达式');
  V = validate(G, T);
  const sim = new Simulator(G, V, T).run(1);
  assert.equal(sim.val.n1, 90);
  G.edge('e1').amount = '任意';
  G.node('f1').name = '任意';
  V = validate(G, T);
  assert.match(V.err['e1:amount'], /"任意" 是节点名称，表达式中请用 id 引用：f1/);
  assert.deepEqual(E.refsTo(G, 'n1').map(r => r.owner.id), ['f1']);
});
test('v3 图（按名称引用）自动迁移为按 id 引用', () => {
  const { graph: G, migrated } = normalizeGraph({ version: 3, tables: [{ alias: '表', path: 'x.json', keyField: 'id' }], nodes: [
    { id: 'n1', type: 'pool', name: '金币', init: '0' },
    { id: 'n2', type: 'pool', name: '道具_1', init: '道具_1.init', row: { table: '表', key: 1 } },
    { id: 'f1', type: 'formula', name: '速度', expr: '金币*2 + 表[金币].v + 道具_1.cap + min(金币, tick)' },
    { id: 'a1', type: 'action', name: '产', condition: '速度 > 金币' },
  ], edges: [{ id: 'e1', from: 'a1', to: 'n1', amount: '速度' }] });
  assert.match(migrated, /节点 id/);
  assert.equal(G.version, 4);
  assert.equal(G.node('f1').expr, 'n1*2 + 表[n1].v + n2.cap + min(n1, tick)');
  assert.equal(G.node('n2').init, 'n2.init');
  assert.equal(G.node('a1').condition, 'f1 > n1');
  assert.equal(G.edge('e1').amount, 'f1');
  assert.equal(normalizeGraph(JSON.parse(JSON.stringify(G))).migrated, '', 'v4 不再迁移');
});
test('非法节点 id 自动修正并同步引用', () => {
  const { graph: G } = normalizeGraph({ version: 4, nextId: 5, tables: [], nodes: [
    { id: 'tick', type: 'pool', name: 'A', init: '0' }, { id: '1x', type: 'formula', name: 'B', expr: 'tick+1' }, { id: 'a1', type: 'action', name: 'C' },
  ], edges: [{ id: 'e1', from: 'a1', to: 'tick', amount: '1' }] });
  const ids = G.nodes.map(n => n.id);
  assert.ok(!ids.includes('tick') && !ids.includes('1x'));
  assert.equal(G.edge('e1').to, ids[0]);
  assert.equal(G.nodes[1].expr, `${ids[0]}+1`);
});
test('旧模型自动迁移，结果与旧引擎一致', () => {
  const raw = { nextId: 10, nodes: [
    { id: 'n1', type: 'source', name: '产出源', x: 0, y: 0 },
    { id: 'n2', type: 'pool', name: '金币', x: 200, y: 0, init: 0 },
    { id: 'n3', type: 'drain', name: '日常消耗', x: 400, y: 0 },
    { id: 'n4', type: 'converter', name: '兑换', x: 200, y: 150, rateIn: '100', rateOut: '1' },
    { id: 'n5', type: 'pool', name: '钻石', x: 200, y: 300, init: 0 },
    { id: 'n6', type: 'gate', name: '十连门', x: 400, y: 300, condition: '钻石>=5' },
    { id: 'n7', type: 'drain', name: '十连抽消耗', x: 600, y: 300 },
  ], edges: [
    { id: 'e1', from: 'n1', to: 'n2', rate: '10' }, { id: 'e2', from: 'n2', to: 'n3', rate: '3' },
    { id: 'e3', from: 'n2', to: 'n4', rate: '' }, { id: 'e4', from: 'n4', to: 'n5', rate: '' },
    { id: 'e5', from: 'n5', to: 'n6', rate: '5' }, { id: 'e6', from: 'n6', to: 'n7', rate: '' },
  ] };
  assert.ok(normalizeGraph(raw).migrated);
  const { G, sim } = simulate(raw, 200, new TableStore());
  const last = byName(G, sim.history.at(-1));
  assert.equal(last.金币, 0);
  assert.equal(last.钻石, 4);
  assert.equal(last.兑换, 14);
  assert.equal(last.十连门, 2);
  assert.equal(G.nodes.find(n => n.name === '十连门').condition, G.nodes.find(n => n.name === '钻石').id + '>=5');
});
test('tbitem.1003 解析并绑定：显示名取行的 name，id 不变，引用不受影响', () => {
  const { graph: G } = normalizeGraph(exampleGraph());
  const T = loadTables(G);
  assert.deepEqual(E.resolveRowRef(G, T, 'tbitem.1003'), { alias: '道具表', key: 1003 });
  assert.match(E.resolveRowRef(G, T, 'tbitem.9999').err, /不存在主键 9999/);
  assert.match(E.resolveRowRef(G, T, 'tbx.1').err, /未找到数据表/);
  assert.equal(E.resolveRowRef(G, T, '普通名字'), null);
  const p = E.createNode(G, 'pool', { x: 0, y: 0 });
  G.edges.push({ id: 'ex', from: p.id, to: 'a2', amount: `${p.id}*0.5` });
  const id = p.id;
  E.bindPoolToRow(G, T, p, '道具表', 1003);
  assert.equal(p.id, id);
  assert.equal(p.name, '经验');
  assert.equal(G.edge('ex').amount, `${id}*0.5`);
  const spec = E.newCurrencySpec(G, T, '道具表', T.ok('道具表').cols, T.find('道具表', 1001), 1001, 'n77');
  assert.deepEqual([spec.name, spec.init, spec.cap], ['金币', 'n77.init', 'n77.max_stack']);
});
test('连接两个资源池自动创建折叠的「转移」行为', () => {
  const { graph: G } = normalizeGraph(exampleGraph());
  const V = validate(G, loadTables(G));
  const r = E.link(G, V, 'n1', 'n2');
  assert.equal(r.ok, true);
  const act = G.node(r.selectId);
  assert.equal(act.type, 'action');
  assert.equal(act.compact, true);
  assert.equal(E.link(G, V, 'a1', 'a2').ok, false);
});
test('无限运行：历史超过上限后抽稀，末尾始终是当前 tick', () => {
  const raw = {
    version: 4, nextId: 10, seed: 1, tables: [],
    nodes: [{ id: 'p', type: 'pool', name: 'P', x: 0, y: 0, init: '0', cap: '' }, actionDefaults({ id: 'a', type: 'action', name: 'A', x: 0, y: 0 })],
    edges: [{ id: 'e', from: 'a', to: 'p', amount: '1' }],
  };
  const N = HIST_MAX * 2 + 123, { sim } = simulate(raw, N, new TableStore());
  const H = sim.history;
  assert.ok(H.length <= HIST_MAX + 1, `history ${H.length}`);
  assert.equal(H[0].tick, 0);
  assert.equal(H.at(-1).tick, N);
  assert.equal(H.at(-1).p, N);
  assert.ok(H.slice(0, -1).every(h => h.tick % sim.histStride === 0), '采样点对齐');
  for (let i = 1; i < H.length; i++) assert.ok(H[i].tick > H[i - 1].tick);
  for (let k = 0; k < 7; k++) sim.step();
  assert.equal(sim.history.at(-1).tick, N + 7);
  assert.equal(sim.history.filter(h => h.tick % sim.histStride !== 0).length <= 1, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
