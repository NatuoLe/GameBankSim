// 入口：装配状态 → 初始化各 UI 模块 → 加载数据表 → 首次运行
import { S, emit } from './app/state.js';
import * as A from './app/actions.js';
import { normalizeGraph } from './core/model.js';
import { exampleGraph } from './examples.js';
import { toast } from './ui/dom.js';
import * as toolbar from './ui/toolbar.js';
import * as canvas from './ui/canvas.js';
import * as chart from './ui/chart.js';
import * as panel from './ui/panel.js';
import * as autocomplete from './ui/autocomplete.js';
import * as luban from './ui/luban.js';

async function boot() {
  A.loadPrefs();
  const stored = A.loadStoredGraph();
  const firstRun = !stored;
  const { graph, migrated } = stored || normalizeGraph(exampleGraph());
  S.G = graph;
  if (graph.view) S.ui.view = { ...graph.view };
  if (firstRun) S.ui.lastRunN = S.prefs.ticks;
  A.revalidate();

  for (const m of [toolbar, canvas, chart, panel, autocomplete, luban]) m.init();
  canvas.resize();
  emit('loaded');
  emit('select');
  if (firstRun || !graph.view || migrated) canvas.fitView();
  if (migrated) { A.saveGraph(); toast(`已自动升级旧图：${migrated}`); }
  A.resetSim();

  luban.lbList(localStorage.getItem(A.LS_DIR) || 'sample');
  await A.reloadTables();
  if (!S.prefs.autoRerun && S.ui.lastRunN != null && S.V.ids.size === 0) A.runSim(S.ui.lastRunN);
}

boot().catch(e => { console.error(e); toast('启动失败：' + e.message, true); });
