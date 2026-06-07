/** 标准 TCG 卡牌尺寸（宽 63.5 × 高 88.9） */
export const TCG_WIDTH = 63.5;
export const TCG_HEIGHT = 88.9;
export const TCG_ASPECT_RATIO = TCG_WIDTH / TCG_HEIGHT;

/** 内框边距：四边 3% */
export const INNER_MARGIN_X_RATIO = 0.03;
export const INNER_MARGIN_Y_RATIO = 0.03;

/** 内框（图像区）宽高比，与卡面图像画布一致 */
export const INNER_ASPECT_RATIO =
  (TCG_WIDTH * (1 - 2 * INNER_MARGIN_X_RATIO)) /
  (TCG_HEIGHT * (1 - 2 * INNER_MARGIN_Y_RATIO));

import { ART_DISPLAY_COLS, ART_DISPLAY_ROWS } from '../art/gridConfig';

/** 像素画编辑器预览区 CSS 尺寸上限（展示 60×84 像素格，5∶7，每格 2px） */
export const ART_PREVIEW_WIDTH = ART_DISPLAY_COLS * 2;

export const ART_PREVIEW_HEIGHT = Math.round(
  (ART_PREVIEW_WIDTH * ART_DISPLAY_ROWS) / ART_DISPLAY_COLS
);

export interface TcgScaledSize {
  cardWidth: number;
  cardHeight: number;
  scale: number;
  innerFrame: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export function scaleTcgToFit(
  maxCardHeight: number,
  maxCardWidth?: number
): TcgScaledSize {
  let cardHeight = maxCardHeight;
  let cardWidth = cardHeight * TCG_ASPECT_RATIO;

  if (maxCardWidth !== undefined && cardWidth > maxCardWidth) {
    cardWidth = maxCardWidth;
    cardHeight = cardWidth / TCG_ASPECT_RATIO;
  }

  const scale = cardHeight / TCG_HEIGHT;
  const innerLeft = cardWidth * INNER_MARGIN_X_RATIO;
  const innerTop = cardHeight * INNER_MARGIN_Y_RATIO;
  const innerWidth = cardWidth * (1 - 2 * INNER_MARGIN_X_RATIO);
  const innerHeight = cardHeight * (1 - 2 * INNER_MARGIN_Y_RATIO);

  return {
    cardWidth,
    cardHeight,
    scale,
    innerFrame: {
      left: innerLeft,
      top: innerTop,
      width: innerWidth,
      height: innerHeight,
    },
  };
}
