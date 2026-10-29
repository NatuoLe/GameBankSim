import { S } from '/js/app/state.js';
import * as A from '/js/app/actions.js';
import { exampleGraph } from '/js/examples.js';

const out = [];
const ok = (name, c, info = '') => out.push((c ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const type = async (inp, text) => { inp.focus(); inp.value = text; inp.setSelectionRange(text.length, text.length); inp.dispatchEvent(new Event('input', { bubbles: true })); await wait(30); };
try {
  await wait(600);
  // 1. v3 旧图迁移
  ok('v3 旧图启动时迁移为 id 引用', S.G.version === 4 && S.G.node('f1').expr === 'n1*2' && S.G.edge('e1').amount === 'f1', `${S.G.node('f1')?.expr} / ${S.G.edge('e1')?.amount}`);
  ok('迁移后无错误', !S.V.ids.size, JSON.stringify(S.V.err));
  ok('已写入 v4 存储', !!localStorage.getItem('num-sim.graph.v4'));

  // 2. 示例图
  await A.loadGraphObj(exampleGraph(), 'x', true);
  await wait(500);
  ok('示例运行 200 tick 无错误', S.sim.tick === 200 && !S.V.ids.size && !S.sim.error);
  const g0 = S.sim.val.n1, lv = S.sim.val.n4;

  // 3. 面板：选中 f2，显示 id 徽标，改名不影响表达式
  A.select({ kind: 'node', id: 'f2' });
  ok('面板显示 id 徽标', $('#props .pid')?.textContent === 'f2');
  const nameInp = $('#props input[data-f=name]');
  nameInp.value = '金币产速 (每tick)'; nameInp.dispatchEvent(new Event('change'));
  await wait(300);
  ok('改名为任意文本（含空格括号）成功', S.G.node('f2').name === '金币产速 (每tick)' && !S.V.ids.size);
  ok('引用 f2 的表达式未变', S.G.edge('e1').amount === 'f2');
  ok('改名后结果不变', S.sim.val.n1 === g0 && S.sim.val.n4 === lv);
  ok('被引用列表', $('#props').textContent.includes('被引用（1）'), $('#props').textContent.match(/被引用（\d+）/)?.[0]);

  // 4. 名称重复不报错
  A.renameNode(S.G.node('n2'), '金币');
  await wait(200);
  ok('名称重复不再报错', !S.V.ids.size);

  // 5. 自动补全：输入名称 → 插入 id
  A.select({ kind: 'edge', id: 'e2' });
  const amt = $('#props input[data-f=amount]');
  await type(amt, '经');
  const ac = $('#ac');
  ok('按名称搜索出现候选', ac.style.display === 'block' && ac.textContent.includes('n3'), ac.textContent.slice(0, 80));
  amt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(50);
  ok('选中后插入 id', amt.value === 'n3', amt.value);
  await type(amt, 'n1.');
  ok('id. 补全绑定行字段', ac.style.display === 'block' && ac.textContent.includes('max_stack'));
  await type(amt, '金币*0');
  await wait(200);
  ok('误用名称：提示使用 id', /是节点名称，表达式中请用 id 引用：n1 \/ n2/.test(S.V.err['e2:amount'] || ''), S.V.err['e2:amount']);
  await type(amt, '3');
  await wait(200);

  // 6. 绑定数据行：id 不变，显示名取行名称
  const p = A.addNode('pool', { x: 1000, y: 0 });
  const pid = p.id;
  A.select({ kind: 'node', id: pid });
  const ni = $('#props input[data-f=name]');
  ni.value = 'tbitem.1002'; ni.dispatchEvent(new Event('change'));
  await wait(200);
  ok('tbitem.1002 绑定：id 不变，名称=钻石', p.id === pid && p.name === '钻石' && p.row.key === 1002, `${p.id} ${p.name}`);
  ok('字段插入使用 id', !!$(`#props [data-ins="${pid}.max_stack"]`));

  // 7. 以行新建货币：init/cap 用新 id
  const before = S.G.nodes.length;
  A.newCurrency('道具表', S.tables.ok('道具表').cols, S.tables.find('道具表', 1003), 1003, { x: 1200, y: 0 });
  const nc = S.G.nodes[before];
  ok('以行新建货币：init/cap 引用自身 id', nc && nc.init === `${nc.id}.init` && nc.cap === `${nc.id}.max_stack` && nc.name === '经验', nc && `${nc.id} ${nc.init} ${nc.cap}`);
  await wait(200);
  ok('新货币无错误', !S.V.ids.size, JSON.stringify(S.V.err));

  // 8. 图例带 id
  ok('图例带 id', $('#legend').textContent.includes('n1·金币'));
} catch (err) { ok('异常', false, err.stack); }
await wait(50);
ok('无运行时错误', !window.__errs.length, window.__errs.join(' | '));
const pre = parent.document.createElement('pre'); pre.id = 'result'; pre.textContent = out.join('\n');
parent.document.body.appendChild(pre);
