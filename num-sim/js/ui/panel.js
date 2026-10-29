// 右侧属性面板 + 检查列表 + 诊断
import { S, on } from '../app/state.js';
import * as A from '../app/actions.js';
import { TYPES, TRIGGERS, MODES } from '../core/model.js';
import { reasonText } from '../core/sim.js';
import { fmt } from '../core/util.js';
import { rowRefText } from '../core/edit.js';
import { $, esc, toast } from './dom.js';
import { insertRef } from './autocomplete.js';

const HELP = `<div class="help">
<b>核心模型：状态 + 行为</b>
<ul>
<li><b style="color:#4f8cff">资源池</b>：状态，持有数值，可绑定 Luban 数据行</li>
<li><b style="color:#2ad4d4">公式</b>：派生状态，只读计算值，如 <code>等级表[n4].exp_need</code></li>
<li><b style="color:#f5c542">行为</b>：一句完整的话 ——「当 [触发] 且 [条件] 时，以 [概率]，消耗 {…} → 产出 {…}」</li>
</ul>
<b>变量引用 = 节点 id</b>
<ul>
<li>每个资源池 / 公式由画布自动分配唯一 id（如 <code>n1</code>、<code>f2</code>），显示在节点标题栏右侧；表达式里只用 id 引用</li>
<li>名称只是显示标签：可随意修改、可重复，改名不影响任何表达式</li>
<li>表达式框里输入名称（如 <code>金币</code>）会自动补全成对应 id；选中节点可看到「被引用」列表</li>
</ul>
<b>连线 = 行为的参数</b>
<ul>
<li>资源池 → 行为：消耗（线上写数量）；行为 → 资源池：产出</li>
<li>没有消耗 = 凭空产出；没有产出 = 纯消耗</li>
<li>两个资源池直接相连：自动创建 1 进 1 出的「转移」行为，并折叠显示为一条线</li>
</ul>
<b>端口与连线操作</b>
<ul>
<li>节点均为长方形：上边为入口、下边为出口；初始各 1 个空端口（空心），每连一条就多排列出一个，节点随之变宽</li>
<li>从端口拖出连线，拖到目标节点上任意位置松开即连接；松开在空白处可「新建节点并连接」</li>
<li>单击端口：进入一次性连线，再点目标节点完成（点上方入口则是「连入到这里」）</li>
<li>右键节点：连出 / 连入 / 新建并连接 / 折叠 / 删除；右键连线：编辑数量或删除；右键空白：新建节点</li>
</ul>
<b>行为的字段</b>
<ul>
<li>触发：每 tick / 每 N tick / 条件变为真时（边沿，适合解锁）</li>
<li>条件、概率：每次执行前按最新状态判断（概率受顶部种子控制）</li>
<li>执行方式：全有或全无（买东西）/ 尽量执行（按最短缺资源的比例部分执行）</li>
<li>每 tick 最多执行次数：资源够就在同一 tick 重复（如一次升多级）</li>
<li>顺序：行为按列表顺序依次结算，靠前者优先拿到资源</li>
</ul>
<b>诊断</b>：运行后行为右上角的圆点表示本 tick 状态；选中行为可看到「为什么没执行」及累计统计
<br><br>
<b>Luban 数据绑定</b>
<ol>
<li>① 浏览到 Luban json 输出目录（或 xlsx/csv 源表，自动识别 <code>##var</code> 表头）→ ③ 预览 → 注册为数据表</li>
<li>资源池「名称」框输入 <code>tbitem.1001</code> 回车即绑定该行，显示名称自动取该行的名称（id 不变）</li>
<li>Luban 重新导表后点 ②「全部刷新」，所有引用即时生效</li>
</ol>
<b>表达式</b>
<ul>
<li>变量：资源池 / 公式的 id、<code>tick</code>；查表 <code>表[主键].字段</code>；绑定行字段 <code>n1.max_stack</code>（n1 为已绑定行的资源池）</li>
<li>运算：<code>+ - * / % ^</code>、比较、<code>&amp;&amp; || !</code>、<code>条件 ? a : b</code></li>
<li>函数：<code>min max floor ceil round abs sign sqrt pow exp log log10 clamp lerp if rand randint chance</code></li>
<li>自动补全：输入名称或 id 列出资源池/公式（插入 id）；<code>tb</code> 列表、<code>tbitem.1</code> 列行；↑↓ Enter/Tab，Ctrl+Space 呼出</li>
</ul>
<b>运行</b>：「运行」从 0 跑指定 tick 数；「▶ 持续」从当前状态一直跑下去（空格键 播放/暂停，旁边可选速度），播放中改图会按新图重放到当前 tick 后继续；超长运行时曲线自动抽稀
<br><br>
<b>视图</b>：右键拖动或空白处拖动平移，滚轮缩放，Delete 删除，Esc 返回选择；快捷键 V/L/X
</div>`;

