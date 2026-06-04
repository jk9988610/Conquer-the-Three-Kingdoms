/** 卡牌标签：当前实现角色，预留动作与物品 */
export type CardTag = 'character' | 'action' | 'item';

export type GamePhase = 'prep' | 'battle';

export interface CardData {
  id: string;
  name: string;
  tags: CardTag[];
  /** 角色卡展示用简短描述 */
  description?: string;
}

export interface CardInstance {
  instanceId: string;
  data: CardData;
}

export interface GameZones {
  /** 我方手牌 */
  hand: CardInstance[];
  /** 我方战场（场上下半区） */
  playerBattlefield: CardInstance[];
  /** 敌方战场（场上上半区，战斗阶段） */
  enemyBattlefield: CardInstance[];
  /** 商店区（准备阶段，与敌方战场共用上半区） */
  shop: CardInstance[];
}

export interface GameState {
  phase: GamePhase;
  zones: GameZones;
}
