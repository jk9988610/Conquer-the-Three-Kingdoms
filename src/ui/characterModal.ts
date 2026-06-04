import type { CardData, CardInstance, SlotKind } from '../game/types';
import { showCardBrief } from './cardBrief';
import { createPixelArtCanvas } from './cardElement';

export interface CharacterModalHandlers {
  onClose: () => void;
  onUnequip: (slotKind: SlotKind, index: number) => void;
}

const SLOT_LABELS: Record<SlotKind, string> = {
  weapon: '武器',
  vehicle: '载具',
  accessory: '饰品',
};

export function openCharacterModal(
  character: CardInstance,
  handlers: CharacterModalHandlers
): void {
  closeCharacterModal();

  const overlay = document.createElement('div');
  overlay.className = 'char-modal-overlay';
  overlay.dataset.modal = 'character';

  const modal = document.createElement('div');
  modal.className = 'char-modal';
  modal.innerHTML = `
    <header class="char-modal__head">
      <h2 class="char-modal__title"></h2>
      <button type="button" class="char-modal__close" aria-label="关闭">×</button>
    </header>
    <p class="char-modal__stats"></p>
    <div class="char-modal__slots" data-slots></div>
  `;

  modal.querySelector('.char-modal__title')!.textContent = character.data.name;
  const st = character.stats;
  modal.querySelector('.char-modal__stats')!.textContent = st
    ? `生命 ${st.hp}/${st.maxHp} · 攻击 ${st.attack}`
    : '';

  const slotsRoot = modal.querySelector('[data-slots]')!;
  const loadout = character.loadout;
  if (loadout) {
    for (let i = 0; i < 3; i++) {
      slotsRoot.append(
        buildSlot(
          'weapon',
          i,
          `${SLOT_LABELS.weapon} ${i + 1}`,
          loadout.weapons[i],
          handlers
        )
      );
    }
    slotsRoot.append(
      buildSlot('vehicle', 0, SLOT_LABELS.vehicle, loadout.vehicle, handlers)
    );
    for (let i = 0; i < 2; i++) {
      slotsRoot.append(
        buildSlot(
          'accessory',
          i,
          `${SLOT_LABELS.accessory} ${i + 1}`,
          loadout.accessories[i],
          handlers
        )
      );
    }
  }

  overlay.append(modal);
  document.body.append(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) handlers.onClose();
  });
  modal.querySelector('.char-modal__close')?.addEventListener('click', () => {
    handlers.onClose();
  });
}

function buildSlot(
  kind: SlotKind,
  index: number,
  label: string,
  entry: { instanceId: string; data: CardData } | null,
  handlers: CharacterModalHandlers
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'char-slot';

  const title = document.createElement('span');
  title.className = 'char-slot__label';
  title.textContent = label;

  const box = document.createElement('div');
  box.className = 'char-slot__box';
  if (entry) {
    const art = createPixelArtCanvas(entry.data.artKey ?? 'generic', 56, 56);
    art.classList.add('char-slot__art');
    art.addEventListener('click', (e) => {
      e.stopPropagation();
      showCardBrief(entry.data, art);
    });
    box.append(art);
  } else {
    box.textContent = '空';
    box.classList.add('char-slot__box--empty');
  }

  const uneq = document.createElement('button');
  uneq.type = 'button';
  uneq.className = 'char-slot__unequip';
  uneq.textContent = '卸下';
  uneq.disabled = !entry;
  uneq.addEventListener('click', () => handlers.onUnequip(kind, index));

  wrap.append(title, box, uneq);
  return wrap;
}

export function closeCharacterModal(): void {
  document.querySelector('[data-modal="character"]')?.remove();
}
