import type { PixelArtKey } from '../game/types';
import { ART_DISPLAY_COLS, ART_DISPLAY_ROWS } from './gridConfig';
import { sampleImageToGrid } from './imageToGrid';
import { gridDrawLayout, gridToPacked, type GridDrawMode, type PackedGrid } from './packedGrid';

const customArtImages = new Map<PixelArtKey, HTMLImageElement>();
const customArtDisplayPacked = new Map<PixelArtKey, PackedGrid>();

export function hasCustomArtImage(key: PixelArtKey): boolean {
  return customArtImages.has(key);
}

export function countLoadedCustomArtImages(): number {
  return customArtImages.size;
}

export function getCustomArtImage(key: PixelArtKey): HTMLImageElement | undefined {
  return customArtImages.get(key);
}

export function getCustomArtDisplayPacked(key: PixelArtKey): PackedGrid | undefined {
  return customArtDisplayPacked.get(key);
}

/** 注册 PNG 卡图；自动采样 60×84 网格供渲染层高亮取色 */
export function setCustomArtImage(key: PixelArtKey, image: HTMLImageElement): void {
  customArtImages.set(key, image);
  const grid = sampleImageToGrid(image, ART_DISPLAY_COLS, ART_DISPLAY_ROWS);
  customArtDisplayPacked.set(key, gridToPacked(grid, ART_DISPLAY_COLS, ART_DISPLAY_ROWS));
}

export function clearCustomArtImage(key: PixelArtKey): void {
  customArtImages.delete(key);
  customArtDisplayPacked.delete(key);
}

export async function loadArtImageFromBlob(key: PixelArtKey, blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await waitForImage(img, url, 15000);
    setCustomArtImage(key, img);
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function shouldUseCrossOrigin(url: string): boolean {
  try {
    const resolved = new URL(url, window.location.href);
    if (resolved.origin === window.location.origin) return false;
    // Capacitor WebView 本地资源；不设 crossOrigin 避免 CORS 拦截
    if (/^https?:\/\/localhost/i.test(resolved.origin)) return false;
    return /^https?:/i.test(resolved.protocol);
  } catch {
    return false;
  }
}

export async function loadArtImageFromUrl(key: PixelArtKey, url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  if (shouldUseCrossOrigin(url)) {
    img.crossOrigin = 'anonymous';
  }
  await waitForImage(img, url, 15000);
  setCustomArtImage(key, img);
  return img;
}

function waitForImage(img: HTMLImageElement, src: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`图片加载超时 (${timeoutMs}ms)`));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`无法加载卡图: ${src}`));
    };
    img.src = src;
  });
}

/** 将 60×84 PNG 按与 PackedGrid 相同的 fit/cover 规则绘制到卡面 */
export function drawArtImageToCanvas(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  mode: GridDrawMode = 'cover'
): void {
  const dstCols = ART_DISPLAY_COLS;
  const dstRows = ART_DISPLAY_ROWS;

  if (mode === 'fit') {
    const cellPx = Math.min(Math.floor(width / dstCols), Math.floor(height / dstRows));
    if (cellPx >= 1) {
      const drawW = dstCols * cellPx;
      const drawH = dstRows * cellPx;
      const ox = Math.floor((width - drawW) / 2);
      const oy = Math.floor((height - drawH) / 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, ox, oy, drawW, drawH);
      return;
    }
  }

  const { cell, ox, oy } = gridDrawLayout(dstCols, dstRows, width, height, mode);
  const dw = dstCols * cell;
  const dh = dstRows * cell;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, ox, oy, dw, dh);
}
