import { MidiSampler } from '../audio/midiSampler';
import {
  buyFromShop,
  equipFromHand,
  playCharacterFromHand,
  unequipToHand,
} from '../game/actions';
import { createCardInstance, setPhase } from '../game/state';
import type { CardInstance, GameState } from '../game/types';
import type { TcgScaledSize } from '../tcg/dimensions';
import { showCardBrief, hideCardBrief } from './cardBrief';
import {
  closeCharacterModal,
  openCharacterModal,
} from './characterModal';
import { createCardElement, createDragGhost } from './cardElement';
import { cardSizeForZone } from './layout';
import { attachPointerDrag } from './pointerDrag';

export interface GameBoardCallbacks {
  onStateChange: (state: GameState) => void;
}

type DragSource =
  | { kind: 'shop'; templateId: string }
  | { kind: 'hand'; instanceId: string };

export class GameBoard {
  private root: HTMLElement;
  private state: GameState;
  private callbacks: GameBoardCallbacks;
  private cardSize: TcgScaledSize | null = null;
  private dragCleanups: (() => void)[] = [];
  private music = new MidiSampler();
  private musicOn = false;
  private modalCharacterId: string | null = null;
  private activeDrag: DragSource | null = null;

  constructor(
    container: HTMLElement,
    initialState: GameState,
    callbacks: GameBoardCallbacks
  ) {
    this.root = container;
    this.state = initialState;
    this.callbacks = callbacks;
    this.root.className = 'game-board';
    this.root.innerHTML = `
      <header class="game-board__header">
        <h1 class="game-board__title">三国志 TCG</h1>
        <div class="game-board__controls">
          <span class="game-board__gold" data-gold></span>
          <span class="game-board__phase" data-phase-label></span>
          <span class="game-board__hint-text" data-hint title=""></span>
          <button type="button" class="btn" data-action="toggle-phase">阶段</button>
          <button type="button" class="btn" data-action="toggle-music">音乐</button>
          <button type="button" class="btn" data-action="fullscreen">全屏</button>
        </div>
      </header>
      <main class="game-board__zones">
        <section class="zone" data-zone-id="top">
          <h2 class="zone__label" data-top-label></h2>
          <div class="zone__body" data-zone-body="top"></div>
        </section>
        <section class="zone" data-zone-id="player">
          <h2 class="zone__label">我方战场</h2>
          <div class="zone__body" data-zone-body="player"></div>
        </section>
        <section class="zone" data-zone-id="hand">
          <h2 class="zone__label">手牌</h2>
          <div class="zone__body" data-zone-body="hand"></div>
        </section>
      </main>
    `;

    this.bindControls();
    this.updateLayoutSize();
    window.addEventListener('resize', () => this.updateLayoutSize());
    this.render();
  }

  updateState(state: GameState): void {
    this.state = state;
    this.render();
  }

