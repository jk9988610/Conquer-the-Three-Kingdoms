/** 游戏 UI 根：全屏时为 .game-board，否则为 #app */
export function getAppShell(): HTMLElement {
  const fs = document.fullscreenElement as HTMLElement | null;
  if (fs) return fs;
  return document.getElementById('app') ?? document.body;
}

/** 拖拽幽灵等浮层挂载点（与弹层一致，避免全屏/非全屏两套树） */
export function getOverlayMount(): HTMLElement {
  return getAppShell();
}

/** 居中弹层挂载点 */
export function getModalOverlayMount(): HTMLElement {
  return getAppShell();
}

const FLOATING_SELECTORS = [
  '[data-modal]',
  '.card-brief-layer',
] as const;

/** 全屏切换后把已打开的浮层移回当前 shell，避免留在 body 上不可点或不可见 */
export function reparentFloatingLayers(): void {
  const mount = getModalOverlayMount();
  for (const sel of FLOATING_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (el.parentElement !== mount) mount.append(el);
    });
  }
}

document.addEventListener('fullscreenchange', reparentFloatingLayers);
