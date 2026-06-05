import { drawPixelArt, prepareSharpCanvas } from '../art/pixelArt';
import type { CardInstance, PixelArtKey } from '../game/types';
import type { TcgScaledSize } from '../tcg/dimensions';

export interface CardElementOptions {
  size: TcgScaledSize;
  /** 场上角色：透明外框，仅显示像素与文本 */
  onField?: 'player' | 'enemy';
  showPrice?: number;
  soldOut?: boolean;
}

export function createPixelArtCanvas(
  artKey: PixelArtKey,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const prep = prepareSharpCanvas(canvas, width, height);
  if (prep) {
    drawPixelArt(prep.ctx, artKey, prep.cssWidth, prep.cssHeight, {
      transparent: true,
      mode: 'fit',
    });
  }
  return canvas;
}

export function createCardElement(
  card: CardInstance,
  options: CardElementOptions
): HTMLElement {
  const { size, onField, showPrice, soldOut = false } = options;

  const el = document.createElement('article');
  el.className = 'tcg-card';
  if (soldOut) el.classList.add('tcg-card--sold-out');
  el.dataset.instanceId = card.instanceId;
  el.dataset.templateId = card.data.id;
  el.dataset.artKey = card.data.artKey ?? 'generic';
  el.style.width = `${size.cardWidth}px`;
  el.style.height = `${size.cardHeight}px`;

  if (onField === 'player') {
    el.dataset.field = 'player';
    el.classList.add('tcg-card--field-player', 'tcg-card--field-bare');
  } else if (onField === 'enemy') {
    el.dataset.field = 'enemy';
    el.classList.add('tcg-card--field-bare');
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

function innerRect(source: HTMLElement): DOMRect {
  const inner = source.querySelector('.tcg-card__inner');
  return (inner ?? source).getBoundingClientRect();
}

/** 拖拽幽灵：仅内框尺寸的透明像素图，无边框 */
export function createDragGhost(source: HTMLElement): HTMLElement {
  const ir = innerRect(source);
  const w = Math.max(1, Math.round(ir.width));
  const h = Math.max(1, Math.round(ir.height));
  const artKey = (source.dataset.artKey ?? 'generic') as PixelArtKey;
  const srcCanvas = source.querySelector('canvas.tcg-card__art');

  const ghost = document.createElement('div');
  ghost.className = 'tcg-card-ghost';
  ghost.style.width = `${w}px`;
  ghost.style.height = `${h}px`;

  const canvas = document.createElement('canvas');
  canvas.className = 'tcg-card-ghost__art';
  const prep = prepareSharpCanvas(canvas, w, h);
  if (prep) {
    if (srcCanvas instanceof HTMLCanvasElement) {
      prep.ctx.drawImage(srcCanvas, 0, 0, prep.cssWidth, prep.cssHeight);
    } else {
      drawPixelArt(prep.ctx, artKey, prep.cssWidth, prep.cssHeight, {
        transparent: true,
        mode: 'fit',
      });
    }
  }

  ghost.append(canvas);
  return ghost;
}

/** 拖拽时指针相对内框的偏移 */
export function dragAnchorOffset(
  source: HTMLElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const ir = innerRect(source);
  return { x: clientX - ir.left, y: clientY - ir.top };
}
