// 应用状态 + 事件总线。UI 模块之间不直接调用，只通过事件同步。
//
// 事件：
//   graph   图数据变化（已重新校验）        select  选中对象变化
//   panel   需要重建属性面板                sim     模拟结果变化
//   tables  数据表加载/注册/改名/移除        loaded  整张图被替换（导入/示例/清空/启动）
//   fit     请求画布适应视图                play    持续运行状态切换（播放/暂停）
import { TableStore } from '../core/tables.js';

export const S = {
  /** @type {import('../core/model.js').Graph} */
  G: null,
  /** validate() 结果 */
  V: null,
  /** @type {import('../core/sim.js').Simulator} */
  sim: null,
  tables: new TableStore(),
  ui: {
    // linkDir：连线模式下 linkFrom 作为起点（out）还是终点（in）
    mode: 'select', sel: null, linkFrom: null, linkDir: 'out', mouse: { x: 0, y: 0 },
    view: { ox: 0, oy: 0, s: 1 }, lastRunN: null, vis: {}, hover: null, exprTarget: null,
    /** 是否正在持续运行 */
    playing: false,
  },
  /** speed：持续运行速度（tick/秒，0 = 尽可能快） */
  prefs: { ticks: 200, autoRerun: true, norm: false, speed: 10 },
};

const handlers = {};
export function on(ev, fn) { (handlers[ev] ||= []).push(fn); }
export function emit(ev, ...args) { for (const fn of handlers[ev] || []) fn(...args); }
