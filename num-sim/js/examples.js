// 预置示例：通用经济循环 + 升级循环
import { actionDefaults, GRAPH_VERSION } from './core/model.js';

export function exampleGraph() {
  const A = (id, name, x, y, o) => actionDefaults({ id, type: 'action', name, x, y, ...o });
  return {
    version: GRAPH_VERSION, nextId: 100, view: null, seed: 1,
    tables: [
      { alias: '道具表', path: 'sample/tbitem.json', keyField: 'id', sheet: null, labelField: 'name' },
      { alias: '等级表', path: 'sample/tblevel.json', keyField: 'level', sheet: null, labelField: null },
    ],
    // 自上而下布局：入口在上，出口在下。表达式中的变量一律用节点 id 引用（n1 / f2 …），name 只是显示标签
    nodes: [
      { id: 'n1', type: 'pool', name: '金币', x: 0, y: 140, init: 'n1.init', cap: 'n1.max_stack', row: { table: '道具表', key: 1001 } },
      { id: 'n2', type: 'pool', name: '钻石', x: 120, y: 440, init: 'n2.init', cap: 'n2.max_stack', row: { table: '道具表', key: 1002 } },
      { id: 'n3', type: 'pool', name: '经验', x: 600, y: 140, init: 'n3.init', cap: '', row: { table: '道具表', key: 1003 } },
      { id: 'n4', type: 'pool', name: '等级', x: 600, y: 440, init: '1', cap: '20' },
      { id: 'f1', type: 'formula', name: '升级所需', x: 800, y: 290, expr: '等级表[n4].exp_need' },
      { id: 'f2', type: 'formula', name: '每tick金币', x: -200, y: 0, expr: '等级表[n4].gold_per_tick' },
      A('a1', '金币产出', 0, 0, {}),
      A('a2', '日常消耗', -180, 290, { mode: 'partial' }),
      A('a3', '兑换', 60, 290, { compact: true }),
      A('a4', '十连抽', 120, 590, { trigger: 'every', every: '10' }),
      A('a5', '幸运宝箱', 300, 290, { trigger: 'every', every: '5', chance: '0.3' }),
      A('a6', '经验获取', 600, 0, {}),
      A('a7', '升级', 600, 290, { times: '5' }),
    ],
    edges: [
      { id: 'e1', from: 'a1', to: 'n1', amount: 'f2' },
      { id: 'e2', from: 'n1', to: 'a2', amount: '3' },
      { id: 'e3', from: 'n1', to: 'a3', amount: '100' },
      { id: 'e4', from: 'a3', to: 'n2', amount: '1' },
      { id: 'e5', from: 'n2', to: 'a4', amount: '5' },
      { id: 'e6', from: 'a5', to: 'n2', amount: '1' },
      { id: 'e7', from: 'a6', to: 'n3', amount: '8' },
      { id: 'e8', from: 'n3', to: 'a7', amount: 'f1' },
      { id: 'e9', from: 'a7', to: 'n4', amount: '1' },
    ],
  };
}
