import { scaleTcgToFit, type TcgScaledSize } from '../tcg/dimensions';

/** 根据固定区域内容区计算卡牌尺寸（各区域一致） */
export function cardSizeForZone(zoneContent: HTMLElement): TcgScaledSize {
  const h = zoneContent.clientHeight;
  const w = zoneContent.clientWidth;
  const maxH = Math.max(80, h * 0.9);
  const maxW = Math.max(50, w * 0.38);
  return scaleTcgToFit(maxH, maxW);
}
