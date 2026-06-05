import type { PixelArtKey } from '../game/types';
import type { PixelGrid } from './pixelArt';
import { ART_GRID_COLS, ART_GRID_ROWS } from './gridConfig';
import {
  clonePackedGrid,
  createPackedGrid,
  decodePackedBase64,
  encodePackedBase64,
  gridToPacked,
  packedGridSize,
  type PackedGrid,
} from './packedGrid';
import { upscaleGridToArtSize } from './pixelArt';

const STORAGE_KEY_V2 = 'tcg-pixel-editor-drafts-v2';
const STORAGE_KEY_V1 = 'tcg-pixel-editor-drafts-v1';
const LAYER_COUNT = 3;

export interface PixelEditorDraft {
  layers: PackedGrid[];
  layerVisible: boolean[];
  updatedAt: number;
}

interface DraftStoreV2 {
  lastArtKey?: PixelArtKey;
  byKey: Partial<
    Record<
      PixelArtKey,
      {
        layersB64: string[];
        layerVisible: boolean[];
        updatedAt: number;
      }
    >
  >;
}

interface DraftStoreV1 {
  lastArtKey?: PixelArtKey;
  byKey: Partial<
    Record<
      PixelArtKey,
      {
        layers: PixelGrid[];
        layerVisible: boolean[];
        updatedAt: number;
      }
    >
  >;
}

function readStoreV2(): DraftStoreV2 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return { byKey: {} };
    const parsed = JSON.parse(raw) as DraftStoreV2;
    return { lastArtKey: parsed.lastArtKey, byKey: parsed.byKey ?? {} };
  } catch {
    return { byKey: {} };
  }
}

function writeStoreV2(store: DraftStoreV2): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(store));
  } catch {
    /* 存储已满或不可用 */
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

function emptyPackedLayer(): PackedGrid {
  return createPackedGrid();
}

function normalizeDraftLayers(layers: PackedGrid[]): PackedGrid[] {
  const out: PackedGrid[] = [];
  const size = packedGridSize();
  for (let i = 0; i < LAYER_COUNT; i++) {
    const g = layers[i];
    out.push(g && g.length === size ? clonePackedGrid(g) : emptyPackedLayer());
  }
  return out;
}

function emptyPixelGrid(): PixelGrid {
  const out: PixelGrid = [];
  for (let y = 0; y < ART_GRID_ROWS; y++) {
    out.push(Array.from({ length: ART_GRID_COLS }, () => null));
  }
  return out;
}

function migrateV1Draft(key: PixelArtKey, v1: DraftStoreV1): PixelEditorDraft | null {
  const draft = v1.byKey[key];
  if (!draft?.layers?.length) return null;
  const layers = draft.layers.map((g) =>
    gridToPacked(g ? upscaleGridToArtSize(g) : emptyPixelGrid())
  );
  return {
    layers: normalizeDraftLayers(layers),
    layerVisible:
      draft.layerVisible?.length === LAYER_COUNT
        ? [...draft.layerVisible]
        : [true, true, true],
    updatedAt: draft.updatedAt,
  };
}

export function getLastEditedArtKey(): PixelArtKey | null {
  const v2 = readStoreV2();
  if (v2.lastArtKey) return v2.lastArtKey;
  return readStoreV1()?.lastArtKey ?? null;
}

export function loadPixelEditorDraft(key: PixelArtKey): PixelEditorDraft | null {
  const stored = readStoreV2().byKey[key];
  if (stored?.layersB64?.length) {
    const layers = stored.layersB64.map((b64) => decodePackedBase64(b64));
    return {
      layers: normalizeDraftLayers(layers),
      layerVisible:
        stored.layerVisible?.length === LAYER_COUNT
          ? [...stored.layerVisible]
          : [true, true, true],
      updatedAt: stored.updatedAt,
    };
  }

  const v1 = readStoreV1();
  if (v1) return migrateV1Draft(key, v1);

  return null;
}

export function savePixelEditorDraft(
  key: PixelArtKey,
  layers: PackedGrid[],
  layerVisible: boolean[]
): void {
  const store = readStoreV2();
  store.lastArtKey = key;
  store.byKey[key] = {
    layersB64: layers.map((g) => encodePackedBase64(g)),
    layerVisible: [...layerVisible],
    updatedAt: Date.now(),
  };
  writeStoreV2(store);
}
