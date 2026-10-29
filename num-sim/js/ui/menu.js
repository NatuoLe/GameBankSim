// 通用右键菜单（DOM 浮层）
// items: { label, act, hint?, danger?, disabled? } | '-'（分隔线） | { title }
import { esc } from './dom.js';

let el = null, bound = false;

export function closeMenu() { if (el) { el.remove(); el = null; } }
export const menuOpen = () => !!el;

function bind() {
  bound = true;
  window.addEventListener('mousedown', ev => { if (el && !el.contains(ev.target)) closeMenu(); }, true);
  window.addEventListener('keydown', ev => { if (el && ev.key === 'Escape') { closeMenu(); ev.stopPropagation(); } }, true);
  window.addEventListener('wheel', closeMenu, { passive: true, capture: true });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('blur', closeMenu);
}

export function openMenu(x, y, items) {
  if (!bound) bind();
  closeMenu();
  // 去掉首尾与连续的分隔线
  const list = items.filter(Boolean).filter((it, i, a) => it !== '-' || (i > 0 && a[i - 1] !== '-' && i < a.length - 1));
  el = document.createElement('div');
  el.id = 'ctxmenu';
  el.addEventListener('contextmenu', ev => ev.preventDefault());
  for (const it of list) {
    const d = document.createElement('div');
    if (it === '-') d.className = 'mi-sep';
    else if (it.title) { d.className = 'mi-title'; d.textContent = it.title; }
    else {
      d.className = 'mi' + (it.danger ? ' danger' : '') + (it.disabled ? ' off' : '');
      d.innerHTML = `<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}`;
      if (!it.disabled) d.onclick = () => { closeMenu(); it.act(); };
    }
    el.appendChild(d);
  }
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
