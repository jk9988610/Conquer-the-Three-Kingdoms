const CLICK_THRESHOLD_PX = 10;

export interface PointerDragOptions {
  source: HTMLElement;
  createGhost: (source: HTMLElement) => HTMLElement;
  onDrop: (clientX: number, clientY: number, isClick: boolean) => void;
  onMove?: (clientX: number, clientY: number) => void;
}

function dragMountRoot(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null) ?? document.body;
}

export function attachPointerDrag(options: PointerDragOptions): () => void {
  const { source, createGhost, onDrop, onMove } = options;
  let ghost: HTMLElement | null = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  const offset = { x: 0, y: 0 };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (source.classList.contains('tcg-card--sold-out')) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    source.setPointerCapture(e.pointerId);
    source.classList.add('tcg-card--dragging');

    ghost = createGhost(source);
    const mount = dragMountRoot();
    mount.append(ghost);
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      margin: '0',
    });

    const rect = source.getBoundingClientRect();
    offset.x = e.clientX - rect.left;
    offset.y = e.clientY - rect.top;
    moveGhost(e.clientX, e.clientY);
  };

  const moveGhost = (cx: number, cy: number) => {
    if (!ghost) return;
    ghost.style.left = `${cx - offset.x}px`;
    ghost.style.top = `${cy - offset.y}px`;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    onMove?.(e.clientX, e.clientY);
  };

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    source.classList.remove('tcg-card--dragging');
    try {
      source.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const isClick = Math.hypot(dx, dy) < CLICK_THRESHOLD_PX;

    ghost?.remove();
    ghost = null;

    onDrop(e.clientX, e.clientY, isClick);
  };

  source.addEventListener('pointerdown', onPointerDown);
  source.addEventListener('pointermove', onPointerMove);
  source.addEventListener('pointerup', endDrag);
  source.addEventListener('pointercancel', endDrag);
  source.addEventListener('contextmenu', (e) => e.preventDefault());

  return () => {
    source.removeEventListener('pointerdown', onPointerDown);
    source.removeEventListener('pointermove', onPointerMove);
    source.removeEventListener('pointerup', endDrag);
    source.removeEventListener('pointercancel', endDrag);
    ghost?.remove();
  };
}
