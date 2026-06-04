import { createCardInstance } from './state';
import type { GameState } from './types';

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
    return { ok: false, reason: '仅可将角色卡拖至我方战场' };
  }

  const hand = [...state.zones.hand];
  hand.splice(index, 1);
  const onField = createCardInstance(card.data, true);

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
    return { ok: false, reason: '仅在准备阶段可购买' };
  }

  const listingIndex = state.shopListings.findIndex(
    (l) => l.template.id === templateId
  );
  if (listingIndex === -1) {
    return { ok: false, reason: '商店无此商品' };
  }

  const listing = state.shopListings[listingIndex];
  const price = listing.template.price ?? 0;
  if (state.gold < price) {
    return { ok: false, reason: `金币不足（需要 ${price}）` };
  }

  if (listing.stock === 0) {
    return { ok: false, reason: '已售罄' };
  }

  const listings = [...state.shopListings];
  if (listing.stock > 0) {
    listings[listingIndex] = { ...listing, stock: listing.stock - 1 };
  }

  const purchased = createCardInstance({ ...listing.template, price: undefined });

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
