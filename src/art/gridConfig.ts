/** 卡牌像素画逻辑网格（500×700，宽高比 5∶7，与内框一致） */
export const ART_GRID_COLS = 500;
export const ART_GRID_ROWS = 700;

export const ART_GRID_ASPECT = ART_GRID_COLS / ART_GRID_ROWS;

/**
 * 卡面/预览展示分辨率（100×140，5∶7）。
 * 每可见像素对应 5×5 逻辑格，在典型卡面内框约 2–3 CSS 像素/格，像素风清晰可辨。
 */
export const ART_DISPLAY_COLS = 100;
export const ART_DISPLAY_ROWS = 140;

/** 参考线主刻度间隔（格）；全网格线过密时用稀疏参考线 */
export const ART_GRID_MAJOR_STEP = 50;
