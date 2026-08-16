import { gridToPacked, packedToGrid } from './packedGrid';
import {
  applyPixelImportMixForEditor,
  applyPixelImportMixOnDisplay,
  type PixelImportDisplayOptions,
  type PixelImportEffectMix,
  type PixelImportMixOptions,
} from './pixelGridEffects';

type PreviewMessage = {
  type: 'preview';
  id: number;
  packed: Uint32Array;
  gridCols: number;
  gridRows: number;
  mix: PixelImportEffectMix;
  options: PixelImportDisplayOptions;
  displayCols: number;
  displayRows: number;
};

type EditorMessage = {
  type: 'editor';
  id: number;
  packed: Uint32Array;
  gridCols: number;
  gridRows: number;
  mix: PixelImportEffectMix;
  options: PixelImportMixOptions;
};

type WorkerMessage = PreviewMessage | EditorMessage;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  try {
    const grid = packedToGrid(msg.packed, msg.gridCols, msg.gridRows);
    if (msg.type === 'preview') {
      const display = applyPixelImportMixOnDisplay(grid, msg.mix, {
        ...msg.options,
        displayCols: msg.displayCols,
        displayRows: msg.displayRows,
      });
      const outPacked = gridToPacked(display, msg.displayCols, msg.displayRows);
      self.postMessage(
        {
          type: 'preview',
          id: msg.id,
          packed: outPacked,
          displayCols: msg.displayCols,
          displayRows: msg.displayRows,
        },
        { transfer: [outPacked.buffer] }
      );
      return;
    }

    const result = applyPixelImportMixForEditor(grid, msg.mix, msg.options);
    const outPacked = gridToPacked(result, msg.gridCols, msg.gridRows);
    self.postMessage(
      {
        type: 'editor',
        id: msg.id,
        packed: outPacked,
        gridCols: msg.gridCols,
        gridRows: msg.gridRows,
      },
      { transfer: [outPacked.buffer] }
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
