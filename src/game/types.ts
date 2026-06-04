/** 卡牌标签 */
export type CardTag = 'character' | 'action' | 'item' | 'equipment';

export type GamePhase = 'prep' | 'battle';

/** 像素画标识，由程序绘制 */
export type PixelArtKey =
  | 'generic'
  | 'lvbu'
  | 'liu'
  | 'guan'
  | 'zhang'
  | 'heal-potion'
  | 'fangtian';

export interface CardData {
  id: string;
  name: string;
  tags: CardTag[];
  description?: string;
  artKey?: PixelArtKey;
  /** 商店售价（仅商店陈列） */
  price?: number;
}

export interface BattleStats {
  maxHp: number;
  hp: number;
  attack: number;
}

export interface CardInstance {
  instanceId: string;
  data: CardData;
  /** 上场后的角色数值（预留装备加成等） */
  stats?: BattleStats;
}

export interface ShopListing {
  template: CardData;
  /** 库存 -1 表示无限 */
  stock: number;
}

export interface GameZones {
  hand: CardInstance[];
  playerBattlefield: CardInstance[];
  enemyBattlefield: CardInstance[];
  shop: CardInstance[];
}

export interface GameState {
  phase: GamePhase;
  gold: number;
  zones: GameZones;
  /** 商店可购列表（准备阶段） */
  shopListings: ShopListing[];
}
