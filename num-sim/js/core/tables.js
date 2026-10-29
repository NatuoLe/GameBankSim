// 数据表运行时仓库：按别名保存已加载的表，按主键索引行。不负责 IO。
import { normKey, keyLit, toNum } from './util.js';

export function buildIndex(rows, keyField) {
  const idx = new Map();
  for (const r of rows) { const k = normKey(r[keyField]); if (k !== '' && !idx.has(k)) idx.set(k, r); }
  return idx;
}
export const guessKey = cols => cols.find(c => /^id$/i.test(c)) || cols.find(c => /^(key|level|lv|_key)$/i.test(c)) || cols[0];

/**
 * 每张表的状态：{ status: 'loading' } | { status: 'error', error } | { status: 'ok', cols, rows, index }
 */
export class TableStore {
  constructor() { this.map = {}; }
  get(alias) { return this.map[alias]; }
  ok(alias) { const t = this.map[alias]; return t && t.status === 'ok' ? t : null; }
  loading(alias) { this.map[alias] = { status: 'loading' }; }
  fail(alias, error) { this.map[alias] = { status: 'error', error }; }
  put(alias, cols, rows, keyField) { return (this.map[alias] = { status: 'ok', cols, rows, index: buildIndex(rows, keyField) }); }
  remove(alias) { delete this.map[alias]; }
  rename(oldAlias, newAlias) { this.map[newAlias] = this.map[oldAlias]; delete this.map[oldAlias]; }
  clear() { this.map = {}; }
  /** 查行，找不到返回 null */
  find(alias, key) { const t = this.ok(alias); return t ? t.index.get(normKey(key)) || null : null; }
  /** 取数值字段，任何问题都抛出可读错误（供表达式运行时使用） */
  num(alias, key, field) {
    const t = this.ok(alias);
    if (!t) throw new Error(`数据表 ${alias} 未加载`);
    const row = t.index.get(normKey(key));
    if (!row) throw new Error(`${alias} 中不存在主键 ${keyLit(key)}`);
    if (!(field in row)) throw new Error(`${alias} 没有字段 ${field}`);
    const x = toNum(row[field]);
    if (Number.isNaN(x)) throw new Error(`${alias}[${keyLit(key)}].${field} = "${row[field]}" 不是数字`);
    return x;
  }
}
