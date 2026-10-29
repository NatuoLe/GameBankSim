// 生命周期曲线 + 图例
import { S, on } from '../app/state.js';
import * as A from '../app/actions.js';
import { fmt } from '../core/util.js';
import { $, esc } from './dom.js';

const PALETTE = ['#4f8cff', '#3ecf6e', '#f5c542', '#ff7a59', '#b26bff', '#2ad4d4', '#ff5d9e', '#a0d911', '#ffa940', '#9aa7ff', '#ff5d5d', '#7ee0b0'];
let chart;

/** 所有可绘制序列（也用于 CSV 导出） */
export function seriesList() {
  const out = []; let ci = 0;
  for (const n of S.G.nodes) {
    let name, def = true;
    if (n.type === 'pool') { const lbl = A.rowLabelOf(n); name = `${n.id}·${n.name}${lbl && lbl !== n.name ? `(${lbl})` : ''}`; }
    else if (n.type === 'formula') name = `ƒ ${n.id}·${n.name}`;
    else { name = `#${n.name}(累计执行)`; def = false; }
    out.push({ id: n.id, name, color: PALETTE[ci++ % PALETTE.length], visible: S.ui.vis[n.id] ?? def });
  }
  return out;
}
function niceStep(range, count) {
  const raw = range / count, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

export function drawChart() {
  const r = chart.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const W = r.width, H = r.height; if (W < 10 || H < 10) return;
  if (chart.width !== Math.round(W * d) || chart.height !== Math.round(H * d)) { chart.width = Math.round(W * d); chart.height = Math.round(H * d); }
  const g = chart.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
  const hist = S.sim ? S.sim.history : [], ser = seriesList().filter(s => s.visible);
  const norm = S.prefs.norm;
  g.font = '11px "Segoe UI","Microsoft YaHei",sans-serif';
  if (hist.length < 2 || !ser.length) {
    g.fillStyle = '#6f7689'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(hist.length < 2 ? '点击「运行」后显示曲线' : '没有可显示的序列', W / 2, H / 2); return;
  }
  const pl = norm ? 40 : 50, pr = 12, pt = 10, pb = 22, pw = W - pl - pr, ph = H - pt - pb;
  const rng = {};
  let lo = Infinity, hi = -Infinity;
  for (const s of ser) {
    let a = Infinity, b = -Infinity;
    for (const h of hist) { const v = h[s.id]; if (typeof v === 'number') { if (v < a) a = v; if (v > b) b = v; } }
    if (!Number.isFinite(a)) { a = 0; b = 1; }
    if (b - a < 1e-9) b = a + 1;
    rng[s.id] = [a, b]; lo = Math.min(lo, a); hi = Math.max(hi, b);
  }
  lo = Math.min(0, lo); if (hi - lo < 1e-9) hi = lo + 1;
  const ys = niceStep(hi - lo, 5); lo = Math.floor(lo / ys) * ys; hi = Math.ceil(hi / ys) * ys;
  const t0 = hist[0].tick, t1 = hist[hist.length - 1].tick, span = Math.max(1, t1 - t0);
  const X = t => pl + (t - t0) / span * pw;
  const Y = (s, v) => { const [a, b] = norm ? rng[s.id] : [lo, hi]; return pt + ph - (v - a) / (b - a) * ph; };
  g.strokeStyle = '#242833'; g.fillStyle = '#7d869c'; g.lineWidth = 1; g.textAlign = 'right'; g.textBaseline = 'middle';
  if (norm) for (let i = 0; i <= 4; i++) { const y = Math.round(pt + ph - i / 4 * ph) + 0.5; g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.fillText(i * 25 + '%', pl - 5, y); }
  else for (let v = lo; v <= hi + ys * 0.01; v += ys) { const y = Math.round(pt + ph - (v - lo) / (hi - lo) * ph) + 0.5; g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.fillText(fmt(v), pl - 5, y); }
  const xs = Math.max(1, niceStep(span, 6)); g.textAlign = 'center'; g.textBaseline = 'top';
  for (let t = Math.ceil(t0 / xs) * xs; t <= t1; t += xs) { const x = Math.round(X(t)) + 0.5; g.beginPath(); g.moveTo(x, pt); g.lineTo(x, pt + ph); g.stroke(); g.fillText(String(t), x, pt + ph + 5); }
  g.lineWidth = 1.6;
  for (const s of ser) {
    g.strokeStyle = s.color; g.beginPath(); let first = true;
    for (const h of hist) { const v = h[s.id]; if (typeof v !== 'number') continue; const x = X(h.tick), y = Y(s, v); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
    g.stroke();
  }
  const hover = S.ui.hover;
  if (hover != null) {
    const idx = Math.max(0, Math.min(hist.length - 1, Math.round((hover - pl) / pw * (hist.length - 1))));
    const h = hist[idx], x = X(h.tick);
    g.strokeStyle = '#ffffff55'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, pt); g.lineTo(x, pt + ph); g.stroke();
    const lines = [`tick ${h.tick}`, ...ser.map(s => `${s.name}: ${fmt(h[s.id])}`)];
    g.font = '12px "Segoe UI","Microsoft YaHei",sans-serif';
    const bw = Math.max(...lines.map(l => g.measureText(l).width)) + 16, bh = lines.length * 16 + 8;
    let bx = x + 10; if (bx + bw > W - 4) bx = x - 10 - bw;
    g.fillStyle = '#1b1e25f0'; g.strokeStyle = '#3a4052'; g.fillRect(bx, pt + 4, bw, bh); g.strokeRect(bx + 0.5, pt + 4.5, bw, bh);
    g.textAlign = 'left'; g.textBaseline = 'top';
    lines.forEach((l, i) => { g.fillStyle = i === 0 ? '#aab' : ser[i - 1].color; g.fillText(l, bx + 8, pt + 9 + i * 16); });
    ser.forEach(s => { const v = h[s.id]; if (typeof v !== 'number') return; g.fillStyle = s.color; g.beginPath(); g.arc(x, Y(s, v), 3, 0, Math.PI * 2); g.fill(); });
  }
}

export function renderLegend() {
  const last = S.sim && S.sim.history[S.sim.history.length - 1];
  const box = $('#legend');
  box.innerHTML = seriesList().map(s =>
    `<span class="lg ${s.visible ? '' : 'off'}" data-id="${s.id}"><i style="background:${s.color}"></i>${esc(s.name)}<b>${last ? fmt(last[s.id]) : ''}</b></span>`).join('');
  box.querySelectorAll('.lg').forEach(el => el.onclick = () => {
    const s = seriesList().find(x => x.id === el.dataset.id);
    S.ui.vis[s.id] = !s.visible; A.savePrefs(); renderLegend(); drawChart();
  });
}

export function init() {
  chart = $('#chart');
  chart.addEventListener('mousemove', ev => { S.ui.hover = ev.clientX - chart.getBoundingClientRect().left; drawChart(); });
  chart.addEventListener('mouseleave', () => { S.ui.hover = null; drawChart(); });
  const nc = $('#normChk');
  nc.checked = S.prefs.norm;
  nc.onchange = () => { S.prefs.norm = nc.checked; A.savePrefs(); drawChart(); };
  let rafId = 0;
  new ResizeObserver(() => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(drawChart); }).observe(chart);
  const refresh = () => { renderLegend(); drawChart(); };
  on('sim', refresh); on('tables', refresh); on('loaded', refresh);
}
