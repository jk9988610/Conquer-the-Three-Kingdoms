import type { CardData, CardInstance, SlotKind } from '../game/types';
import { INNER_ASPECT_RATIO } from '../tcg/dimensions';
import { showCardBrief } from './cardBrief';
import { createPixelArtCanvas } from './cardElement';
import { getModalOverlayMount } from './overlayRoot';

export interface CharacterModalHandlers {
  onClose: () => void;
  onUnequip?: (slotKind: SlotKind, index: number) => void;
}

export interface CharacterModalOptions {
  /** 敌方角色不显示卸下装备 */
  side: 'player' | 'enemy';
}

const SLOT_LABELS: Record<SlotKind, string> = {
  weapon: '武器',
  vehicle: '载具',
  accessory: '饰品',
};

export function openCharacterModal(
  character: CardInstance,
  handlers: CharacterModalHandlers,
  options: CharacterModalOptions
): void {
  closeCharacterModal();

  const { side } = options;
  const canUnequip = side === 'player' && !!handlers.onUnequip;

  const overlay = document.createElement('div');
  overlay.className = 'char-modal-overlay';
  overlay.dataset.modal = 'character';

  const modal = document.createElement('div');
  modal.className = 'char-modal';
  modal.innerHTML = `
    <button type="button" class="char-modal__close" aria-label="关闭">×</button>
    <div class="char-modal__layout char-modal__layout--thirds">
      <section class="char-modal__col">
        <h3 class="char-modal__col-title">角色介绍</h3>
        <div class="char-modal__col-body char-modal__col-body--intro">
          <h2 class="char-modal__title"></h2>
          <p class="char-modal__stats"></p>
          <p class="char-modal__desc"></p>
        </div>
      </section>
      <section class="char-modal__col">
        <h3 class="char-modal__col-title">角色样貌</h3>
        <div class="char-modal__col-body char-modal__col-body--portrait" data-portrait></div>
      </section>
      <section class="char-modal__col">
        <h3 class="char-modal__col-title">角色装备</h3>
        <div class="char-modal__col-body char-modal__col-body--equip" data-equip></div>
      </section>
    </div>
  `;

  const portraitCol = modal.querySelector<HTMLElement>('[data-portrait]')!;
  const colW = Math.min(220, Math.floor((window.innerWidth * 0.92 - 80) / 3));
  const portraitW = Math.max(100, colW - 24);
  const portraitH = Math.round(portraitW / INNER_ASPECT_RATIO);
  const portrait = createPixelArtCanvas(
    character.data.artKey ?? 'generic',
    portraitW,
    portraitH
  );
  portrait.className = 'char-modal__art';
  portraitCol.append(portrait);

  modal.querySelector('.char-modal__title')!.textContent = character.data.name;
  modal.querySelector('.char-modal__desc')!.textContent =
    character.data.description ?? '';

  const st = character.stats;
  modal.querySelector('.char-modal__stats')!.textContent = st
    ? `生命 ${st.hp} / ${st.maxHp}　攻击 ${st.attack}`
    : '';

  const equipRoot = modal.querySelector('[data-equip]')!;
  const loadout = character.loadout;
  if (loadout) {
    const weaponsRow = document.createElement('div');
    weaponsRow.className = 'char-modal__equip-row char-modal__equip-row--weapons';
    for (let i = 0; i < 3; i++) {
      weaponsRow.append(
        buildSlot(
          'weapon',
          i,
          `${SLOT_LABELS.weapon} ${i + 1}`,
          loadout.weapons[i],
          canUnequip ? handlers : null
        )
      );
    }

    const miscRow = document.createElement('div');
    miscRow.className = 'char-modal__equip-row char-modal__equip-row--misc';
    miscRow.append(
      buildSlot(
        'vehicle',
        0,
        SLOT_LABELS.vehicle,
        loadout.vehicle,
        canUnequip ? handlers : null
      )
    );
    for (let i = 0; i < 2; i++) {
      miscRow.append(
        buildSlot(
          'accessory',
          i,
          `${SLOT_LABELS.accessory} ${i + 1}`,
          loadout.accessories[i],
          canUnequip ? handlers : null
        )
      );
    }

    equipRoot.append(weaponsRow, miscRow);
  } else {
    equipRoot.innerHTML = '<p class="char-modal__no-equip">无装备栏</p>';
  }

  overlay.append(modal);
  getModalOverlayMount().append(overlay);

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
  handlers: CharacterModalHandlers | null
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'char-slot';

  const title = document.createElement('span');
  title.className = 'char-slot__label';
  title.textContent = label;

  const box = document.createElement('div');
  box.className = 'char-slot__box';
  if (entry) {
    const art = createPixelArtCanvas(entry.data.artKey ?? 'generic', 48, 48);
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

  wrap.append(title, box);

  if (handlers?.onUnequip) {
    const uneq = document.createElement('button');
    uneq.type = 'button';
    uneq.className = 'char-slot__unequip';
    uneq.textContent = '卸下';
    uneq.disabled = !entry;
    uneq.addEventListener('click', () => handlers.onUnequip!(kind, index));
    wrap.append(uneq);
  }

  return wrap;
}

export function closeCharacterModal(): void {
  document.querySelector('[data-modal="character"]')?.remove();
}
