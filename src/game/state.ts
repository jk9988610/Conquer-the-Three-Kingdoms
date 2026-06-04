import {
  DEFAULT_SHOP_LISTINGS,
  STARTING_GOLD,
  characterBattleStats,
  defaultEnemyRoster,
} from './catalog';
import { applyLoadoutToStats, ensureLoadout } from './equipment';
import type { CardData, CardInstance, GamePhase, GameState } from './types';
import { emptyLoadout } from './types';

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
    inst.loadout = emptyLoadout();
  }
  return inst;
}

export function createInitialState(hand: CardData[]): GameState {
  const enemyRoster = defaultEnemyRoster().map((d) =>
    applyLoadoutToStats(ensureLoadout(createCardInstance(d, true)))
  );

  return {
    phase: 'prep',
    gold: STARTING_GOLD,
    shopListings: DEFAULT_SHOP_LISTINGS.map((s) => ({ ...s })),
    enemyRoster,
    zones: {
      hand: hand.map((d) => createCardInstance(d)),
      playerBattlefield: [],
      enemyBattlefield: [],
    },
  };
}

export function enterBattlePhase(state: GameState): GameState {
  return {
    ...state,
    phase: 'battle',
    zones: {
      ...state.zones,
      enemyBattlefield: state.enemyRoster.map((c) => ({ ...c })),
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

export function findOnPlayerField(
  state: GameState,
  instanceId: string
): CardInstance | undefined {
  return state.zones.playerBattlefield.find((c) => c.instanceId === instanceId);
}

export function updatePlayerCharacter(
  state: GameState,
  updated: CardInstance
): GameState {
  const list = state.zones.playerBattlefield.map((c) =>
    c.instanceId === updated.instanceId ? updated : c
  );
  return {
    ...state,
    zones: { ...state.zones, playerBattlefield: list },
  };
}
