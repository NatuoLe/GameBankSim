// 文件 IO：经本地 server.js 读取目录与数据表文件。浏览器专用。
import { jsonToTable, lubanAoa, parseCSV } from '../core/parse.js';

export const isFileProto = location.protocol === 'file:';

export async function api(url) {
  if (isFileProto) throw new Error('请双击 start.bat 通过本地服务打开，才能读取本地文件');
  const r = await fetch(url);
  if (!r.ok) { let m = 'HTTP ' + r.status; try { m = (await r.json()).error || m; } catch (_) { /* ignore */ } throw new Error(m); }
  return r;
}

/** → { dir, parent, entries: [{ name, type: 'dir'|'file', path, size }] } */
export const listDir = async dir => (await api('/api/list?dir=' + encodeURIComponent(dir))).json();

let xlsxP = null;
/** SheetJS：优先本地 xlsx.full.min.js，失败再走 CDN */
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxP) return xlsxP;
  const srcs = ['xlsx.full.min.js', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'];
  xlsxP = new Promise((res, rej) => {
    const tryAt = i => {
      if (i >= srcs.length) { xlsxP = null; return rej(new Error('SheetJS 加载失败（离线？）。可改用 Luban 导出的 json，或把 xlsx.full.min.js 放到 num-sim 目录下')); }
      const s = document.createElement('script'); s.src = srcs[i];
      s.onload = () => window.XLSX ? res(window.XLSX) : tryAt(i + 1);
      s.onerror = () => { s.remove(); tryAt(i + 1); };
      document.head.appendChild(s);
    };
    tryAt(0);
  });
  return xlsxP;
}

export const wbTable = (wb, sheet) => lubanAoa(window.XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '' }));

/** 读取并解析数据表文件 → { cols, rows, sheets, sheet, wb? } */
export async function fetchParsed(p, sheet) {
  const ext = p.split('.').pop().toLowerCase(), url = '/api/file?path=' + encodeURIComponent(p);
  const text = async () => { let t = await (await api(url)).text(); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); return t; };
  if (ext === 'json') return { ...jsonToTable(JSON.parse(await text())), sheets: null, sheet: null };
  if (ext === 'csv') return { ...lubanAoa(parseCSV(await text())), sheets: null, sheet: null };
  const X = await loadXLSX();
  const wb = X.read(await (await api(url)).arrayBuffer(), { type: 'array' });
  const sh = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0];
  return { ...wbTable(wb, sh), sheets: wb.SheetNames, sheet: sh, wb };
}
