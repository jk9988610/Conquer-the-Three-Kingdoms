import { registerHighlightBreathTarget, hasAnyDisplayHighlight } from '../art/displayHighlight';
import {
  artHasHighlightBreath,
  drawPixelArt,
  drawPixelArtBase,
  drawPixelArtHighlightOverlay,
  getArtHighlight,
  prepareSharpCanvas,
} from '../art/pixelArt';
import type { CardInstance, PixelArtKey } from '../game/types';
import type { TcgScaledSize } from '../tcg/dimensions';

export interface CardElementOptions {
  size: TcgScaledSize;
  /** 场上角色：透明外框，仅显示像素与文本 */
  onField?: 'player' | 'enemy';
  showPrice?: number;
  soldOut?: boolean;
}

interface PixelArtLayers {
  artLayer: HTMLElement;
  resize: (width: number, height: number) => void;
}

function buildPixelArtLayers(artKey: PixelArtKey, width: number, height: number): PixelArtLayers {
  let cssW = Math.max(1, Math.floor(width));
  let cssH = Math.max(1, Math.floor(height));

  const artLayer = document.createElement('div');
  artLayer.className = 'tcg-card__art-layer';

  const baseCanvas = document.createElement('canvas');
  baseCanvas.className = 'tcg-card__art tcg-card__art--base';

  const highlight = getArtHighlight(artKey);
  const hasHighlight = hasAnyDisplayHighlight(highlight);
  let highlightCanvas: HTMLCanvasElement | null = null;

  const redrawBase = (): void => {
    const prep = prepareSharpCanvas(baseCanvas, cssW, cssH);
    if (!prep) return;
    drawPixelArtBase(prep.ctx, artKey, prep.cssWidth, prep.cssHeight, {
      transparent: true,
      mode: 'cover',
    });
  };

  const redrawHighlight = (): void => {
    if (!highlightCanvas) return;
    const prep = prepareSharpCanvas(highlightCanvas, cssW, cssH);
    if (!prep) return;
    prep.ctx.clearRect(0, 0, prep.cssWidth, prep.cssHeight);
    drawPixelArtHighlightOverlay(prep.ctx, artKey, prep.cssWidth, prep.cssHeight, {
      mode: 'cover',
    });
  };

  redrawBase();
  artLayer.append(baseCanvas);

  if (hasHighlight) {
    highlightCanvas = document.createElement('canvas');
    highlightCanvas.className = 'tcg-card__art tcg-card__art--highlight';
    redrawHighlight();
    artLayer.append(highlightCanvas);

    if (artHasHighlightBreath(artKey)) {
      registerHighlightBreathTarget({
        hasBreath: () => artHasHighlightBreath(artKey),
        redraw: redrawHighlight,
      });
    }
  }

  return {
    artLayer,
    resize(nextW: number, nextH: number) {
      cssW = Math.max(1, Math.floor(nextW));
      cssH = Math.max(1, Math.floor(nextH));
      redrawBase();
      redrawHighlight();
    },
  };
}

