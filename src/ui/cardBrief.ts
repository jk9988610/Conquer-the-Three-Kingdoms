import type { CardData } from '../game/types';
import { getModalOverlayMount } from './overlayRoot';

let layer: HTMLElement | null = null;

function ensureLayer(): HTMLElement {
  const mount = getModalOverlayMount();
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'card-brief-layer';
  }
  if (layer.parentElement !== mount) {
    mount.append(layer);
  }
  return layer;
}

/** 手牌/槽位点击：简略效果与描述 */
export function showCardBrief(data: CardData, anchor: HTMLElement): void {
  const root = ensureLayer();
  root.innerHTML = '';
  root.classList.add('card-brief-layer--open');

  const pop = document.createElement('div');
  pop.className = 'card-brief';
  pop.innerHTML = `
    <strong class="card-brief__name"></strong>
    <p class="card-brief__desc"></p>
    <p class="card-brief__effect"></p>
  `;
  pop.querySelector('.card-brief__name')!.textContent = data.name;
  pop.querySelector('.card-brief__desc')!.textContent = data.description ?? '';
  const effect = effectLine(data);
  const effectEl = pop.querySelector('.card-brief__effect')!;
  if (effect) {
    effectEl.textContent = effect;
  } else {
    effectEl.remove();
  }

  root.append(pop);

  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - 220);
  const top = Math.max(8, r.top - pop.offsetHeight - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  const close = (e: Event) => {
    if (e.target instanceof Node && pop.contains(e.target)) return;
    hideCardBrief();
    document.removeEventListener('pointerdown', close, true);
  };
  window.setTimeout(() => {
    document.addEventListener('pointerdown', close, true);
  }, 0);
}

export function hideCardBrief(): void {
  layer?.classList.remove('card-brief-layer--open');
  if (layer) layer.innerHTML = '';
}

function effectLine(data: CardData): string {
  if (data.attackBonus) return `攻击 +${data.attackBonus}`;
  if (data.id === 'item-heal-potion') return '治疗 20 生命';
  return '';
}
