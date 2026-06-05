/** 卡牌像素画逻辑网格（500×700，宽高比 5∶7，与内框一致） */
export const ART_GRID_COLS = 500;
export const ART_GRID_ROWS = 700;

export const ART_GRID_ASPECT = ART_GRID_COLS / ART_GRID_ROWS;

/**
 * 卡面/预览展示分辨率（75×105，5∶7）。
 * 每可见像素约对应 6–7 逻辑格，块感更强、更接近复古像素风。
 */
export const ART_DISPLAY_COLS = 75;
export const ART_DISPLAY_ROWS = 105;

/** 参考线主刻度间隔（格）；全网格线过密时用稀疏参考线 */
export const ART_GRID_MAJOR_STEP = 50;
