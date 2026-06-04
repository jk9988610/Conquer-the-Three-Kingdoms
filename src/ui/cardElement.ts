import { drawPixelArt } from '../art/pixelArt';
import type { CardInstance } from '../game/types';
import type { TcgScaledSize } from '../tcg/dimensions';

export interface CardElementOptions {
  size: TcgScaledSize;
  /** 手牌角色：可拖拽上场 */
  draggableToBattle?: boolean;
  showTags?: boolean;
  /** 商店：显示购买按钮 */
  shopPrice?: number;
  onBuy?: () => void;
}

export function createCardElement(
  card: CardInstance,
  options: CardElementOptions
): HTMLElement {
  const {
    size,
    draggableToBattle = false,
    showTags = true,
    shopPrice,
    onBuy,
  } = options;

  const el = document.createElement('article');
  el.className = 'tcg-card';
  el.dataset.instanceId = card.instanceId;
  el.dataset.templateId = card.data.id;
  el.style.width = `${size.cardWidth}px`;
  el.style.height = `${size.cardHeight}px`;

  if (draggableToBattle) {
    el.classList.add('tcg-card--draggable');
    el.setAttribute('aria-label', `拖拽 ${card.data.name} 至我方战场`);
  }

  const { left, top, width, height } = size.innerFrame;
  const inner = document.createElement('div');
  inner.className = 'tcg-card__inner';
  inner.style.left = `${left}px`;
  inner.style.top = `${top}px`;
  inner.style.width = `${width}px`;
  inner.style.height = `${height}px`;

  const artLayer = document.createElement('div');
  artLayer.className = 'tcg-card__art-layer';
  const canvas = document.createElement('canvas');
  canvas.className = 'tcg-card__art';
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(Math.floor(height * 0.62)));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    drawPixelArt(ctx, card.data.artKey ?? 'generic', canvas.width, canvas.height);
  }
  artLayer.append(canvas);

  const textLayer = document.createElement('div');
  textLayer.className = 'tcg-card__text-layer';

  const title = document.createElement('h3');
  title.className = 'tcg-card__title';
  title.textContent = card.data.name;

  const desc = document.createElement('p');
  desc.className = 'tcg-card__desc';
  desc.textContent = card.data.description ?? '';

  if (card.stats) {
    const stats = document.createElement('p');
    stats.className = 'tcg-card__stats';
    stats.textContent = `生命 ${card.stats.hp}/${card.stats.maxHp} · 攻击 ${card.stats.attack}`;
    textLayer.append(title, desc, stats);
  } else {
    textLayer.append(title, desc);
  }

  inner.append(artLayer, textLayer);

  if (showTags && card.data.tags.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'tcg-card__tags';
    for (const tag of card.data.tags) {
      const badge = document.createElement('span');
      badge.className = `tcg-card__tag tcg-card__tag--${tag}`;
      badge.textContent = tagLabel(tag);
      tags.append(badge);
    }
    inner.append(tags);
  }

  if (shopPrice !== undefined && onBuy) {
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'tcg-card__buy';
    buy.textContent = `购买 ${shopPrice}`;
    buy.addEventListener('click', (e) => {
      e.stopPropagation();
      onBuy();
    });
    el.append(buy);
  }

  el.append(inner);
  return el;
}

export function createDragGhost(source: HTMLElement): HTMLElement {
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.add('tcg-card__ghost');
  ghost.style.width = source.style.width;
  ghost.style.height = source.style.height;
  ghost.style.position = 'fixed';
  ghost.style.zIndex = '9999';
  ghost.style.pointerEvents = 'none';
  ghost.style.margin = '0';
  return ghost;
}

function tagLabel(tag: string): string {
  const map: Record<string, string> = {
    character: '角色',
    action: '动作',
    item: '物品',
    equipment: '装备',
  };
  return map[tag] ?? tag;
}
