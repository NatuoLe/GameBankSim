// 应用操作：UI 调用这里修改状态；这里调用 core，持久化，然后发事件。不直接操作具体 UI 模块。
import { S, emit } from './state.js';
import { validate } from '../core/validate.js';
import { Simulator } from '../core/sim.js';
import { normalizeGraph } from '../core/model.js';
import { keyLit } from '../core/util.js';
import * as E from '../core/edit.js';
import { fetchParsed } from '../io/loader.js';
import { toast } from '../ui/dom.js';

const LS_GRAPH = 'num-sim.graph.v4', LS_OLD = ['num-sim.graph.v3', 'num-sim.graph.v2', 'num-sim.graph.v1'], LS_UI = 'num-sim.ui.v1';
export const LS_DIR = 'num-sim.lbdir';

/* ---------- 持久化 ---------- */
export function loadStoredGraph() {
  for (const key of [LS_GRAPH, ...LS_OLD]) {
    try {
      const g = JSON.parse(localStorage.getItem(key));
      if (g && Array.isArray(g.nodes) && Array.isArray(g.edges)) return normalizeGraph(g);
    } catch (_) { /* ignore */ }
  }
  return null;
}
export function saveGraph() {
  if (!S.G) return;
  S.G.view = { ...S.ui.view };
  localStorage.setItem(LS_GRAPH, JSON.stringify(S.G));
}
export function loadPrefs() {
  try {
    const u = JSON.parse(localStorage.getItem(LS_UI)) || {};
    S.ui.lastRunN = u.lastRunN ?? null;
    S.ui.vis = u.vis || {};
    if (u.ticks) S.prefs.ticks = u.ticks;
    if (u.autoRerun === false) S.prefs.autoRerun = false;
    if (u.norm) S.prefs.norm = true;
    if (SPEEDS.includes(u.speed)) S.prefs.speed = u.speed;
  } catch (_) { /* ignore */ }
}
export function savePrefs() { localStorage.setItem(LS_UI, JSON.stringify({ lastRunN: S.ui.lastRunN, vis: S.ui.vis, ...S.prefs })); }

/* ---------- 查询（供 UI 使用） ---------- */
export const rowLabelOf = n => E.rowLabel(S.G, S.tables, n);
export const boundRowOf = n => E.boundRow(S.tables, n);
export const selectedNode = () => (S.ui.sel && S.ui.sel.kind === 'node' ? S.G.node(S.ui.sel.id) : null);
/** 节点的「id · 名称」显示文本 */
export const nodeTag = n => (n ? (n.name && n.name !== n.id ? `${n.id}·${n.name}` : n.id) : '?');
/** 引用了某个变量 id 的表达式位置 */
export const refsTo = id => E.refsTo(S.G, id);

/* ---------- 校验与模拟 ---------- */
export function revalidate() { S.V = validate(S.G, S.tables); }
export function resetSim() { S.sim = new Simulator(S.G, S.V, S.tables); emit('sim'); }
export function runSim(n) {
  const t0 = performance.now();
  S.sim = new Simulator(S.G, S.V, S.tables);
  if (!S.V.ids.size && !S.sim.error) S.sim.run(n);
  S.ui.lastRunN = n;
  emit('sim');
  return performance.now() - t0;
}
const FAIL_MSG = { invalid: '图中存在错误，请先修正（见右侧「检查」）', halted: '模拟已熔断，修正后点「重置」或「运行」' };
const failText = sim => (sim.lastFail === 'runtime' ? '模拟熔断：' + sim.error.msg : FAIL_MSG[sim.lastFail]);
export function stepSim() {
  pause();
  flushRerun();
  if (!S.sim || S.sim.V !== S.V) S.sim = new Simulator(S.G, S.V, S.tables);
  if (!S.sim.step()) toast(failText(S.sim), true);
  emit('sim');
}
export function rerun() {
  rerunT = 0;
  if (S.ui.playing) {
    // 播放中改图：用新图重放到当前 tick 后继续播放
    if (S.V.ids.size) { pause(); resetSim(); return toast(FAIL_MSG.invalid, true); }
    const t = S.sim ? S.sim.tick : 0;
    if (t > REPLAY_MAX) toast(`已运行 ${t} tick，超过 ${REPLAY_MAX}，改图后从 0 重新开始`);
    runSim(t > REPLAY_MAX ? 0 : t);
    if (S.sim.error) { pause(); toast('模拟熔断：' + S.sim.error.msg, true); }
    return;
  }
  if (S.prefs.autoRerun && S.ui.lastRunN != null && S.V.ids.size === 0) runSim(S.ui.lastRunN);
  else resetSim();
}

