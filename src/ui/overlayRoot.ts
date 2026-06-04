/** 拖拽幽灵：全屏时挂到全屏元素，否则 body */
export function getOverlayMount(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null) ?? document.body;
}

/** 居中弹层（角色详情、绘制器等）：始终挂 body，避免相对棋盘偏移 */
export function getModalOverlayMount(): HTMLElement {
  return document.body;
}