/* ---------- HTML 片段 ---------- */
function fieldHtml(label, f, val, id, hint, expr = true, extra = '') {
  return `<div class="field"><label>${label}</label>
    <input data-f="${f}" ${expr ? 'data-expr' : ''} ${extra} value="${esc(val)}" spellcheck="false" autocomplete="off">
    ${hint ? `<div class="hint">${hint}</div>` : ''}
    <div class="err" data-ek="${id}:${f}"></div></div>`;
}
function selectHtml(label, f, val, opts, hint) {
  return `<div class="field"><label>${label}</label><select data-f="${f}">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${v}</option>`).join('')}</select>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}
function rowBindHtml(n) {
  if (!n.row) return `<div class="field"><label>绑定数据行</label><div class="hint">未绑定。在上方名称中输入 <code>tb表名.主键</code>（如 <code>tbitem.1001</code>，会自动补全）回车即可绑定；也可在左侧 ③ 表预览中点选一行。</div></div>`;
  const ref = rowRefText(n.row), t = S.tables.get(n.row.table), row = A.boundRowOf(n), d = S.G.table(n.row.table);
  const label = A.rowLabelOf(n);
  let h = `<div class="field"><label>绑定数据行</label><div class="row" style="margin:0;flex-wrap:wrap"><span class="ref">${esc(ref)}</span>${label ? `<b>${esc(label)}</b>` : ''}
    <span style="margin-left:auto;display:flex;gap:4px"><button class="sm" data-act="locate" title="在左侧表预览中定位到该行">定位</button><button class="sm" data-act="unbind">解除</button></span></div>`;
  if (label && n.name !== label) h += `<div class="row" style="margin:4px 0 0"><span class="hint" style="margin:0">显示名称与该行名称不同</span><button class="sm" data-act="rename" style="margin-left:auto">改为「${esc(label)}」</button></div>`;
  h += `<div class="err" data-ek="${n.id}:row"></div>`;
  if (row && d) {
    h += `<div class="hint">该行全部字段（点击插入 <code>${esc(n.id)}.字段</code> 到当前表达式；🔑 主键，🏷 显示字段）</div><div class="fields">`;
    h += t.cols.map(c => {
      const mk = c === d.keyField ? '🔑' : c === d.labelField ? '🏷' : '';
      return `<div class="fld" data-ins="${esc(n.id + '.' + c)}" title="插入 ${esc(n.id + '.' + c)}"><span>${mk}${esc(c)}</span><span class="ell">${esc(row[c])}</span></div>`;
    }).join('');
    h += '</div>';
  } else if (t && t.status === 'loading') h += '<div class="hint">数据表加载中…</div>';
  return h + '</div>';
}
const idTag = n => `<code class="nid">${esc(n.id)}</code>`;
function ioRows(list, dir) {
  return list.map(e => {
    const p = S.G.node(dir === 'in' ? e.from : e.to), lbl = A.rowLabelOf(p);
    return `<div class="field io"><div class="row" style="margin:0"><span class="dot" style="background:${TYPES.pool.color}"></span><span class="ell ioname" title="${esc(p.id)} · ${esc(p.name)}${lbl && lbl !== p.name ? ' · ' + esc(lbl) : ''}">${idTag(p)} ${esc(p.name)}</span><span class="dim">×</span><input data-edge="${e.id}" data-expr value="${esc(e.amount)}" spellcheck="false" autocomplete="off" style="flex:1"><button class="sm danger" data-deledge="${e.id}" title="移除">✕</button></div><div class="err" data-ek="${e.id}:amount"></div></div>`;
  }).join('');
}
function addSelect(dir, used) {
  const pools = S.G.nodes.filter(n => n.type === 'pool' && !used.has(n.id));
  if (!pools.length) return '';
  return `<select data-add="${dir}" style="width:100%;margin-bottom:8px"><option value="">＋ 添加${dir === 'in' ? '消耗' : '产出'}资源…</option>${pools.map(p => `<option value="${p.id}">${esc(p.id)} · ${esc(p.name)}</option>`).join('')}</select>`;
}
/** 引用了该变量的表达式位置 */
function refsHtml(n) {
  const refs = A.refsTo(n.id);
  const FL = { init: '初始值', cap: '上限', expr: '表达式', every: '间隔', condition: '条件', chance: '概率', times: '次数', amount: '数量' };
  let h = `<div class="sub">被引用（${refs.length}）</div>`;
  if (!refs.length) return h + `<div class="hint">还没有表达式引用 <code>${esc(n.id)}</code>。在任意表达式框输入名称或 id 可自动补全</div>`;
  return h + '<div class="fields">' + refs.map(({ owner, field }) => {
    const isEdge = !owner.type, tgt = isEdge ? S.G.ownerAction(owner) || owner : owner;
    const who = isEdge ? `${A.nodeTag(S.G.node(owner.from))} → ${A.nodeTag(S.G.node(owner.to))}` : A.nodeTag(owner);
    return `<div class="fld" data-goref="${esc(isEdge && !S.G.ownerAction(owner) ? 'e:' + owner.id : tgt.id)}" title="${esc(owner[field])}"><span>${esc(who)}</span><span class="ell">${FL[field] || field}：${esc(owner[field])}</span></div>`;
  }).join('') + '</div>';
}
function actionHtml(a) {
  const io = S.V.io[a.id] || { ins: [], outs: [] };
  const acts = S.G.nodes.filter(n => n.type === 'action'), idx = acts.indexOf(a);
  const combined = S.V.compact.has(a.id) && io.ins[0].amount === io.outs[0].amount;
  let h = `<div class="sub">何时</div>`;
  h += selectHtml('触发', 'trigger', a.trigger, TRIGGERS);
  if (a.trigger === 'every') h += fieldHtml('间隔 N（tick）', 'every', a.every, a.id, 'tick 为 N 的倍数时触发，可写表达式');
  h += fieldHtml(a.trigger === 'rise' ? '条件（必填）' : '条件', 'condition', a.condition, a.id,
    a.trigger === 'rise' ? '条件由假变真的那个 tick 触发（如 <code>n4>=10</code> 解锁）' : '可选，留空 = 总是满足；每次执行前按最新状态判断');
  h += fieldHtml('概率', 'chance', a.chance, a.id, '可选，0~1，留空 = 必定；每次执行前掷骰（受顶部种子控制）');
  h += `<div class="sub">做什么</div>`;
  if (combined) {
    const p = S.G.node(io.ins[0].from), q = S.G.node(io.outs[0].to);
    h += `<div class="field"><label>${idTag(p)} ${esc(p.name)} → ${idTag(q)} ${esc(q.name)} 转移量</label>`;
    h += `<input data-xfer data-expr value="${esc(io.ins[0].amount)}" spellcheck="false" autocomplete="off"><div class="hint">消耗与产出同量；需要不同数量（如 100 金币 → 1 钻石）请取消下方「显示为连线」后分别设置</div><div class="err" data-ek="${io.ins[0].id}:amount"></div></div>`;
  } else {
    h += `<div class="field" style="margin-bottom:4px"><label>消耗（从资源池扣除）${io.ins.length ? '' : ' —— 无，即凭空产出'}</label></div>${ioRows(io.ins, 'in')}${addSelect('in', new Set(io.ins.map(e => e.from)))}`;
    h += `<div class="field" style="margin-bottom:4px"><label>产出（加入资源池）${io.outs.length ? '' : ' —— 无，即纯消耗'}</label></div>${ioRows(io.outs, 'out')}${addSelect('out', new Set(io.outs.map(e => e.to)))}`;
  }
  h += selectHtml('执行方式', 'mode', a.mode, MODES, '全有或全无：任一消耗不足则整次不执行；尽量执行：按最短缺资源的比例部分执行');
  h += fieldHtml('每 tick 最多执行次数', 'times', a.times, a.id, '留空 = 1；条件与资源仍满足时在同一 tick 内重复执行（如一次升多级），上限 1000');
  if (io.ins.length === 1 && io.outs.length === 1 && io.ins[0].from !== io.outs[0].to)
    h += `<label class="chk" style="margin-bottom:10px"><input type="checkbox" data-act="compact" ${a.compact ? 'checked' : ''}>显示为连线（1 进 1 出时可折叠成一条线）</label>`;
  h += `<div class="field"><label>结算顺序</label><div class="row">第 ${idx + 1} / ${acts.length} 个行为
    <button class="sm" data-act="up" ${idx === 0 ? 'disabled' : ''}>提前</button>
    <button class="sm" data-act="down" ${idx === acts.length - 1 ? 'disabled' : ''}>延后</button></div>
    <div class="hint">多个行为争抢同一资源时，靠前者优先</div></div>`;
  h += `<div class="sub">诊断</div><div id="diagBox"></div>`;
  return h;
}

