import type { PixelArtKey } from '../game/types';
import type { PixelGrid } from './pixelArt';
import {
  createEmptyDisplayHighlight,
  decodeDisplayHighlightBase64,
  encodeDisplayHighlightBase64,
  type DisplayHighlightGrid,
} from './displayHighlight';
import { ART_GRID_COLS, ART_GRID_ROWS } from './gridConfig';
import {
  clonePackedGrid,
  compositePackedGrids,
  createPackedGrid,
  decodePackedBase64,
  encodePackedBase64,
  gridToPacked,
  packedGridSize,
  upscalePackedToArtSize,
  type PackedGrid,
} from './packedGrid';
import { upscaleGridToArtSize } from './pixelArt';

const STORAGE_KEY_V3 = 'tcg-pixel-editor-drafts-v3';
const STORAGE_KEY_V2 = 'tcg-pixel-editor-drafts-v2';
const STORAGE_KEY_V1 = 'tcg-pixel-editor-drafts-v1';

export interface PixelEditorDraft {
  grid: PackedGrid;
  highlight: DisplayHighlightGrid;
  highlightBreathSpeed?: number;
  updatedAt: number;
}

interface DraftStoreV3 {
  lastArtKey?: PixelArtKey;
  byKey: Partial<
    Record<
      PixelArtKey,
      {
        gridB64: string;
        highlightB64?: string;
        highlightBreathSpeed?: number;
        updatedAt: number;
      }
    >
  >;
}

interface DraftStoreV2 {
  lastArtKey?: PixelArtKey;
  byKey: Partial<
    Record<
      PixelArtKey,
      { layersB64: string[]; layerVisible: boolean[]; updatedAt: number }
    >
  >;
}

interface DraftStoreV1 {
  lastArtKey?: PixelArtKey;
  byKey: Partial<
    Record<
      PixelArtKey,
      { layers: PixelGrid[]; layerVisible: boolean[]; updatedAt: number }
    >
  >;
}

function readStoreV3(): DraftStoreV3 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V3);
    if (!raw) return { byKey: {} };
    const parsed = JSON.parse(raw) as DraftStoreV3;
    return { lastArtKey: parsed.lastArtKey, byKey: parsed.byKey ?? {} };
  } catch {
    return { byKey: {} };
  }
}

function writeStoreV3(store: DraftStoreV3): void {
  try {
    localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(store));
  } catch {
    /* 存储已满或不可用 */
  }
}

function readStoreV2(): DraftStoreV2 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return null;
    return JSON.parse(raw) as DraftStoreV2;
  } catch {
    return null;
  }
}

function readStoreV1(): DraftStoreV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return null;
    return JSON.parse(raw) as DraftStoreV1;
  } catch {
    return null;
  }
}

function emptyPixelGrid(): PixelGrid {
  const out: PixelGrid = [];
  for (let y = 0; y < ART_GRID_ROWS; y++) {
    out.push(Array.from({ length: ART_GRID_COLS }, () => null));
  }
  return out;
}

const LEGACY_GRID_SIZES: [number, number][] = [
  [200, 280],
  [100, 140],
  [50, 70],
  [25, 35],
];

function normalizeGrid(grid: PackedGrid | null | undefined): PackedGrid {
  const size = packedGridSize();
  if (!grid || grid.length === 0) return createPackedGrid();
  if (grid.length === size) return clonePackedGrid(grid);
  for (const [cols, rows] of LEGACY_GRID_SIZES) {
    if (grid.length === cols * rows) {
      return upscalePackedToArtSize(grid, cols, rows);
    }
  }
  return createPackedGrid();
}

function migrateV2Draft(key: PixelArtKey, v2: DraftStoreV2): PixelEditorDraft | null {
  const draft = v2.byKey[key];
  if (!draft?.layersB64?.length) return null;
  const layers = draft.layersB64.map((b64) => decodePackedBase64(b64));
  const merged = compositePackedGrids(layers, draft.layerVisible);
  return {
    grid: normalizeGrid(merged),
    highlight: createEmptyDisplayHighlight(),
    updatedAt: draft.updatedAt,
  };
}

function migrateV1Draft(key: PixelArtKey, v1: DraftStoreV1): PixelEditorDraft | null {
  const draft = v1.byKey[key];
  if (!draft?.layers?.length) return null;
  const layers = draft.layers.map((g) =>
    gridToPacked(g ? upscaleGridToArtSize(g) : emptyPixelGrid())
  );
  const merged = compositePackedGrids(layers, draft.layerVisible);
  return {
    grid: normalizeGrid(merged),
    highlight: createEmptyDisplayHighlight(),
    updatedAt: draft.updatedAt,
  };
}

export function getLastEditedArtKey(): PixelArtKey | null {
  const v3 = readStoreV3();
  if (v3.lastArtKey) return v3.lastArtKey;
  return readStoreV2()?.lastArtKey ?? readStoreV1()?.lastArtKey ?? null;
}

export function loadPixelEditorDraft(key: PixelArtKey): PixelEditorDraft | null {
  const stored = readStoreV3().byKey[key];
  if (stored?.gridB64) {
    return {
      grid: normalizeGrid(decodePackedBase64(stored.gridB64)),
      highlight: stored.highlightB64
        ? decodeDisplayHighlightBase64(stored.highlightB64)
        : createEmptyDisplayHighlight(),
      highlightBreathSpeed: stored.highlightBreathSpeed,
      updatedAt: stored.updatedAt,
    };
  }
  const v2 = readStoreV2();
  if (v2?.byKey[key]) return migrateV2Draft(key, v2);
  const v1 = readStoreV1();
  if (v1?.byKey[key]) return migrateV1Draft(key, v1);
  return null;
}

export function savePixelEditorDraft(
  key: PixelArtKey,
  grid: PackedGrid,
  highlight: DisplayHighlightGrid = createEmptyDisplayHighlight(),
  highlightBreathSpeed = 50
): void {
  const store = readStoreV3();
  store.lastArtKey = key;
  store.byKey[key] = {
    gridB64: encodePackedBase64(grid),
    highlightB64: encodeDisplayHighlightBase64(highlight),
    highlightBreathSpeed: Math.max(1, Math.min(100, Math.round(highlightBreathSpeed))),
    updatedAt: Date.now(),
  };
  writeStoreV3(store);
}
