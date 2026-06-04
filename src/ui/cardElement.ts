import { drawPixelArt } from '../art/pixelArt';
import type { CardInstance, PixelArtKey } from '../game/types';
import type { TcgScaledSize } from '../tcg/dimensions';

export interface CardElementOptions {
  size: TcgScaledSize;
  onFieldPlayer?: boolean;
  showPrice?: number;
  soldOut?: boolean;
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
  if (ctx) drawPixelArt(ctx, artKey, width, height, { transparent: true });
  return canvas;
}

export function createCardElement(
  card: CardInstance,
  options: CardElementOptions
): HTMLElement {
  const { size, onFieldPlayer = false, showPrice, soldOut = false } = options;

  const el = document.createElement('article');
  el.className = 'tcg-card';
  if (soldOut) el.classList.add('tcg-card--sold-out');
  el.dataset.instanceId = card.instanceId;
  el.dataset.templateId = card.data.id;
  el.dataset.artKey = card.data.artKey ?? 'generic';
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
  const canvas = createPixelArtCanvas(
    card.data.artKey ?? 'generic',
    Math.max(1, Math.floor(width)),
    Math.max(1, Math.floor(height))
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

  if (showPrice !== undefined && !soldOut) {
    const price = document.createElement('span');
    price.className = 'tcg-card__price';
    price.textContent = `${showPrice}金`;
    textLayer.append(price);
  }

  inner.append(artLayer, textLayer);
  el.append(inner);

  if (soldOut) {
    const badge = document.createElement('div');
    badge.className = 'tcg-card__sold-out';
    badge.textContent = '售罄';
    el.append(badge);
  }

  return el;
}

/** 拖拽幽灵：仅透明底像素图，无框 */
export function createDragGhost(source: HTMLElement): HTMLElement {
  const rect = source.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);

  const ghost = document.createElement('div');
  ghost.className = 'tcg-card-ghost';
  ghost.style.width = `${w}px`;
  ghost.style.height = `${h}px`;

  const artKey = (source.dataset.artKey ?? 'generic') as PixelArtKey;
  const inner = source.querySelector('.tcg-card__inner');
  const srcCanvas = source.querySelector('canvas.tcg-card__art');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.className = 'tcg-card-ghost__art';
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    if (srcCanvas instanceof HTMLCanvasElement && inner) {
      const ir = inner.getBoundingClientRect();
      const dx = ir.left - rect.left;
      const dy = ir.top - rect.top;
      ctx.drawImage(srcCanvas, dx, dy, ir.width, ir.height);
    } else {
      drawPixelArt(ctx, artKey, w, h, { transparent: true });
    }
  }

  ghost.append(canvas);
  return ghost;
}
