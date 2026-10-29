// 画布：节点/端口/连线绘制、命中测试、拖拽/平移/缩放、右键菜单、编辑模式
// 节点统一为长方形：顶部标题栏 + 内容区；上边是入口端口，下边是出口端口。
import { S, on } from '../app/state.js';
import * as A from '../app/actions.js';
import { TYPES, actionSummary } from '../core/model.js';
import { fmt, trunc } from '../core/util.js';
import { rowRefText } from '../core/edit.js';
import { $ } from './dom.js';
import { NW, NH, HEAD, PR, visible, computeLayout, freeSlot, curve, bezPt, curveDist, hitNode, hitPort, canLink } from './ports.js';
import { openMenu } from './menu.js';
import { insertRef } from './autocomplete.js';

const STATUS_COLOR = { ok: '#3ecf6e', trigger: '#5a6070', cond: '#b26bff', chance: '#9aa7ff', short: '#ff5d5d', full: '#ffa940' };
const EDGE_COLOR = { in: '#b88484', out: '#74b38c' };
const TYPE_ICON = { pool: '◉', action: '▶', formula: 'ƒ' };
const MODE_TIP = {
  select: '选择：拖动节点移动；从端口拖出连线（上入下出），拖到目标节点上松开即连接，松开在空白处可新建；右键菜单；右键/空白拖动平移，滚轮缩放',
  link: '连线：先点起点再点终点（点上方入口端口则反向）；资源池→行为 = 消耗，行为→资源池 = 产出，资源池→资源池 = 自动创建「转移」（Esc 退出）',
  delete: '删除：点击节点或连线即删除',
};
let cv, ctx, dpr = 1, raf = 0, drag = null, LY = null, hoverPort = null, rmMoved = false, linkOnce = false;

export function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
export function resize() {
  const r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  draw();
}
function toWorld(ev) {
  const r = cv.getBoundingClientRect(), v = S.ui.view;
  return { x: (ev.clientX - r.left - v.ox) / v.s, y: (ev.clientY - r.top - v.oy) / v.s };
}
export function viewCenter() {
  const r = cv.getBoundingClientRect(), v = S.ui.view;
  return { x: (r.width / 2 - v.ox) / v.s + (Math.random() - 0.5) * 60, y: (r.height / 2 - v.oy) / v.s + (Math.random() - 0.5) * 60 };
}

/* ---------- 连线几何与命中 ---------- */
const portTol = () => Math.max(PR + 4, 9 / S.ui.view.s);
const portKey = p => `${p.node.id}:${p.dir}:${p.i}`;
/** 画布上的可见连线：普通连线 + 折叠成连线的行为；c 为贝塞尔控制点 */
function visualLinks(L) {
  const { G, V } = S, out = [];
  const end = (m, e, id) => m.get(e.id) || (n => ({ x: n.x, y: n.y }))(G.node(id));
  for (const e of G.edges) {
    if (!G.node(e.from) || !G.node(e.to)) continue;
    const act = G.ownerAction(e);
    if (act && V.compact.has(act.id)) continue;
    out.push({ kind: 'edge', id: e.id, c: curve(end(L.from, e, e.from), end(L.to, e, e.to)) });
  }
  for (const id of V.compact) {
    const io = V.io[id], ei = io.ins[0], eo = io.outs[0];
    out.push({ kind: 'compact', id, c: curve(end(L.from, ei, ei.from), end(L.to, eo, eo.to)) });
  }
  return out;
}
function hitLink(L, p) {
  let best = null, bd = 8 / S.ui.view.s;
  for (const l of visualLinks(L)) { const d = curveDist(p, l.c); if (d < bd) { bd = d; best = l; } }
  return best;
}
/** 节点或折叠行为（连线）作为连线目标 */
function targetAt(L, p) {
  const n = hitNode(L, p); if (n) return n;
  const l = hitLink(L, p);
  return l && l.kind === 'compact' ? S.G.node(l.id) : null;
}