  private bindControls(): void {
    this.root
      .querySelector('[data-action="toggle-phase"]')
      ?.addEventListener('click', () => {
        const next = this.state.phase === 'prep' ? 'battle' : 'prep';
        closeCharacterModal();
        this.commitState(setPhase(this.state, next));
      });

    this.root
      .querySelector('[data-action="toggle-music"]')
      ?.addEventListener('click', () => {
        this.musicOn = !this.musicOn;
        if (this.musicOn) this.music.playMelody();
        else this.music.stop();
        const btn = this.root.querySelector('[data-action="toggle-music"]');
        if (btn) btn.textContent = this.musicOn ? '音乐开' : '音乐';
      });

    this.root
      .querySelector('[data-action="fullscreen"]')
      ?.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          void this.root.requestFullscreen?.();
        } else {
          void document.exitFullscreen();
        }
      });
  }

  private updateLayoutSize(): void {
    const body = this.root.querySelector<HTMLElement>('[data-zone-body="hand"]');
    if (!body || body.clientHeight < 10) {
      requestAnimationFrame(() => this.updateLayoutSize());
      return;
    }
    const next = cardSizeForZone(body);
    const changed =
      !this.cardSize ||
      Math.abs(this.cardSize.cardHeight - next.cardHeight) > 1;
    if (changed) {
      this.cardSize = next;
      this.render();
    }
  }

  private commitState(state: GameState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
    if (this.modalCharacterId) {
      const c = state.zones.playerBattlefield.find(
        (x) => x.instanceId === this.modalCharacterId
      );
      if (c) {
        closeCharacterModal();
        this.openModal(c);
      } else {
        closeCharacterModal();
        this.modalCharacterId = null;
      }
    }
    this.render();
  }

  private clearDrags(): void {
    for (const fn of this.dragCleanups) fn();
    this.dragCleanups = [];
  }

  private zoneBody(id: 'top' | 'player' | 'hand'): HTMLElement | null {
    return this.root.querySelector(`[data-zone-body="${id}"]`);
  }

  private pointInZone(x: number, y: number, id: 'top' | 'player' | 'hand'): boolean {
    const z = this.zoneBody(id);
    if (!z) return false;
    const r = z.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private playerCharacterAt(x: number, y: number): string | null {
    const cards = this.root.querySelectorAll<HTMLElement>(
      '.tcg-card[data-field="player"]'
    );
    for (const el of cards) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return el.dataset.instanceId ?? null;
      }
    }
    return null;
  }

  private clearHighlights(): void {
    this.root
      .querySelectorAll('.zone__body--over')
      .forEach((z) => z.classList.remove('zone__body--over'));
    this.root
      .querySelectorAll('.tcg-card--snap')
      .forEach((c) => c.classList.remove('tcg-card--snap'));
  }

  private onDragMove(x: number, y: number): void {
    this.clearHighlights();
    if (!this.activeDrag) return;

    if (this.activeDrag.kind === 'shop' && this.pointInZone(x, y, 'hand')) {
      this.zoneBody('hand')?.classList.add('zone__body--over');
    }
    if (this.activeDrag.kind === 'hand') {
      const dragHand = this.activeDrag;
      const card = this.state.zones.hand.find(
        (c) => c.instanceId === dragHand.instanceId
      );
      if (!card) return;
      if (card.data.tags.includes('character') && this.pointInZone(x, y, 'player')) {
        this.zoneBody('player')?.classList.add('zone__body--over');
      }
      if (card.data.tags.includes('equipment')) {
        const cid = this.playerCharacterAt(x, y);
        if (cid) {
          const el = this.root.querySelector(
            `[data-instance-id="${cid}"]`
          );
          el?.classList.add('tcg-card--snap');
        }
      }
    }
  }

  private handleDrop(x: number, y: number, isClick: boolean, src: DragSource): void {
    this.clearHighlights();
    this.activeDrag = null;

    if (src.kind === 'shop') {
      if (this.pointInZone(x, y, 'hand')) {
        this.apply(buyFromShop(this.state, src.templateId));
      }
      return;
    }

    const card = this.state.zones.hand.find((c) => c.instanceId === src.instanceId);
    if (!card) return;

    if (isClick) {
      if (
        card.data.tags.includes('item') ||
        card.data.tags.includes('equipment')
      ) {
        const el = this.root.querySelector(
          `[data-instance-id="${src.instanceId}"]`
        );
        if (el) showCardBrief(card.data, el as HTMLElement);
      }
      return;
    }

    if (card.data.tags.includes('character') && this.pointInZone(x, y, 'player')) {
      this.apply(playCharacterFromHand(this.state, src.instanceId));
      return;
    }

    if (card.data.tags.includes('equipment')) {
      const charId = this.playerCharacterAt(x, y);
      if (charId) {
        this.apply(equipFromHand(this.state, src.instanceId, charId));
      }
    }
  }

  private bindDrag(
    el: HTMLElement,
    source: DragSource,
    card?: CardInstance
  ): void {
    this.dragCleanups.push(
      attachPointerDrag({
        source: el,
        createGhost: createDragGhost,
        onMove: (x, y) => {
          this.activeDrag = source;
          this.onDragMove(x, y);
        },
        onDrop: (x, y, isClick) => {
          this.handleDrop(x, y, isClick, source);
        },
      })
    );

    if (card?.data.tags.includes('character')) {
      /* 角色仅拖拽，不点击上场 */
    }
  }

  private apply(
    result: ReturnType<typeof playCharacterFromHand>
  ): void {
    if (result.ok) {
      this.setHint('成功');
      this.commitState(result.state);
    } else {
      this.setHint(result.reason);
    }
  }

  private setHint(text: string): void {
    const el = this.root.querySelector<HTMLElement>('[data-hint]');
    if (!el) return;
    const short = text.length > 18 ? `${text.slice(0, 17)}…` : text;
    el.textContent = short;
    el.title = text;
  }

  private openModal(character: CardInstance): void {
    this.modalCharacterId = character.instanceId;
    openCharacterModal(character, {
      onClose: () => {
        closeCharacterModal();
        this.modalCharacterId = null;
      },
      onUnequip: (slotKind, index) => {
        const res = unequipToHand(
          this.state,
          character.instanceId,
          slotKind,
          index
        );
        if (res.ok) {
          this.commitState(res.state);
          this.setHint('已卸下手牌');
        } else {
          this.setHint(res.reason);
        }
      },
    });
  }

  private render(): void {
    if (!this.cardSize) return;
    this.clearDrags();
    hideCardBrief();

    const size = this.cardSize;
    const goldEl = this.root.querySelector('[data-gold]');
    const phaseLabel = this.root.querySelector('[data-phase-label]');
    const topLabel = this.root.querySelector('[data-top-label]');
    const topBody = this.zoneBody('top');
    const playerBody = this.zoneBody('player');
    const handBody = this.zoneBody('hand');

    if (!goldEl || !phaseLabel || !topLabel || !topBody || !playerBody || !handBody) {
      return;
    }

    const isPrep = this.state.phase === 'prep';
    goldEl.textContent = `${this.state.gold}金`;
    phaseLabel.textContent = isPrep ? '准备' : '战斗';
    topLabel.textContent = isPrep ? '商店' : '敌方';
    this.root.dataset.phase = this.state.phase;

    if (!this.root.querySelector('[data-hint]')?.textContent) {
      this.setHint('拖角色上场·商店入手牌·装备吸附');
    }

    topBody.innerHTML = '';
    playerBody.innerHTML = '';
    handBody.innerHTML = '';

    if (isPrep) {
      for (const listing of this.state.shopListings) {
        if (listing.stock === 0) continue;
        const display = createCardInstance(listing.template);
        const el = createCardElement(display, {
          size,
          showPrice: listing.template.price,
        });
        el.dataset.shop = '1';
        this.bindDrag(el, { kind: 'shop', templateId: listing.template.id });
        topBody.append(el);
      }
    } else {
      for (const card of this.state.zones.enemyBattlefield) {
        topBody.append(createCardElement(card, { size }));
      }
    }

    for (const card of this.state.zones.playerBattlefield) {
      const el = createCardElement(card, { size, onFieldPlayer: true });
      el.addEventListener('click', () => this.openModal(card));
      this.bindDrag(el, { kind: 'hand', instanceId: card.instanceId }, card);
      playerBody.append(el);
    }

    for (const card of this.state.zones.hand) {
      const el = createCardElement(card, { size });
      const canDrag =
        card.data.tags.includes('character') ||
        card.data.tags.includes('equipment') ||
        card.data.tags.includes('item');
      if (canDrag) {
        this.bindDrag(el, { kind: 'hand', instanceId: card.instanceId }, card);
      }
      handBody.append(el);
    }
  }
}
