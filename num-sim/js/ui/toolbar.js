// 顶部工具栏 + 全局快捷键
import { S, on } from '../app/state.js';
import * as A from '../app/actions.js';
import { exampleGraph } from '../examples.js';
import { GRAPH_VERSION } from '../core/model.js';
import { $, toast, download } from './dom.js';
import { setMode, fitView } from './canvas.js';
import { seriesList } from './chart.js';

function exportCsv() {
  const sim = S.sim;
  if (!sim || sim.history.length < 2) return toast('请先运行模拟', true);
  const ser = seriesList();
  const q = s => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const rows = [['tick', ...ser.map(s => q(s.name))].join(',')];
  for (const h of sim.history) rows.push([h.tick, ...ser.map(s => h[s.id] ?? '')].join(','));
  download('num-sim-result.csv', '\ufeff' + rows.join('\r\n'), 'text/csv;charset=utf-8');
}
function ticksInput() {
  const n = Math.max(1, Math.min(100000, Math.floor(+$('#ticks').value || 0)));
  $('#ticks').value = n; S.prefs.ticks = n;
  return n;
}

export function init() {
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('#ticks').value = S.prefs.ticks;
  $('#ticks').onchange = () => { ticksInput(); A.savePrefs(); };
  $('#autoRerun').checked = S.prefs.autoRerun;
  $('#autoRerun').onchange = () => { S.prefs.autoRerun = $('#autoRerun').checked; A.savePrefs(); };
  $('#seed').addEventListener('input', () => { const s = Math.floor(+$('#seed').value); if (Number.isFinite(s)) A.setSeed(s); });

  $('#btnRun').onclick = () => {
    A.pause();
    const n = ticksInput();
    if (S.V.ids.size) return toast('图中存在错误，请先修正（见右侧「检查」）', true);
    const ms = A.runSim(n); A.savePrefs();
    if (S.sim.error) toast('模拟熔断：' + S.sim.error.msg, true);
    else toast(`已运行 ${S.sim.tick} tick（${ms.toFixed(0)} ms）`);
  };
  $('#btnPlay').onclick = A.togglePlay;
  const sp = $('#speed');
  sp.innerHTML = A.SPEEDS.map(v => `<option value="${v}">${v ? v + ' tick/s' : '最快'}</option>`).join('');
  sp.value = String(S.prefs.speed);
  sp.onchange = () => A.setSpeed(+sp.value);
  $('#btnStep').onclick = A.stepSim;
  $('#btnReset').onclick = () => { A.pause(); S.ui.lastRunN = null; A.savePrefs(); A.resetSim(); };
  $('#btnCsv').onclick = exportCsv;
  $('#btnExport').onclick = () => download('num-sim-graph.json', JSON.stringify(S.G, null, 2), 'application/json');
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try {
      const g = JSON.parse(await f.text());
      if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error('缺少 nodes / edges');
      await A.loadGraphObj(g, '已导入 ' + f.name, false);
    } catch (e) { toast('导入失败：' + e.message, true); }
  };
  $('#btnFit').onclick = fitView;
  $('#btnExample').onclick = () => { if (confirm('载入示例将覆盖当前图，确定？')) A.loadGraphObj(exampleGraph(), '已载入示例', true); };
  $('#btnClear').onclick = () => { if (confirm('清空当前图（含已注册数据表）？')) A.loadGraphObj({ version: GRAPH_VERSION, nextId: 1, nodes: [], edges: [], tables: [] }, '已清空', false); };

  window.addEventListener('keydown', ev => {
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { A.deleteSelection(); ev.preventDefault(); }
    else if (ev.key === ' ') {
      if (tag === 'button') document.activeElement.blur();
      A.togglePlay(); ev.preventDefault();
    }
    else if (ev.key === 'Escape' || ev.key === 'v' || ev.key === 'V') setMode('select');
    else if (ev.key === 'l' || ev.key === 'L') setMode('link');
    else if (ev.key === 'x' || ev.key === 'X') setMode('delete');
  });

  const tickInfo = () => {
    const el = $('#tickInfo');
    el.textContent = (S.ui.playing ? '▶ ' : '') + 'tick ' + (S.sim ? S.sim.tick : 0);
    el.classList.toggle('live', S.ui.playing);
  };
  on('sim', tickInfo);
  on('play', () => {
    const b = $('#btnPlay');
    b.textContent = S.ui.playing ? '⏸ 暂停' : '▶ 持续';
    b.classList.toggle('playing', S.ui.playing);
    tickInfo();
  });
  on('loaded', () => { $('#seed').value = S.G.seed; });
}
