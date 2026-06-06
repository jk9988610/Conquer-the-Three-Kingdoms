import {
  sampleImageWithCrop,
  type ImageCropParams,
} from '../art/imageToGrid';
import type { PixelGrid } from '../art/pixelArt';
import { getModalOverlayMount } from './overlayRoot';

export interface ImageImportModalOptions {
  image: HTMLImageElement;
  cols: number;
  rows: number;
  onConfirm: (grid: PixelGrid) => void;
  onCancel?: () => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

type ImportOverlay = HTMLElement & {
  __importRo?: ResizeObserver;
  __importTeardown?: () => void;
};

export function closeImageImportModal(): void {
  const overlay = document.querySelector<ImportOverlay>('[data-modal="image-import"]');
  overlay?.__importRo?.disconnect();
  overlay?.__importTeardown?.();
  overlay?.remove();
}

export function openImageImportModal(options: ImageImportModalOptions): void {
  closeImageImportModal();

  const { image, cols, rows, onConfirm, onCancel } = options;
  const aspect = cols / rows;
  const nw = image.naturalWidth;
  const nh = image.naturalHeight;

  const overlay = document.createElement('div') as ImportOverlay;
  overlay.className = 'img-import-overlay';
  overlay.dataset.modal = 'image-import';

  const modal = document.createElement('div');
  modal.className = 'img-import-modal';
  modal.innerHTML = `
    <header class="img-import-modal__head">
      <h3 class="img-import-modal__title">调整导入区域</h3>
      <p class="img-import-modal__hint">单指拖动图片，双指缩放；虚线框内为画布范围</p>
    </header>
    <div class="img-import-modal__viewport" data-viewport>
      <div class="img-import-modal__stage" data-stage></div>
      <div class="img-import-modal__frame" data-frame></div>
    </div>
    <footer class="img-import-modal__actions">
      <button type="button" class="btn" data-cancel>取消</button>
      <button type="button" class="btn" data-confirm>确定</button>
    </footer>
  `;

  const viewport = modal.querySelector<HTMLElement>('[data-viewport]')!;
  const stage = modal.querySelector<HTMLElement>('[data-stage]')!;

  image.className = 'img-import-modal__img';
  image.draggable = false;
  stage.append(image);

  let panX = 0;
  let panY = 0;
  let userScale = 1;
  let baseScale = 1;
  let frameLeft = 0;
  let frameTop = 0;
  let frameWidth = 0;
  let frameHeight = 0;
  let viewportW = 0;
  let viewportH = 0;

  const pointers = new Map<number, { x: number; y: number }>();
  let lastPinchDist = 0;
  let lastPinchMid: { x: number; y: number } | null = null;

  function layoutFrame(): void {
    const rect = viewport.getBoundingClientRect();
    viewportW = rect.width;
    viewportH = rect.height;
    if (viewportW < 8 || viewportH < 8) return;

    const pad = 16;
    const maxW = viewportW - pad * 2;
    const maxH = viewportH - pad * 2;
    if (maxW / maxH > aspect) {
      frameHeight = maxH;
      frameWidth = maxH * aspect;
    } else {
      frameWidth = maxW;
      frameHeight = maxW / aspect;
    }
    frameLeft = (viewportW - frameWidth) / 2;
    frameTop = (viewportH - frameHeight) / 2;

    const frameEl = modal.querySelector<HTMLElement>('[data-frame]')!;
    frameEl.style.left = `${frameLeft}px`;
    frameEl.style.top = `${frameTop}px`;
    frameEl.style.width = `${frameWidth}px`;
    frameEl.style.height = `${frameHeight}px`;

    baseScale = Math.max(frameWidth / nw, frameHeight / nh);
    applyTransform();
  }

  function applyTransform(): void {
    const baseW = nw * baseScale;
    const baseH = nh * baseScale;
    image.style.width = `${baseW}px`;
    image.style.height = `${baseH}px`;
    image.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${userScale})`;
  }

  function getCropParams(): ImageCropParams {
    return {
      panX,
      panY,
      userScale,
      baseScale,
      frameLeft,
      frameTop,
      frameWidth,
      frameHeight,
      viewportWidth: viewportW,
      viewportHeight: viewportH,
    };
  }

  function finishConfirm(): void {
    if (frameWidth < 1 || frameHeight < 1) {
      layoutFrame();
      if (frameWidth < 1) return;
    }
    onConfirm(sampleImageWithCrop(image, cols, rows, getCropParams()));
    closeImageImportModal();
  }

  function finishCancel(): void {
    onCancel?.();
    closeImageImportModal();
  }

  viewport.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      lastPinchMid = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
    } else {
      lastPinchDist = 0;
      lastPinchMid = null;
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    const prev = pointers.get(e.pointerId)!;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      panX += e.clientX - prev.x;
      panY += e.clientY - prev.y;
      applyTransform();
      return;
    }

    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const vRect = viewport.getBoundingClientRect();
      const anchorX = midX - vRect.left - viewportW / 2;
      const anchorY = midY - vRect.top - viewportH / 2;

      if (lastPinchDist > 0) {
        const factor = dist / lastPinchDist;
        const nextScale = clamp(userScale * factor, 0.12, 14);
        const ratio = nextScale / userScale;
        panX = anchorX - (anchorX - panX) * ratio;
        panY = anchorY - (anchorY - panY) * ratio;
        userScale = nextScale;
      }
      if (lastPinchMid) {
        panX += midX - lastPinchMid.x;
        panY += midY - lastPinchMid.y;
      }
      lastPinchDist = dist;
      lastPinchMid = { x: midX, y: midY };
      applyTransform();
    }
  });

  const onPointerEnd = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      lastPinchDist = 0;
      lastPinchMid = null;
    }
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  viewport.addEventListener('pointerup', onPointerEnd);
  viewport.addEventListener('pointercancel', onPointerEnd);

  modal.querySelector('[data-confirm]')?.addEventListener('click', finishConfirm);
  modal.querySelector('[data-cancel]')?.addEventListener('click', finishCancel);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) finishCancel();
  });
  modal.addEventListener('click', (e) => e.stopPropagation());

  const blockBrowserGesture = (e: Event) => {
    e.preventDefault();
  };
  const blockWheel = (e: WheelEvent) => {
    e.preventDefault();
  };
  const gestureTargets = [overlay, modal, viewport];
  for (const el of gestureTargets) {
    el.addEventListener('touchstart', blockBrowserGesture, { passive: false });
    el.addEventListener('touchmove', blockBrowserGesture, { passive: false });
    el.addEventListener('gesturestart', blockBrowserGesture, { passive: false });
    el.addEventListener('gesturechange', blockBrowserGesture, { passive: false });
    el.addEventListener('wheel', blockWheel, { passive: false });
  }

  overlay.append(modal);
  getModalOverlayMount().append(overlay);

  const ro = new ResizeObserver(() => layoutFrame());
  ro.observe(viewport);
  overlay.__importRo = ro;
  overlay.__importTeardown = () => {
    for (const el of gestureTargets) {
      el.removeEventListener('touchstart', blockBrowserGesture);
      el.removeEventListener('touchmove', blockBrowserGesture);
      el.removeEventListener('gesturestart', blockBrowserGesture);
      el.removeEventListener('gesturechange', blockBrowserGesture);
      el.removeEventListener('wheel', blockWheel);
    }
  };

  requestAnimationFrame(() => {
    layoutFrame();
    requestAnimationFrame(layoutFrame);
  });
}
