/** 标准 TCG 卡牌尺寸（宽 63 × 高 88，单位可为 mm 或逻辑像素） */
export const TCG_WIDTH = 63;
export const TCG_HEIGHT = 88;
export const TCG_ASPECT_RATIO = TCG_WIDTH / TCG_HEIGHT;

/** 内框边距：左右 3%，上下 4% */
export const INNER_MARGIN_X_RATIO = 0.03;
export const INNER_MARGIN_Y_RATIO = 0.04;

export interface TcgScaledSize {
  /** 当前缩放后的卡牌宽度（px） */
  cardWidth: number;
  /** 当前缩放后的卡牌高度（px） */
  cardHeight: number;
  /** 统一缩放系数（相对标准尺寸） */
  scale: number;
  /** 内框区域（相对卡牌左上角的像素偏移与尺寸） */
  innerFrame: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

/**
 * 根据可用高度计算等比例缩放的 TCG 卡牌尺寸，保持 63:88 比例。
 */
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
