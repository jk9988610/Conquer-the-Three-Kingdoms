import type { CardInstance } from '../game/types';
import type { TcgScaledSize } from '../tcg/dimensions';

export interface CardElementOptions {
  size: TcgScaledSize;
  /** 是否显示为可打出（手牌角色卡） */
  playable?: boolean;
  /** 是否显示标签徽章 */
  showTags?: boolean;
}

export function createCardElement(
  card: CardInstance,
  options: CardElementOptions
): HTMLElement {
  const { size, playable = false, showTags = true } = options;
  const el = document.createElement('article');
  el.className = 'tcg-card';
  el.dataset.instanceId = card.instanceId;
  el.style.width = `${size.cardWidth}px`;
  el.style.height = `${size.cardHeight}px`;

  if (playable) {
    el.classList.add('tcg-card--playable');
    el.setAttribute('draggable', 'true');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `打出 ${card.data.name}`);
  }

  const frame = document.createElement('div');
  frame.className = 'tcg-card__frame';
  const { left, top, width, height } = size.innerFrame;
  frame.style.left = `${left}px`;
  frame.style.top = `${top}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;

  const title = document.createElement('h3');
  title.className = 'tcg-card__title';
  title.textContent = card.data.name;

  const desc = document.createElement('p');
  desc.className = 'tcg-card__desc';
  desc.textContent = card.data.description ?? '';

  frame.append(title, desc);

  if (showTags && card.data.tags.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'tcg-card__tags';
    for (const tag of card.data.tags) {
      const badge = document.createElement('span');
      badge.className = `tcg-card__tag tcg-card__tag--${tag}`;
      badge.textContent = tagLabel(tag);
      tags.append(badge);
    }
    frame.append(tags);
  }

  el.append(frame);
  return el;
}

function tagLabel(tag: string): string {
  const map: Record<string, string> = {
    character: '角色',
    action: '动作',
    item: '物品',
  };
  return map[tag] ?? tag;
}
