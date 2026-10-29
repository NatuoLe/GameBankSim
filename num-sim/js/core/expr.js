// 表达式：递归下降解析，不使用 eval。
// compile() 产出的函数签名为 fn(scope)，scope = { vars, rng, table(alias,key,field), member(id,field) }
// —— 表达式模块不知道数据表、模拟器的存在，依赖由调用方通过 scope 注入。
// 变量一律用画布维护的节点 id 引用（如 n1、f2），节点名称只是显示标签。

/** 函数表：[最少参数, 最多参数, 实现, 是否需要随机数(第一个参数注入 rng)] */
export const FUNCS = {
  min: [1, 99, Math.min], max: [1, 99, Math.max],
  floor: [1, 1, Math.floor], ceil: [1, 1, Math.ceil],
  round: [1, 2, (x, n = 0) => { const p = 10 ** n; return Math.round(x * p) / p; }],
  abs: [1, 1, Math.abs], sign: [1, 1, Math.sign], sqrt: [1, 1, Math.sqrt], pow: [2, 2, Math.pow],
  exp: [1, 1, Math.exp], log: [1, 2, (x, b) => b === undefined ? Math.log(x) : Math.log(x) / Math.log(b)], log10: [1, 1, Math.log10],
  clamp: [3, 3, (x, a, b) => Math.min(b, Math.max(a, x))],
  lerp: [3, 3, (a, b, t) => a + (b - a) * t],
  if: [3, 3, null],
  rand: [0, 2, (r, a, b) => a === undefined ? r() : b === undefined ? r() * a : a + (b - a) * r(), true],
  randint: [2, 2, (r, a, b) => { a = Math.ceil(a); b = Math.floor(b); return a + Math.floor(r() * (b - a + 1)); }, true],
  chance: [1, 1, (r, p) => r() < p ? 1 : 0, true],
};
export const FUNC_DOC = {
  min: 'min(a,b,…)', max: 'max(a,b,…)', floor: '向下取整', ceil: '向上取整', round: 'round(x,位数)', abs: '绝对值', sign: '符号',
  sqrt: '平方根', pow: 'pow(x,y)', exp: 'e^x', log: 'log(x[,底])', log10: '常用对数', clamp: 'clamp(x,lo,hi)', lerp: 'lerp(a,b,t)',
  if: 'if(条件,a,b)', rand: 'rand() / rand(a,b)', randint: 'randint(a,b)', chance: 'chance(p) → 0/1',
};
export const RESERVED = new Set(['tick', ...Object.keys(FUNCS)]);
export const ID_START = /[\p{L}_]/u;
export const ID_PART = /[\p{L}\p{N}_]/u;
export const IDENT_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;
/** 标识符的正则源码片段，供其他模块拼接正则 */
export const ID_PATTERN = '[\\p{L}_][\\p{L}\\p{N}_]*';

export function tokenize(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const s = src.slice(i, j);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) throw new Error(`非法数字 "${s}" @${i + 1}`);
      toks.push({ t: 'num', v: parseFloat(s), p: i, e: j }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new Error(`字符串缺少结束引号 @${i + 1}`);
      toks.push({ t: 'str', v: src.slice(i + 1, j), p: i, e: j + 1 }); i = j + 1; continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1; while (j < src.length && ID_PART.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j), p: i, e: j }); i = j; continue;
    }
    const two = src.substr(i, 2);
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) { toks.push({ t: 'op', v: two, p: i, e: i + 2 }); i += 2; continue; }
    if ('+-*/%^()<>!,?:[].'.includes(c)) { toks.push({ t: 'op', v: c, p: i, e: i + 1 }); i++; continue; }
    throw new Error(`非法字符 "${c}" @${i + 1}`);
  }
  return toks;
}

/**
 * 语法（优先级从低到高）：
 *   c ? a : b   ||   &&   比较   + -   * / %   一元 - + !   ^（右结合）
 *   数字 | (expr) | 函数(args) | 变量 | 表[主键].字段 | 资源池.字段
 * 返回 { fn, ids: 引用的变量名, refs: 引用的数据表字段 }
 */
