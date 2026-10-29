// 数据表文件解析：json / csv / 二维数组（xlsx 经 SheetJS 转出）→ { cols, rows }
// 纯函数，不做任何 IO。

function findRows(d) {
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    for (const k in d) if (Array.isArray(d[k])) return d[k];
    const vals = Object.values(d);
    if (vals.length && vals.every(v => v && typeof v === 'object' && !Array.isArray(v))) return Object.entries(d).map(([k, v]) => ({ _key: k, ...v }));
  }
  return null;
}
function flatten(o, pre = '', out = {}, depth = 0) {
  for (const k in o) {
    const v = o[k], key = pre ? pre + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flatten(v, key, out, depth + 1);
    else out[key] = (v && typeof v === 'object') ? JSON.stringify(v) : v;
  }
  return out;
}

/** Luban 导出 json：数组 / 含数组字段的对象 / 以 key 为键的对象 */
export function jsonToTable(data) {
  let arr = findRows(data);
  if (!arr) { if (data && typeof data === 'object') arr = [data]; else throw new Error('json 中未找到数据行'); }
  const rows = arr.map(r => (r && typeof r === 'object' && !Array.isArray(r)) ? flatten(r) : { value: Array.isArray(r) ? JSON.stringify(r) : r });
  const cols = [], seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  return { cols, rows };
}

/** 二维数组 → 行对象。识别 Luban 源表：首列 ##var 行为字段名，其余 ## 开头的行（##type / ## 注释）跳过 */
export function lubanAoa(aoa) {
  const cell0 = r => String((r && r[0]) ?? '').trim();
  let hi = aoa.findIndex(r => /^##var$/i.test(cell0(r)));
  const luban = hi >= 0;
  if (!luban) hi = aoa.findIndex(r => r && r.some(c => String(c ?? '').trim() !== ''));
  if (hi < 0) return { cols: [], rows: [] };
  const header = aoa[hi], cols = [], idx = [];
  for (let i = luban ? 1 : 0; i < header.length; i++) {
    const h = String(header[i] ?? '').trim();
    if (h && !cols.includes(h)) { cols.push(h); idx.push(i); }
  }
  const rows = [];
  for (let r = hi + 1; r < aoa.length; r++) {
    const row = aoa[r]; if (!row) continue;
    if (luban && cell0(row).startsWith('##')) continue;
    const o = {}; let any = false;
    idx.forEach((ci, k) => { const v = row[ci]; if (v !== '' && v !== undefined && v !== null) any = true; o[cols[k]] = v ?? ''; });
    if (any) rows.push(o);
  }
  return { cols, rows };
}

export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