/* ---------- 渲染 ---------- */
export function render() {
  const box = $('#props'), s = S.ui.sel, G = S.G;
  if (!s) { box.innerHTML = HELP; return; }
  let h = '';
  if (s.kind === 'node') {
    const n = G.node(s.id); if (!n) { S.ui.sel = null; return render(); }
    const T = TYPES[n.type], isVar = n.type === 'pool' || n.type === 'formula';
    h += `<div class="ptitle"><span class="dot ${n.type === 'action' ? 'sq' : ''}" style="background:${T.color}"></span>${T.label}${isVar ? `<span class="pid" title="画布自动分配的唯一 id，表达式中用它引用此${T.label}；点击复制/插入" data-ins="${esc(n.id)}">${esc(n.id)}</span>` : `<span class="dim" style="margin-left:auto;font-size:11px">${n.id}</span>`}</div>`;
    if (n.type === 'pool') h += fieldHtml('名称', 'name', n.name, n.id, `仅用于显示，可随意修改、可重复；表达式中用 id <code>${esc(n.id)}</code> 引用。输入 <code>tb表名.主键</code>（如 <code>tbitem.1001</code>）回车 = 绑定数据行`, false, 'data-acrow="1" placeholder="显示名称，或 tbitem.1001 绑定数据行"');
    else h += fieldHtml('名称', 'name', n.name, n.id, isVar ? `仅用于显示，可随意修改、可重复；表达式中用 id <code>${esc(n.id)}</code> 引用` : '', false);
    h += `<div class="err" data-ek="${n.id}:kind"></div>`;
    if (n.type === 'pool') {
      h += rowBindHtml(n);
      h += fieldHtml('初始值 init', 'init', n.init, n.id, `只能用常量/数据表，如 <code>${esc(n.id)}.init</code>；留空 = 0`);
      h += fieldHtml('上限 cap', 'cap', n.cap, n.id, `可选；满了后产出被截断，全部目标已满时行为不执行。如 <code>${esc(n.id)}.max_stack</code>`);
      h += `<div class="sub">关联行为 / 当前状态</div><div id="diagBox"></div>`;
      h += refsHtml(n);
    }
    if (n.type === 'formula') {
      h += fieldHtml('表达式', 'expr', n.expr, n.id, '每 tick 开始及每次行为执行后重新计算。如 <code>等级表[n4].exp_need</code>（n4 为资源池 id）');
      h += `<div class="sub">当前值</div><div id="diagBox"></div>`;
      h += refsHtml(n);
    }
    if (n.type === 'action') h += actionHtml(n);
    h += `<button class="danger" data-act="del" style="margin-top:6px">删除${T.label}</button>`;
    box.innerHTML = h;
    bindNode(box, n);
  } else {
    const e = G.edge(s.id); if (!e) { S.ui.sel = null; return render(); }
    const a = G.node(e.from), b = G.node(e.to), k = S.V.kind[e.id], act = G.ownerAction(e);
    h += `<div class="ptitle">${k === 'in' ? '消耗' : k === 'out' ? '产出' : '无效连线'}<span class="dim" style="margin-left:auto;font-size:11px">${e.id}</span></div>`;
    h += `<div class="field"><label>方向</label><div><span class="dot ${a.type === 'action' ? 'sq' : ''}" style="background:${TYPES[a.type].color}"></span>${esc(A.nodeTag(a))} → <span class="dot ${b.type === 'action' ? 'sq' : ''}" style="background:${TYPES[b.type].color}"></span>${esc(A.nodeTag(b))}</div></div>`;
    if (k === 'in' || k === 'out') h += fieldHtml(k === 'in' ? '每次执行消耗' : '每次执行产出', 'amount', e.amount, e.id, '可写表达式，按 id 引用资源池/公式（输入名称可自动补全为 id），或数据表');
    h += `<div class="err" data-ek="${e.id}:kind"></div>`;
    if (act) h += `<button data-act="owner" style="margin-right:6px">编辑所属行为「${esc(act.name)}」</button>`;
    h += `<button class="danger" data-act="del">删除连线</button>`;
    box.innerHTML = h;
    box.querySelectorAll('input[data-f]').forEach(inp => inp.addEventListener('input', () => A.setField(e, 'amount', inp.value)));
    const ow = box.querySelector('[data-act=owner]'); if (ow) ow.onclick = () => A.select({ kind: 'node', id: act.id });
    box.querySelector('[data-act=del]').onclick = A.deleteSelection;
  }
  updateErrors();
  renderDiag();
}

