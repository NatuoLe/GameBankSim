// 左侧 Luban 区：① 文件浏览 ② 已注册数据表 ③ 表预览 / 注册 / 绑定
import { S, on } from '../app/state.js';
import * as A from '../app/actions.js';
import { normKey, keyLit, trunc } from '../core/util.js';
import { guessKey } from '../core/tables.js';
import { checkAlias, toIdent, makeTableDef } from '../core/edit.js';
import { listDir, fetchParsed, wbTable } from '../io/loader.js';
import { $, esc, toast } from './dom.js';
import { insertRef } from './autocomplete.js';
import { viewCenter } from './canvas.js';

const MAX_ROWS = 500;
/** 当前预览：{ name, path, cols, rows, sheets, sheet, wb?, alias, keyField, sel, fromRegistry } */
const lb = { dir: '', parent: null, view: null };
const samePath = (a, b) => String(a).replace(/\//g, '\\').toLowerCase() === String(b).replace(/\//g, '\\').toLowerCase();
const aliasFor = (p, sheet) => S.G.tables.find(t => samePath(t.path, p) && (t.sheet || null) === (sheet || null))?.alias || null;

/* ---------- ① 文件浏览 ---------- */
export async function lbList(dir) {
  const box = $('#lbList');
  try {
    const d = await listDir(dir);
    lb.dir = d.dir; lb.parent = d.parent;
    $('#lbDir').value = d.dir; $('#lbCur').textContent = d.dir || '我的电脑'; $('#lbCur').title = d.dir;
    if (d.dir) localStorage.setItem(A.LS_DIR, d.dir);
    const kb = n => n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(1) + 'K' : (n / 1048576).toFixed(1) + 'M';
    box.innerHTML = d.entries.length ? d.entries.map((e, i) => {
      const ext = e.type === 'dir' ? 'DIR' : e.name.split('.').pop().toUpperCase();
      const reg = e.type === 'file' && S.G.tables.some(t => samePath(t.path, e.path));
      return `<div class="fi ${lb.view && samePath(lb.view.path, e.path) ? 'cur' : ''}" data-i="${i}" title="${esc(e.path)}"><span class="tag ${e.type === 'dir' ? 'dir' : ''}">${ext}</span><span class="ell">${esc(e.name)}</span>${reg ? '<span class="tag tbl">已注册</span>' : ''}${e.type === 'file' ? `<span class="sz">${kb(e.size)}</span>` : ''}</div>`;
    }).join('') : '<div class="fi dim">（没有 json/xlsx/xls/csv 文件）</div>';
    box.querySelectorAll('.fi[data-i]').forEach(el => el.onclick = () => {
      const e = d.entries[+el.dataset.i];
      if (e.type === 'dir') lbList(e.path);
      else { box.querySelectorAll('.fi').forEach(x => x.classList.remove('cur')); el.classList.add('cur'); openFile(e.path, e.name); }
    });
  } catch (e) { box.innerHTML = `<div class="fi" style="color:var(--err);cursor:default">${esc(e.message)}</div>`; }
}
async function openFile(p, name, sheet, wb) {
  $('#lbTitle').textContent = '③ 表预览 · 加载中…';
  try {
    const parsed = wb && sheet ? { ...wbTable(wb, sheet), sheets: wb.SheetNames, sheet, wb } : await fetchParsed(p, sheet);
    const alias = aliasFor(p, parsed.sheet);
    lb.view = { name, path: p, ...parsed, alias, keyField: alias ? S.G.table(alias).keyField : guessKey(parsed.cols), sel: null, fromRegistry: false };
    renderPreview(); renderTables();
  } catch (e) {
    $('#lbTitle').textContent = '③ 表预览';
    $('#lbTable').innerHTML = `<div style="padding:8px;color:var(--err)">${esc(e.message)}</div>`;
  }
}

/* ---------- ② 已注册数据表 ---------- */
function openRegistered(d, keepSel) {
  const t = S.tables.get(d.alias);
  if (!t || t.status !== 'ok') return toast(t && t.error ? `${d.alias} 加载失败：${t.error}` : `${d.alias} 加载中`, true);
  const sel = keepSel && lb.view && lb.view.alias === d.alias ? lb.view.sel : null;
  lb.view = { name: d.path.split(/[\\/]/).pop() + (d.sheet ? ' / ' + d.sheet : ''), path: d.path, cols: t.cols, rows: t.rows, sheets: null, sheet: d.sheet, alias: d.alias, keyField: d.keyField, sel, fromRegistry: true };
  renderPreview(); renderTables();
}
export function renderTables() {
  const box = $('#tblList'), G = S.G;
  if (!G.tables.length) { box.innerHTML = '<div class="fi dim" style="cursor:default">尚未注册。① 浏览文件 → ③ 预览 →「注册为数据表」</div>'; return; }
  box.innerHTML = G.tables.map((d, i) => {
    const t = S.tables.get(d.alias) || {};
    const st = t.status === 'ok' ? `${t.rows.length} 行` : t.status === 'error' ? '<span style="color:var(--err)">失败</span>' : '加载中';
    const tip = `${d.path}${d.sheet ? ' / ' + d.sheet : ''}${t.error ? '\n' + t.error : ''}`;
    return `<div class="fi ${lb.view && lb.view.alias === d.alias ? 'cur' : ''}" data-i="${i}" title="${esc(tip)}"><span class="tag tbl">表</span><b class="ell">${esc(d.alias)}</b><span class="dim ell" style="flex:1">主键 ${esc(d.keyField)}</span><span class="sz">${st}</span>` +
      `<button class="sm" data-a="reload" title="重新读取">↻</button><button class="sm" data-a="rename">改名</button><button class="sm danger" data-a="del">✕</button></div>`;
  }).join('');
  box.querySelectorAll('.fi[data-i]').forEach(el => el.onclick = async ev => {
    const d = G.tables[+el.dataset.i], a = ev.target.dataset.a;
    if (a === 'reload') {
      const t = await A.reloadTable(d);
      toast(t.status === 'ok' ? `已刷新 ${d.alias}` : `刷新失败：${t.error}`, t.status !== 'ok');
    } else if (a === 'rename') {
      const old = d.alias, nv = (prompt('新的数据表别名', d.alias) || '').trim();
      if (!nv || nv === old) return;
      const m = A.renameTable(d, nv);
      if (m) return toast(m, true);
      if (lb.view && lb.view.alias === old) lb.view.alias = nv;
      renderPreview(); renderTables();
      toast(`已改名 ${old} → ${nv}，所有引用已同步`);
    } else if (a === 'del') {
      if (!confirm(`移除数据表 ${d.alias}？引用它的表达式和绑定会报错。`)) return;
      if (lb.view && lb.view.alias === d.alias) { lb.view.alias = null; lb.view.fromRegistry = false; }
      A.removeTable(d); renderPreview();
    } else openRegistered(d);
  });
}

/* ---------- ③ 表预览 ---------- */
function defaultAlias(name) {
  const base = toIdent(name.replace(/\.[^.]+$/, ''));
  let a = base, i = 2;
  while (checkAlias(S.G, a) && i < 100) a = base + '_' + i++;
  return a;
}
export function renderPreview() {
  const v = lb.view;
  if (!v) { $('#lbTitle').textContent = '③ 表预览'; $('#lbReg').innerHTML = ''; $('#lbTable').innerHTML = ''; $('#lbSheetBar').style.display = 'none'; renderBind(); return; }
  $('#lbTitle').textContent = `③ 表预览 · ${v.name}（${v.rows.length} 行${v.rows.length > MAX_ROWS ? '，显示前 ' + MAX_ROWS : ''}）`;
  const sb = $('#lbSheetBar');
  if (v.sheets && v.sheets.length > 1) {
    sb.style.display = '';
    $('#lbSheet').innerHTML = v.sheets.map(n => `<option ${n === v.sheet ? 'selected' : ''}>${esc(n)}</option>`).join('');
  } else sb.style.display = 'none';
  const reg = $('#lbReg');
  if (v.alias) {
    const d = S.G.table(v.alias);
    reg.innerHTML = `<span class="dim">已注册为</span><span class="ref">${esc(v.alias)}</span><span class="dim">🔑${esc(v.keyField)}</span>
      <span class="dim" title="可选：绑定行时作为资源池的默认显示名称，并在画布/图例上显示；不影响表达式引用（表达式用节点 id）">🏷显示</span><select id="regLabel" style="max-width:96px"><option value="">（无）</option>${v.cols.map(c => `<option ${d && c === d.labelField ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
    $('#regLabel').onchange = ev => { if (d) A.setLabelField(d, ev.target.value); };
  } else if (!v.cols.length) reg.innerHTML = '<span class="dim">该表没有可识别的字段</span>';
  else {
    reg.innerHTML = `<span class="dim">别名</span><input id="regAlias" style="width:96px" value="${esc(defaultAlias(v.name))}"><span class="dim">主键</span><select id="regKey" style="max-width:100px">${v.cols.map(c => `<option ${c === v.keyField ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><button class="sm primary" id="regBtn">注册为数据表</button>`;
    $('#regBtn').onclick = registerView;
    $('#regKey').onchange = ev => { v.keyField = ev.target.value; renderPreview(); };
  }
  const ki = v.cols.indexOf(v.keyField);
  let h = '<table><thead><tr><th class="idx">#</th>' + v.cols.map((c, i) => `<th class="${i === ki ? 'key' : ''}" title="${esc(c)}${i === ki ? '（主键）' : ''}">${i === ki ? '🔑' : ''}${esc(c)}</th>`).join('') + '</tr></thead><tbody>';
  const shown = v.rows.slice(0, MAX_ROWS).map((r, ri) => [r, ri]);
  if (v.sel && v.sel.r >= MAX_ROWS && v.rows[v.sel.r]) shown.push([v.rows[v.sel.r], v.sel.r]);
  for (const [r, ri] of shown) {
    h += `<tr class="${v.sel && v.sel.r === ri ? 'row-on' : ''}"><td class="idx">${ri + 1}</td>` +
      v.cols.map((c, ci) => `<td data-r="${ri}" data-c="${ci}" class="${v.sel && v.sel.r === ri && v.sel.c === ci ? 'cell-on' : ''}" title="${esc(r[c])}">${esc(r[c])}</td>`).join('') + '</tr>';
  }
  $('#lbTable').innerHTML = h + '</tbody></table>';
  renderBind();
}
function registerView() {
  const v = lb.view; if (!v) return;
  const alias = $('#regAlias').value.trim(), keyField = $('#regKey').value;
  const m = checkAlias(S.G, alias); if (m) return toast(m, true);
  const ignored = A.registerTable(makeTableDef(alias, v.path, keyField, v.sheet, v.cols), v.cols, v.rows);
  v.alias = alias; v.keyField = keyField;
  renderPreview(); renderTables();
  toast(`已注册 ${alias}（${v.rows.length - ignored} 行${ignored > 0 ? `，${ignored} 行主键为空或重复被忽略` : ''}）`, ignored > 0);
}
/** 在预览中定位资源池绑定的行 */
export function locateRow(n, quiet) {
  const d = n && n.row && S.G.table(n.row.table), t = d && S.tables.ok(d.alias);
  if (!t) { if (!quiet) toast(`数据表 ${n?.row?.table} 未加载`, true); return; }
  const row = t.index.get(normKey(n.row.key));
  if (!row) { if (!quiet) toast(`${n.row.table}[${keyLit(n.row.key)}] 不存在`, true); return; }
  openRegistered(d);
  lb.view.sel = { r: t.rows.indexOf(row), c: Math.max(0, t.cols.indexOf(d.keyField)) };
  renderPreview();
  const tr = $('#lbTable tr.row-on'); if (tr) tr.scrollIntoView({ block: 'center' });
}

/* ---------- 绑定条 ---------- */
export function renderBind() {
  const box = $('#lbBind'), v = lb.view;
  if (!v) { box.innerHTML = '<span class="dim">打开一个表：注册后可按主键把数据行绑定为货币，或把字段引用插入表达式</span>'; return; }
  if (!v.alias) { box.innerHTML = '<span class="dim">先填写别名、选择主键并注册，之后才能绑定/引用（避免拷贝数值导致与 Luban 脱节）</span>'; return; }
  if (!v.sel) { box.innerHTML = '<span class="dim">点击表中某一行（单元格）开始绑定</span>'; return; }
  const row = v.rows[v.sel.r], field = v.cols[v.sel.c], key = row[v.keyField];
  if (normKey(key) === '') { box.innerHTML = '<span style="color:var(--err)">该行主键为空，无法引用</span>'; return; }
  const rowRef = `${v.alias}[${keyLit(key)}]`;
  const sn = A.selectedNode(), pool = sn && sn.type === 'pool' ? sn : null;
  const sameRow = pool && pool.row && pool.row.table === v.alias && normKey(pool.row.key) === normKey(key);
  const fieldRef = sameRow ? `${pool.id}.${field}` : `${rowRef}.${field}`;
  let h = `<span class="ref" title="数据行引用">${esc(rowRef)}</span>`;
  h += `<button class="sm primary" data-b="new" title="新建资源池并绑定到此行">以此行新建货币</button>`;
  if (pool && !sameRow) h += `<button class="sm primary" data-b="bind">绑定到 ${esc(pool.id)}·${esc(pool.name)}</button>`;
  h += `<button class="sm" data-b="ins" title="插入到最近聚焦的表达式输入框">插入 ${esc(trunc(fieldRef, 26))}</button>`;
  box.innerHTML = h;
  box.querySelectorAll('[data-b]').forEach(b => { b.onmousedown = ev => ev.preventDefault(); });
  box.querySelector('[data-b=new]').onclick = () => A.newCurrency(v.alias, v.cols, row, key, viewCenter());
  const bb = box.querySelector('[data-b=bind]'); if (bb) bb.onclick = () => A.bindByRef(pool, v.alias, key);
  box.querySelector('[data-b=ins]').onclick = () => insertRef(fieldRef);
}

export function init() {
  $('#lbGo').onclick = () => lbList($('#lbDir').value.trim());
  $('#lbDir').addEventListener('keydown', ev => { if (ev.key === 'Enter') lbList($('#lbDir').value.trim()); });
  $('#lbUp').onclick = () => { if (lb.parent !== null && lb.parent !== undefined) lbList(lb.parent); };
  $('#tblReloadAll').onclick = async () => {
    const bad = await A.reloadTables();
    toast(bad.length ? `${bad.length} 张表刷新失败` : `已刷新 ${S.G.tables.length} 张表`, bad.length > 0);
  };
  $('#lbTable').addEventListener('mousedown', ev => { if (ev.target.closest('td[data-r]')) ev.preventDefault(); });
  $('#lbTable').addEventListener('click', ev => {
    const td = ev.target.closest('td[data-r]'); if (!td || !lb.view) return;
    lb.view.sel = { r: +td.dataset.r, c: +td.dataset.c };
    $('#lbTable').querySelectorAll('.cell-on').forEach(x => x.classList.remove('cell-on'));
    $('#lbTable').querySelectorAll('.row-on').forEach(x => x.classList.remove('row-on'));
    td.classList.add('cell-on'); td.parentElement.classList.add('row-on');
    renderBind();
  });
  $('#lbSheet').addEventListener('change', ev => { const v = lb.view; if (v) openFile(v.path, v.name, ev.target.value, v.wb); });

  on('select', () => { renderBind(); const n = A.selectedNode(); if (n && n.row) locateRow(n, true); });
  on('graph', renderBind);
  on('tables', () => {
    renderTables();
    const d = lb.view && lb.view.fromRegistry && lb.view.alias && S.G.table(lb.view.alias);
    if (d && S.tables.ok(d.alias)) openRegistered(d, true); else renderBind();
  });
  on('loaded', () => { lb.view = null; renderTables(); renderPreview(); });
}
