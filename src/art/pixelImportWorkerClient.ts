import type { PixelGrid } from './pixelArt';
import { ART_DISPLAY_COLS, ART_DISPLAY_ROWS, ART_GRID_COLS, ART_GRID_ROWS } from './gridConfig';
import { gridToPacked, packedToGrid } from './packedGrid';
import {
  applyPixelImportMixForEditor,
  applyPixelImportMixOnDisplay,
  type PixelImportDisplayOptions,
  type PixelImportEffectMix,
  type PixelImportMixOptions,
} from './pixelGridEffects';

type PreviewResult = {
  type: 'preview';
  id: number;
  packed: Uint32Array;
  displayCols: number;
  displayRows: number;
};

type EditorResult = {
  type: 'editor';
  id: number;
  packed: Uint32Array;
  gridCols: number;
  gridRows: number;
};

type ErrorResult = {
  type: 'error';
  id: number;
  message: string;
};

type WorkerResult = PreviewResult | EditorResult | ErrorResult;

let worker: Worker | null = null;
let workerFailed = false;
let nextJobId = 1;

const previewWaiters = new Map<
  number,
  { resolve: (grid: PixelGrid) => void; reject: (err: Error) => void }
>();
const editorWaiters = new Map<
  number,
  { resolve: (grid: PixelGrid) => void; reject: (err: Error) => void }
>();

function ensureWorker(): Worker | null {
  if (workerFailed) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./pixelImportWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        const data = event.data;
        if (data.type === 'preview') {
          const packed = new Uint32Array(data.packed);
          const grid = packedToGrid(packed, data.displayCols, data.displayRows);
          previewWaiters.get(data.id)?.resolve(grid);
          previewWaiters.delete(data.id);
          return;
        }
        if (data.type === 'editor') {
          const packed = new Uint32Array(data.packed);
          const grid = packedToGrid(packed, data.gridCols, data.gridRows);
          editorWaiters.get(data.id)?.resolve(grid);
          editorWaiters.delete(data.id);
          return;
        }
        if (data.type === 'error') {
          const err = new Error(data.message);
          previewWaiters.get(data.id)?.reject(err);
          previewWaiters.delete(data.id);
          editorWaiters.get(data.id)?.reject(err);
          editorWaiters.delete(data.id);
        }
      };
      worker.onerror = () => {
        workerFailed = true;
        worker = null;
        for (const [, waiter] of previewWaiters) waiter.reject(new Error('效果 Worker 异常'));
        for (const [, waiter] of editorWaiters) waiter.reject(new Error('效果 Worker 异常'));
        previewWaiters.clear();
        editorWaiters.clear();
      };
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return worker;
}

export function isPixelImportWorkerAvailable(): boolean {
  return ensureWorker() !== null;
}

export function runImportMixPreview(
  logicalGrid: PixelGrid,
  mix: PixelImportEffectMix,
  options: PixelImportDisplayOptions
): Promise<PixelGrid> {
  const displayCols = options.displayCols ?? ART_DISPLAY_COLS;
  const displayRows = options.displayRows ?? ART_DISPLAY_ROWS;
  const w = ensureWorker();
  if (!w) {
    return Promise.resolve(applyPixelImportMixOnDisplay(logicalGrid, mix, options));
  }

  const id = nextJobId++;
  const packed = gridToPacked(logicalGrid, ART_GRID_COLS, ART_GRID_ROWS);
  const payload = packed.slice();

  return new Promise<PixelGrid>((resolve, reject) => {
    previewWaiters.set(id, { resolve, reject });
    w.postMessage(
      {
        type: 'preview',
        id,
        packed: payload,
        gridCols: ART_GRID_COLS,
        gridRows: ART_GRID_ROWS,
        mix,
        options,
        displayCols,
        displayRows,
      },
      [payload.buffer]
    );
  });
}

export function runImportMixForEditor(
  logicalGrid: PixelGrid,
  mix: PixelImportEffectMix,
  options?: PixelImportMixOptions
): Promise<PixelGrid> {
  const w = ensureWorker();
  if (!w) {
    return Promise.resolve(applyPixelImportMixForEditor(logicalGrid, mix, options));
  }

  const id = nextJobId++;
  const packed = gridToPacked(logicalGrid, ART_GRID_COLS, ART_GRID_ROWS);
  const payload = packed.slice();

  return new Promise<PixelGrid>((resolve, reject) => {
    editorWaiters.set(id, { resolve, reject });
    w.postMessage(
      {
        type: 'editor',
        id,
        packed: payload,
        gridCols: ART_GRID_COLS,
        gridRows: ART_GRID_ROWS,
        mix,
        options: options ?? {},
      },
      [payload.buffer]
    );
  });
}
