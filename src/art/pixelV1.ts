import type { Pixel, PixelGrid } from './pixelArt';

export interface PixelV1Image {
  type: 'pixel/v1';
  w: number;
  h: number;
  palette: string[];
  pixels: number[];
}

function hexToRgba(hex: string): Pixel {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `rgba(${r},${g},${b},1.00)`;
  }
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},1.00)`;
  }
  return null;
}

/** pixel/v1（Card World 商店格式）→ 绘制网格 */
export function pixelV1ToPixelGrid(img: PixelV1Image): PixelGrid {
  const rows: PixelGrid = [];
  for (let y = 0; y < img.h; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < img.w; x++) {
      const idx = img.pixels[y * img.w + x] ?? 0;
      const hex = img.palette[idx];
      row.push(hex ? hexToRgba(hex) : null);
    }
    rows.push(row);
  }
  return rows;
}
