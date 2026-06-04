/** 拖拽幽灵：全屏时挂到全屏元素，否则 body */
export function getOverlayMount(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null) ?? document.body;
}

/** 居中弹层：全屏时挂到全屏元素内，否则 body（与拖拽幽灵一致，避免全屏下不可见） */
export function getModalOverlayMount(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null) ?? document.body;
}