export function compile(src) {
  const toks = tokenize(src); let k = 0;
  const ids = new Set(), refs = [];
  const isOp = v => toks[k] && toks[k].t === 'op' && toks[k].v === v;
  const where = () => toks[k] ? ` @${toks[k].p + 1}` : ' @末尾';
  const eat = v => { if (!isOp(v)) throw new Error(`缺少 "${v}"${where()}`); k++; };
  const fieldChain = () => {
    const t = toks[k];
    if (!t || t.t !== 'id') throw new Error(`"." 后缺少字段名${where()}`);
    const parts = [t.v]; k++;
    while (isOp('.') && toks[k + 1] && toks[k + 1].t === 'id') { parts.push(toks[k + 1].v); k += 2; }
    return parts.join('.');
  };
  const bin = (next, ops, mk) => () => {
    let a = next();
    while (toks[k] && toks[k].t === 'op' && ops.includes(toks[k].v)) { const op = toks[k++].v, l = a, r = next(); a = mk(op, l, r); }
    return a;
  };
  const pPrim = () => {
    const t = toks[k];
    if (!t) throw new Error('表达式不完整 @末尾');
    if (t.t === 'num') { k++; const v = t.v; return () => v; }
    if (t.t === 'str') throw new Error(`字符串只能用作数据表主键，例如 表["${t.v}"].字段 @${t.p + 1}`);
    if (t.t === 'id') {
      k++; const name = t.v;
      if (isOp('(')) {
        const spec = FUNCS[name]; if (!spec) throw new Error(`未知函数 "${name}"`);
        k++;
        const args = [];
        if (!isOp(')')) { args.push(pTern()); while (isOp(',')) { k++; args.push(pTern()); } }
        eat(')');
        if (args.length < spec[0] || args.length > spec[1])
          throw new Error(`${name}() 需要 ${spec[0] === spec[1] ? spec[0] : spec[0] + '~' + spec[1]} 个参数，实际 ${args.length} 个`);
        if (name === 'if') { const [c, a, b] = args; return s => c(s) ? a(s) : b(s); }
        const f = spec[2];
        if (spec[3]) return s => f(s.rng, ...args.map(a => a(s)));
        if (args.length === 1) { const [a] = args; return s => f(a(s)); }
        return s => f(...args.map(a => a(s)));
      }
      if (isOp('[')) {
        k++;
        let keyFn, keyConst;
        if (toks[k] && toks[k].t === 'str') { keyConst = toks[k].v; k++; const kv = keyConst; keyFn = () => kv; }
        else {
          const s0 = k; keyFn = pTern();
          if (k - s0 === 1 && toks[s0].t === 'num') keyConst = toks[s0].v;
        }
        eat(']');
        if (!isOp('.')) throw new Error(`表引用需要指定字段，例如 ${name}[主键].字段${where()}`);
        k++;
        const field = fieldChain();
        refs.push({ kind: 'table', alias: name, keyConst, field });
        return s => s.table(name, keyFn(s), field);
      }
      if (isOp('.')) {
        k++;
        const field = fieldChain();
        refs.push({ kind: 'member', name, field });
        return s => s.member(name, field);
      }
      ids.add(name);
      return s => s.vars[name];
    }
    if (isOp('(')) { k++; const e = pTern(); eat(')'); return e; }
    throw new Error(`意外的 "${t.v}"${where()}`);
  };
  const pPow = () => {
    const b = pPrim();
    if (isOp('^')) { k++; const e = pUnary(); return s => Math.pow(b(s), e(s)); }
    return b;
  };
  const pUnary = () => {
    if (isOp('-')) { k++; const a = pUnary(); return s => -a(s); }
    if (isOp('+')) { k++; return pUnary(); }
    if (isOp('!')) { k++; const a = pUnary(); return s => a(s) ? 0 : 1; }
    return pPow();
  };
  const pMul = bin(pUnary, ['*', '/', '%'], (op, l, r) => op === '*' ? s => l(s) * r(s) : op === '/' ? s => l(s) / r(s) : s => l(s) % r(s));
  const pAdd = bin(pMul, ['+', '-'], (op, l, r) => op === '+' ? s => l(s) + r(s) : s => l(s) - r(s));
  const CMP = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
  const pCmp = bin(pAdd, Object.keys(CMP), (op, l, r) => { const f = CMP[op]; return s => f(l(s), r(s)) ? 1 : 0; });
  const pAnd = bin(pCmp, ['&&'], (op, l, r) => s => (l(s) && r(s)) ? 1 : 0);
  const pOr = bin(pAnd, ['||'], (op, l, r) => s => (l(s) || r(s)) ? 1 : 0);
  const pTern = () => {
    const c = pOr();
    if (isOp('?')) { k++; const a = pTern(); eat(':'); const b = pTern(); return s => c(s) ? a(s) : b(s); }
    return c;
  };
  if (!toks.length) throw new Error('表达式为空');
  const fn = pTern();
  if (k < toks.length) throw new Error(`多余的内容 "${toks[k].v}"${where()}`);
  return { fn, ids: [...ids], refs };
}

/**
 * 替换表达式中的变量标识符（跳过 "." 之后的字段名与函数名）。
 * map(name) 返回新文本或 undefined（不替换）；一次扫描完成，不会连锁替换。
 */
export function replaceIdents(src, map) {
  if (src === undefined || src === null || src === '') return src;
  let toks; try { toks = tokenize(String(src)); } catch (_) { return src; }
  let s = String(src);
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i], nx = toks[i + 1], pv = toks[i - 1];
    if (t.t !== 'id') continue;
    if (nx && nx.t === 'op' && nx.v === '(') continue;
    if (pv && pv.t === 'op' && pv.v === '.') continue;
    const r = map(t.v);
    if (r !== undefined && r !== t.v) s = s.slice(0, t.p) + r + s.slice(t.e);
  }
  return s;
}
/** 重命名表达式中的某个标识符（用于数据表别名改名） */
export const renameInExpr = (src, oldName, newName) => replaceIdents(src, v => (v === oldName ? newName : undefined));
