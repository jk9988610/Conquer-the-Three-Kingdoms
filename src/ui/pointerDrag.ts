/**
 * 指针拖拽（兼容触摸），避免 HTML5 draggable 与长按选中文本冲突。
 */
export interface PointerDragOptions {
  source: HTMLElement;
  instanceId: string;
  onDrop: (instanceId: string) => void;
  getDropZone: () => HTMLElement | null;
  createGhost: (source: HTMLElement) => HTMLElement;
}

export function attachPointerDrag(options: PointerDragOptions): () => void {
  const { source, instanceId, onDrop, getDropZone, createGhost } = options;
  let ghost: HTMLElement | null = null;
  let dragging = false;
  const offset = { x: 0, y: 0 };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    source.setPointerCapture(e.pointerId);
    source.classList.add('tcg-card--dragging');

    ghost = createGhost(source);
    document.body.append(ghost);
    const rect = source.getBoundingClientRect();
    offset.x = e.clientX - rect.left;
    offset.y = e.clientY - rect.top;
    moveGhost(e.clientX, e.clientY);
    highlightZone(true);
  };

  const moveGhost = (cx: number, cy: number) => {
    if (!ghost) return;
    ghost.style.left = `${cx - offset.x}px`;
    ghost.style.top = `${cy - offset.y}px`;
  };

  const highlightZone = (active: boolean) => {
    const zone = getDropZone();
    if (!zone) return;
    zone.classList.toggle('zone__cards--drag-over', active);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    const zone = getDropZone();
    if (!zone) return;
    const r = zone.getBoundingClientRect();
    const inside =
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom;
    zone.classList.toggle('zone__cards--drag-over', inside);
  };

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    source.classList.remove('tcg-card--dragging');
    try {
      source.releasePointerCapture(e.pointerId);
    } catch {
      /* 已释放 */
    }

    const zone = getDropZone();
    let dropped = false;
    if (zone) {
      const r = zone.getBoundingClientRect();
      dropped =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
      zone.classList.remove('zone__cards--drag-over');
    }

    ghost?.remove();
    ghost = null;

    if (dropped) onDrop(instanceId);
  };

  const onPointerUp = (e: PointerEvent) => endDrag(e);
  const onPointerCancel = (e: PointerEvent) => endDrag(e);

  source.addEventListener('pointerdown', onPointerDown);
  source.addEventListener('pointermove', onPointerMove);
  source.addEventListener('pointerup', onPointerUp);
  source.addEventListener('pointercancel', onPointerCancel);
  source.addEventListener('contextmenu', (e) => e.preventDefault());

  return () => {
    source.removeEventListener('pointerdown', onPointerDown);
    source.removeEventListener('pointermove', onPointerMove);
    source.removeEventListener('pointerup', onPointerUp);
    source.removeEventListener('pointercancel', onPointerCancel);
    ghost?.remove();
  };
}