/* ---------- 持续运行 / 暂停 ---------- */
/** 播放速度选项（tick/秒），0 = 尽可能快 */
export const SPEEDS = [1, 2, 5, 10, 20, 50, 100, 500, 0];
const REPLAY_MAX = 50000, FRAME_BUDGET = 12, FRAME_MAX = 5000;
let playTimer = 0, playLast = 0, playAcc = 0, lastEmit = 0;
// 用定时器而不是 rAF 驱动：模拟与绘制解耦（绘制仍由各 UI 自己的 rAF 合并）
function playFrame() {
  playTimer = 0;
  if (!S.ui.playing) return;
  const now = performance.now(), sim = S.sim, sp = S.prefs.speed;
  const dt = Math.min(250, now - playLast); playLast = now;
  let ok = true, n = 0;
  if (sp > 0) {
    playAcc += dt * sp / 1000;
    const want = Math.floor(playAcc); playAcc -= want;
    while (n < want && (ok = sim.step())) if (++n % 64 === 0 && performance.now() - now > FRAME_BUDGET) { playAcc = 0; break; }
  } else {
    do { for (let i = 0; i < 32 && (ok = sim.step()); i++) n++; } while (ok && n < FRAME_MAX && performance.now() - now < FRAME_BUDGET);
  }
  if (!ok) { pause(); toast(failText(sim), true); emit('sim'); return; }
  // 高速时限制界面刷新频率（约 20 次/秒）
  if (n && ((sp > 0 && sp <= 20) || now - lastEmit >= 50)) { lastEmit = now; emit('sim'); }
  playTimer = setTimeout(playFrame, 16);
}
/** 从当前状态开始持续运行（不设上限，直到暂停或熔断） */
export function play() {
  if (S.ui.playing) return;
  flushRerun();
  if (S.V.ids.size) return toast(FAIL_MSG.invalid, true);
  if (!S.sim || S.sim.V !== S.V) S.sim = new Simulator(S.G, S.V, S.tables);
  if (S.sim.error) return toast(failText({ lastFail: 'runtime', error: S.sim.error }), true);
  S.ui.playing = true; playAcc = 0; playLast = performance.now(); lastEmit = 0;
  playTimer = setTimeout(playFrame, 16);
  emit('play');
}
/** 暂停；之后「改图自动重跑」会重放到暂停时的 tick */
export function pause() {
  if (!S.ui.playing) return;
  S.ui.playing = false;
  clearTimeout(playTimer); playTimer = 0;
  if (S.sim) { S.ui.lastRunN = S.sim.tick; savePrefs(); }
  emit('sim'); emit('play');
}
export const togglePlay = () => (S.ui.playing ? pause() : play());
export function setSpeed(sp) { S.prefs.speed = sp; playAcc = 0; savePrefs(); }
let rerunT = 0;
/** 立即执行防抖中的重跑（保证模拟器与最新校验结果一致） */
export function flushRerun() { if (rerunT) { clearTimeout(rerunT); rerun(); } }
/** 图数据被修改后调用：校验 → 保存 → 通知 → 延迟重跑 */
export function changed() {
  revalidate();
  saveGraph();
  clearTimeout(rerunT);
  rerunT = setTimeout(rerun, 120);
  emit('graph');
}
export function select(sel) { S.ui.sel = sel; emit('select'); }
export const refreshPanel = () => emit('panel');