export function createPixelArtCanvas(
  artKey: PixelArtKey,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'tcg-card__art';
  const prep = prepareSharpCanvas(canvas, width, height);
  if (prep) {
    drawPixelArt(prep.ctx, artKey, prep.cssWidth, prep.cssHeight, {
      transparent: true,
      mode: 'cover',
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

  const artKey = card.data.artKey ?? 'generic';
  const pixelLayers = buildPixelArtLayers(artKey, Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
  (el as HTMLElement & { __pixelLayers?: PixelArtLayers }).__pixelLayers = pixelLayers;

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

  inner.append(pixelLayers.artLayer, textLayer);
  el.append(inner);

  if (soldOut) {
    const badge = document.createElement('div');
    badge.className = 'tcg-card__sold-out';
    badge.textContent = '售罄';
    el.append(badge);
  }

  return el;
}

/** 增量更新已有卡牌 DOM（尺寸、数值、售罄状态） */
export function updateCardElement(
  el: HTMLElement,
  card: CardInstance,
  options: CardElementOptions
): void {
  const { size, showPrice, soldOut = false } = options;

  el.style.width = `${size.cardWidth}px`;
  el.style.height = `${size.cardHeight}px`;
  el.classList.toggle('tcg-card--sold-out', soldOut);

  const inner = el.querySelector<HTMLElement>('.tcg-card__inner');
  if (inner) {
    const { left, top, width, height } = size.innerFrame;
    inner.style.left = `${left}px`;
    inner.style.top = `${top}px`;
    inner.style.width = `${width}px`;
    inner.style.height = `${height}px`;

    const layers = (el as HTMLElement & { __pixelLayers?: PixelArtLayers }).__pixelLayers;
    if (layers) {
      layers.resize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    }
  }

  const title = el.querySelector<HTMLElement>('.tcg-card__title');
  if (title) title.textContent = card.data.name;

  const desc = el.querySelector<HTMLElement>('.tcg-card__desc');
  if (desc) desc.textContent = card.data.description ?? '';

  let statsEl = el.querySelector<HTMLElement>('.tcg-card__stats');
  if (card.stats) {
    const text = `HP ${card.stats.hp}/${card.stats.maxHp} ATK ${card.stats.attack}`;
    if (statsEl) statsEl.textContent = text;
    else {
      statsEl = document.createElement('p');
      statsEl.className = 'tcg-card__stats';
      statsEl.textContent = text;
      el.querySelector('.tcg-card__text-layer')?.append(statsEl);
    }
  } else if (statsEl) {
    statsEl.remove();
  }

  let priceEl = el.querySelector<HTMLElement>('.tcg-card__price');
  if (showPrice !== undefined && !soldOut) {
    const text = `${showPrice}金`;
    if (priceEl) priceEl.textContent = text;
    else {
      priceEl = document.createElement('span');
      priceEl.className = 'tcg-card__price';
      priceEl.textContent = text;
      el.querySelector('.tcg-card__text-layer')?.append(priceEl);
    }
  } else if (priceEl) {
    priceEl.remove();
  }

  let soldBadge = el.querySelector<HTMLElement>('.tcg-card__sold-out');
  if (soldOut) {
    if (!soldBadge) {
      soldBadge = document.createElement('div');
      soldBadge.className = 'tcg-card__sold-out';
      soldBadge.textContent = '售罄';
      el.append(soldBadge);
    }
  } else if (soldBadge) {
    soldBadge.remove();
  }
}

function innerRect(source: HTMLElement): DOMRect {
  const inner = source.querySelector('.tcg-card__inner');
  return (inner ?? source).getBoundingClientRect();
}

function primaryArtCanvas(source: HTMLElement): HTMLCanvasElement | null {
  const base = source.querySelector('canvas.tcg-card__art--base');
  if (base instanceof HTMLCanvasElement) return base;
  const legacy = source.querySelector('canvas.tcg-card__art');
  return legacy instanceof HTMLCanvasElement ? legacy : null;
}

/** 拖拽幽灵：仅内框尺寸的透明像素图，无边框 */
export function createDragGhost(source: HTMLElement): HTMLElement {
  const ir = innerRect(source);
  const w = Math.max(1, Math.round(ir.width));
  const h = Math.max(1, Math.round(ir.height));
  const artKey = (source.dataset.artKey ?? 'generic') as PixelArtKey;
  const srcCanvas = primaryArtCanvas(source);

  const ghost = document.createElement('div');
  ghost.className = 'tcg-card-ghost';
  ghost.style.width = `${w}px`;
  ghost.style.height = `${h}px`;

  const canvas = document.createElement('canvas');
  canvas.className = 'tcg-card-ghost__art';
  const prep = prepareSharpCanvas(canvas, w, h);
  if (prep) {
    if (srcCanvas) {
      prep.ctx.drawImage(srcCanvas, 0, 0, prep.cssWidth, prep.cssHeight);
      const highlightCanvas = source.querySelector('canvas.tcg-card__art--highlight');
      if (highlightCanvas instanceof HTMLCanvasElement) {
        prep.ctx.drawImage(highlightCanvas, 0, 0, prep.cssWidth, prep.cssHeight);
      }
    } else {
      drawPixelArt(prep.ctx, artKey, prep.cssWidth, prep.cssHeight, {
        transparent: true,
        mode: 'cover',
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
