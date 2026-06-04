/** 卡牌标签 */
export type CardTag = 'character' | 'action' | 'item' | 'equipment';

export type GamePhase = 'prep' | 'battle';

export type SlotKind = 'weapon' | 'vehicle' | 'accessory';

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
  price?: number;
  /** 装备占用的槽位类型 */
  equipSlot?: SlotKind;
  attackBonus?: number;
}

export interface BattleStats {
  maxHp: number;
  hp: number;
  attack: number;
  /** 基础攻击（未含装备） */
  baseAttack: number;
}

export interface EquippedEntry {
  instanceId: string;
  data: CardData;
}

export interface CharacterLoadout {
  weapons: [EquippedEntry | null, EquippedEntry | null, EquippedEntry | null];
  vehicle: EquippedEntry | null;
  accessories: [EquippedEntry | null, EquippedEntry | null];
}

export function emptyLoadout(): CharacterLoadout {
  return {
    weapons: [null, null, null],
    vehicle: null,
    accessories: [null, null],
  };
}

export interface CardInstance {
  instanceId: string;
  data: CardData;
  stats?: BattleStats;
  loadout?: CharacterLoadout;
}

export interface ShopListing {
  template: CardData;
  stock: number;
}

export interface GameZones {
  hand: CardInstance[];
  playerBattlefield: CardInstance[];
  enemyBattlefield: CardInstance[];
}

export interface GameState {
  phase: GamePhase;
  gold: number;
  zones: GameZones;
  shopListings: ShopListing[];
  /** 战斗阶段从名册恢复敌方单位 */
  enemyRoster: CardInstance[];
}