/* ---------- 绘制 ---------- */
function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x - w + r, y - h); ctx.arcTo(x + w, y - h, x + w, y + h, r); ctx.arcTo(x + w, y + h, x - w, y + h, r);
  ctx.arcTo(x - w, y + h, x - w, y - h, r); ctx.arcTo(x - w, y - h, x + w, y - h, r); ctx.closePath();
}
/** 按宽度截断（以当前 ctx.font 测量） */
function fit(s, maxW) {
  s = String(s ?? '');
  if (ctx.measureText(s).width <= maxW) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function strokeCurve(c) {
  ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y);
  ctx.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y); ctx.stroke();
}
/** 箭头：曲线末端竖直向下，尖端停在入口端口上缘 */
function arrowAt(p, col) {
  const y = p.y - PR - 1;
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x - 4.5, y - 9); ctx.lineTo(p.x + 4.5, y - 9); ctx.closePath(); ctx.fill();
}
function labelBox(text, x, y, color, bg) {
  ctx.font = '12px Consolas,"Microsoft YaHei",sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.rect(x - w / 2, y - 9, w, 18); ctx.fill();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y);
  return w;
}
function statusDot(x, y, col) {
  if (!col) return;
  ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#14161b'; ctx.stroke();
}
const isBad = id => S.V.ids.has(id) || !!(S.sim && S.sim.error && S.sim.error.id === id);
function statusOf(a) {
  const sim = S.sim;
  if (!sim || !sim.tick) return null;
  const info = sim.act[a.id]; if (!info) return null;
  return info.n > 0 ? STATUS_COLOR.ok : STATUS_COLOR[info.reason] || STATUS_COLOR.trigger;
}
function edgeColor(e) {
  const own = S.G.ownerAction(e);
  if (isBad(e.id)) return '#ff5d5d';
  if (own && S.V.compact.has(own.id)) return TYPES.action.color;
  return EDGE_COLOR[S.V.kind[e.id]] || '#7d869c';
}
function drawPorts(L, wireTarget) {
  const T = TYPES[L.n.type];
  for (const p of [...L.ins, ...L.outs]) {
    const hov = hoverPort === portKey(p), tgt = wireTarget === p;
    ctx.beginPath(); ctx.arc(p.x, p.y, PR + (hov || tgt ? 1.5 : 0), 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    if (p.edge) {
      ctx.fillStyle = edgeColor(p.edge); ctx.fill();
      ctx.strokeStyle = hov ? '#ffffff' : '#14161b'; ctx.stroke();
    } else {
      ctx.fillStyle = tgt ? '#4f8cff' : '#14161b'; ctx.fill();
      ctx.strokeStyle = tgt ? '#bcd3ff' : hov ? '#ffffff' : T.color; ctx.stroke();
    }
  }
}
/** 节点内容：[标题行文字, 主行文字, 主行样式, 副行文字, 副行颜色] */
function nodeText(n) {
  const sim = S.sim;
  if (n.type === 'pool') {
    const lbl = n.row ? A.rowLabelOf(n) : '';
    return { main: fmt(sim ? sim.val[n.id] : 0), mainFont: 'bold 15px "Segoe UI",sans-serif', mainCol: '#ffffff',
      sub: n.row ? `⛓ ${rowRefText(n.row)}${lbl ? ' · ' + lbl : ''}` : (n.cap && n.cap.trim() ? '上限 ' + n.cap.trim() : ''), subCol: n.row ? '#5fe0c4' : '#8a91a3' };
  }
  if (n.type === 'formula') {
    return { main: fmt(sim ? sim.fval[n.id] : NaN), mainFont: 'bold 14px "Segoe UI",sans-serif', mainCol: '#ffffff', sub: '= ' + String(n.expr || ''), subCol: '#8a91a3' };
  }
  return { main: actionSummary(n), mainFont: '11px "Segoe UI","Microsoft YaHei",sans-serif', mainCol: '#e3d7a8',
    sub: n.condition.trim() ? '当 ' + n.condition.trim() : '', subCol: '#b79bdc' };
}
function drawNode(n, L, hl) {
  const { ui, sim } = S, T = TYPES[n.type], { x, y } = n, { hw, hh } = L;
  const isSel = ui.sel && ui.sel.id === n.id, bad = isBad(n.id);
  ctx.shadowColor = '#0009'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  rrect(x, y, hw, hh, 7); ctx.fillStyle = '#1d212b'; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.save(); ctx.clip();
  ctx.fillStyle = T.color + '3a'; ctx.fillRect(x - hw, y - hh, hw * 2, HEAD);
  ctx.fillStyle = T.color; ctx.fillRect(x - hw, y - hh + HEAD - 1, hw * 2, 1);
  ctx.restore();
  rrect(x, y, hw, hh, 7);
  ctx.lineWidth = isSel ? 2.6 : 1.6;
  ctx.strokeStyle = bad ? '#ff5d5d' : hl ? '#4f8cff' : isSel ? '#ffffff' : T.color;
  if (n.type === 'formula') ctx.setLineDash([5, 3]);
  ctx.stroke(); ctx.setLineDash([]);

  const hy = y - hh + HEAD / 2, col = n.type === 'action' ? statusOf(n) : null;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = '11px "Segoe UI Symbol","Segoe UI",sans-serif'; ctx.fillStyle = T.color;
  ctx.fillText(TYPE_ICON[n.type], x - hw + 7, hy);
  // 资源池 / 公式：标题栏右侧显示表达式引用用的 id
  let idW = 0;
  if (n.type !== 'action') {
    ctx.font = 'bold 10.5px Consolas,monospace';
    idW = ctx.measureText(n.id).width + 8;
    const bx = x + hw - 5 - idW;
    ctx.fillStyle = '#0d1018cc'; ctx.beginPath(); ctx.rect(bx, hy - 7, idW, 14); ctx.fill();
    ctx.fillStyle = T.color; ctx.textAlign = 'center'; ctx.fillText(n.id, bx + idW / 2, hy + 0.5);
    ctx.textAlign = 'left'; idW += 4;
  }
  ctx.font = 'bold 12px "Segoe UI","Microsoft YaHei",sans-serif'; ctx.fillStyle = '#ffffff';
  ctx.fillText(fit(n.name, hw * 2 - 26 - idW - (col ? 14 : 0)), x - hw + 20, hy);
  statusDot(x + hw - 10, hy, col);
  const info = col && sim.act[n.id];
  if (info && info.n > 1) { ctx.fillStyle = '#7ee0a0'; ctx.font = 'bold 11px "Segoe UI",sans-serif'; ctx.fillText('×' + info.n, x + hw + 5, hy); }

  const t = nodeText(n), by = y + HEAD / 2, inner = hw * 2 - 14;
  const mainY = t.sub ? by - 7 : by, subY = by + 9;
  ctx.textAlign = 'center';
  ctx.font = t.mainFont; ctx.fillStyle = t.mainCol; ctx.fillText(fit(t.main, inner), x, mainY);
  if (t.sub) { ctx.font = '10.5px Consolas,"Microsoft YaHei",sans-serif'; ctx.fillStyle = t.subCol; ctx.fillText(fit(t.sub, inner), x, subY); }
}
/** 正在拖出的连线（端口拖拽或连线模式）：{ node, dir, p } */
function wireState() {
  if (drag && drag.type === 'wire') return drag.moved ? { node: drag.port.node, dir: drag.port.dir, p: drag.port } : null;
  const ui = S.ui;
  if (ui.mode !== 'link' || !ui.linkFrom) return null;
  const n = S.G.node(ui.linkFrom); if (!n) return null;
  return { node: n, dir: ui.linkDir, p: freeSlot(LY, n.id, ui.linkDir) || { x: n.x, y: n.y } };
}

function render() {
  const { G, V, sim, ui } = S;
  LY = computeLayout();
  const W = cv.width / dpr, H = cv.height / dpr, { ox, oy, s } = ui.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#14161b'; ctx.fillRect(0, 0, W, H);
  const gs = 40 * s;
  if (gs > 8) {
    ctx.fillStyle = '#262a34';
    for (let x = ((ox % gs) + gs) % gs; x < W; x += gs) for (let y = ((oy % gs) + gs) % gs; y < H; y += gs) ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  const hasRun = sim && sim.tick > 0, labels = [];
  for (const l of visualLinks(LY)) {
    const c = l.c, m = bezPt(c, 0.5);
    if (l.kind === 'edge') {
      const e = G.edge(l.id), k = V.kind[e.id], isSel = ui.sel && ui.sel.id === e.id, bad = isBad(e.id);
      const col = isSel && !bad ? '#ffffff' : edgeColor(e);
      ctx.strokeStyle = col; ctx.lineWidth = isSel ? 2.5 : 1.6; strokeCurve(c); arrowAt(c[3], col);
      let txt = k === 'in' || k === 'out' ? trunc(e.amount.trim() || '?', 22) : '';
      if (hasRun && sim.flows[e.id] !== undefined) txt += '  ▸' + fmt(sim.flows[e.id]);
      if (txt) labels.push(() => labelBox(txt, m.x, m.y, bad ? '#ff9a9a' : '#e6e9f0', '#1b1e25e6'));
    } else {
      const a = G.node(l.id), io = V.io[a.id], ei = io.ins[0], eo = io.outs[0];
      const isSel = ui.sel && ui.sel.id === a.id, bad = isBad(a.id) || isBad(ei.id) || isBad(eo.id);
      const col = bad ? '#ff5d5d' : isSel ? '#ffffff' : TYPES.action.color;
      ctx.strokeStyle = col; ctx.lineWidth = isSel ? 3 : 2.2; strokeCurve(c); arrowAt(c[3], col);
      const ai = ei.amount.trim() || '?', ao = eo.amount.trim() || '?';
      let txt = `${a.name}  ${ai === ao ? ai : ai + '→' + ao}`;
      if (hasRun) { const fi = fmt(sim.flows[ei.id] || 0), fo = fmt(sim.flows[eo.id] || 0); txt += '  ▸' + (fi === fo ? fi : `${fi}→${fo}`); }
      labels.push(() => {
        const w = labelBox(trunc(txt, 42), m.x, m.y, bad ? '#ff9a9a' : '#ffe9a8', '#262217ee');
        statusDot(m.x - w / 2 - 7, m.y, statusOf(a));
        const extra = [actionSummary(a), a.condition.trim() ? '当 ' + a.condition.trim() : ''].filter(Boolean).join(' · ');
        ctx.font = '11px Consolas,"Microsoft YaHei",sans-serif'; ctx.fillStyle = '#9a8f6a'; ctx.textAlign = 'center';
        ctx.fillText(trunc(extra, 44), m.x, m.y + 17);
      });
    }
  }
  const w = wireState();
  let wireTarget = null, wireNode = null;
  if (w) {
    const t = hitNode(LY, ui.mouse);
    let end = ui.mouse;
    if (t && canLink(w.node, t)) { wireNode = t; wireTarget = freeSlot(LY, t.id, w.dir === 'out' ? 'in' : 'out'); if (wireTarget) end = wireTarget; }
    ctx.strokeStyle = '#4f8cff'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.8;
    strokeCurve(w.dir === 'out' ? curve(w.p, end) : curve(end, w.p)); ctx.setLineDash([]);
  }
  for (const n of G.nodes) {
    const L = LY.nodes.get(n.id); if (!L) continue;
    drawNode(n, L, ui.linkFrom === n.id || (w && (w.node === n || wireNode === n)));
  }
  for (const L of LY.nodes.values()) drawPorts(L, wireTarget);
  for (const f of labels) f();
}

/* ---------- 模式 / 视图 ---------- */
const baseCursor = () => { const m = S.ui.mode; return m === 'select' ? 'default' : m === 'delete' ? 'not-allowed' : 'crosshair'; };
function updateTip() {
  const { mode: m, linkFrom, linkDir } = S.ui, n = linkFrom && S.G.node(linkFrom);
  $('#modeTip').textContent = m.startsWith('add:') ? `添加${TYPES[m.slice(4)].label}：点击画布空白处放置（按住 Shift 连续放置）`
    : m === 'link' && n ? (linkDir === 'out' ? `从「${n.name}」连出：点击终点节点` : `连入到「${n.name}」：点击起点节点`) + '（点空白处、右键或 Esc 取消）'
      : MODE_TIP[m];
}
export function setMode(m) {
  S.ui.mode = m; S.ui.linkFrom = null; S.ui.linkDir = 'out'; linkOnce = false;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  updateTip();
  cv.style.cursor = baseCursor();
  draw();
}
/** 从节点开始一次性连线（右键菜单 / 单击端口）：连完自动回到选择模式 */
function startLink(n, dir) {
  setMode('link');
  S.ui.linkFrom = n.id; S.ui.linkDir = dir; linkOnce = true;
  updateTip(); draw();
}
const finishLink = (srcId, dir, tgtId) => (dir === 'out' ? A.linkNodes(srcId, tgtId) : A.linkNodes(tgtId, srcId));
function linkClick(target, port) {
  const ui = S.ui;
  if (!ui.linkFrom) {
    if (target) { ui.linkFrom = target.id; ui.linkDir = port ? port.dir : 'out'; updateTip(); }
    return draw();
  }
  const f = ui.linkFrom, d = ui.linkDir;
  ui.linkFrom = null; ui.linkDir = 'out';
  if (target && target.id !== f) finishLink(f, d, target.id);
  if (linkOnce) setMode('select'); else { updateTip(); draw(); }
}
export function fitView() {
  const r = cv.getBoundingClientRect(), L = computeLayout();
  const vis = S.G.nodes.filter(visible);
  if (!vis.length) { S.ui.view = { ox: r.width / 2, oy: r.height / 2, s: 1 }; return draw(); }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of vis) {
    const q = L.nodes.get(n.id), hw = (q ? q.hw : NW) + 20, hh = (q ? q.hh : NH) + 12;
    x0 = Math.min(x0, n.x - hw); y0 = Math.min(y0, n.y - hh); x1 = Math.max(x1, n.x + hw); y1 = Math.max(y1, n.y + hh);
  }
  const pad = 40, s = Math.min(1.6, Math.max(0.25, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
  S.ui.view = { s, ox: r.width / 2 - (x0 + x1) / 2 * s, oy: r.height / 2 - (y0 + y1) / 2 * s };
  draw(); A.saveGraph();
}

/* ---------- 右键菜单 ---------- */
/** 节点下方（side=1）或上方（side=-1）的空位 */
function spotNear(n, side) {
  let x = n.x;
  const y = n.y + side * 150;
  for (let i = 0; i < 20 && S.G.nodes.some(o => visible(o) && Math.abs(o.x - x) < 160 && Math.abs(o.y - y) < 75); i++) x += 180;
  return { x, y };
}
function canCompact(a) {
  const io = S.V.io[a.id];
  return !!io && io.ins.length === 1 && io.outs.length === 1 && io.ins[0].from !== io.outs[0].to;
}
function nodeMenu(n) {
  const sel = () => A.select({ kind: 'node', id: n.id });
  const items = [{ title: `${TYPES[n.type].label} · ${A.nodeTag(n)}` }];
  if (n.type === 'pool') items.push(
    { label: '从这里连出 ↓', hint: '连到行为 = 被消耗', act: () => startLink(n, 'out') },
    { label: '连入到这里 ↑', hint: '行为连来 = 产出', act: () => startLink(n, 'in') },
    '-',
    { label: '新建行为：消耗此资源', act: () => A.createLinked('action', spotNear(n, 1), n.id, 'out') },
    { label: '新建行为：产出此资源', act: () => A.createLinked('action', spotNear(n, -1), n.id, 'in') },
    { label: '新建资源池：转移过去', hint: '自动创建「转移」', act: () => A.createLinked('pool', spotNear(n, 1), n.id, 'out') });
  else if (n.type === 'action') items.push(
    { label: '连出到资源池 ↓', hint: '产出', act: () => startLink(n, 'out') },
    { label: '连入自资源池 ↑', hint: '消耗', act: () => startLink(n, 'in') },
    '-',
    { label: '新建资源池：作为产出', act: () => A.createLinked('pool', spotNear(n, 1), n.id, 'out') },
    { label: '新建资源池：作为消耗', act: () => A.createLinked('pool', spotNear(n, -1), n.id, 'in') },
    '-',
    { label: '折叠为连线', hint: canCompact(n) ? '' : '需恰好 1 进 1 出', disabled: !canCompact(n), act: () => A.setCompact(n, true) },
    { label: '结算顺序：提前', act: () => A.moveAction(n, -1) },
    { label: '结算顺序：延后', act: () => A.moveAction(n, 1) });
  else items.push({ label: `公式不参与连线，在表达式中用 id ${n.id} 引用`, disabled: true });
  if (n.type !== 'action') items.push({ label: `插入 / 复制 id「${n.id}」`, hint: '到最近聚焦的表达式框', act: () => insertRef(n.id) });
  items.push('-', { label: '编辑属性', act: sel }, { label: '删除', danger: true, act: () => A.deleteNode(n.id) });
  return items;
}
function edgeMenu(e) {
  const G = S.G, a = G.node(e.from), b = G.node(e.to), own = G.ownerAction(e), k = S.V.kind[e.id];
  return [
    { title: `${k === 'in' ? '消耗' : k === 'out' ? '产出' : '连线'} · ${A.nodeTag(a)} → ${A.nodeTag(b)}` },
    { label: '编辑数量', hint: trunc(e.amount, 16), act: () => A.select({ kind: 'edge', id: e.id }) },
    own && { label: `编辑所属行为「${trunc(own.name, 12)}」`, act: () => A.select({ kind: 'node', id: own.id }) },
    '-',
    { label: '删除连线', danger: true, act: () => A.deleteEdge(e.id) },
  ];
}
function compactMenu(a) {
  return [
    { title: `行为（显示为连线） · ${a.name}` },
    { label: '编辑行为', act: () => A.select({ kind: 'node', id: a.id }) },
    { label: '展开为方块', act: () => A.setCompact(a, false) },
    '-',
    { label: '删除行为', danger: true, act: () => A.deleteNode(a.id) },
  ];
}
function blankMenu(p) {
  return [
    { title: '画布' },
    { label: '新建资源池', act: () => A.addNode('pool', p) },
    { label: '新建行为', act: () => A.addNode('action', p) },
    { label: '新建公式', act: () => A.addNode('formula', p) },
    '-',
    { label: '适应视图', act: fitView },
  ];
}
/** 端口拖出的线松开在空白处：新建节点并连接（新节点的对侧端口落在松手位置） */
function dropMenu(ev, src, dir, p) {
  const at = { x: p.x, y: p.y + (dir === 'out' ? 1 : -1) * NH };
  const mk = (type, label, hint) => ({ label, hint, act: () => A.createLinked(type, at, src.id, dir) });
  const items = [{ title: `新建并连接 · ${dir === 'out' ? '从' : '到'}「${src.name}」` }];
  if (src.type === 'pool') items.push(
    dir === 'out' ? mk('action', '新建行为：消耗此资源') : mk('action', '新建行为：产出此资源'),
    dir === 'out' ? mk('pool', '新建资源池：转移过去', '自动创建「转移」') : mk('pool', '新建资源池：从它转移过来', '自动创建「转移」'));
  else items.push(dir === 'out' ? mk('pool', '新建资源池：作为产出') : mk('pool', '新建资源池：作为消耗'));
  openMenu(ev.clientX, ev.clientY, items);
}
function onContextMenu(ev) {
  ev.preventDefault();
  if (rmMoved) { rmMoved = false; return; }
  drag = null;
  if (S.ui.mode === 'link' && S.ui.linkFrom) return setMode('select');
  const G = S.G, p = toWorld(ev), L = computeLayout(), port = hitPort(L, p, portTol());
  let items;
  if (port && port.edge) {
    const own = G.ownerAction(port.edge);
    if (own && S.V.compact.has(own.id)) { A.select({ kind: 'node', id: own.id }); items = compactMenu(own); }
    else { A.select({ kind: 'edge', id: port.edge.id }); items = edgeMenu(port.edge); }
  } else {
    const n = port ? port.node : hitNode(L, p), l = n ? null : hitLink(L, p);
    if (n) { A.select({ kind: 'node', id: n.id }); items = nodeMenu(n); }
    else if (l && l.kind === 'compact') { A.select({ kind: 'node', id: l.id }); items = compactMenu(G.node(l.id)); }
    else if (l) { A.select({ kind: 'edge', id: l.id }); items = edgeMenu(G.edge(l.id)); }
    else items = blankMenu(p);
  }
  openMenu(ev.clientX, ev.clientY, items);
}

/* ---------- 鼠标交互 ---------- */
function onMouseDown(ev) {
  const ui = S.ui, p = toWorld(ev), L = computeLayout(), m = ui.mode;
  const startPan = right => { drag = { type: 'pan', right, sx: ev.clientX, sy: ev.clientY, ox: ui.view.ox, oy: ui.view.oy }; };
  if (ev.button === 2) { rmMoved = false; return startPan(true); }
  if (ev.button !== 0) return startPan(false);
  if (m.startsWith('add:')) { if (!hitNode(L, p) && !hitLink(L, p)) { A.addNode(m.slice(4), p); if (!ev.shiftKey) setMode('select'); } return; }
  const port = m === 'delete' ? null : hitPort(L, p, portTol());
  if (m === 'link') return port ? linkClick(port.node, port) : linkClick(targetAt(L, p), null);
  if (port) { ui.mouse = p; drag = { type: 'wire', port, sx: ev.clientX, sy: ev.clientY, moved: false }; return; }
  const n = hitNode(L, p), l = n ? null : hitLink(L, p);
  if (m === 'delete') {
    if (n) A.deleteNode(n.id);
    else if (l) l.kind === 'compact' ? A.deleteNode(l.id) : A.deleteEdge(l.id);
    return;
  }
  if (n) { if (!ui.sel || ui.sel.id !== n.id) A.select({ kind: 'node', id: n.id }); drag = { type: 'node', n, dx: p.x - n.x, dy: p.y - n.y, sx: ev.clientX, sy: ev.clientY }; }
  else if (l) A.select(l.kind === 'compact' ? { kind: 'node', id: l.id } : { kind: 'edge', id: l.id });
  else { A.select(null); startPan(false); }
}
function onMouseMove(ev) {
  const ui = S.ui;
  if (drag) {
    const moved = Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 4;
    if (drag.type === 'pan') { if (moved && drag.right) rmMoved = true; ui.view.ox = drag.ox + ev.clientX - drag.sx; ui.view.oy = drag.oy + ev.clientY - drag.sy; }
    else if (drag.type === 'node') { const p = toWorld(ev); drag.n.x = Math.round(p.x - drag.dx); drag.n.y = Math.round(p.y - drag.dy); }
    else { if (moved) drag.moved = true; ui.mouse = toWorld(ev); }
    return draw();
  }
  if (ev.target !== cv) { if (hoverPort) { hoverPort = null; draw(); } return; }
  ui.mouse = toWorld(ev);
  if (ui.mode === 'link' && ui.linkFrom) draw();
  if (ui.mode === 'select' || ui.mode === 'link') {
    const hp = hitPort(computeLayout(), ui.mouse, portTol()), k = hp ? portKey(hp) : null;
    if (k !== hoverPort) { hoverPort = k; cv.style.cursor = hp ? 'pointer' : baseCursor(); draw(); }
  }
}
function onMouseUp(ev) {
  const d = drag; drag = null;
  if (!d) return;
  if (d.type !== 'wire') { if (d.type === 'node' || !d.right || rmMoved) A.saveGraph(); return; }
  const src = d.port.node;
  if (!d.moved) return startLink(src, d.port.dir);
  const p = toWorld(ev), t = targetAt(computeLayout(), p);
  if (t) { if (t !== src) finishLink(src.id, d.port.dir, t.id); }
  else if (ev.target === cv) dropMenu(ev, src, d.port.dir, p);
  draw();
}
let wheelT = 0;
function onWheel(ev) {
  ev.preventDefault();
  const v = S.ui.view, r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const s0 = v.s, s1 = Math.min(3, Math.max(0.2, s0 * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
  v.ox = mx - (mx - v.ox) * s1 / s0; v.oy = my - (my - v.oy) * s1 / s0; v.s = s1;
  draw(); clearTimeout(wheelT); wheelT = setTimeout(A.saveGraph, 300);
}

export function init() {
  cv = $('#cv'); ctx = cv.getContext('2d');
  cv.addEventListener('contextmenu', onContextMenu);
  cv.addEventListener('mousedown', onMouseDown);
  cv.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('resize', resize);
  for (const ev of ['graph', 'select', 'sim', 'tables', 'loaded']) on(ev, draw);
  on('fit', fitView);
  setMode('select');
}
