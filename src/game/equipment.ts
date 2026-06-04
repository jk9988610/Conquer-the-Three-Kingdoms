import type {
  CardData,
  CardInstance,
  CharacterLoadout,
  EquippedEntry,
  SlotKind,
} from './types';
import { emptyLoadout } from './types';

export function getEquipSlotKind(data: CardData): SlotKind | null {
  if (data.equipSlot) return data.equipSlot;
  if (data.id === 'equip-fangtian') return 'weapon';
  return null;
}

export function canEquipToLoadout(
  loadout: CharacterLoadout,
  data: CardData
): { ok: true; slotKind: SlotKind; index: number } | { ok: false; reason: string } {
  const kind = getEquipSlotKind(data);
  if (!kind) return { ok: false, reason: '不可装备' };

  if (kind === 'weapon') {
    const idx = loadout.weapons.findIndex((w) => w === null);
    if (idx === -1) return { ok: false, reason: '武器槽已满' };
    return { ok: true, slotKind: 'weapon', index: idx };
  }
  if (kind === 'vehicle') {
    if (loadout.vehicle) return { ok: false, reason: '载具槽已满' };
    return { ok: true, slotKind: 'vehicle', index: 0 };
  }
  const idx = loadout.accessories.findIndex((a) => a === null);
  if (idx === -1) return { ok: false, reason: '饰品槽已满' };
  return { ok: true, slotKind: 'accessory', index: idx };
}

export function placeInLoadout(
  loadout: CharacterLoadout,
  entry: EquippedEntry,
  slotKind: SlotKind,
  index: number
): CharacterLoadout {
  const next: CharacterLoadout = {
    weapons: [...loadout.weapons] as CharacterLoadout['weapons'],
    vehicle: loadout.vehicle,
    accessories: [...loadout.accessories] as CharacterLoadout['accessories'],
  };
  if (slotKind === 'weapon') next.weapons[index] = entry;
  else if (slotKind === 'vehicle') next.vehicle = entry;
  else next.accessories[index] = entry;
  return next;
}

export function removeFromLoadout(
  loadout: CharacterLoadout,
  slotKind: SlotKind,
  index: number
): { loadout: CharacterLoadout; removed: EquippedEntry | null } {
  const next: CharacterLoadout = {
    weapons: [...loadout.weapons] as CharacterLoadout['weapons'],
    vehicle: loadout.vehicle,
    accessories: [...loadout.accessories] as CharacterLoadout['accessories'],
  };
  let removed: EquippedEntry | null = null;
  if (slotKind === 'weapon') {
    removed = next.weapons[index];
    next.weapons[index] = null;
  } else if (slotKind === 'vehicle') {
    removed = next.vehicle;
    next.vehicle = null;
  } else {
    removed = next.accessories[index];
    next.accessories[index] = null;
  }
  return { loadout: next, removed };
}

export function computeAttack(char: CardInstance): number {
  const base = char.stats?.baseAttack ?? char.stats?.attack ?? 0;
  const loadout = char.loadout ?? emptyLoadout();
  let bonus = 0;
  for (const w of loadout.weapons) {
    if (w) bonus += w.data.attackBonus ?? 0;
  }
  if (loadout.vehicle) bonus += loadout.vehicle.data.attackBonus ?? 0;
  for (const a of loadout.accessories) {
    if (a) bonus += a.data.attackBonus ?? 0;
  }
  return base + bonus;
}

export function applyLoadoutToStats(char: CardInstance): CardInstance {
  if (!char.stats) return char;
  const attack = computeAttack(char);
  return { ...char, stats: { ...char.stats, attack } };
}

export function ensureLoadout(char: CardInstance): CardInstance {
  if (char.loadout) return char;
  return { ...char, loadout: emptyLoadout() };
}
