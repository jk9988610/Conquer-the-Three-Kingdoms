import { drawPixelArt } from '../art/pixelArt';
import type { CardInstance, PixelArtKey } from '../game/types';
import type { TcgScaledSize } from '../tcg/dimensions';

export interface CardElementOptions {
  size: TcgScaledSize;
  /** 我方场上角色，可点击查看详情 */
  onFieldPlayer?: boolean;
  showPrice?: number;
}

export function createPixelArtCanvas(
  artKey: PixelArtKey,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) drawPixelArt(ctx, artKey, width, height);
  return canvas;
}

export function createCardElement(
  card: CardInstance,
  options: CardElementOptions
): HTMLElement {
  const { size, onFieldPlayer = false, showPrice } = options;

  const el = document.createElement('article');
  el.className = 'tcg-card';
  el.dataset.instanceId = card.instanceId;
  el.dataset.templateId = card.data.id;
  el.style.width = `${size.cardWidth}px`;
  el.style.height = `${size.cardHeight}px`;

  if (onFieldPlayer) {
    el.dataset.field = 'player';
    el.classList.add('tcg-card--field-player');
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
  const artH = Math.floor(height * 0.58);
  const canvas = createPixelArtCanvas(
    card.data.artKey ?? 'generic',
    Math.max(1, Math.floor(width)),
    Math.max(1, artH)
  );
  canvas.className = 'tcg-card__art';
  artLayer.append(canvas);

  const textLayer = document.createElement('div');
  textLayer.className = 'tcg-card__text-layer';

  const title = document.createElement('h3');
  title.className = 'tcg-card__title';
  title.textContent = card.data.name;

  const desc = document.createElement('p');
  desc.className = 'tcg-card__desc';
  desc.textContent = card.data.description ?? '';

  textLayer.append(title, desc);

  if (card.stats) {
    const stats = document.createElement('p');
    stats.className = 'tcg-card__stats';
    stats.textContent = `HP ${card.stats.hp}/${card.stats.maxHp} ATK ${card.stats.attack}`;
    textLayer.append(stats);
  }

  if (showPrice !== undefined) {
    const price = document.createElement('span');
    price.className = 'tcg-card__price';
    price.textContent = `${showPrice}金`;
    textLayer.append(price);
  }

  inner.append(artLayer, textLayer);

  const tags = document.createElement('div');
  tags.className = 'tcg-card__tags';
  for (const tag of card.data.tags) {
    const badge = document.createElement('span');
    badge.className = `tcg-card__tag tcg-card__tag--${tag}`;
    badge.textContent = tagLabel(tag);
    tags.append(badge);
  }
  inner.append(tags);

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
