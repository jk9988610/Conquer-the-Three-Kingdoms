import { ART_GRID_COLS, ART_GRID_ROWS } from './gridConfig';

export interface ArtMemoryReport {
  cols: number;
  rows: number;
  cells: number;
  packedBytes: number;
  rgbaRawBytes: number;
  jsonStringEstimateBytes: number;
  pngUncompressedBytes: number;
  pngFileEstimateMinKb: number;
  pngFileEstimateMaxKb: number;
  gridOverlayNote: string;
}

export function computeArtMemoryReport(
  cols = ART_GRID_COLS,
  rows = ART_GRID_ROWS
): ArtMemoryReport {
  const cells = cols * rows;
  const packedBytes = cells * 4;
  const rgbaRawBytes = cells * 4;
  const jsonStringEstimateBytes = Math.round(cells * 28);
  const pngUncompressedBytes = cells * 4;
  const fillRatio = 0.12;
  const pngFileEstimateMinKb = Math.round((cells * fillRatio * 0.35) / 1024) || 1;
  const pngFileEstimateMaxKb = Math.round((cells * 0.85 * 0.9) / 1024) || 1;

  return {
    cols,
    rows,
    cells,
    packedBytes,
    rgbaRawBytes,
    jsonStringEstimateBytes,
    pngUncompressedBytes,
    pngFileEstimateMinKb,
    pngFileEstimateMaxKb,
    gridOverlayNote:
      '参考线仅绘制在叠加层，不占像素数据内存；推荐主刻度稀疏线+当前格高亮，而非 56k 条全网格线',
  };
}

function fmtKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatArtMemoryReport(report = computeArtMemoryReport()): string {
  return [
    `网格: ${report.cols}×${report.rows} = ${report.cells.toLocaleString()} 格`,
    `── 单张图 ──`,
    `PackedGrid (运行时): ${fmtKb(report.packedBytes)}`,
    `未压缩 RGBA 位图: ${fmtKb(report.rgbaRawBytes)}`,
    `旧 JSON 字符串格 (估算): ${fmtKb(report.jsonStringEstimateBytes)}`,
    `导出 PNG 文件 (估算): ${report.pngFileEstimateMinKb}–${report.pngFileEstimateMaxKb} KB`,
    `PNG 未压缩体积: ${fmtKb(report.pngUncompressedBytes)}`,
    `── 对比 ──`,
    `Packed 与 RGBA 原图相同均为 4B/格；JSON 约 ${Math.round(report.jsonStringEstimateBytes / report.packedBytes)}×`,
    `── 参考线 ──`,
    report.gridOverlayNote,
  ].join('\n');
}
