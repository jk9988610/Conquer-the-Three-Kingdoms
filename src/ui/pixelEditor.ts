import { uploadArtToCloud } from '../art/artCloudUpload';
import { createArtCardMeta, downloadJsonFile } from '../art/artMeta';
import { formatArtMemoryReport } from '../art/artMemoryStats';
import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
  ART_GRID_COLS,
  ART_GRID_MAJOR_STEP,
  ART_GRID_ROWS,
} from '../art/gridConfig';
import {
  drawPackedPreview,
  getArtHighlight,
  getArtHighlightBreathSpeed,
  getArtPacked,
  setCustomArtGrid,
  setCustomArtHighlight,
  type Pixel,
  PIXEL_ART_KEYS,
  upscaleGridToArtSize,
} from '../art/pixelArt';
import {
  argbEquals,
  argbToPixel,
  clonePackedGrid,
  collectPackedDiff,
  copyPackedRegion,
  createPackedGrid,
  downsamplePackedGrid,
  downloadPackedPng,
  packedGridToPngBlob,
  drawDisplayPackedAtCellSize,
  flattenPackedToDisplayBlocks,
  getPackedPixel,
  gridDrawLayout,
  gridIndex,
  gridToPacked,
  packedToGrid,
  pastePackedRegion,
  pixelToArgb,
  clearPackedRegion,
  type PackedGrid,
} from '../art/packedGrid';
import {
  anyDisplayHighlightBreath,
  cloneDisplayHighlight,
  createEmptyDisplayHighlight,
  DISPLAY_HIGHLIGHT_BREATH,
  DISPLAY_HIGHLIGHT_GLOW,
  DISPLAY_HIGHLIGHT_MARK,
  displayHighlightIndex,
  fillDisplayPackedWithHighlight,
  hasAnyDisplayHighlight,
  paintDisplayHighlightMarks,
  registerHighlightBreathTarget,
  type DisplayHighlightGrid,
} from '../art/displayHighlight';
import {
  getLastEditedArtKey,
  loadPixelEditorDraft,
  savePixelEditorDraft,
} from '../art/pixelArtDraft';
import { loadImageFromFile } from '../art/imageToGrid';
import { openImageImportEffectModal } from './imageImportEffectModal';
import { openImageImportModal } from './imageImportModal';
import type { PixelArtKey } from '../game/types';
import { createColorPicker, type ColorPickerValue } from './colorPicker';
import { ART_PREVIEW_HEIGHT, ART_PREVIEW_WIDTH } from '../tcg/dimensions';
import { getModalOverlayMount } from './overlayRoot';
import { openArtShopModal } from './artShopModal';

const MIN_CELL_PX = 1;
const PANE_INSET_PX = 4;
/** 绘制区内框（art-surface 单边边框），像素区在其内侧 */
const ART_INNER_FRAME_PX = 1;
/** 绘制区外框（edit-stage 单边边框），包裹 art-surface */
const EDIT_STAGE_FRAME_PX = 1;
const MAX_UNDO = 10;
const MAX_BRUSH = 12;
const MIN_VIEW_ZOOM = 0.15;
const MAX_VIEW_ZOOM = 12;

interface CellPatch {
  i: number;
  prev: number;
  next: number;
}

interface HighlightPatch {
  idx: number;
  prev: number;
  next: number;
}

type EditorLayer = 'item' | 'render';
const PALETTE_PRESETS = [
  '#c44',
  '#6a8',
  '#48c',
  '#ec4',
  '#ffffff',
  '#000000',
  '#e8589a',
];

type Tool =
  | 'paint'
  | 'fill'
  | 'eraser'
  | 'eyedropper'
  | 'highlight'
  | 'glow'
  | 'breath'
  | 'render-eraser'
  | 'hand';
type ClipboardMode = 'copy' | 'cut' | 'paste' | null;

interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint32Array;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeRect(x0: number, y0: number, x1: number, y1: number) {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

let editorOverlay: HTMLElement | null = null;
let editorTeardown: (() => void) | null = null;

export function openPixelEditor(onApplied: () => void): void {
  closePixelEditor();

  let currentKey: PixelArtKey = 'heal-potion';
  let gridCols = ART_GRID_COLS;
  let gridRows = ART_GRID_ROWS;
  let grid: PackedGrid = createPackedGrid();
  let highlightGrid: DisplayHighlightGrid = createEmptyDisplayHighlight();
  let activeLayer: EditorLayer = 'item';
  const pixelUndoStack: CellPatch[][] = [];
  const pixelRedoStack: CellPatch[][] = [];
  const renderUndoStack: HighlightPatch[][] = [];
  const renderRedoStack: HighlightPatch[][] = [];
  let highlightPatchBatch: Map<number, { prev: number; next: number }> | null = null;
  let highlightStrokeUndoPushed = false;
  let breathSpeed = 50;
  let unregisterBreathTarget: (() => void) | null = null;
  let patchBatch: Map<number, { prev: number; next: number }> | null = null;
  let strokeUndoPushed = false;
  let paintColor: Pixel = 'rgba(255,255,255,1)';
  let paintArgb = pixelToArgb(paintColor);
  let brushSize = 1;
  let renderBrushSize = 1;
  let tool: Tool = 'hand';
  let showGrid = false;
  let transparentFlash = false;
  let flashHighlight = false;
  let flashTimer: ReturnType<typeof setInterval> | undefined;
  let viewPanX = 0;
  let viewPanY = 0;
  let viewZoom = 1;
  let navPanStart: { x: number; y: number; panX: number; panY: number } | null = null;
  const navPointers = new Map<number, { x: number; y: number }>();
  let lastPinchDist = 0;
  let selection: Selection | null = null;
  let clipboard: { pixels: Uint32Array; w: number; h: number } | null = null;
  let selectStart: { x: number; y: number } | null = null;
  let lastSelectEnd: { x: number; y: number } | null = null;
  let moveAnchor: { x: number; y: number } | null = null;
  let moveOffset = { x: 0, y: 0 };
  let movePreviewPos: { x: number; y: number } | null = null;
  /** 粘贴预览悬浮于画布，不修改底层像素直至确认落盘 */
  let selectionFloating = false;
  let floatingPasteOnly = false;
  let clipboardMode: ClipboardMode = null;
  let lastPaintCell: { x: number; y: number } | null = null;
  let lastHighlightCell: { x: number; y: number } | null = null;
  let lastDragCell: { x: number; y: number } | null = null;
  let pointerDrawing = false;
  let cellSize = 4;
  let gridPixelW = gridCols * cellSize;
  let gridPixelH = gridRows * cellSize;
  let previewPixelW = ART_PREVIEW_WIDTH;
  let previewPixelH = ART_PREVIEW_HEIGHT;

  function makeEmptyGrid(): PackedGrid {
    return createPackedGrid(gridCols, gridRows);
  }

  /** packedGrid 批量操作回调：(index, prev, next) */
  function packedCellChange(index: number, prev: number, next: number): void {
    const prevVal = prev >>> 0;
    const nextVal = next >>> 0;
    if (prevVal === nextVal) return;
    if (!patchBatch) patchBatch = new Map();
    const existing = patchBatch.get(index);
    if (existing) {
      existing.next = nextVal;
    } else {
      patchBatch.set(index, { prev: prevVal, next: nextVal });
    }
    grid[index] = nextVal;
  }

  function recordCellChange(index: number, next: number): void {
    packedCellChange(index, grid[index] ?? 0, next);
  }

  function beginUndoBatch(): void {
    patchBatch = new Map();
  }

  function commitUndoBatch(): void {
    if (!patchBatch || patchBatch.size === 0) {
      patchBatch = null;
      return;
    }
    const cells: CellPatch[] = [];
    for (const [i, { prev, next }] of patchBatch) {
      cells.push({ i, prev, next });
    }
    pixelUndoStack.push(cells);
    if (pixelUndoStack.length > MAX_UNDO) pixelUndoStack.shift();
    pixelRedoStack.length = 0;
    patchBatch = null;
    updateUndoRedoButtons();
  }

  function pushPatches(cells: CellPatch[]): void {
    if (cells.length === 0) return;
    pixelUndoStack.push(cells);
    if (pixelUndoStack.length > MAX_UNDO) pixelUndoStack.shift();
    pixelRedoStack.length = 0;
    updateUndoRedoButtons();
  }

  function applyPixelPatches(cells: CellPatch[], useNext: boolean): void {
    for (const p of cells) {
      grid[p.i] = (useNext ? p.next : p.prev) >>> 0;
    }
  }

  function applyRenderPatches(highlights: HighlightPatch[], useNext: boolean): void {
    for (const p of highlights) {
      highlightGrid[p.idx] = (useNext ? p.next : p.prev) & 0xff;
    }
  }

  function replaceGrid(next: PackedGrid): void {
    const before = clonePackedGrid(grid);
    grid = clonePackedGrid(next);
    pushPatches(collectPackedDiff(before, grid));
  }

  function resetHistory(): void {
    pixelUndoStack.length = 0;
    pixelRedoStack.length = 0;
    strokeUndoPushed = false;
    patchBatch = null;
    resetRenderHistory();
    updateUndoRedoButtons();
  }

  function recordHighlightChange(idx: number, next: number): void {
    const prev = highlightGrid[idx] ?? 0;
    if (prev === next) return;
    if (!highlightPatchBatch) highlightPatchBatch = new Map();
    const existing = highlightPatchBatch.get(idx);
    if (existing) {
      existing.next = next;
    } else {
      highlightPatchBatch.set(idx, { prev, next });
    }
    highlightGrid[idx] = next;
  }

  function beginHighlightUndoBatch(): void {
    highlightPatchBatch = new Map();
  }

  function commitHighlightUndoBatch(): void {
    if (!highlightPatchBatch || highlightPatchBatch.size === 0) {
      highlightPatchBatch = null;
      return;
    }
    const highlights: HighlightPatch[] = [];
    for (const [idx, { prev, next }] of highlightPatchBatch) {
      highlights.push({ idx, prev, next });
    }
    renderUndoStack.push(highlights);
    if (renderUndoStack.length > MAX_UNDO) renderUndoStack.shift();
    renderRedoStack.length = 0;
    highlightPatchBatch = null;
    updateUndoRedoButtons();
  }

  function resetHighlightHistory(): void {
    highlightStrokeUndoPushed = false;
    highlightPatchBatch = null;
  }

  function resetRenderHistory(): void {
    renderUndoStack.length = 0;
    renderRedoStack.length = 0;
    resetHighlightHistory();
  }

  function syncLayerUi(): void {
    panel.querySelectorAll('[data-editor-layer]').forEach((btn) => {
      btn.classList.toggle(
        'pixel-editor__layer-pick--active',
        (btn as HTMLElement).dataset.editorLayer === activeLayer
      );
    });
    panel.querySelectorAll('[data-layer-panel]').forEach((el) => {
      const layer = (el as HTMLElement).dataset.layerPanel as EditorLayer;
      (el as HTMLElement).hidden = layer !== activeLayer;
    });
    if (toolsScroll) toolsScroll.hidden = activeLayer === 'render';
    syncToolbarUi();
    updateUndoRedoButtons();
  }

  function setEditorLayer(layer: EditorLayer): void {
    if (activeLayer === layer) return;
    activeLayer = layer;
    exitClipboardModes(true);
    if (layer === 'render') setTool('highlight');
    else setTool('hand');
    syncLayerUi();
    refreshEditCanvas();
    redrawGridLayer();
  }

  function undoPixel(): void {
    if (pixelUndoStack.length === 0) return;
    const entry = pixelUndoStack.pop()!;
    pixelRedoStack.push(entry);
    applyPixelPatches(entry, false);
    selection = null;
    selectStart = null;
    refreshAll();
    updateUndoRedoButtons();
  }

  function redoPixel(): void {
    if (pixelRedoStack.length === 0) return;
    const entry = pixelRedoStack.pop()!;
    pixelUndoStack.push(entry);
    applyPixelPatches(entry, true);
    selection = null;
    selectStart = null;
    refreshAll();
    updateUndoRedoButtons();
  }

  function undoRender(): void {
    if (renderUndoStack.length === 0) return;
    const entry = renderUndoStack.pop()!;
    renderRedoStack.push(entry);
    applyRenderPatches(entry, false);
    refreshAll();
    syncBreathAnimation();
    updateUndoRedoButtons();
  }

  function redoRender(): void {
    if (renderRedoStack.length === 0) return;
    const entry = renderRedoStack.pop()!;
    renderUndoStack.push(entry);
    applyRenderPatches(entry, true);
    refreshAll();
    syncBreathAnimation();
    updateUndoRedoButtons();
  }

  function undoActiveLayer(): void {
    if (activeLayer === 'render') undoRender();
    else undoPixel();
  }

  function redoActiveLayer(): void {
    if (activeLayer === 'render') redoRender();
    else redoPixel();
  }

  function updateUndoRedoButtons(): void {
    const undoBtn = panel.querySelector<HTMLButtonElement>('[data-undo]');
    const redoBtn = panel.querySelector<HTMLButtonElement>('[data-redo]');
    const renderUndoBtn = panel.querySelector<HTMLButtonElement>('[data-render-undo]');
    const renderRedoBtn = panel.querySelector<HTMLButtonElement>('[data-render-redo]');
    if (undoBtn) undoBtn.disabled = pixelUndoStack.length === 0;
    if (redoBtn) redoBtn.disabled = pixelRedoStack.length === 0;
    if (renderUndoBtn) renderUndoBtn.disabled = renderUndoStack.length === 0;
    if (renderRedoBtn) renderRedoBtn.disabled = renderRedoStack.length === 0;
  }

  function updateClipboardButtons(): void {
    const pasteBtn = panel.querySelector<HTMLButtonElement>('[data-paste]');
    if (!pasteBtn) return;
    const hasPendingSelection =
      (clipboardMode === 'copy' || clipboardMode === 'cut') && !!selection;
    pasteBtn.disabled = !clipboard && !hasPendingSelection;
  }

  function clearToolbarHighlights(): void {
    panel.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.classList.remove('pixel-editor__tool--active');
    });
    panel.querySelector('[data-copy]')?.classList.remove('pixel-editor__tool--active');
    panel.querySelector('[data-cut]')?.classList.remove('pixel-editor__tool--active');
    panel.querySelector('[data-paste]')?.classList.remove('pixel-editor__tool--active');
  }

  function syncToolbarUi(): void {
    clearToolbarHighlights();
    if (clipboardMode) {
      if (clipboardMode === 'copy') {
        panel.querySelector('[data-copy]')?.classList.add('pixel-editor__tool--active');
      } else if (clipboardMode === 'cut') {
        panel.querySelector('[data-cut]')?.classList.add('pixel-editor__tool--active');
      } else if (clipboardMode === 'paste') {
        panel.querySelector('[data-paste]')?.classList.add('pixel-editor__tool--active');
      }
      updateClipboardButtons();
      return;
    }
    panel.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.classList.toggle(
        'pixel-editor__tool--active',
        (btn as HTMLElement).dataset.tool === tool
      );
    });
  }

  function clearSelection(): void {
    selection = null;
    selectionFloating = false;
    floatingPasteOnly = false;
    moveAnchor = null;
    movePreviewPos = null;
    selectStart = null;
    lastSelectEnd = null;
    updateSelectionBox();
    updateClipboardButtons();
  }

  function discardPasteFloating(): void {
    if (!floatingPasteOnly) return;
    selectionFloating = false;
    floatingPasteOnly = false;
    selection = null;
    moveAnchor = null;
    movePreviewPos = null;
    updateSelectionBox();
    refreshAll();
  }

  function exitClipboardModes(commitPaste = false): void {
    if (clipboardMode === 'paste' && floatingPasteOnly) {
      if (commitPaste) commitPasteFloating();
      else discardPasteFloating();
    } else {
      clearSelection();
    }
    clipboardMode = null;
    selectStart = null;
    syncToolbarUi();
  }

  function flattenEditorGrid(): void {
    grid = flattenPackedToDisplayBlocks(grid, gridCols, gridRows);
  }

  function persistDraft(): void {
    flattenEditorGrid();
    savePixelEditorDraft(currentKey, grid, highlightGrid, breathSpeed);
  }

  /** 优先恢复本地草稿，否则从已应用美术加载 */
  function loadArtForKey(key: PixelArtKey): void {
    gridCols = ART_GRID_COLS;
    gridRows = ART_GRID_ROWS;
    const draft = loadPixelEditorDraft(key);
    grid = draft ? clonePackedGrid(draft.grid) : clonePackedGrid(getArtPacked(key));
    highlightGrid = draft
      ? new Uint8Array(draft.highlight)
      : cloneDisplayHighlight(getArtHighlight(key));
    breathSpeed = draft?.highlightBreathSpeed ?? getArtHighlightBreathSpeed(key);
    selection = null;
    selectStart = null;
    selectionFloating = false;
    floatingPasteOnly = false;
    clipboardMode = null;
    moveAnchor = null;
    movePreviewPos = null;
    viewPanX = 0;
    viewPanY = 0;
    viewZoom = 1;
    activeLayer = 'item';
    resetHistory();
    applyEditViewTransform();
    syncLayerUi();
    syncBreathAnimation();
  }

  const overlay = document.createElement('div');
  overlay.className = 'pixel-editor-overlay';
  overlay.dataset.modal = 'pixel-editor';

  const panel = document.createElement('div');
  panel.className = 'pixel-editor';
  panel.innerHTML = `
    <header class="pixel-editor__topbar">
      <h2 class="pixel-editor__title">像素画绘制</h2>
      <label class="pixel-editor__topbar-card">
        <span class="pixel-editor__topbar-card-label">卡牌</span>
        <select data-select class="pixel-editor__topbar-select"></select>
      </label>
      <div class="pixel-editor__topbar-actions">
        <button type="button" class="btn pixel-editor__topbar-btn" data-transparent-flash title="高亮闪烁已透明区域，便于检查抠图">透明闪烁</button>
        <button type="button" class="btn pixel-editor__topbar-btn" data-open-debug>调试</button>
        <button type="button" class="btn pixel-editor__topbar-btn" data-fullscreen>全屏</button>
        <button type="button" class="pixel-editor__close" aria-label="关闭">×</button>
      </div>
    </header>
    <div class="pixel-editor__canvas-row" data-canvas-row>
      <section class="pixel-editor__pane pixel-editor__pane--preview">
        <div class="pixel-editor__pane-label">预览</div>
        <div class="pixel-editor__pane-fill" data-preview-panel>
          <div class="pixel-editor__art-surface" data-preview-surface>
            <canvas data-preview-grid-art></canvas>
          </div>
        </div>
      </section>
      <section class="pixel-editor__pane pixel-editor__pane--edit">
        <div class="pixel-editor__pane-label">绘制</div>
        <div class="pixel-editor__pane-fill pixel-editor__edit-viewport-wrap" data-edit-panel>
          <div class="pixel-editor__edit-viewport" data-edit-viewport>
            <div class="pixel-editor__edit-stage" data-edit-stage>
              <div class="pixel-editor__art-surface" data-edit-surface>
                <canvas data-edit-canvas></canvas>
                <canvas class="pixel-editor__grid-overlay" data-grid-layer></canvas>
                <div class="pixel-editor__sel-box" data-sel-box hidden></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
    <section class="pixel-editor__pane pixel-editor__pane--tools">
      <div class="pixel-editor__pane-label">工具</div>
      <div class="pixel-editor__pane-fill pixel-editor__pane-fill--tools" data-tools-panel>
          <div class="pixel-editor__tools-fixed">
            <div class="pixel-editor__layers">
              <div class="pixel-editor__layers-title">图层</div>
              <div class="pixel-editor__layer-list">
                <div class="pixel-editor__layer-row">
                  <button type="button" class="btn pixel-editor__layer-pick pixel-editor__layer-pick--active" data-editor-layer="item">像素层</button>
                </div>
                <div class="pixel-editor__layer-row">
                  <button type="button" class="btn pixel-editor__layer-pick" data-editor-layer="render">渲染层</button>
                </div>
              </div>
            </div>
            <div class="pixel-editor__layer-panel" data-layer-panel="item">
              <div class="pixel-editor__tools-grid pixel-editor__tools-grid--primary">
                <button type="button" class="btn pixel-editor__tool" data-tool="paint">画笔</button>
                <button type="button" class="btn pixel-editor__tool" data-tool="eraser">橡皮</button>
                <button type="button" class="btn pixel-editor__tool" data-tool="eyedropper">取色</button>
                <button type="button" class="btn pixel-editor__tool" data-tool="fill">填充</button>
                <button type="button" class="btn" data-undo disabled>撤销</button>
                <button type="button" class="btn" data-redo disabled>重做</button>
              </div>
              <div class="pixel-editor__clipboard-row">
                <button type="button" class="btn" data-copy>复制</button>
                <button type="button" class="btn" data-cut>剪切</button>
                <button type="button" class="btn" data-paste disabled>粘贴</button>
              </div>
              <label class="pixel-editor__brush-row">
                画笔粗细
                <input type="range" min="1" max="12" value="1" data-brush-size />
                <span data-brush-size-label>1</span>
              </label>
            </div>
            <div class="pixel-editor__layer-panel" data-layer-panel="render" hidden>
              <div class="pixel-editor__tools-grid pixel-editor__tools-grid--effects">
                <button type="button" class="btn pixel-editor__tool" data-tool="highlight" title="在有色块上标记高亮">高亮</button>
                <button type="button" class="btn pixel-editor__tool" data-tool="glow" title="为已高亮色块开启/关闭光晕">光晕</button>
                <button type="button" class="btn pixel-editor__tool" data-tool="breath" title="为已高亮色块开启/关闭呼吸灯">呼吸</button>
                <button type="button" class="btn pixel-editor__tool" data-tool="render-eraser" title="擦除色块上的渲染效果">渲染橡皮</button>
              </div>
              <div class="pixel-editor__tools-grid pixel-editor__tools-grid--render-undo">
                <button type="button" class="btn" data-render-undo disabled>撤销</button>
                <button type="button" class="btn" data-render-redo disabled>重做</button>
              </div>
              <label class="pixel-editor__brush-row">
                渲染粗细
                <input type="range" min="1" max="12" value="1" data-render-brush-size />
                <span data-render-brush-size-label>1</span>
              </label>
              <label class="pixel-editor__brush-row">
                呼吸速度
                <input type="range" min="1" max="100" value="50" data-breath-speed />
                <span data-breath-speed-label>50</span>
              </label>
              <button type="button" class="btn pixel-editor__clear-render" data-clear-render>清空渲染层</button>
            </div>
            <div class="pixel-editor__tools-nav" data-alpha-mount></div>
            <div class="pixel-editor__tools-nav">
              <button type="button" class="btn pixel-editor__tool pixel-editor__tool--active" data-tool="hand" title="单指拖动平移">拖动</button>
              <button type="button" class="btn" data-zoom-reset title="复位视图">复位</button>
            </div>
          </div>
          <div class="pixel-editor__tools-scroll" data-tools-scroll>
            <div class="pixel-editor__color-block" data-color-picker></div>
            <div class="pixel-editor__presets" data-presets></div>
          </div>
          <div class="pixel-editor__tools-actions">
            <button type="button" class="btn" data-import-image>导入图片</button>
            <input type="file" accept="image/*" hidden data-import-file />
            <button type="button" class="btn" data-toggle-grid>参考线：关</button>
            <button type="button" class="btn" data-clear>清空画布</button>
            <button type="button" class="btn" data-apply>应用</button>
            <button type="button" class="btn" data-export>导出 PNG</button>
            <button type="button" class="btn" data-export-bundle title="下载 PNG + 渲染层 meta.json">导出资源包</button>
            <button type="button" class="btn btn--accent" data-upload-cloud title="上传至 Supabase，玩家刷新后自动加载">上传云端</button>
            <button type="button" class="btn" data-view-shop title="打开 Card World 美术商店">查看商店</button>
          </div>
        </div>
    </section>
    <div class="pixel-editor__drawer-backdrop" data-debug-backdrop aria-hidden="true"></div>
    <aside class="pixel-editor__drawer pixel-editor__drawer--debug" data-debug-drawer aria-hidden="true" aria-label="调试">
      <header class="pixel-editor__drawer-head">
        <span>调试</span>
        <button type="button" class="pixel-editor__drawer-close" data-close-drawer aria-label="关闭">×</button>
      </header>
      <div class="pixel-editor__drawer-body pixel-editor__debug-body">
        <pre class="pixel-editor__editor-debug-body" data-pixel-debug></pre>
      </div>
    </aside>
  `;

  const select = panel.querySelector<HTMLSelectElement>('[data-select]')!;
  const canvasRow = panel.querySelector<HTMLElement>('[data-canvas-row]')!;
  const debugBackdrop = panel.querySelector<HTMLElement>('[data-debug-backdrop]')!;
  const debugDrawer = panel.querySelector<HTMLElement>('[data-debug-drawer]')!;
  const openDebugBtn = panel.querySelector<HTMLElement>('[data-open-debug]')!;
  const transparentFlashBtn = panel.querySelector<HTMLButtonElement>(
    '[data-transparent-flash]'
  )!;
  const previewPanel = panel.querySelector<HTMLElement>('[data-preview-panel]')!;
  const previewSurface = panel.querySelector<HTMLElement>('[data-preview-surface]')!;
  const editPanel = panel.querySelector<HTMLElement>('[data-edit-panel]')!;
  const editViewport = panel.querySelector<HTMLElement>('[data-edit-viewport]')!;
  const editStage = panel.querySelector<HTMLElement>('[data-edit-stage]')!;
  const editSurface = panel.querySelector<HTMLElement>('[data-edit-surface]')!;
  const brushSizeInput = panel.querySelector<HTMLInputElement>('[data-brush-size]')!;
  const brushSizeLabel = panel.querySelector<HTMLElement>('[data-brush-size-label]')!;
  const renderBrushSizeInput = panel.querySelector<HTMLInputElement>('[data-render-brush-size]')!;
  const renderBrushSizeLabel = panel.querySelector<HTMLElement>('[data-render-brush-size-label]')!;
  const toolsScroll = panel.querySelector<HTMLElement>('[data-tools-scroll]')!;
  const debugEl = panel.querySelector<HTMLElement>('[data-pixel-debug]')!;
  const editCanvas = panel.querySelector<HTMLCanvasElement>('[data-edit-canvas]')!;
  const gridLayerCanvas = panel.querySelector<HTMLCanvasElement>('[data-grid-layer]')!;
  const previewGridArt = panel.querySelector<HTMLCanvasElement>('[data-preview-grid-art]')!;
  const selBox = panel.querySelector<HTMLElement>('[data-sel-box]')!;
  const colorPickerMount = panel.querySelector('[data-color-picker]')!;
  const alphaMount = panel.querySelector<HTMLElement>('[data-alpha-mount]')!;
  for (const k of PIXEL_ART_KEYS) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    select.append(opt);
  }
  select.value = currentKey;

  const picker = createColorPicker(
    { css: 'rgba(255,255,255,1)', hex: '#ffffff', alpha: 1 },
    (v: ColorPickerValue) => {
      paintColor = v.css;
      paintArgb = pixelToArgb(v.css);
    },
    { alphaMount }
  );
  colorPickerMount.append(picker.element);

  const presetsEl = panel.querySelector('[data-presets]')!;
  for (const hex of PALETTE_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pixel-editor__preset';
    b.style.background = hex;
    b.addEventListener('click', () => {
      paintColor = hex.startsWith('#') ? hex : `rgba(255,255,255,1)`;
      paintArgb = pixelToArgb(paintColor);
    });
    presetsEl.append(b);
  }

  function setupCanvas(
    canvas: HTMLCanvasElement,
    w: number,
    h: number,
    dpr: number,
    options: { fillParent?: boolean } = {}
  ): CanvasRenderingContext2D | null {
    const cssW = Math.max(1, Math.floor(w));
    const cssH = Math.max(1, Math.floor(h));
    const ratio = Math.max(1, dpr);
    canvas.width = Math.max(1, Math.floor(cssW * ratio));
    canvas.height = Math.max(1, Math.floor(cssH * ratio));
    if (options.fillParent) {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = '100%';
    } else {
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.style.maxWidth = `${cssW}px`;
      canvas.style.maxHeight = `${cssH}px`;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }
    return ctx;
  }

  function canPanZoomView(): boolean {
    return tool === 'hand' && !clipboardMode;
  }

  /** 剪贴板模式下禁用绘制/平移，仅允许框选或粘贴拖动 */
  function deactivateToolForClipboard(): void {
    tool = 'hand';
    editCanvas.style.cursor = 'crosshair';
    applyEditViewTransform();
  }

  function applyEditViewTransform(): void {
    editStage.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`;
    panel.classList.toggle('pixel-editor--pan-mode', canPanZoomView());
  }

  function updateEditorDebug(): void {
    if (!debugEl) return;
    debugEl.textContent = [
      `卡牌: ${currentKey}`,
      `工具: ${tool} · 笔粗: ${brushSize} · 渲染粗: ${renderBrushSize}`,
      `视图缩放: ${(viewZoom * 100).toFixed(0)}%`,
      `展示格: ${cellSize}px · 逻辑: ${gridCols}×${gridRows} · 显示: ${ART_DISPLAY_COLS}×${ART_DISPLAY_ROWS}`,
      `画布: ${gridPixelW}×${gridPixelH} · 撤销≤${MAX_UNDO}`,
      '',
      formatArtMemoryReport(),
    ].join('\n');
  }

  function availSizeInPane(
    panelEl: HTMLElement,
    minCols = ART_DISPLAY_COLS,
    minRows = ART_DISPLAY_ROWS
  ): { w: number; h: number } {
    const inset = PANE_INSET_PX * 2;
    return {
      w: Math.max(MIN_CELL_PX * minCols, panelEl.clientWidth - inset),
      h: Math.max(MIN_CELL_PX * minRows, panelEl.clientHeight - inset),
    };
  }

  function logicalRectToCanvasPx(rect: { x: number; y: number; w: number; h: number }) {
    return {
      left: (rect.x / gridCols) * gridPixelW,
      top: (rect.y / gridRows) * gridPixelH,
      width: (rect.w / gridCols) * gridPixelW,
      height: (rect.h / gridRows) * gridPixelH,
    };
  }

  function editSurfaceOuterSize(): { w: number; h: number } {
    const frame = ART_INNER_FRAME_PX * 2;
    return { w: gridPixelW + frame, h: gridPixelH + frame };
  }

  function editStageOuterSize(): { w: number; h: number } {
    const inner = editSurfaceOuterSize();
    const frame = EDIT_STAGE_FRAME_PX * 2;
    return { w: inner.w + frame, h: inner.h + frame };
  }

  function editFrameTotalPx(): number {
    return 2 * (ART_INNER_FRAME_PX + EDIT_STAGE_FRAME_PX);
  }

  function setElementBoxSize(el: HTMLElement, w: number, h: number): void {
    const ws = `${w}px`;
    const hs = `${h}px`;
    el.style.width = ws;
    el.style.height = hs;
    el.style.minWidth = ws;
    el.style.minHeight = hs;
    el.style.maxWidth = ws;
    el.style.maxHeight = hs;
  }

  function syncEditSurfaceSize(): void {
    const stageOuter = editStageOuterSize();
    const surfaceOuter = editSurfaceOuterSize();
    setElementBoxSize(editStage, stageOuter.w, stageOuter.h);
    setElementBoxSize(editSurface, surfaceOuter.w, surfaceOuter.h);
    panel.style.setProperty('--pe-art-w', `${gridPixelW}px`);
    panel.style.setProperty('--pe-art-h', `${gridPixelH}px`);
  }

  /** 预览区：按卡面展示分辨率（60×84）适配面板，无额外内框 */
  function layoutPreview(): void {
    const avail = availSizeInPane(previewPanel);
    const aspect = gridCols / gridRows;
    let pw = Math.min(avail.w, ART_PREVIEW_WIDTH);
    let ph = Math.round(pw / aspect);
    if (ph > avail.h) {
      ph = Math.min(avail.h, ART_PREVIEW_HEIGHT);
      pw = Math.round(ph * aspect);
    }
    previewPixelW = Math.max(1, Math.floor(pw));
    previewPixelH = Math.max(1, Math.floor(ph));
    setElementBoxSize(previewSurface, previewPixelW, previewPixelH);
    previewSurface.style.boxSizing = 'border-box';
    const dpr = window.devicePixelRatio || 1;
    setupCanvas(previewGridArt, previewPixelW, previewPixelH, dpr, { fillParent: true });
    refreshPreview();
  }

  /** 绘制区：按视口扣除内外框后计算格宽，stage 外框尺寸由 syncEditSurfaceSize 提供 */
  function layoutViewport(): void {
    if (canvasRow.clientWidth < 24 || canvasRow.clientHeight < 24) {
      requestAnimationFrame(layoutViewport);
      return;
    }

    const frame = editFrameTotalPx();
    const availW = Math.max(
      ART_DISPLAY_COLS,
      Math.floor(editViewport.clientWidth) - frame
    );
    const availH = Math.max(
      ART_DISPLAY_ROWS,
      Math.floor(editViewport.clientHeight) - frame
    );
    cellSize = Math.max(
      MIN_CELL_PX,
      Math.floor(Math.min(availW / ART_DISPLAY_COLS, availH / ART_DISPLAY_ROWS))
    );
    gridPixelW = ART_DISPLAY_COLS * cellSize;
    gridPixelH = ART_DISPLAY_ROWS * cellSize;
    syncEditSurfaceSize();
    layoutGrid();
    layoutPreview();
  }

  let debugOpen = false;

  function updateDebugUi(): void {
    debugBackdrop.classList.toggle('pixel-editor__drawer-backdrop--open', debugOpen);
    debugDrawer.classList.toggle('pixel-editor__drawer--open', debugOpen);
    debugBackdrop.setAttribute('aria-hidden', debugOpen ? 'false' : 'true');
    debugDrawer.setAttribute('aria-hidden', debugOpen ? 'false' : 'true');
    openDebugBtn.classList.toggle('pixel-editor__topbar-btn--active', debugOpen);
  }

  function toggleDebug(): void {
    debugOpen = !debugOpen;
    updateDebugUi();
  }

  function closeDebug(): void {
    debugOpen = false;
    updateDebugUi();
  }

  function layoutGrid(): void {
    const dpr = window.devicePixelRatio || 1;
    setupCanvas(editCanvas, gridPixelW, gridPixelH, dpr, { fillParent: true });
    setupCanvas(gridLayerCanvas, gridPixelW, gridPixelH, dpr, { fillParent: true });
    syncEditSurfaceSize();
    refreshAll();
    updateSelectionBox();
    updateEditorDebug();
  }

  function floatingSelectionPos(): { x: number; y: number } | null {
    if (!selection) return null;
    return movePreviewPos ?? { x: selection.x, y: selection.y };
  }

  /** 摆放悬浮时在预览位置叠加选区像素 */
  function gridForDisplay(): PackedGrid {
    const pos = selectionFloating ? floatingSelectionPos() : null;
    if (pos && selection) {
      const preview = clonePackedGrid(grid);
      pastePackedRegion(
        preview,
        gridCols,
        gridRows,
        pos.x,
        pos.y,
        selection.w,
        selection.h,
        selection.pixels
      );
      return preview;
    }
    return grid;
  }

  function drawTransparentFlashOverlay(
    ctx: CanvasRenderingContext2D,
    cellPx: number,
    originX: number,
    originY: number
  ): void {
    if (!transparentFlash || !flashHighlight) return;
    const display = displayPackedForView();
    ctx.fillStyle = 'rgba(255, 48, 140, 0.72)';
    for (let dy = 0; dy < ART_DISPLAY_ROWS; dy++) {
      for (let dx = 0; dx < ART_DISPLAY_COLS; dx++) {
        if ((display[gridIndex(dx, dy, ART_DISPLAY_COLS)] ?? 0) !== 0) continue;
        ctx.fillRect(
          originX + dx * cellPx,
          originY + dy * cellPx,
          cellPx,
          cellPx
        );
      }
    }
  }

  function refreshEditCanvas(): void {
    const ctx = editCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, gridPixelW, gridPixelH);
    if (activeLayer === 'render' && hasAnyDisplayHighlight(highlightGrid)) {
      fillDisplayPackedWithHighlight(
        ctx,
        displayPackedForView(),
        highlightGrid,
        cellSize,
        0,
        0,
        breathSpeed
      );
    } else {
      drawDisplayPackedAtCellSize(
        ctx,
        gridForDisplay(),
        cellSize,
        0,
        0,
        gridCols,
        gridRows
      );
    }
    drawTransparentFlashOverlay(ctx, cellSize, 0, 0);
  }

  function refreshPreview(): void {
    const sq = previewGridArt.getContext('2d');
    if (!sq) return;
    sq.clearRect(0, 0, previewPixelW, previewPixelH);
    drawPackedPreview(sq, gridForDisplay(), previewPixelW, previewPixelH, gridCols, gridRows);
    const layout = gridDrawLayout(
      ART_DISPLAY_COLS,
      ART_DISPLAY_ROWS,
      previewPixelW,
      previewPixelH,
      'fit'
    );
    const previewCellPx = Math.max(1, Math.floor(layout.cell));
    drawTransparentFlashOverlay(sq, previewCellPx, layout.ox, layout.oy);
  }

  function refreshAll(): void {
    refreshEditCanvas();
    refreshPreview();
    redrawGridLayer();
    updateSelectionBox();
  }

  function logicBlockForDisplayCell(dx: number, dy: number) {
    const x0 = Math.floor((dx * gridCols) / ART_DISPLAY_COLS);
    const y0 = Math.floor((dy * gridRows) / ART_DISPLAY_ROWS);
    const x1 =
      dx >= ART_DISPLAY_COLS - 1
        ? gridCols
        : Math.floor(((dx + 1) * gridCols) / ART_DISPLAY_COLS);
    const y1 =
      dy >= ART_DISPLAY_ROWS - 1
        ? gridRows
        : Math.floor(((dy + 1) * gridRows) / ART_DISPLAY_ROWS);
    return { x0, y0, x1, y1 };
  }

  /** 屏幕坐标 → 展示格（含最底行/最右列） */
  function displayCellFromPointer(
    clientX: number,
    clientY: number
  ): { dx: number; dy: number } | null {
    const rect = editCanvas.getBoundingClientRect();
    const dw = rect.width > 0 ? rect.width : gridPixelW || 1;
    const dh = rect.height > 0 ? rect.height : gridPixelH || 1;
    const canvasX = ((clientX - rect.left) / dw) * gridPixelW;
    const canvasY = ((clientY - rect.top) / dh) * gridPixelH;
    if (canvasX < 0 || canvasY < 0 || canvasX > gridPixelW || canvasY > gridPixelH) {
      return null;
    }
    const nx = Math.min(Math.max(canvasX / gridPixelW, 0), 1);
    const ny = Math.min(Math.max(canvasY / gridPixelH, 0), 1);
    const dx = Math.min(
      ART_DISPLAY_COLS - 1,
      Math.max(0, Math.ceil(nx * ART_DISPLAY_COLS) - 1)
    );
    const dy = Math.min(
      ART_DISPLAY_ROWS - 1,
      Math.max(0, Math.ceil(ny * ART_DISPLAY_ROWS) - 1)
    );
    return { dx, dy };
  }

  /** 屏幕坐标 → 逻辑像素格（映射到展示块起点） */
  function cellFromPointer(clientX: number, clientY: number): { x: number; y: number } | null {
    const dc = displayCellFromPointer(clientX, clientY);
    if (!dc) return null;
    const { x0, y0 } = logicBlockForDisplayCell(dc.dx, dc.dy);
    return { x: x0, y: y0 };
  }

  function cellFromEvent(e: PointerEvent): { x: number; y: number } | null {
    return cellFromPointer(e.clientX, e.clientY);
  }

  function updateSelectionBox(rect?: { x: number; y: number; w: number; h: number }): void {
    const floating = selectionFloating ? floatingSelectionPos() : null;
    const r =
      rect ??
      (selection
        ? {
            x: floating?.x ?? selection.x,
            y: floating?.y ?? selection.y,
            w: selection.w,
            h: selection.h,
          }
        : null);
    if (!r) {
      selBox.hidden = true;
      return;
    }
    selBox.hidden = false;
    const px = logicalRectToCanvasPx(r);
    selBox.style.left = `${px.left}px`;
    selBox.style.top = `${px.top}px`;
    selBox.style.width = `${px.width}px`;
    selBox.style.height = `${px.height}px`;
  }

  function setTool(next: Tool): void {
    exitClipboardModes(true);
    tool = next;
    syncToolbarUi();
    editCanvas.style.cursor = next === 'hand' ? 'grab' : 'crosshair';
    applyEditViewTransform();
    updateEditorDebug();
  }

  function nearestPastePosition(): { x: number; y: number } {
    if (!clipboard) return { x: 0, y: 0 };
    return {
      x: clamp(Math.floor((gridCols - clipboard.w) / 2), 0, Math.max(0, gridCols - clipboard.w)),
      y: clamp(Math.floor((gridRows - clipboard.h) / 2), 0, Math.max(0, gridRows - clipboard.h)),
    };
  }

  function armCopyMode(): void {
    exitClipboardModes(false);
    deactivateToolForClipboard();
    clipboardMode = 'copy';
    clearSelection();
    syncToolbarUi();
  }

  function armCutMode(): void {
    exitClipboardModes(false);
    deactivateToolForClipboard();
    clipboardMode = 'cut';
    clearSelection();
    syncToolbarUi();
  }

  function handlePasteClick(): void {
    if ((clipboardMode === 'copy' || clipboardMode === 'cut') && selection) {
      const mode = clipboardMode;
      deactivateToolForClipboard();
      clipboardMode = 'paste';
      captureClipboardFromSelection(mode);
      startPasteFloating();
      syncToolbarUi();
      return;
    }
    if (!clipboard) return;
    if (clipboardMode === 'paste') {
      exitClipboardModes(true);
      return;
    }
    exitClipboardModes(false);
    deactivateToolForClipboard();
    clipboardMode = 'paste';
    startPasteFloating();
    syncToolbarUi();
  }

  function fillDisplayCell(dx: number, dy: number, colorArgb: number): void {
    if (dx < 0 || dy < 0 || dx >= ART_DISPLAY_COLS || dy >= ART_DISPLAY_ROWS) return;
    const { x0, y0, x1, y1 } = logicBlockForDisplayCell(dx, dy);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        recordCellChange(gridIndex(x, y, gridCols), colorArgb);
      }
    }
  }

  /** 与画布绘制一致：逻辑格下采样为 60×84 展示格 */
  function displayPackedForView(): PackedGrid {
    return downsamplePackedGrid(
      gridForDisplay(),
      gridCols,
      gridRows,
      ART_DISPLAY_COLS,
      ART_DISPLAY_ROWS
    );
  }

  function isDisplayCellOpaqueAt(dx: number, dy: number): boolean {
    return (displayPackedForView()[gridIndex(dx, dy, ART_DISPLAY_COLS)] ?? 0) !== 0;
  }

  function toggleHighlightFlagAtDisplay(dx: number, dy: number, flag: number): void {
    if (dx < 0 || dy < 0 || dx >= ART_DISPLAY_COLS || dy >= ART_DISPLAY_ROWS) return;
    const idx = displayHighlightIndex(dx, dy);
    const prev = highlightGrid[idx] ?? 0;

    if (flag === DISPLAY_HIGHLIGHT_MARK) {
      if (!isDisplayCellOpaqueAt(dx, dy)) return;
      const next = prev & DISPLAY_HIGHLIGHT_MARK ? 0 : prev | DISPLAY_HIGHLIGHT_MARK;
      recordHighlightChange(idx, next);
      return;
    }

    if (!(prev & DISPLAY_HIGHLIGHT_MARK) || !isDisplayCellOpaqueAt(dx, dy)) return;
    const next = prev & flag ? prev & ~flag : prev | flag;
    recordHighlightChange(idx, next);
  }

  function stampHighlightBrushAtDisplay(
    centerDx: number,
    centerDy: number,
    flag: number
  ): void {
    const r = renderBrushSize - 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (renderBrushSize > 1 && dx * dx + dy * dy > r * r + r * 0.2) continue;
        toggleHighlightFlagAtDisplay(centerDx + dx, centerDy + dy, flag);
      }
    }
  }

  function clearHighlightAtDisplay(dx: number, dy: number): void {
    if (dx < 0 || dy < 0 || dx >= ART_DISPLAY_COLS || dy >= ART_DISPLAY_ROWS) return;
    const idx = displayHighlightIndex(dx, dy);
    const prev = highlightGrid[idx] ?? 0;
    if (prev === 0) return;
    recordHighlightChange(idx, 0);
  }

  function stampRenderEraserAtDisplay(centerDx: number, centerDy: number): void {
    const r = renderBrushSize - 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (renderBrushSize > 1 && dx * dx + dy * dy > r * r + r * 0.2) continue;
        clearHighlightAtDisplay(centerDx + dx, centerDy + dy);
      }
    }
  }

  function clearRenderLayer(): void {
    let any = false;
    for (let i = 0; i < highlightGrid.length; i++) {
      if ((highlightGrid[i] ?? 0) !== 0) {
        any = true;
        break;
      }
    }
    if (!any) return;
    beginHighlightUndoBatch();
    for (let i = 0; i < highlightGrid.length; i++) {
      if ((highlightGrid[i] ?? 0) !== 0) recordHighlightChange(i, 0);
    }
    commitHighlightUndoBatch();
    syncBreathAnimation();
    refreshAll();
  }

  function highlightToolFlag(): number {
    if (tool === 'glow') return DISPLAY_HIGHLIGHT_GLOW;
    if (tool === 'breath') return DISPLAY_HIGHLIGHT_BREATH;
    return DISPLAY_HIGHLIGHT_MARK;
  }

  function highlightAtDisplay(dc: { dx: number; dy: number }): void {
    const flag = highlightToolFlag();
    if (
      lastHighlightCell?.x === dc.dx &&
      lastHighlightCell?.y === dc.dy &&
      renderBrushSize === 1
    ) {
      return;
    }
    if (lastHighlightCell) {
      forEachDisplayLine(lastHighlightCell.x, lastHighlightCell.y, dc.dx, dc.dy, (px, py) => {
        stampHighlightBrushAtDisplay(px, py, flag);
      });
    } else {
      stampHighlightBrushAtDisplay(dc.dx, dc.dy, flag);
    }
    lastHighlightCell = { x: dc.dx, y: dc.dy };
    if (activeLayer === 'render') refreshEditCanvas();
    redrawGridLayer();
    syncBreathAnimation();
  }

  function eraseRenderAtDisplay(dc: { dx: number; dy: number }): void {
    if (
      lastHighlightCell?.x === dc.dx &&
      lastHighlightCell?.y === dc.dy &&
      renderBrushSize === 1
    ) {
      return;
    }
    if (lastHighlightCell) {
      forEachDisplayLine(lastHighlightCell.x, lastHighlightCell.y, dc.dx, dc.dy, (px, py) => {
        stampRenderEraserAtDisplay(px, py);
      });
    } else {
      stampRenderEraserAtDisplay(dc.dx, dc.dy);
    }
    lastHighlightCell = { x: dc.dx, y: dc.dy };
    if (activeLayer === 'render') refreshEditCanvas();
    redrawGridLayer();
    syncBreathAnimation();
  }

  function isRenderPaintTool(t: Tool): boolean {
    return t === 'highlight' || t === 'glow' || t === 'breath' || t === 'render-eraser';
  }

  function paintHighlightMarks(ctx: CanvasRenderingContext2D): void {
    paintDisplayHighlightMarks(ctx, highlightGrid, cellSize, 0, 0, breathSpeed);
  }

  function redrawGridLayer(): void {
    const ctx = gridLayerCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, gridPixelW, gridPixelH);
    if (showGrid) drawReferenceGridLines(ctx);
    if (activeLayer === 'render') paintHighlightMarks(ctx);
  }

  function drawReferenceGridLines(ctx: CanvasRenderingContext2D): void {
    const displayStep = Math.max(
      1,
      Math.round((ART_GRID_MAJOR_STEP * ART_DISPLAY_COLS) / gridCols)
    );
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;

    const drawV = (c: number, strong: boolean) => {
      if (c < 0 || c > ART_DISPLAY_COLS) return;
      ctx.globalAlpha = strong ? 0.55 : 0.22;
      const x =
        c >= ART_DISPLAY_COLS
          ? gridPixelW - 0.5
          : (c / ART_DISPLAY_COLS) * gridPixelW + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridPixelH);
      ctx.stroke();
    };

    const drawH = (r: number, strong: boolean) => {
      if (r < 0 || r > ART_DISPLAY_ROWS) return;
      ctx.globalAlpha = strong ? 0.55 : 0.22;
      const y =
        r >= ART_DISPLAY_ROWS
          ? gridPixelH - 0.5
          : (r / ART_DISPLAY_ROWS) * gridPixelH + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gridPixelW, y);
      ctx.stroke();
    };

    for (let c = 0; c <= ART_DISPLAY_COLS; c += displayStep) drawV(c, true);
    for (let r = 0; r <= ART_DISPLAY_ROWS; r += displayStep) drawH(r, true);
    drawV(0, true);
    drawV(ART_DISPLAY_COLS, true);
    drawH(0, true);
    drawH(ART_DISPLAY_ROWS, true);
    ctx.globalAlpha = 1;
  }

  function syncBreathAnimation(): void {
    if (!anyDisplayHighlightBreath(highlightGrid)) {
      unregisterBreathTarget?.();
      unregisterBreathTarget = null;
      return;
    }
    if (unregisterBreathTarget) return;
    unregisterBreathTarget = registerHighlightBreathTarget({
      hasBreath: () => anyDisplayHighlightBreath(highlightGrid),
      redraw: () => {
        if (activeLayer === 'render') refreshEditCanvas();
        redrawGridLayer();
      },
    });
  }

  /** 按展示格（60×84）泛洪填充，与所见色块一致 */
  function floodFillDisplayCell(dx: number, dy: number, fillArgb: number): void {
    const display = displayPackedForView();
    const target = getPackedPixel(display, dx, dy, ART_DISPLAY_COLS);
    if (argbEquals(target, fillArgb)) return;

    const stack: [number, number][] = [[dx, dy]];
    const seen = new Set<number>();

    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const idx = gridIndex(cx, cy, ART_DISPLAY_COLS);
      if (seen.has(idx)) continue;
      if (cx < 0 || cy < 0 || cx >= ART_DISPLAY_COLS || cy >= ART_DISPLAY_ROWS) continue;
      if (!argbEquals(display[idx] ?? 0, target)) continue;
      seen.add(idx);
      fillDisplayCell(cx, cy, fillArgb);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  function forEachDisplayLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    visit: (dx: number, dy: number) => void
  ): void {
    let x = x0;
    let y = y0;
    const adx = Math.abs(x1 - x0);
    const ady = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = adx - ady;

    while (true) {
      visit(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -ady) {
        err -= ady;
        x += sx;
      }
      if (e2 < adx) {
        err += adx;
        y += sy;
      }
    }
  }

  /** 笔刷粗细按展示像素（60×84）计，与卡面所见块一致 */
  function stampBrushAtDisplay(centerDx: number, centerDy: number, colorArgb: number): void {
    const r = brushSize - 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (brushSize > 1 && dx * dx + dy * dy > r * r + r * 0.2) continue;
        fillDisplayCell(centerDx + dx, centerDy + dy, colorArgb);
      }
    }
  }

  /** 沿展示格连线绘制/擦除，避免拖动时跳过格子形成网格残留 */
  function paintAtDisplay(dc: { dx: number; dy: number }, colorArgb: number = paintArgb): void {
    if (lastPaintCell?.x === dc.dx && lastPaintCell?.y === dc.dy && brushSize === 1) {
      return;
    }
    if (lastPaintCell) {
      forEachDisplayLine(lastPaintCell.x, lastPaintCell.y, dc.dx, dc.dy, (px, py) => {
        stampBrushAtDisplay(px, py, colorArgb);
      });
    } else {
      stampBrushAtDisplay(dc.dx, dc.dy, colorArgb);
    }
    lastPaintCell = { x: dc.dx, y: dc.dy };
    refreshAll();
  }

  function sampleColorAtDisplay(dx: number, dy: number): void {
    const v = getPackedPixel(displayPackedForView(), dx, dy, ART_DISPLAY_COLS);
    const c = argbToPixel(v);
    if (!c) return;
    paintColor = c;
    paintArgb = v;
    picker.setFromCss(c);
  }

  /** 复制/剪切框选完成：保留选区，待点击粘贴写入剪贴板 */
  function finishClipboardBox(x1: number, y1: number): void {
    if (!selectStart || (clipboardMode !== 'copy' && clipboardMode !== 'cut')) return;
    const rect = normalizeRect(selectStart.x, selectStart.y, x1, y1);
    rect.x = clamp(rect.x, 0, gridCols - 1);
    rect.y = clamp(rect.y, 0, gridRows - 1);
    rect.w = Math.min(rect.w, gridCols - rect.x);
    rect.h = Math.min(rect.h, gridRows - rect.y);
    selectStart = null;
    lastSelectEnd = null;
    if (rect.w < 1 || rect.h < 1) {
      clearSelection();
      return;
    }
    selection = {
      ...rect,
      pixels: copyPackedRegion(grid, rect.x, rect.y, rect.w, rect.h, gridCols),
    };
    updateSelectionBox(rect);
    updateClipboardButtons();
    refreshAll();
  }

  function captureClipboardFromSelection(mode: 'copy' | 'cut'): boolean {
    if (!selection) return false;
    clipboard = {
      pixels: selection.pixels.slice(),
      w: selection.w,
      h: selection.h,
    };
    if (mode === 'cut') {
      beginUndoBatch();
      clearPackedRegion(
        grid,
        selection.x,
        selection.y,
        selection.w,
        selection.h,
        gridCols,
        packedCellChange
      );
      commitUndoBatch();
    }
    clearSelection();
    updateClipboardButtons();
    return true;
  }

  function startPasteFloating(at?: { x: number; y: number }): void {
    if (!clipboard) return;
    const pos = at ?? nearestPastePosition();
    const tx = clamp(pos.x, 0, Math.max(0, gridCols - clipboard.w));
    const ty = clamp(pos.y, 0, Math.max(0, gridRows - clipboard.h));
    selection = {
      x: tx,
      y: ty,
      w: clipboard.w,
      h: clipboard.h,
      pixels: clipboard.pixels.slice(),
    };
    selectionFloating = true;
    floatingPasteOnly = true;
    movePreviewPos = { x: tx, y: ty };
    moveAnchor = null;
    updateSelectionBox();
    refreshAll();
  }

  function endMoveDrag(): void {
    if (moveAnchor && selection && movePreviewPos) {
      selection.x = movePreviewPos.x;
      selection.y = movePreviewPos.y;
    }
    moveAnchor = null;
    movePreviewPos = null;
    lastDragCell = null;
    updateSelectionBox();
    refreshAll();
  }

  function commitPasteFloating(): void {
    if (!selection || !floatingPasteOnly) return;
    const pos = floatingSelectionPos() ?? { x: selection.x, y: selection.y };
    const tx = clamp(pos.x, 0, gridCols - selection.w);
    const ty = clamp(pos.y, 0, gridRows - selection.h);
    beginUndoBatch();
    pastePackedRegion(
      grid,
      gridCols,
      gridRows,
      tx,
      ty,
      selection.w,
      selection.h,
      selection.pixels,
      packedCellChange
    );
    commitUndoBatch();
    selectionFloating = false;
    floatingPasteOnly = false;
    selection = null;
    movePreviewPos = null;
    moveAnchor = null;
    updateSelectionBox();
    refreshAll();
  }

  const blockBrowserGesture = (e: Event) => e.preventDefault();

  for (const el of [overlay, panel, editSurface, editCanvas]) {
    el.addEventListener('contextmenu', blockBrowserGesture);
  }

  if (toolsScroll) {
    toolsScroll.addEventListener(
      'touchmove',
      (e) => e.stopPropagation(),
      { passive: true }
    );
    toolsScroll.addEventListener(
      'wheel',
      (e) => e.stopPropagation(),
      { passive: true }
    );
  }

  panel.addEventListener(
    'touchmove',
    (e) => {
      const t = e.target as HTMLElement;
      if (toolsScroll?.contains(t)) return;
      if (t.closest('input[type="range"]') || t.closest('.range-slider-row')) return;
      if (pointerDrawing) e.preventDefault();
    },
    { passive: false }
  );

  const onEditPointerDown = (e: PointerEvent) => {
    if (navPointers.size >= 2) return;
    const cell = cellFromEvent(e);

    if ((clipboardMode === 'copy' || clipboardMode === 'cut') && cell) {
      e.preventDefault();
      e.stopPropagation();
      pointerDrawing = true;
      editSurface.setPointerCapture(e.pointerId);
      selectStart = { x: cell.x, y: cell.y };
      lastSelectEnd = { x: cell.x, y: cell.y };
      updateSelectionBox({ x: cell.x, y: cell.y, w: 1, h: 1 });
      return;
    }

    if (clipboardMode === 'paste' && floatingPasteOnly && selection && cell) {
      e.preventDefault();
      e.stopPropagation();
      pointerDrawing = true;
      editSurface.setPointerCapture(e.pointerId);
      const pos = floatingSelectionPos() ?? { x: selection.x, y: selection.y };
      movePreviewPos = { ...pos };
      moveAnchor = { x: cell.x, y: cell.y };
      moveOffset = { x: cell.x - pos.x, y: cell.y - pos.y };
      lastDragCell = { x: cell.x, y: cell.y };
      return;
    }

    if (clipboardMode) return;

    if (tool === 'hand') return;

    if (tool === 'eyedropper') {
      if (activeLayer !== 'item') return;
      e.preventDefault();
      const dc = displayCellFromPointer(e.clientX, e.clientY);
      if (dc) sampleColorAtDisplay(dc.dx, dc.dy);
      return;
    }

    e.preventDefault();
    const dc = displayCellFromPointer(e.clientX, e.clientY);
    if (!dc && !cell) return;
    pointerDrawing = true;
    editSurface.setPointerCapture(e.pointerId);
    if (tool === 'paint') {
      if (activeLayer !== 'item') return;
      if (!dc) return;
      if (!strokeUndoPushed) {
        beginUndoBatch();
        strokeUndoPushed = true;
      }
      lastPaintCell = null;
      paintAtDisplay(dc);
      return;
    }
    if (tool === 'fill') {
      if (activeLayer !== 'item') return;
      if (!dc) return;
      beginUndoBatch();
      floodFillDisplayCell(dc.dx, dc.dy, paintArgb);
      commitUndoBatch();
      refreshAll();
      return;
    }
    if (tool === 'eraser') {
      if (activeLayer !== 'item') return;
      if (!dc) return;
      if (!strokeUndoPushed) {
        beginUndoBatch();
        strokeUndoPushed = true;
      }
      lastPaintCell = null;
      paintAtDisplay(dc, 0);
      return;
    }
    if (tool === 'render-eraser') {
      if (activeLayer !== 'render') return;
      if (!dc) return;
      if (!highlightStrokeUndoPushed) {
        beginHighlightUndoBatch();
        highlightStrokeUndoPushed = true;
      }
      lastHighlightCell = null;
      eraseRenderAtDisplay(dc);
      return;
    }
    if (tool === 'highlight' || tool === 'glow' || tool === 'breath') {
      if (activeLayer !== 'render') return;
      if (!dc) return;
      if (!highlightStrokeUndoPushed) {
        beginHighlightUndoBatch();
        highlightStrokeUndoPushed = true;
      }
      lastHighlightCell = null;
      highlightAtDisplay(dc);
      return;
    }
  };

  editSurface.addEventListener('pointerdown', onEditPointerDown);

  const onEditPointerMove = (e: PointerEvent) => {
    if (!editSurface.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    const dc = displayCellFromPointer(e.clientX, e.clientY);
    const cell = cellFromEvent(e);
    if ((clipboardMode === 'copy' || clipboardMode === 'cut') && selectStart && cell) {
      const { x, y } = cell;
      lastSelectEnd = { x, y };
      updateSelectionBox(normalizeRect(selectStart.x, selectStart.y, x, y));
      return;
    }
    if (!cell) return;
    const { x, y } = cell;
    if (clipboardMode === 'paste' && moveAnchor && selection) {
      lastDragCell = { x, y };
      movePreviewPos = {
        x: clamp(x - moveOffset.x, 0, gridCols - selection.w),
        y: clamp(y - moveOffset.y, 0, gridRows - selection.h),
      };
      updateSelectionBox({
        x: movePreviewPos.x,
        y: movePreviewPos.y,
        w: selection.w,
        h: selection.h,
      });
      refreshEditCanvas();
      refreshPreview();
      return;
    }
    if (clipboardMode) return;
    if (tool === 'paint') {
      if (activeLayer !== 'item' || !dc) return;
      paintAtDisplay(dc);
      return;
    }
    if (tool === 'eraser') {
      if (activeLayer !== 'item' || !dc) return;
      paintAtDisplay(dc, 0);
      return;
    }
    if (tool === 'render-eraser') {
      if (activeLayer !== 'render' || !dc) return;
      eraseRenderAtDisplay(dc);
      return;
    }
    if (tool === 'highlight' || tool === 'glow' || tool === 'breath') {
      if (activeLayer !== 'render' || !dc) return;
      highlightAtDisplay(dc);
      return;
    }
  };

  editSurface.addEventListener('pointermove', onEditPointerMove);

  const onEditPointerUp = (e: PointerEvent) => {
    const cell = cellFromEvent(e) ?? lastDragCell;
    if ((clipboardMode === 'copy' || clipboardMode === 'cut') && selectStart) {
      const end = cell ?? lastSelectEnd ?? selectStart;
      finishClipboardBox(end.x, end.y);
    }
    if (!cell) {
      if (clipboardMode === 'paste' && moveAnchor) {
        endMoveDrag();
      }
      lastPaintCell = null;
      lastHighlightCell = null;
      strokeUndoPushed = false;
      if (highlightStrokeUndoPushed) commitHighlightUndoBatch();
      highlightStrokeUndoPushed = false;
      pointerDrawing = false;
      try {
        editSurface.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      return;
    }
    const { x, y } = cell;
    if (clipboardMode === 'paste' && moveAnchor && selection) {
      movePreviewPos = {
        x: clamp(x - moveOffset.x, 0, gridCols - selection.w),
        y: clamp(y - moveOffset.y, 0, gridRows - selection.h),
      };
      endMoveDrag();
    }
    if (strokeUndoPushed && (tool === 'paint' || tool === 'eraser')) {
      commitUndoBatch();
    }
    if (highlightStrokeUndoPushed && isRenderPaintTool(tool)) {
      commitHighlightUndoBatch();
    }
    lastPaintCell = null;
    lastHighlightCell = null;
    strokeUndoPushed = false;
    highlightStrokeUndoPushed = false;
    pointerDrawing = false;
    try {
      editSurface.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  editSurface.addEventListener('pointerup', onEditPointerUp);

  editSurface.addEventListener('pointercancel', (e) => {
    if (strokeUndoPushed && (tool === 'paint' || tool === 'eraser')) {
      commitUndoBatch();
    }
    if (highlightStrokeUndoPushed && isRenderPaintTool(tool)) {
      commitHighlightUndoBatch();
    }
    if (clipboardMode === 'paste' && moveAnchor) {
      endMoveDrag();
    }
    lastPaintCell = null;
    lastHighlightCell = null;
    strokeUndoPushed = false;
    highlightStrokeUndoPushed = false;
    pointerDrawing = false;
    try {
      editSurface.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  });

  panel.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => setTool((btn as HTMLElement).dataset.tool as Tool));
  });

  panel.querySelectorAll('[data-editor-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = (btn as HTMLElement).dataset.editorLayer as EditorLayer;
      setEditorLayer(layer);
    });
  });

  panel.querySelector('[data-undo]')?.addEventListener('click', () => undoPixel());
  panel.querySelector('[data-redo]')?.addEventListener('click', () => redoPixel());
  panel.querySelector('[data-render-undo]')?.addEventListener('click', () => undoRender());
  panel.querySelector('[data-render-redo]')?.addEventListener('click', () => redoRender());
  panel.querySelector('[data-copy]')?.addEventListener('click', () => armCopyMode());
  panel.querySelector('[data-cut]')?.addEventListener('click', () => armCutMode());
  panel.querySelector('[data-paste]')?.addEventListener('click', () => handlePasteClick());

  brushSizeInput.addEventListener('input', () => {
    brushSize = clamp(Number(brushSizeInput.value) || 1, 1, MAX_BRUSH);
    brushSizeLabel.textContent = String(brushSize);
    updateEditorDebug();
  });

  renderBrushSizeInput.addEventListener('input', () => {
    renderBrushSize = clamp(Number(renderBrushSizeInput.value) || 1, 1, MAX_BRUSH);
    renderBrushSizeLabel.textContent = String(renderBrushSize);
    updateEditorDebug();
  });

  panel.querySelector('[data-clear-render]')?.addEventListener('click', () => clearRenderLayer());

  const breathSpeedInput = panel.querySelector<HTMLInputElement>('[data-breath-speed]')!;
  const breathSpeedLabel = panel.querySelector<HTMLElement>('[data-breath-speed-label]')!;
  breathSpeedInput.addEventListener('input', () => {
    breathSpeed = clamp(Number(breathSpeedInput.value) || 50, 1, 100);
    breathSpeedLabel.textContent = String(breathSpeed);
    if (anyDisplayHighlightBreath(highlightGrid) && activeLayer === 'render') refreshAll();
  });

  panel.querySelector('[data-zoom-reset]')?.addEventListener('click', () => {
    if (!canPanZoomView()) return;
    viewPanX = 0;
    viewPanY = 0;
    viewZoom = 1;
    applyEditViewTransform();
    updateEditorDebug();
  });

  editViewport.addEventListener(
    'wheel',
    (e) => {
      if (!canPanZoomView()) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      viewZoom = clamp(viewZoom * factor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
      applyEditViewTransform();
      updateEditorDebug();
    },
    { passive: false }
  );

  editViewport.addEventListener('pointerdown', (e) => {
    navPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (navPointers.size === 2 && canPanZoomView()) {
      const pts = [...navPointers.values()];
      lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      return;
    }
    if (canPanZoomView()) {
      e.preventDefault();
      editViewport.setPointerCapture(e.pointerId);
      navPanStart = { x: e.clientX, y: e.clientY, panX: viewPanX, panY: viewPanY };
    }
  });

  editViewport.addEventListener('pointermove', (e) => {
    if (!navPointers.has(e.pointerId)) return;
    navPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (navPointers.size === 2 && canPanZoomView()) {
      e.preventDefault();
      const pts = [...navPointers.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (lastPinchDist > 0) {
        viewZoom = clamp(
          viewZoom * (dist / lastPinchDist),
          MIN_VIEW_ZOOM,
          MAX_VIEW_ZOOM
        );
        applyEditViewTransform();
        updateEditorDebug();
      }
      lastPinchDist = dist;
      return;
    }

    if (canPanZoomView() && navPanStart && editViewport.hasPointerCapture(e.pointerId)) {
      e.preventDefault();
      viewPanX = navPanStart.panX + (e.clientX - navPanStart.x);
      viewPanY = navPanStart.panY + (e.clientY - navPanStart.y);
      applyEditViewTransform();
    }
  });

  const onNavPointerEnd = (e: PointerEvent) => {
    navPointers.delete(e.pointerId);
    if (navPointers.size < 2) lastPinchDist = 0;
    navPanStart = null;
    try {
      editViewport.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };
  editViewport.addEventListener('pointerup', onNavPointerEnd);
  editViewport.addEventListener('pointercancel', onNavPointerEnd);

  panel.querySelector('[data-toggle-grid]')?.addEventListener('click', () => {
    showGrid = !showGrid;
    redrawGridLayer();
    const btn = panel.querySelector('[data-toggle-grid]');
    if (btn) btn.textContent = showGrid ? '参考线：开' : '参考线：关';
  });

  select.addEventListener('change', () => {
    persistDraft();
    currentKey = select.value as PixelArtKey;
    loadArtForKey(currentKey);
    layoutGrid();
    refreshAll();
  });

  const importFileInput = panel.querySelector<HTMLInputElement>('[data-import-file]')!;

  panel.querySelector('[data-import-image]')?.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files?.[0];
    importFileInput.value = '';
    if (!file) return;

    void (async () => {
      try {
        const img = await loadImageFromFile(file);
        openImageImportModal({
          image: img,
          cols: gridCols,
          rows: gridRows,
          onConfirm: (imported) => {
            openImageImportEffectModal({
              grid: imported,
              cols: gridCols,
              rows: gridRows,
              onConfirm: (processed) => {
                replaceGrid(gridToPacked(processed));
                clearSelection();
                viewPanX = 0;
                viewPanY = 0;
                viewZoom = 1;
                applyEditViewTransform();
                flattenEditorGrid();
                refreshAll();
                savePixelEditorDraft(currentKey, grid, highlightGrid, breathSpeed);
                requestAnimationFrame(() => layoutViewport());
              },
            });
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '导入失败';
        window.alert(msg);
      }
    })();
  });

  panel.querySelector('[data-clear]')?.addEventListener('click', () => {
    replaceGrid(makeEmptyGrid());
    selection = null;
    refreshAll();
  });

  panel.querySelector('[data-apply]')?.addEventListener('click', () => {
    flattenEditorGrid();
    setCustomArtGrid(currentKey, packedToGrid(grid));
    setCustomArtHighlight(currentKey, highlightGrid, breathSpeed);
    savePixelEditorDraft(currentKey, grid, highlightGrid, breathSpeed);
    onApplied();
  });

  panel.querySelector('[data-export]')?.addEventListener('click', () => {
    flattenEditorGrid();
    refreshAll();
    downloadPackedPng(grid, `${currentKey}.png`);
  });

  panel.querySelector('[data-export-bundle]')?.addEventListener('click', () => {
    flattenEditorGrid();
    refreshAll();
    downloadPackedPng(grid, `${currentKey}.png`);
    downloadJsonFile(
      `${currentKey}.meta.json`,
      createArtCardMeta(currentKey, highlightGrid, breathSpeed)
    );
  });

  const uploadCloudBtn = panel.querySelector<HTMLButtonElement>('[data-upload-cloud]')!;
  uploadCloudBtn.addEventListener('click', () => {
    void (async () => {
      const prevLabel = uploadCloudBtn.textContent;
      uploadCloudBtn.disabled = true;
      uploadCloudBtn.textContent = '上传中…';
      try {
        flattenEditorGrid();
        refreshAll();
        const meta = createArtCardMeta(currentKey, highlightGrid, breathSpeed);
        const pngBlob = await packedGridToPngBlob(grid);
        await uploadArtToCloud(currentKey, pngBlob, meta);
        setCustomArtGrid(currentKey, packedToGrid(grid));
        setCustomArtHighlight(currentKey, highlightGrid, breathSpeed);
        savePixelEditorDraft(currentKey, grid, highlightGrid, breathSpeed);
        onApplied();
        uploadCloudBtn.textContent = '上传成功';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`上传失败：${msg}`);
        uploadCloudBtn.textContent = prevLabel ?? '上传云端';
      } finally {
        uploadCloudBtn.disabled = false;
        window.setTimeout(() => {
          if (uploadCloudBtn.textContent === '上传成功') {
            uploadCloudBtn.textContent = '上传云端';
          }
        }, 2200);
      }
    })();
  });

  panel.querySelector('[data-view-shop]')?.addEventListener('click', () => {
    openArtShopModal({
      onImportPixelGrid: (pixelGrid) => {
        flattenEditorGrid();
        grid = clonePackedGrid(gridToPacked(upscaleGridToArtSize(pixelGrid)));
        highlightGrid = createEmptyDisplayHighlight();
        selection = null;
        selectStart = null;
        selectionFloating = false;
        resetHistory();
        refreshAll();
        persistDraft();
      },
    });
  });

  function updateTransparentFlashBtn(): void {
    transparentFlashBtn.classList.toggle('pixel-editor__topbar-btn--active', transparentFlash);
    transparentFlashBtn.textContent = transparentFlash ? '停止闪烁' : '透明闪烁';
  }

  function stopTransparentFlash(): void {
    if (flashTimer !== undefined) {
      clearInterval(flashTimer);
      flashTimer = undefined;
    }
    flashHighlight = false;
  }

  function startTransparentFlash(): void {
    stopTransparentFlash();
    flashHighlight = true;
    flashTimer = setInterval(() => {
      flashHighlight = !flashHighlight;
      refreshEditCanvas();
      refreshPreview();
    }, 480);
  }

  transparentFlashBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    transparentFlash = !transparentFlash;
    if (transparentFlash) {
      startTransparentFlash();
    } else {
      stopTransparentFlash();
      refreshAll();
    }
    updateTransparentFlashBtn();
  });

  const fullscreenBtn = panel.querySelector<HTMLElement>('[data-fullscreen]')!;

  const updateFullscreenBtn = (): void => {
    const on = document.fullscreenElement === overlay;
    fullscreenBtn.textContent = on ? '退出全屏' : '全屏';
  };

  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!document.fullscreenElement) {
      void overlay.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  });
  document.addEventListener('fullscreenchange', updateFullscreenBtn);

  openDebugBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDebug();
  });
  debugBackdrop.addEventListener('click', closeDebug);
  debugDrawer.addEventListener('click', (e) => e.stopPropagation());
  panel.querySelectorAll('[data-close-drawer]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDebug();
    });
  });

  const requestClose = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    closeDebug();
    closePixelEditor();
  };
  const closeBtn = panel.querySelector('.pixel-editor__close');
  closeBtn?.addEventListener('click', requestClose);
  closeBtn?.addEventListener('pointerup', requestClose);

  const onEditorKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redoActiveLayer();
      else undoActiveLayer();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redoActiveLayer();
      return;
    }
    if (mod && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      armCopyMode();
      return;
    }
    if (mod && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      armCutMode();
      return;
    }
    if (mod && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      handlePasteClick();
      return;
    }
    if (e.key === 'Escape') {
      if (clipboardMode) {
        e.preventDefault();
        exitClipboardModes(false);
        return;
      }
      if (debugOpen) {
        closeDebug();
        return;
      }
      closePixelEditor();
      return;
    }
  };
  document.addEventListener('keydown', onEditorKey);

  const ro = new ResizeObserver(() => layoutViewport());
  ro.observe(canvasRow);
  ro.observe(previewPanel);
  ro.observe(editPanel);

  const lastKey = getLastEditedArtKey();
  if (lastKey && PIXEL_ART_KEYS.includes(lastKey)) {
    currentKey = lastKey;
    select.value = lastKey;
  }
  loadArtForKey(currentKey);
  setTool('hand');
  layoutGrid();
  updateClipboardButtons();
  syncLayerUi();

  overlay.append(panel);
  editorOverlay = overlay;
  editorTeardown = () => {
    stopTransparentFlash();
    unregisterBreathTarget?.();
    unregisterBreathTarget = null;
    persistDraft();
    ro.disconnect();
    document.removeEventListener('keydown', onEditorKey);
    document.removeEventListener('fullscreenchange', updateFullscreenBtn);
  };
  getModalOverlayMount().append(overlay);
  updateDebugUi();
  updateFullscreenBtn();
  requestAnimationFrame(() => {
    layoutViewport();
    requestAnimationFrame(() => layoutViewport());
  });
}

export function closePixelEditor(): void {
  editorTeardown?.();
  editorTeardown = null;
  editorOverlay?.remove();
  editorOverlay = null;
  document.querySelector('[data-modal="pixel-editor"]')?.remove();
}