function bindNode(box, n) {
  const q = sel => box.querySelector(sel);
  box.querySelectorAll('input[data-f]').forEach(inp => {
    const f = inp.dataset.f;
    if (f !== 'name') return inp.addEventListener('input', () => A.setField(n, f, inp.value));
    inp.addEventListener('change', () => {
      if (!document.body.contains(inp)) return;
      const v = inp.value.trim();
      if (n.type === 'pool') {
        const r = A.tryBindByText(n, v);
        if (r) { if (r.err) { toast(r.err, true); inp.value = n.name; } return; }
      }
      const m = A.renameNode(n, v);
      if (m) { toast(m, true); inp.value = n.name; }
    });
  });
  box.querySelectorAll('select[data-f]').forEach(sel => sel.addEventListener('change', () => { A.setField(n, sel.dataset.f, sel.value); render(); }));
  box.querySelectorAll('input[data-edge]').forEach(inp => inp.addEventListener('input', () => { const e = S.G.edge(inp.dataset.edge); if (e) A.setField(e, 'amount', inp.value); }));
  const xf = q('input[data-xfer]');
  if (xf) xf.addEventListener('input', () => { const io = S.V.io[n.id]; io.outs[0].amount = xf.value; A.setField(io.ins[0], 'amount', xf.value); });
  box.querySelectorAll('[data-deledge]').forEach(b => b.onclick = () => { A.deleteEdge(b.dataset.deledge); render(); });
  box.querySelectorAll('select[data-add]').forEach(sel => sel.addEventListener('change', () => {
    if (!sel.value) return;
    if (sel.dataset.add === 'in') A.linkNodes(sel.value, n.id); else A.linkNodes(n.id, sel.value);
  }));
  const cp = q('[data-act=compact]'); if (cp) cp.onchange = () => A.setCompact(n, cp.checked);
  const up = q('[data-act=up]'); if (up) up.onclick = () => A.moveAction(n, -1);
  const dn = q('[data-act=down]'); if (dn) dn.onclick = () => A.moveAction(n, 1);
  const ub = q('[data-act=unbind]'); if (ub) ub.onclick = () => A.unbindRow(n);
  const lc = q('[data-act=locate]'); if (lc) lc.onclick = () => A.select({ kind: 'node', id: n.id });
  const rn = q('[data-act=rename]'); if (rn) rn.onclick = () => { A.renameNode(n, A.rowLabelOf(n)); render(); };
  box.querySelectorAll('[data-ins]').forEach(el => { el.onmousedown = ev => ev.preventDefault(); el.onclick = () => insertRef(el.dataset.ins); });
  box.querySelectorAll('[data-goref]').forEach(el => el.onclick = () => {
    const v = el.dataset.goref;
    A.select(v.startsWith('e:') ? { kind: 'edge', id: v.slice(2) } : { kind: 'node', id: v });
  });
  q('[data-act=del]').onclick = A.deleteSelection;
}

