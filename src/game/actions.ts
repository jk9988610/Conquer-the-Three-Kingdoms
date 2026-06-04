import {
  applyLoadoutToStats,
  canEquipToLoadout,
  ensureLoadout,
  placeInLoadout,
  removeFromLoadout,
} from './equipment';
import { maxAllyAttack } from './catalog';
import { createCardInstance, updatePlayerCharacter } from './state';
import type { GameState, SlotKind } from './types';

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

export function playCharacterFromHand(
  state: GameState,
  instanceId: string
): ActionResult {
  const index = state.zones.hand.findIndex((c) => c.instanceId === instanceId);
  if (index === -1) {
    return { ok: false, reason: '手牌中未找到该卡牌' };
  }

  const card = state.zones.hand[index];
  if (!card.data.tags.includes('character')) {
    return { ok: false, reason: '仅角色可上场' };
  }

  const hand = [...state.zones.hand];
  hand.splice(index, 1);
  const onField = applyLoadoutToStats(
    ensureLoadout(createCardInstance(card.data, true))
  );

  return {
    ok: true,
    state: {
      ...state,
      zones: {
        ...state.zones,
        hand,
        playerBattlefield: [...state.zones.playerBattlefield, onField],
      },
    },
  };
}

export function buyFromShop(state: GameState, templateId: string): ActionResult {
  if (state.phase !== 'prep') {
    return { ok: false, reason: '仅准备阶段可购' };
  }

  const listingIndex = state.shopListings.findIndex(
    (l) => l.template.id === templateId
  );
  if (listingIndex === -1) {
    return { ok: false, reason: '无此商品' };
  }

  const listing = state.shopListings[listingIndex];
  const price = listing.template.price ?? 0;
  if (state.gold < price) {
    return { ok: false, reason: `金币不足(${price})` };
  }
  if (listing.stock === 0) {
    return { ok: false, reason: '售罄' };
  }

  const listings = [...state.shopListings];
  const nextStock = listing.stock < 0 ? 0 : Math.max(0, listing.stock - 1);
  listings[listingIndex] = { ...listing, stock: nextStock };

  const purchased = createCardInstance({
    ...listing.template,
    price: undefined,
  });

  return {
    ok: true,
    state: {
      ...state,
      gold: state.gold - price,
      shopListings: listings,
      zones: {
        ...state.zones,
        hand: [...state.zones.hand, purchased],
      },
    },
  };
}

export function equipFromHand(
  state: GameState,
  equipInstanceId: string,
  characterInstanceId: string
): ActionResult {
  const hi = state.zones.hand.findIndex((c) => c.instanceId === equipInstanceId);
  if (hi === -1) return { ok: false, reason: '手牌无此装备' };

  const equipCard = state.zones.hand[hi];
  if (!equipCard.data.tags.includes('equipment')) {
    return { ok: false, reason: '非装备卡' };
  }

  const char = state.zones.playerBattlefield.find(
    (c) => c.instanceId === characterInstanceId
  );
  if (!char) return { ok: false, reason: '目标不在我方战场' };

  const withLoadout = ensureLoadout(char);
  const slot = canEquipToLoadout(withLoadout.loadout!, equipCard.data);
  if (!slot.ok) return { ok: false, reason: slot.reason };

  const entry = {
    instanceId: equipCard.instanceId,
    data: equipCard.data,
  };
  const newLoadout = placeInLoadout(
    withLoadout.loadout!,
    entry,
    slot.slotKind,
    slot.index
  );

  const hand = [...state.zones.hand];
  hand.splice(hi, 1);

  const updated = applyLoadoutToStats({
    ...withLoadout,
    loadout: newLoadout,
  });

  return {
    ok: true,
    state: updatePlayerCharacter(
      { ...state, zones: { ...state.zones, hand } },
      updated
    ),
  };
}

export function attackEnemyFromHand(
  state: GameState,
  actionInstanceId: string,
  enemyInstanceId: string
): ActionResult {
  if (state.phase !== 'battle') {
    return { ok: false, reason: '仅战斗阶段可攻击' };
  }

  const hi = state.zones.hand.findIndex((c) => c.instanceId === actionInstanceId);
  if (hi === -1) return { ok: false, reason: '手牌无此攻击牌' };

  const actionCard = state.zones.hand[hi];
  if (
    !actionCard.data.tags.includes('action') ||
    actionCard.data.actionKind !== 'attack'
  ) {
    return { ok: false, reason: '非攻击动作牌' };
  }

  const enemy = state.zones.enemyBattlefield.find(
    (c) => c.instanceId === enemyInstanceId
  );
  if (!enemy?.stats) return { ok: false, reason: '目标不在敌方战场' };

  const damage = maxAllyAttack(state);
  if (damage <= 0) {
    return { ok: false, reason: '我方无角色，无法计算攻击力' };
  }

  const hand = [...state.zones.hand];
  hand.splice(hi, 1);

  const newHp = enemy.stats.hp - damage;
  let enemyBattlefield = state.zones.enemyBattlefield;

  if (newHp <= 0) {
    enemyBattlefield = enemyBattlefield.filter(
      (c) => c.instanceId !== enemyInstanceId
    );
  } else {
    const updated = {
      ...enemy,
      stats: { ...enemy.stats, hp: newHp },
    };
    enemyBattlefield = enemyBattlefield.map((c) =>
      c.instanceId === enemyInstanceId ? updated : c
    );
  }

  return {
    ok: true,
    state: {
      ...state,
      zones: {
        ...state.zones,
        hand,
        enemyBattlefield,
      },
    },
  };
}

export function unequipToHand(
  state: GameState,
  characterInstanceId: string,
  slotKind: SlotKind,
  index: number
): ActionResult {
  const char = state.zones.playerBattlefield.find(
    (c) => c.instanceId === characterInstanceId
  );
  if (!char?.loadout) return { ok: false, reason: '无装备' };

  const { loadout, removed } = removeFromLoadout(char.loadout, slotKind, index);
  if (!removed) return { ok: false, reason: '槽位为空' };

  const updated = applyLoadoutToStats({ ...char, loadout });
  const hand = [
    ...state.zones.hand,
    createCardInstance(removed.data),
  ];

  return {
    ok: true,
    state: {
      ...updatePlayerCharacter(state, updated),
      zones: {
        ...state.zones,
        hand,
      },
    },
  };
}
