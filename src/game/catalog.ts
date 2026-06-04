import type { CardData, ShopListing } from './types';

export const CARD_LIU: CardData = {
  id: 'char-liu',
  name: '刘备',
  tags: ['character'],
  description: '仁德之主',
  artKey: 'liu',
};

export const CARD_GUAN: CardData = {
  id: 'char-guan',
  name: '关羽',
  tags: ['character'],
  description: '武圣',
  artKey: 'guan',
};

export const CARD_ZHANG: CardData = {
  id: 'char-zhang',
  name: '张飞',
  tags: ['character'],
  description: '万夫不当',
  artKey: 'zhang',
};

export const CARD_LVBU: CardData = {
  id: 'char-lvbu',
  name: '吕布',
  tags: ['character'],
  description: '飞将，武力绝伦',
  artKey: 'lvbu',
};

export const CARD_HEAL_POTION: CardData = {
  id: 'item-heal-potion',
  name: '治疗药水',
  tags: ['item'],
  description: '选中角色治疗20点生命值',
  artKey: 'heal-potion',
  price: 30,
};

export const CARD_ATTACK_RED: CardData = {
  id: 'action-attack-red',
  name: '赤刃斩',
  tags: ['action'],
  actionKind: 'attack',
  description: '攻击力等于己方所有角色攻击力的最高值',
  artKey: 'attack-red',
};

export const CARD_ATTACK_ORANGE: CardData = {
  id: 'action-attack-orange',
  name: '烈阳突击',
  tags: ['action'],
  actionKind: 'attack',
  description: '攻击力等于己方所有角色攻击力的最高值',
  artKey: 'attack-orange',
};

export const CARD_ATTACK_PURPLE: CardData = {
  id: 'action-attack-purple',
  name: '紫电一击',
  tags: ['action'],
  actionKind: 'attack',
  description: '攻击力等于己方所有角色攻击力的最高值',
  artKey: 'attack-purple',
};

export const CARD_FANGTIAN: CardData = {
  id: 'equip-fangtian',
  name: '方天画戟',
  tags: ['equipment'],
  description: '增加10点角色攻击力',
  artKey: 'fangtian',
  price: 100,
  equipSlot: 'weapon',
  attackBonus: 10,
};

export const DEFAULT_SHOP_LISTINGS: ShopListing[] = [
  { template: CARD_HEAL_POTION, stock: 1 },
  { template: CARD_FANGTIAN, stock: 1 },
];

export const STARTING_GOLD = 1000;

export function defaultPlayerHand(): CardData[] {
  return [
    CARD_LVBU,
    CARD_ATTACK_RED,
    CARD_ATTACK_ORANGE,
    CARD_ATTACK_PURPLE,
  ];
}

/** 己方场上角色攻击力的最高值（攻击牌伤害依据） */
export function maxAllyAttack(state: { zones: { playerBattlefield: { stats?: { attack: number } }[] } }): number {
  let max = 0;
  for (const c of state.zones.playerBattlefield) {
    const atk = c.stats?.attack ?? 0;
    if (atk > max) max = atk;
  }
  return max;
}

export function defaultEnemyRoster(): CardData[] {
  return [CARD_GUAN, CARD_LIU, CARD_ZHANG];
}

export function characterBattleStats(data: CardData): {
  maxHp: number;
  hp: number;
  attack: number;
  baseAttack: number;
} {
  const baseAttack =
    data.id === 'char-lvbu' ? 12 : data.id === 'char-zhang' ? 9 : 7;
  const maxHp = data.id === 'char-lvbu' ? 30 : 25;
  return { maxHp, hp: maxHp, attack: baseAttack, baseAttack };
}
