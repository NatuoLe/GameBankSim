// 纯函数工具：不依赖 DOM，可在浏览器与 Node 中运行

export const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function fmt(x) {
  if (typeof x !== 'number' || Number.isNaN(x)) return '-';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '-∞';
  const a = Math.abs(x);
  if (a >= 1e7) return x.toExponential(2);
  if (a > 0 && a < 0.01) return x.toPrecision(2);
  return String(Math.round(x * 100) / 100);
}

/** 单元格 → 数字；无法解析返回 NaN（true/false 视为 1/0） */
export function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (s === '') return NaN;
  if (/^true$/i.test(s)) return 1;
  if (/^false$/i.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** 主键归一化：数字主键 1001 / "1001" / "1001.0" 视为同一个 */
export function normKey(k) {
  if (typeof k === 'number') return String(k);
  const s = String(k ?? '').trim();
  return s !== '' && Number.isFinite(Number(s)) ? String(Number(s)) : s;
}
/** 主键在表达式中的字面量写法 */
export function keyLit(k) { const s = normKey(k); return s !== '' && Number.isFinite(Number(s)) ? s : JSON.stringify(s); }
/** 主键存储值：能转数字就存数字 */
export function keyVal(k) { const s = normKey(k); return s !== '' && Number.isFinite(Number(s)) ? Number(s) : s; }

/** 可复现的伪随机数发生器 */
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