export function renderDiag() {
  const box = document.getElementById('diagBox'); if (!box) return;
  const n = A.selectedNode(); if (!n) return;
  const { sim, V, G } = S, T = sim ? sim.tick : 0;
  let h = '';
  if (n.type === 'action') {
    const info = sim && sim.act[n.id], st = sim && sim.stats[n.id];
    if (!T || !info || !st) h = '<div class="hint">运行后显示：本 tick 是否执行、为什么没执行、累计统计</div>';
    else {
      if (info.n) h += `<div class="diag ok">tick ${T}：执行 ${info.n} 次${info.reason && info.reason !== 'trigger' ? `，之后因${reasonText(info)}停止` : ''}</div>`;
      else h += `<div class="diag ${info.reason === 'trigger' ? 'idle' : 'no'}">tick ${T}：未执行 —— ${esc(reasonText(info))}</div>`;
      h += `<div class="hint">累计执行 ${st.fired} 次 / ${T} tick</div>`;
      const parts = [];
      if (st.trigger) parts.push(`未到触发 ${st.trigger}`);
      if (st.cond) parts.push(`条件不满足 ${st.cond}`);
      if (st.chance) parts.push(`概率未中 ${st.chance}`);
      if (st.short) parts.push(`资源不足 ${st.short}（${Object.entries(st.shortBy).map(([k, v]) => `${k} ${v}`).join('，')}）`);
      if (st.full) parts.push(`目标已满 ${st.full}`);
      if (parts.length) h += `<div class="hint">未执行的 tick：${esc(parts.join(' · '))}</div>`;
    }
  } else if (n.type === 'pool') {
    const cap = sim && sim.cap[n.id];
    h += `<div class="hint" style="margin-bottom:4px">当前值 <b style="color:#fff">${fmt(sim ? sim.val[n.id] : NaN)}</b>${cap !== undefined && Number.isFinite(cap) ? ` / 上限 ${fmt(cap)}` : ''}（tick ${T}）</div>`;
    const rel = G.edges.filter(e => (e.from === n.id && V.kind[e.id] === 'in') || (e.to === n.id && V.kind[e.id] === 'out'));
    if (!rel.length) h += '<div class="hint">没有行为使用该资源池。从下方出口拖到行为 = 消耗，从行为出口拖到上方入口 = 产出；也可右键节点「新建行为」</div>';
    else h += '<div class="fields">' + rel.map(e => {
      const isIn = V.kind[e.id] === 'in', a = G.node(isIn ? e.to : e.from);
      const fl = T && sim.flows[e.id] !== undefined ? ` ▸${fmt(sim.flows[e.id])}` : '';
      return `<div class="fld" data-goto="${a.id}" title="点击编辑该行为"><span style="color:${isIn ? '#ff9a9a' : '#7ee0a0'}">${isIn ? '− 被消耗' : '+ 被产出'}</span><span class="ell">${esc(A.nodeTag(a))} × ${esc(e.amount)}${fl}</span></div>`;
    }).join('') + '</div>';
  } else if (n.type === 'formula') {
    h += `<div class="hint">tick ${T} 末：<b style="color:#fff">${fmt(sim ? sim.fval[n.id] : NaN)}</b></div>`;
  }
  box.innerHTML = h;
  box.querySelectorAll('[data-goto]').forEach(el => el.onclick = () => A.select({ kind: 'node', id: el.dataset.goto }));
}

