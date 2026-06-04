import {
  DEFAULT_SHOP_LISTINGS,
  STARTING_GOLD,
  characterBattleStats,
} from './catalog';
import type { CardData, CardInstance, GamePhase, GameState } from './types';

let instanceCounter = 0;

export function createCardInstance(
  data: CardData,
  withStats = false
): CardInstance {
  instanceCounter += 1;
  const inst: CardInstance = {
    instanceId: `inst-${instanceCounter}`,
    data,
  };
  if (withStats && data.tags.includes('character')) {
    inst.stats = characterBattleStats(data);
  }
  return inst;
}

export function createInitialState(hand: CardData[]): GameState {
  return {
    phase: 'prep',
    gold: STARTING_GOLD,
    shopListings: DEFAULT_SHOP_LISTINGS.map((s) => ({ ...s })),
    zones: {
      hand: hand.map((d) => createCardInstance(d)),
      playerBattlefield: [],
      enemyBattlefield: [],
      shop: [],
    },
  };
}

export function enterBattlePhase(state: GameState): GameState {
  return {
    ...state,
    phase: 'battle',
    zones: {
      ...state.zones,
      shop: [],
    },
  };
}

export function enterPrepPhase(state: GameState): GameState {
  return {
    ...state,
    phase: 'prep',
    zones: {
      ...state.zones,
      enemyBattlefield: [],
      shop: [],
    },
    shopListings:
      state.shopListings.length > 0
        ? state.shopListings
        : DEFAULT_SHOP_LISTINGS.map((s) => ({ ...s })),
  };
}

export function setPhase(state: GameState, phase: GamePhase): GameState {
  return phase === 'battle' ? enterBattlePhase(state) : enterPrepPhase(state);
}
