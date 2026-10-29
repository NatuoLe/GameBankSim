// 节点尺寸、端口布局与连线几何。
// 所有节点都是长方形：上边为入口，下边为出口。
// 端口不存数据，完全由连线推导：入口 = 连入的边 + 1 个空槽，出口 = 连出的边 + 1 个空槽；
// 连得越多端口越多，节点随之变宽。公式不参与连线，没有端口。
import { S } from '../app/state.js';

export const NW = 72;   // 节点最小半宽
export const NH = 30;   // 资源池 / 行为半高
export const FH = 26;   // 公式半高
export const HEAD = 20; // 标题栏高度
export const GAP = 22;  // 端口水平间距
export const PR = 5;    // 端口半径

/** 是否作为方块显示（折叠成连线的行为不显示） */
export const visible = n => !(n.type === 'action' && S.V.compact.has(n.id));
const hasPorts = n => n.type === 'pool' || (n.type === 'action' && visible(n));

/**
 * @returns {{ nodes: Map<string, object>, from: Map<string, object>, to: Map<string, object> }}
 *   nodes：节点 id → { n, ports, hw, hh, ins:[port], outs:[port] }
 *   from / to：边 id → 该边在起点（出口）/ 终点（入口）上的端口
 *   port = { x, y, node, dir:'in'|'out', i, edge|null }
 */
export function computeLayout() {
  const { G, V } = S, nodes = new Map(), from = new Map(), to = new Map(), ins = {}, outs = {};
  for (const n of G.nodes) if (hasPorts(n)) { ins[n.id] = []; outs[n.id] = []; }
  for (const e of G.edges) {
    if (!G.node(e.from) || !G.node(e.to)) continue;
    if (outs[e.from]) outs[e.from].push(e);
    if (ins[e.to]) ins[e.to].push(e);
  }
  // 端口按另一端（穿过折叠行为后的可见节点）的 x 排序，减少交叉
  const farX = (id, dir) => {
    let o = G.node(id);
    if (o && o.type === 'action' && V.compact.has(o.id)) {
      const io = V.io[o.id], e = dir === 'in' ? io.ins[0] : io.outs[0];
      o = G.node(dir === 'in' ? e.from : e.to) || o;
    }
    return o ? o.x : 0;
  };
  for (const n of G.nodes) {
    if (!visible(n)) continue;
    const ports = !!ins[n.id];
    const I = ports ? ins[n.id].sort((a, b) => farX(a.from, 'in') - farX(b.from, 'in')) : [];
    const O = ports ? outs[n.id].sort((a, b) => farX(a.to, 'out') - farX(b.to, 'out')) : [];
    const k = ports ? Math.max(I.length, O.length) + 1 : 0;
    const L = { n, ports, hw: Math.max(NW, k * GAP / 2 + 14), hh: n.type === 'formula' ? FH : NH };
    const place = (list, side) => !ports ? [] : Array.from({ length: list.length + 1 }, (_, i) => ({
      x: n.x + (i - list.length / 2) * GAP, y: n.y + side * L.hh, node: n, dir: side < 0 ? 'in' : 'out', i, edge: list[i] || null,
    }));
    L.ins = place(I, -1); L.outs = place(O, 1);
    for (const p of L.ins) if (p.edge) to.set(p.edge.id, p);
    for (const p of L.outs) if (p.edge) from.set(p.edge.id, p);
    nodes.set(n.id, L);
  }
  return { nodes, from, to };
}

/** 空槽（每侧最后一个） */
export const freeSlot = (LY, id, dir) => { const L = LY.nodes.get(id); if (!L) return null; const a = dir === 'in' ? L.ins : L.outs; return a[a.length - 1] || null; };

/* ---------- 曲线 ---------- */
/** 竖直切线的三次贝塞尔：出口向下伸出，入口从上方进入 */
export function curve(p0, p3) {
  const d = Math.max(36, Math.abs(p3.y - p0.y) * 0.5);
  return [p0, { x: p0.x, y: p0.y + d }, { x: p3.x, y: p3.y - d }, p3];
}
export function bezPt(c, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}
function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
export function curveDist(p, c) {
  let best = Infinity, prev = c[0];
  for (let i = 1; i <= 24; i++) { const q = bezPt(c, i / 24); best = Math.min(best, segDist(p, prev, q)); prev = q; }
  return best;
}

/* ---------- 命中 ---------- */
export function hitNode(LY, p) {
  const nodes = S.G.nodes;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i], L = LY.nodes.get(n.id);
    if (L && Math.abs(p.x - n.x) <= L.hw && Math.abs(p.y - n.y) <= L.hh) return n;
  }
  return null;
}
export function hitPort(LY, p, tol) {
  let best = null, bd = tol;
  for (const L of LY.nodes.values()) for (const q of [...L.ins, ...L.outs]) {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
/** 粗略判断两节点能否相连（用于拖线时高亮），最终以 core/edit.link 为准 */
export function canLink(a, b) {
  if (!a || !b || a === b) return false;
  if (a.type === 'formula' || b.type === 'formula') return false;
  return !(a.type === 'action' && b.type === 'action');
}
