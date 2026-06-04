/** 区分点击与拖拽，用于场上角色打开详情 */
export function attachCardTap(el: HTMLElement, onTap: () => void): () => void {
  let sx = 0;
  let sy = 0;
  let pointerId = -1;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    sx = e.clientX;
    sy = e.clientY;
    pointerId = e.pointerId;
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const moved = Math.hypot(e.clientX - sx, e.clientY - sy);
    if (moved < 12) {
      e.stopPropagation();
      e.preventDefault();
      onTap();
    }
    pointerId = -1;
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };
}