export function updateErrors() {
  const els = [...document.querySelectorAll('#props [data-ek]')];
  const rt = S.sim && S.sim.error;
  let rtEl = null;
  if (rt) {
    const mine = els.filter(el => el.dataset.ek.split(':')[0] === rt.id);
    rtEl = mine.find(el => el.dataset.ek.endsWith(':kind')) || mine.find(el => !el.dataset.ek.endsWith(':name')) || mine[0] || null;
  }
  els.forEach(el => {
    const f = el.dataset.ek.split(':')[1];
    let m = S.V.err[el.dataset.ek] || '';
    if (!m && el === rtEl) m = '运行时：' + rt.msg;
    el.textContent = m;
    const inp = el.parentElement.querySelector('input[data-f],input[data-edge],input[data-xfer]');
    if (inp && f !== 'kind' && f !== 'row') inp.classList.toggle('bad', !!m);
  });
}

const FIELD_LABEL = { name: '名称', init: '初始值', cap: '上限', every: '触发间隔', condition: '条件', chance: '概率', times: '执行次数', amount: '数量', kind: '连接', expr: '表达式', row: '绑定行' };
export function renderErrors() {
  const { G, V, sim } = S, box = $('#errs'), items = [];
  const label = id => {
    const n = G.node(id); if (n) return `[${TYPES[n.type].label}] ${A.nodeTag(n)}`;
    const e = G.edge(id);
    if (e) { const k = V.kind[e.id]; return `[${k === 'in' ? '消耗' : k === 'out' ? '产出' : '连线'}] ${A.nodeTag(G.node(e.from))} → ${A.nodeTag(G.node(e.to))}`; }
    return id;
  };
  for (const key in V.err) { const [id, f] = key.split(':'); items.push({ id, text: `${label(id)} ${FIELD_LABEL[f] || f}：${V.err[key]}` }); }
  if (sim && sim.error) items.push({ id: sim.error.id, text: `运行时熔断 ${label(sim.error.id)}：${sim.error.msg}` });
  box.innerHTML = items.map(it => `<div class="eitem" data-id="${esc(it.id)}">${esc(it.text)}</div>`).join('');
  box.querySelectorAll('.eitem').forEach(el => el.onclick = () => {
    const id = el.dataset.id, e = G.edge(id);
    if (G.node(id)) return A.select({ kind: 'node', id });
    if (e) { const a = G.ownerAction(e); A.select(a && V.compact.has(a.id) ? { kind: 'node', id: a.id } : { kind: 'edge', id }); }
  });
}

export function init() {
  const editing = () => $('#props').contains(document.activeElement);
  on('select', render);
  on('panel', render);
  on('graph', () => { updateErrors(); renderErrors(); });
  on('sim', () => { renderErrors(); updateErrors(); renderDiag(); });
  on('tables', () => { if (!editing()) render(); renderErrors(); });
}
