/** 全屏时挂载到全屏元素，否则 body（弹层/拖拽幽灵可见） */
export function getOverlayMount(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null) ?? document.body;
}
