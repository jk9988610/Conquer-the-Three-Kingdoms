import { MidiSampler } from '../audio/midiSampler';
import { maxAllyAttack } from '../game/catalog';
import {
  attackEnemyFromHand,
  buyFromShop,
  equipFromHand,
  playCharacterFromHand,
  unequipToHand,
} from '../game/actions';
import { applyLoadoutToStats, ensureLoadout } from '../game/equipment';
import { createCardInstance, setPhase } from '../game/state';
import type { CardInstance, GameState } from '../game/types';
import type { TcgScaledSize } from '../tcg/dimensions';
import { showCardBrief, hideCardBrief } from './cardBrief';
import {
  closeCharacterModal,
  openCharacterModal,
} from './characterModal';
import { attachCardTap } from './cardTap';
import { createCardElement, createDragGhost } from './cardElement';
import { cardSizeForZone } from './layout';
import { attachPointerDrag } from './pointerDrag';
import { openPixelEditor } from './pixelEditor';
import { APP_VERSION } from '../version';

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
  private tapCleanups: (() => void)[] = [];
  private music = new MidiSampler();
  private musicOn = false;
  private modalCharacterId: string | null = null;
  private activeDrag: DragSource | null = null;
  private hoverLiftId: string | null = null;

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
      <div class="game-board__shell">
        <section class="game-board__canvas" data-canvas>
          <h1 class="game-board__title">三国志 TCG <span class="game-board__ver" data-version></span></h1>
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
        </section>
        <aside class="game-board__sidebar" data-sidebar>
          <div class="game-board__module game-board__module--status">
            <h3 class="game-board__module-title">状态</h3>
            <div class="game-board__module-body">
              <p class="game-board__stat-line"><span class="game-board__stat-k">金币</span> <span data-gold></span></p>
              <p class="game-board__stat-line"><span class="game-board__stat-k">阶段</span> <span data-phase-label></span></p>
              <p class="game-board__stat-line game-board__stat-line--hint" data-hint title=""></p>
            </div>
          </div>
          <div class="game-board__module game-board__module--tools">
            <h3 class="game-board__module-title">设置</h3>
            <div class="game-board__module-body game-board__module-body--tools-row">
              <div class="game-board__tool-buttons">
                <button type="button" class="btn" data-action="toggle-phase">阶段</button>
                <button type="button" class="btn" data-action="toggle-music">音乐</button>
                <button type="button" class="btn" data-action="pixel-editor">绘制</button>
                <button type="button" class="btn" data-action="fullscreen">全屏</button>
              </div>
              <pre class="game-board__debug" data-debug aria-label="调试信息"></pre>
            </div>
          </div>
        </aside>
      </div>
    `;

    this.root.querySelector('[data-version]')!.textContent = `v${APP_VERSION}`;
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
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
      .querySelector('[data-action="pixel-editor"]')
      ?.addEventListener('click', () => {
        openPixelEditor(() => this.render());
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
        this.openModal(c, 'player');
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
    for (const fn of this.tapCleanups) fn();
    this.tapCleanups = [];
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

  private characterAt(
    x: number,
    y: number,
    field: 'player' | 'enemy'
  ): string | null {
    const expand = 20;

    if (this.hoverLiftId) {
      const lifted = this.root.querySelector<HTMLElement>(
        `[data-instance-id="${this.hoverLiftId}"]`
      );
      if (lifted?.dataset.field === field) {
        const r = lifted.getBoundingClientRect();
        if (
          x >= r.left - expand &&
          x <= r.right + expand &&
          y >= r.top - expand &&
          y <= r.bottom + expand
        ) {
          return this.hoverLiftId;
        }
      }
    }

    const cards = this.root.querySelectorAll<HTMLElement>(
      `.tcg-card[data-field="${field}"]`
    );
    for (const el of cards) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return el.dataset.instanceId ?? null;
      }
    }
    return null;
  }

  private setHoverLift(instanceId: string | null): void {
    if (this.hoverLiftId === instanceId) return;
    if (this.hoverLiftId) {
      this.root
        .querySelector(`[data-instance-id="${this.hoverLiftId}"]`)
        ?.classList.remove('tcg-card--lift');
    }
    this.hoverLiftId = instanceId;
    if (instanceId) {
      this.root
        .querySelector(`[data-instance-id="${instanceId}"]`)
        ?.classList.add('tcg-card--lift');
    }
  }

  private clearZoneHighlights(): void {
    this.root
      .querySelectorAll('.zone__body--over')
      .forEach((z) => z.classList.remove('zone__body--over'));
  }

  private clearHighlights(): void {
    this.clearZoneHighlights();
    this.setHoverLift(null);
  }

  private onDragMove(x: number, y: number): void {
    this.clearZoneHighlights();
    if (!this.activeDrag) {
      this.setHoverLift(null);
      return;
    }

    let nextLift: string | null = null;

    if (this.activeDrag.kind === 'shop' && this.pointInZone(x, y, 'hand')) {
      this.zoneBody('hand')?.classList.add('zone__body--over');
    }
    if (this.activeDrag.kind === 'hand') {
      const dragHand = this.activeDrag;
      const card = this.state.zones.hand.find(
        (c) => c.instanceId === dragHand.instanceId
      );
      if (!card) {
        this.setHoverLift(null);
        return;
      }
      if (card.data.tags.includes('character') && this.pointInZone(x, y, 'player')) {
        this.zoneBody('player')?.classList.add('zone__body--over');
      }
      if (
        card.data.tags.includes('equipment') ||
        card.data.tags.includes('item')
      ) {
        nextLift = this.characterAt(x, y, 'player');
      }
      if (
        card.data.tags.includes('action') &&
        card.data.actionKind === 'attack' &&
        this.state.phase === 'battle'
      ) {
        nextLift = this.characterAt(x, y, 'enemy');
      }
    }
    this.setHoverLift(nextLift);
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
        card.data.tags.includes('equipment') ||
        card.data.tags.includes('action')
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
      const charId = this.characterAt(x, y, 'player');
      if (charId) {
        this.apply(equipFromHand(this.state, src.instanceId, charId));
      }
      return;
    }

    if (
      card.data.tags.includes('action') &&
      card.data.actionKind === 'attack'
    ) {
      const enemyId = this.characterAt(x, y, 'enemy');
      if (enemyId) {
        this.apply(attackEnemyFromHand(this.state, src.instanceId, enemyId));
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
    const short = text.length > 22 ? `${text.slice(0, 21)}…` : text;
    el.textContent = short;
    el.title = text;
  }

  private updateDebugPanel(): void {
    const el = this.root.querySelector<HTMLElement>('[data-debug]');
    if (!el) return;
    const z = this.state.zones;
    const maxAtk = maxAllyAttack(this.state);
    el.textContent = [
      `phase: ${this.state.phase}`,
      `gold: ${this.state.gold}`,
      `hand: ${z.hand.length}`,
      `ally field: ${z.playerBattlefield.length}`,
      `enemy field: ${z.enemyBattlefield.length}`,
      `max ally ATK: ${maxAtk}`,
    ].join('\n');
  }

  private openModal(character: CardInstance, side: 'player' | 'enemy'): void {
    const fresh =
      side === 'player'
        ? (this.state.zones.playerBattlefield.find(
            (c) => c.instanceId === character.instanceId
          ) ?? applyLoadoutToStats(ensureLoadout(character)))
        : (this.state.zones.enemyBattlefield.find(
            (c) => c.instanceId === character.instanceId
          ) ?? applyLoadoutToStats(ensureLoadout(character)));

    this.modalCharacterId = side === 'player' ? fresh.instanceId : null;
    openCharacterModal(
      fresh,
      {
        onClose: () => {
          closeCharacterModal();
          this.modalCharacterId = null;
        },
        onUnequip:
          side === 'player'
            ? (slotKind, index) => {
                const id = this.modalCharacterId;
                if (!id) return;
                const res = unequipToHand(this.state, id, slotKind, index);
                if (res.ok) {
                  this.commitState(res.state);
                  this.setHint('已卸下手牌');
                } else {
                  this.setHint(res.reason);
                }
              }
            : undefined,
      },
      { side }
    );
  }

  private bindFieldTap(
    el: HTMLElement,
    instanceId: string,
    side: 'player' | 'enemy'
  ): void {
    this.tapCleanups.push(
      attachCardTap(el, () => {
        const list =
          side === 'player'
            ? this.state.zones.playerBattlefield
            : this.state.zones.enemyBattlefield;
        const current = list.find((c) => c.instanceId === instanceId);
        if (current) this.openModal(current, side);
      })
    );
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
      this.setHint('拖角色上场·攻击拖向敌方·装备吸附');
    }

    this.updateDebugPanel();

    topBody.innerHTML = '';
    playerBody.innerHTML = '';
    handBody.innerHTML = '';

    if (isPrep) {
      for (const listing of this.state.shopListings) {
        const soldOut = listing.stock === 0;
        const display = createCardInstance(listing.template);
        const el = createCardElement(display, {
          size,
          showPrice: listing.template.price,
          soldOut,
        });
        el.dataset.shop = '1';
        if (!soldOut) {
          this.bindDrag(el, { kind: 'shop', templateId: listing.template.id });
        }
        topBody.append(el);
      }
    } else {
      for (const card of this.state.zones.enemyBattlefield) {
        const el = createCardElement(card, { size, onField: 'enemy' });
        this.bindFieldTap(el, card.instanceId, 'enemy');
        topBody.append(el);
      }
    }

    for (const card of this.state.zones.playerBattlefield) {
      const el = createCardElement(card, { size, onField: 'player' });
      this.bindFieldTap(el, card.instanceId, 'player');
      playerBody.append(el);
    }

    for (const card of this.state.zones.hand) {
      const el = createCardElement(card, { size });
      const canDrag =
        card.data.tags.includes('character') ||
        card.data.tags.includes('equipment') ||
        card.data.tags.includes('item') ||
        (card.data.tags.includes('action') &&
          card.data.actionKind === 'attack' &&
          this.state.phase === 'battle');
      if (canDrag) {
        this.bindDrag(el, { kind: 'hand', instanceId: card.instanceId }, card);
      }
      handBody.append(el);
    }
  }
}