/* ---------- 编辑 ---------- */
export function addNode(type, p, extra) {
  const n = E.createNode(S.G, type, p, extra);
  changed(); select({ kind: 'node', id: n.id });
  return n;
}
export function linkNodes(fromId, toId) {
  const r = E.link(S.G, S.V, fromId, toId);
  if (!r.ok) return toast(r.msg, true);
  changed(); select({ kind: 'node', id: r.selectId });
  if (r.msg) toast(r.msg);
}
/** 新建节点并与已有节点相连。dir='out'：other → 新节点；dir='in'：新节点 → other */
export function createLinked(type, p, otherId, dir) {
  const n = E.createNode(S.G, type, p);
  revalidate();
  const r = dir === 'out' ? E.link(S.G, S.V, otherId, n.id) : E.link(S.G, S.V, n.id, otherId);
  if (!r.ok) { E.removeNode(S.G, n.id); revalidate(); return toast(r.msg, true); }
  changed(); select({ kind: 'node', id: n.id });
  if (r.msg) toast(r.msg);
  return n;
}
function dropStaleSelection() {
  const s = S.ui.sel;
  if (s && !S.G.node(s.id) && !S.G.edge(s.id)) select(null);
}
export function deleteNode(id) { E.removeNode(S.G, id); delete S.ui.vis[id]; dropStaleSelection(); changed(); }
export function deleteEdge(id) { E.removeEdge(S.G, id); dropStaleSelection(); changed(); }
export function deleteSelection() {
  const s = S.ui.sel; if (!s) return;
  if (s.kind === 'node') deleteNode(s.id); else deleteEdge(s.id);
}
/** 修改节点/连线的普通字段 */
export function setField(obj, f, v) { obj[f] = v; changed(); }
/** 修改显示名称（表达式按 id 引用，不受影响）；失败返回原因 */
export function renameNode(n, nv) {
  if (nv === n.name) return null;
  const m = E.applyRename(S.G, n, nv);
  if (!m) changed();
  return m;
}
export function moveAction(a, d) { if (E.moveAction(S.G, a, d)) { changed(); refreshPanel(); } }
export function setCompact(a, on) { if (on) a.compact = true; else E.expandAction(S.G, S.V, a); changed(); refreshPanel(); }

/* ---------- 数据行绑定 ---------- */
export function bindByRef(n, alias, key) {
  const ref = `${alias}[${keyLit(key)}]`;
  E.bindPoolToRow(S.G, S.tables, n, alias, key);
  changed(); refreshPanel();
  toast(`${n.id} 已绑定 ${ref}，显示名称 → ${n.name}；表达式中用 ${n.id}.字段 引用该行`);
}
/** 名称框输入 `tbitem.1001`：不是引用返回 null；失败返回 { err }；成功返回 { ok } */
export function tryBindByText(n, text) {
  const r = E.resolveRowRef(S.G, S.tables, text);
  if (!r) return null;
  if (r.err) return r;
  bindByRef(n, r.alias, r.key);
  return { ok: true };
}
export function unbindRow(n) { delete n.row; changed(); refreshPanel(); }
export function newCurrency(alias, cols, row, key, pos) {
  const n = addNode('pool', pos, nn => E.newCurrencySpec(S.G, S.tables, alias, cols, row, key, nn.id));
  toast(`已新建货币 ${n.id}「${n.name}」⛓ ${E.rowRefText(n.row)}`);
}

/* ---------- 数据表 ---------- */
export async function loadTable(def) {
  S.tables.loading(def.alias);
  try {
    const p = await fetchParsed(def.path, def.sheet);
    if (!p.cols.includes(def.keyField)) throw new Error(`没有主键字段 "${def.keyField}"`);
    S.tables.put(def.alias, p.cols, p.rows, def.keyField);
  } catch (e) { S.tables.fail(def.alias, e.message); }
}
export function tablesChanged() { revalidate(); saveGraph(); emit('tables'); rerun(); }
export async function reloadTables() {
  S.G.tables.forEach(d => S.tables.loading(d.alias));
  emit('tables');
  await Promise.all(S.G.tables.map(loadTable));
  tablesChanged();
  return S.G.tables.filter(d => !S.tables.ok(d.alias));
}
export async function reloadTable(d) { await loadTable(d); tablesChanged(); return S.tables.get(d.alias); }
/** 注册数据表；返回被忽略（主键为空或重复）的行数 */
export function registerTable(def, cols, rows) {
  S.G.tables.push(def);
  const t = S.tables.put(def.alias, cols, rows, def.keyField);
  tablesChanged();
  return rows.length - t.index.size;
}
export function removeTable(d) { S.G.tables = S.G.tables.filter(x => x !== d); S.tables.remove(d.alias); tablesChanged(); }
export function renameTable(d, nv) { const m = E.renameTable(S.G, S.tables, d, nv); if (!m) tablesChanged(); return m; }
export function setLabelField(d, f) { d.labelField = f || null; saveGraph(); emit('tables'); }

/* ---------- 整图替换 ---------- */
export async function loadGraphObj(raw, msg, autoRun) {
  pause();
  const { graph, migrated } = normalizeGraph(raw);
  S.G = graph;
  S.tables.clear();
  S.ui.sel = null; S.ui.vis = {}; S.ui.lastRunN = autoRun ? S.prefs.ticks : null;
  revalidate(); resetSim();
  emit('loaded'); emit('select'); emit('fit');
  changed();
  if (msg) toast(msg + (migrated ? `（${migrated}）` : ''));
  await reloadTables();
}
export function setSeed(s) { S.G.seed = s; changed(); }
