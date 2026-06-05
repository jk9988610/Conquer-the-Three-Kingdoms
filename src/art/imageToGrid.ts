import type { Pixel, PixelGrid } from './pixelArt';

/** 与卡牌美术统一的逻辑网格尺寸 */
export const ART_GRID_COLS = 16;
export const ART_GRID_ROWS = 22;

const DEFAULT_ALPHA_THRESHOLD = 128;

export interface ImageToGridOptions {
  /** 0–255，低于此 alpha 的格记为透明 */
  alphaThreshold?: number;
}

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('无法解码图片'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function centerCropRect(
  imgW: number,
  imgH: number,
  targetAspect: number
): { sx: number; sy: number; sw: number; sh: number } {
  const imgAspect = imgW / imgH;
  if (imgAspect > targetAspect) {
    const sw = imgH * targetAspect;
    return { sx: (imgW - sw) / 2, sy: 0, sw, sh: imgH };
  }
  const sh = imgW / targetAspect;
  return { sx: 0, sy: (imgH - sh) / 2, sw: imgW, sh };
}

function toPixelColor(
  r: number,
  g: number,
  b: number,
  a: number,
  alphaThreshold: number
): Pixel {
  if (a < alphaThreshold) return null;
  if (a >= 254) return `rgba(${r},${g},${b},1.00)`;
  const alpha = (a / 255).toFixed(2);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 中心裁剪到目标宽高比后，按格中心点取色（最近邻，避免色块边缘混杂）。
 */
export function sampleImageToGrid(
  image: HTMLImageElement,
  cols: number,
  rows: number,
  options: ImageToGridOptions = {}
): PixelGrid {
  const alphaThreshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;
  const imgW = image.naturalWidth;
  const imgH = image.naturalHeight;
  if (imgW < 1 || imgH < 1) {
    throw new Error('图片尺寸无效');
  }

  const { sx, sy, sw, sh } = centerCropRect(imgW, imgH, cols / rows);

  const canvas = document.createElement('canvas');
  const tw = Math.max(cols, Math.round(sw));
  const th = Math.max(rows, Math.round(sh));
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建画布');

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, tw, th);

  const { data } = ctx.getImageData(0, 0, tw, th);
  const grid: PixelGrid = [];

  for (let y = 0; y < rows; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < cols; x++) {
      const px = Math.min(tw - 1, Math.floor(((x + 0.5) * tw) / cols));
      const py = Math.min(th - 1, Math.floor(((y + 0.5) * th) / rows));
      const i = (py * tw + px) * 4;
      row.push(
        toPixelColor(data[i], data[i + 1], data[i + 2], data[i + 3], alphaThreshold)
      );
    }
    grid.push(row);
  }

  return grid;
}
