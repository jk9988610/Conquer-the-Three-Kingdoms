import type { CardData, CardInstance, GamePhase, GameState } from './types';

let instanceCounter = 0;

export function createCardInstance(data: CardData): CardInstance {
  instanceCounter += 1;
  return {
    instanceId: `inst-${instanceCounter}`,
    data,
  };
}

export function createInitialState(sampleHand: CardData[]): GameState {
  return {
    phase: 'prep',
    zones: {
      hand: sampleHand.map(createCardInstance),
      playerBattlefield: [],
      enemyBattlefield: [],
      shop: [
        createCardInstance({
          id: 'shop-guard',
          name: '守卫',
          tags: ['character'],
          description: '商店示例角色',
        }),
        createCardInstance({
          id: 'shop-merchant',
          name: '商贩',
          tags: ['character'],
          description: '商店示例角色',
        }),
      ],
    },
  };
}

/** 进入战斗阶段：上半区为敌方战场 */
export function enterBattlePhase(state: GameState): GameState {
  return {
    ...state,
    phase: 'battle',
    zones: {
      ...state.zones,
      enemyBattlefield: [...state.zones.enemyBattlefield],
      shop: [],
    },
  };
}

/**
 * 进入准备阶段：清空敌方战场，上半区转为商店区。
 */
export function enterPrepPhase(state: GameState, shopCards: CardData[] = []): GameState {
  return {
    ...state,
    phase: 'prep',
    zones: {
      ...state.zones,
      enemyBattlefield: [],
      shop:
        shopCards.length > 0
          ? shopCards.map(createCardInstance)
          : state.zones.shop.length > 0
            ? state.zones.shop
            : [
                createCardInstance({
                  id: 'shop-default',
                  name: '补给',
                  tags: ['character'],
                  description: '默认商店卡',
                }),
              ],
    },
  };
}

export function setPhase(state: GameState, phase: GamePhase): GameState {
  return phase === 'battle' ? enterBattlePhase(state) : enterPrepPhase(state);
}
