import type { Pixel, PixelGrid } from './pixelArt';
export { ART_GRID_COLS, ART_GRID_ROWS } from './gridConfig';

const DEFAULT_ALPHA_THRESHOLD = 128;
/** 单格采样像素上限，超出则步进抽样 */
const MAX_REGION_SAMPLES = 4096;

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

function srgb8ToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb8(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  const x =
    clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(x * 255);
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
 * 对原图矩形区域做预乘 alpha + 线性 RGB 平均（下采样观感更稳）。
 * x1/y1 为排他上界。
 */
function averageImageRegion(
  data: Uint8ClampedArray,
  imageWidth: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  alphaThreshold: number
): Pixel {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  let step = 1;
  const area = w * h;
  if (area > MAX_REGION_SAMPLES) {
    step = Math.ceil(Math.sqrt(area / MAX_REGION_SAMPLES));
  }

  let sumPr = 0;
  let sumPg = 0;
  let sumPb = 0;
  let sumA = 0;
  let samples = 0;

  for (let py = y0; py < y1; py += step) {
    for (let px = x0; px < x1; px += step) {
      const i = (py * imageWidth + px) * 4;
      const a = data[i + 3]! / 255;
      samples++;
      sumA += a;
      if (a <= 0) continue;
      const lr = srgb8ToLinear(data[i]!);
      const lg = srgb8ToLinear(data[i + 1]!);
      const lb = srgb8ToLinear(data[i + 2]!);
      sumPr += lr * a;
      sumPg += lg * a;
      sumPb += lb * a;
    }
  }

  if (samples === 0) return null;
  const avgA = sumA / samples;
  const alphaByte = Math.round(avgA * 255);
  if (alphaByte < alphaThreshold || sumA < 1e-6) return null;

  const r = linearToSrgb8(sumPr / sumA);
  const g = linearToSrgb8(sumPg / sumA);
  const b = linearToSrgb8(sumPb / sumA);
  return toPixelColor(r, g, b, alphaByte, alphaThreshold);
}

/** 将归一化 UV 矩形映射到像素范围 [x0,x1)×[y0,y1) */
function uvRectToPixelBounds(
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  iw: number,
  ih: number
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (u1 <= 0 || u0 >= 1 || v1 <= 0 || v0 >= 1) return null;

  const clampedU0 = Math.max(0, Math.min(1, u0));
  const clampedU1 = Math.max(0, Math.min(1, u1));
  const clampedV0 = Math.max(0, Math.min(1, v0));
  const clampedV1 = Math.max(0, Math.min(1, v1));

  let x0 = Math.floor(clampedU0 * iw);
  let x1 = Math.ceil(clampedU1 * iw);
  let y0 = Math.floor(clampedV0 * ih);
  let y1 = Math.ceil(clampedV1 * ih);

  x0 = Math.max(0, Math.min(iw - 1, x0));
  y0 = Math.max(0, Math.min(ih - 1, y0));
  x1 = Math.max(x0 + 1, Math.min(iw, x1));
  y1 = Math.max(y0 + 1, Math.min(ih, y1));

  return { x0, y0, x1, y1 };
}

export interface ImageCropParams {
  panX: number;
  panY: number;
  userScale: number;
  baseScale: number;
  frameLeft: number;
  frameTop: number;
  frameWidth: number;
  frameHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

function readImagePixels(image: HTMLImageElement): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法读取图片');
  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}

function uvFromViewport(
  vx: number,
  vy: number,
  centerX: number,
  centerY: number,
  displayW: number,
  displayH: number
): { u: number; v: number } {
  return {
    u: (vx - centerX) / displayW + 0.5,
    v: (vy - centerY) / displayH + 0.5,
  };
}

/** 按弹窗中的平移/缩放与虚线框区域采样到网格（区域平均 + 预乘 alpha） */
export function sampleImageWithCrop(
  image: HTMLImageElement,
  cols: number,
  rows: number,
  crop: ImageCropParams,
  options: ImageToGridOptions = {}
): PixelGrid {
  const alphaThreshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;
  const nw = image.naturalWidth;
  const nh = image.naturalHeight;
  if (nw < 1 || nh < 1) throw new Error('图片尺寸无效');

  const { data, width: iw, height: ih } = readImagePixels(image);
  const displayW = nw * crop.baseScale * crop.userScale;
  const displayH = nh * crop.baseScale * crop.userScale;
  const centerX = crop.viewportWidth / 2 + crop.panX;
  const centerY = crop.viewportHeight / 2 + crop.panY;
  const grid: PixelGrid = [];

  for (let gy = 0; gy < rows; gy++) {
    const row: Pixel[] = [];
    const vy0 = crop.frameTop + (gy / rows) * crop.frameHeight;
    const vy1 = crop.frameTop + ((gy + 1) / rows) * crop.frameHeight;

    for (let gx = 0; gx < cols; gx++) {
      const vx0 = crop.frameLeft + (gx / cols) * crop.frameWidth;
      const vx1 = crop.frameLeft + ((gx + 1) / cols) * crop.frameWidth;

      const { u: u0, v: v0 } = uvFromViewport(vx0, vy0, centerX, centerY, displayW, displayH);
      const { u: u1, v: v1 } = uvFromViewport(vx1, vy1, centerX, centerY, displayW, displayH);

      const bounds = uvRectToPixelBounds(u0, u1, v0, v1, iw, ih);
      if (!bounds) {
        row.push(null);
        continue;
      }

      row.push(
        averageImageRegion(
          data,
          iw,
          bounds.x0,
          bounds.y0,
          bounds.x1,
          bounds.y1,
          alphaThreshold
        )
      );
    }
    grid.push(row);
  }

  return grid;
}

/**
 * 中心裁剪到目标宽高比后，按每格覆盖区域平均取色。
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

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, tw, th);

  const { data } = ctx.getImageData(0, 0, tw, th);
  const grid: PixelGrid = [];

  for (let y = 0; y < rows; y++) {
    const row: Pixel[] = [];
    const y0 = Math.floor((y / rows) * th);
    const y1 = Math.min(th, Math.ceil(((y + 1) / rows) * th));

    for (let x = 0; x < cols; x++) {
      const x0 = Math.floor((x / cols) * tw);
      const x1 = Math.min(tw, Math.ceil(((x + 1) / cols) * tw));
      row.push(averageImageRegion(data, tw, x0, y0, x1, y1, alphaThreshold));
    }
    grid.push(row);
  }

  return grid;
}
