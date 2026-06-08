import type { PixelArtKey } from '../game/types';
import {
  cloneDisplayHighlight,
  createEmptyDisplayHighlight,
  decodeDisplayHighlightBase64,
  encodeDisplayHighlightBase64,
  type DisplayHighlightGrid,
} from './displayHighlight';
import { setCustomArtHighlight } from './pixelArt';

export const ART_META_VERSION = 1 as const;

export interface ArtCardMetaV1 {
  version: typeof ART_META_VERSION;
  artKey: PixelArtKey;
  highlightB64?: string;
  highlightBreathSpeed?: number;
  animations?: Record<string, unknown>;
}

export function createArtCardMeta(
  artKey: PixelArtKey,
  highlight: DisplayHighlightGrid,
  highlightBreathSpeed = 50,
  animations?: Record<string, unknown>
): ArtCardMetaV1 {
  const meta: ArtCardMetaV1 = {
    version: ART_META_VERSION,
    artKey,
    highlightBreathSpeed: Math.max(1, Math.min(100, Math.round(highlightBreathSpeed))),
  };
  if (hasAnyHighlightData(highlight)) {
    meta.highlightB64 = encodeDisplayHighlightBase64(highlight);
  }
  if (animations && Object.keys(animations).length > 0) {
    meta.animations = animations;
  }
  return meta;
}

function hasAnyHighlightData(highlight: DisplayHighlightGrid): boolean {
  for (let i = 0; i < highlight.length; i++) {
    if (highlight[i]! !== 0) return true;
  }
  return false;
}

export function applyArtCardMeta(meta: ArtCardMetaV1): void {
  const highlight = meta.highlightB64
    ? decodeDisplayHighlightBase64(meta.highlightB64)
    : createEmptyDisplayHighlight();
  setCustomArtHighlight(meta.artKey, highlight, meta.highlightBreathSpeed ?? 50);
}

export function parseArtCardMeta(raw: unknown): ArtCardMetaV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<ArtCardMetaV1>;
  if (obj.version !== ART_META_VERSION || typeof obj.artKey !== 'string') return null;
  return {
    version: ART_META_VERSION,
    artKey: obj.artKey as PixelArtKey,
    highlightB64: typeof obj.highlightB64 === 'string' ? obj.highlightB64 : undefined,
    highlightBreathSpeed:
      typeof obj.highlightBreathSpeed === 'number' ? obj.highlightBreathSpeed : undefined,
    animations:
      obj.animations && typeof obj.animations === 'object'
        ? (obj.animations as Record<string, unknown>)
        : undefined,
  };
}

export function cloneArtCardMeta(meta: ArtCardMetaV1): ArtCardMetaV1 {
  return {
    ...meta,
    animations: meta.animations ? { ...meta.animations } : undefined,
  };
}

export function highlightFromArtMeta(meta: ArtCardMetaV1): DisplayHighlightGrid {
  return meta.highlightB64
    ? cloneDisplayHighlight(decodeDisplayHighlightBase64(meta.highlightB64))
    : createEmptyDisplayHighlight();
}

export function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
