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
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('无法解码缓存卡图'));
      img.src = url;
    });
    setCustomArtImage(key, img);
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadArtImageFromUrl(key: PixelArtKey, url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`无法加载卡图: ${url}`));
    img.src = url;
  });
  setCustomArtImage(key, img);
  return img;
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
