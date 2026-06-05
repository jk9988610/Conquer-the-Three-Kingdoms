import type { PixelArtKey } from '../game/types';
import type { PixelGrid } from './pixelArt';
import { ART_GRID_COLS, ART_GRID_ROWS } from './gridConfig';
import { upscaleGridToArtSize } from './pixelArt';

const STORAGE_KEY = 'tcg-pixel-editor-drafts-v1';
const LAYER_COUNT = 3;

export interface PixelEditorDraft {
  layers: PixelGrid[];
  layerVisible: boolean[];
  updatedAt: number;
}

interface DraftStore {
  lastArtKey?: PixelArtKey;
  byKey: Partial<Record<PixelArtKey, PixelEditorDraft>>;
}

function readStore(): DraftStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { byKey: {} };
    const parsed = JSON.parse(raw) as DraftStore;
    return { lastArtKey: parsed.lastArtKey, byKey: parsed.byKey ?? {} };
  } catch {
    return { byKey: {} };
  }
}

function writeStore(store: DraftStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* 存储已满或不可用 */
  }
}

function normalizeDraftLayers(layers: PixelGrid[]): PixelGrid[] {
  const out: PixelGrid[] = [];
  for (let i = 0; i < LAYER_COUNT; i++) {
    const g = layers[i];
    out.push(g ? upscaleGridToArtSize(g) : emptyGrid());
  }
  return out;
}

function emptyGrid(): PixelGrid {
  const out: PixelGrid = [];
  for (let y = 0; y < ART_GRID_ROWS; y++) {
    out.push(Array.from({ length: ART_GRID_COLS }, () => null));
  }
  return out;
}

export function getLastEditedArtKey(): PixelArtKey | null {
  const { lastArtKey } = readStore();
  return lastArtKey ?? null;
}

export function loadPixelEditorDraft(key: PixelArtKey): PixelEditorDraft | null {
  const draft = readStore().byKey[key];
  if (!draft?.layers?.length) return null;
  return {
    layers: normalizeDraftLayers(draft.layers),
    layerVisible: draft.layerVisible?.length === LAYER_COUNT
      ? [...draft.layerVisible]
      : [true, true, true],
    updatedAt: draft.updatedAt,
  };
}

export function savePixelEditorDraft(
  key: PixelArtKey,
  layers: PixelGrid[],
  layerVisible: boolean[]
): void {
  const store = readStore();
  store.lastArtKey = key;
  store.byKey[key] = {
    layers: layers.map((g) => g.map((row) => [...row])),
    layerVisible: [...layerVisible],
    updatedAt: Date.now(),
  };
  writeStore(store);
}
