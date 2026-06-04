import type { CardInstance, GameState } from './types';

export type PlayCardResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

/**
 * 将手牌中的角色卡打出到我方战场。
 * 动作卡、物品卡将在后续扩展。
 */
export function playCharacterFromHand(
  state: GameState,
  instanceId: string
): PlayCardResult {
  const index = state.zones.hand.findIndex((c) => c.instanceId === instanceId);
  if (index === -1) {
    return { ok: false, reason: '手牌中未找到该卡牌' };
  }

  const card = state.zones.hand[index];
  if (!card.data.tags.includes('character')) {
    return { ok: false, reason: '当前仅支持打出标签为「角色」的卡牌' };
  }

  const hand = [...state.zones.hand];
  hand.splice(index, 1);

  return {
    ok: true,
    state: {
      ...state,
      zones: {
        ...state.zones,
        hand,
        playerBattlefield: [...state.zones.playerBattlefield, card],
      },
    },
  };
}

export function findCardInHand(
  state: GameState,
  instanceId: string
): CardInstance | undefined {
  return state.zones.hand.find((c) => c.instanceId === instanceId);
}
