/** 标准 TCG 卡牌尺寸（宽 63.5 × 高 88.9） */
export const TCG_WIDTH = 63.5;
export const TCG_HEIGHT = 88.9;
export const TCG_ASPECT_RATIO = TCG_WIDTH / TCG_HEIGHT;

/** 内框边距：左右 3%，上下 4% */
export const INNER_MARGIN_X_RATIO = 0.03;
export const INNER_MARGIN_Y_RATIO = 0.04;

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
