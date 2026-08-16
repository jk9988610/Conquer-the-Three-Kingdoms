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
import { createCardElement, createDragGhost, updateCardElement } from './cardElement';
import { cardSizeForZone } from './layout';
import { attachPointerDrag } from './pointerDrag';
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
  private dragCleanups = new Map<HTMLElement, () => void>();
  private tapCleanups = new Map<HTMLElement, () => void>();
  private topZoneMode: 'shop' | 'enemy' | null = null;
  private layoutCache: {
    zones: Partial<Record<'top' | 'player' | 'hand', DOMRect>>;
    fieldCards: Map<string, DOMRect>;
  } | null = null;
  private music = new MidiSampler();
  private musicOn = false;
  private modalCharacterId: string | null = null;
  private activeDrag: DragSource | null = null;
  private hoverLiftId: string | null = null;
  private statusOpen = false;
  private debugOpen = false;

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
          <header class="game-board__topbar">
            <h1 class="game-board__title">征战三国 <span class="game-board__ver" data-version></span></h1>
            <div class="game-board__topbar-actions">
              <button type="button" class="btn game-board__topbar-btn" data-action="toggle-status">状态</button>
              <button type="button" class="btn game-board__topbar-btn" data-action="toggle-debug">调试</button>
              <button type="button" class="btn" data-action="toggle-phase">阶段</button>
              <button type="button" class="btn" data-action="toggle-music">音乐</button>
              <button type="button" class="btn" data-action="pixel-editor">绘制</button>
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
        </section>
      </div>
      <div class="game-board__drawer-backdrop" data-board-backdrop aria-hidden="true"></div>
      <aside class="game-board__drawer game-board__drawer--status" data-status-drawer aria-hidden="true">
        <header class="game-board__drawer-head">
          <span>状态</span>
          <button type="button" class="game-board__drawer-close" data-close-board-drawer aria-label="关闭">×</button>
        </header>
        <div class="game-board__drawer-body">
          <p class="game-board__stat-line"><span class="game-board__stat-k">金币</span> <span data-gold></span></p>
          <p class="game-board__stat-line"><span class="game-board__stat-k">阶段</span> <span data-phase-label></span></p>
          <p class="game-board__stat-line game-board__stat-line--hint" data-hint title=""></p>
        </div>
      </aside>
      <aside class="game-board__drawer game-board__drawer--debug" data-debug-drawer aria-hidden="true">
        <header class="game-board__drawer-head">
          <span>调试</span>
          <button type="button" class="game-board__drawer-close" data-close-board-drawer aria-label="关闭">×</button>
        </header>
        <div class="game-board__drawer-body">
          <pre class="game-board__debug" data-debug aria-label="调试信息"></pre>
        </div>
      </aside>
    `;

    this.root.querySelector('[data-version]')!.textContent = `v${APP_VERSION}`;
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.bindControls();
    this.updateBoardDrawerUi();
    this.updateLayoutSize();
    window.addEventListener('resize', () => this.updateLayoutSize());
    this.render();
  }

  updateState(state: GameState): void {
    this.state = state;
    this.render();
  }

  private updateBoardDrawerUi(): void {
    const backdrop = this.root.querySelector<HTMLElement>('[data-board-backdrop]')!;
    const statusDrawer = this.root.querySelector<HTMLElement>('[data-status-drawer]')!;
    const debugDrawer = this.root.querySelector<HTMLElement>('[data-debug-drawer]')!;
    const statusBtn = this.root.querySelector<HTMLElement>('[data-action="toggle-status"]')!;
    const debugBtn = this.root.querySelector<HTMLElement>('[data-action="toggle-debug"]')!;

    backdrop.classList.toggle('game-board__drawer-backdrop--open', this.statusOpen || this.debugOpen);
    statusDrawer.classList.toggle('game-board__drawer--open', this.statusOpen);
    debugDrawer.classList.toggle('game-board__drawer--open', this.debugOpen);
    backdrop.setAttribute('aria-hidden', this.statusOpen || this.debugOpen ? 'false' : 'true');
    statusDrawer.setAttribute('aria-hidden', this.statusOpen ? 'false' : 'true');
    debugDrawer.setAttribute('aria-hidden', this.debugOpen ? 'false' : 'true');
    statusBtn.classList.toggle('game-board__topbar-btn--active', this.statusOpen);
    debugBtn.classList.toggle('game-board__topbar-btn--active', this.debugOpen);
  }

  private closeBoardDrawers(): void {
    this.statusOpen = false;
    this.debugOpen = false;
    this.updateBoardDrawerUi();
  }

  private bindControls(): void {
    this.root
      .querySelector('[data-action="toggle-status"]')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.statusOpen = !this.statusOpen;
        if (this.statusOpen) this.debugOpen = false;
        this.updateBoardDrawerUi();
      });

    this.root
      .querySelector('[data-action="toggle-debug"]')
      ?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.debugOpen = !this.debugOpen;
        if (this.debugOpen) this.statusOpen = false;
        this.updateBoardDrawerUi();
      });

    this.root
      .querySelector('[data-board-backdrop]')
      ?.addEventListener('click', () => this.closeBoardDrawers());

    this.root.querySelectorAll('[data-close-board-drawer]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeBoardDrawers();
      });
    });

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
      ?.addEventListener('click', async () => {
        const { openPixelEditor } = await import('./pixelEditor');
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

  private unbindElement(el: HTMLElement): void {
    const dragFn = this.dragCleanups.get(el);
    if (dragFn) {
      dragFn();
      this.dragCleanups.delete(el);
    }
    const tapFn = this.tapCleanups.get(el);
    if (tapFn) {
      tapFn();
      this.tapCleanups.delete(el);
    }
  }

  private unbindDrag(el: HTMLElement): void {
    const dragFn = this.dragCleanups.get(el);
    if (dragFn) {
      dragFn();
      this.dragCleanups.delete(el);
    }
  }

  private zoneBody(id: 'top' | 'player' | 'hand'): HTMLElement | null {
    return this.root.querySelector(`[data-zone-body="${id}"]`);
  }

  private pointInZone(x: number, y: number, id: 'top' | 'player' | 'hand'): boolean {
    const cached = this.layoutCache?.zones[id];
    if (cached) {
      return x >= cached.left && x <= cached.right && y >= cached.top && y <= cached.bottom;
    }
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
    const fieldCache = this.layoutCache?.fieldCards;
    for (const el of cards) {
      const instanceId = el.dataset.instanceId;
      if (!instanceId) continue;
      const r = fieldCache?.get(instanceId) ?? el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return instanceId;
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
    if (this.dragCleanups.has(el)) return;
    this.dragCleanups.set(
      el,
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
    if (this.tapCleanups.has(el)) return;
    this.tapCleanups.set(
      el,
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

  private removeStaleZoneChildren(body: HTMLElement, desiredKeys: Set<string>): void {
    for (const child of [...body.children]) {
      const el = child as HTMLElement;
      const key = el.dataset.zoneKey;
      if (!key || !desiredKeys.has(key)) {
        this.unbindElement(el);
        el.remove();
      }
    }
  }

  private refreshLayoutCache(): void {
    const zones: Partial<Record<'top' | 'player' | 'hand', DOMRect>> = {};
    const fieldCards = new Map<string, DOMRect>();
    for (const id of ['top', 'player', 'hand'] as const) {
      const z = this.zoneBody(id);
      if (z) zones[id] = z.getBoundingClientRect();
    }
    for (const el of this.root.querySelectorAll<HTMLElement>('.tcg-card[data-field]')) {
      const instanceId = el.dataset.instanceId;
      if (instanceId) fieldCards.set(instanceId, el.getBoundingClientRect());
    }
    this.layoutCache = { zones, fieldCards };
  }

  private render(): void {
    if (!this.cardSize) return;
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

    const nextTopMode = isPrep ? 'shop' : 'enemy';
    if (this.topZoneMode !== nextTopMode) {
      for (const child of [...topBody.children]) {
        this.unbindElement(child as HTMLElement);
      }
      topBody.innerHTML = '';
      this.topZoneMode = nextTopMode;
    }

    const topKeys = new Set<string>();

    if (isPrep) {
      for (const listing of this.state.shopListings) {
        const key = `shop:${listing.template.id}`;
        topKeys.add(key);
        const soldOut = listing.stock === 0;
        const display = createCardInstance(listing.template);
        let el = topBody.querySelector<HTMLElement>(`[data-zone-key="${key}"]`);
        if (el) {
          updateCardElement(el, display, {
            size,
            showPrice: listing.template.price,
            soldOut,
          });
        } else {
          el = createCardElement(display, {
            size,
            showPrice: listing.template.price,
            soldOut,
          });
          el.dataset.zoneKey = key;
          el.dataset.shop = '1';
          topBody.append(el);
        }
        if (!soldOut) {
          this.bindDrag(el, { kind: 'shop', templateId: listing.template.id });
        } else {
          this.unbindDrag(el);
        }
      }
    } else {
      for (const card of this.state.zones.enemyBattlefield) {
        const key = `enemy:${card.instanceId}`;
        topKeys.add(key);
        let el = topBody.querySelector<HTMLElement>(`[data-zone-key="${key}"]`);
        if (el) {
          updateCardElement(el, card, { size, onField: 'enemy' });
        } else {
          el = createCardElement(card, { size, onField: 'enemy' });
          el.dataset.zoneKey = key;
          topBody.append(el);
          this.bindFieldTap(el, card.instanceId, 'enemy');
        }
      }
    }

    this.removeStaleZoneChildren(topBody, topKeys);

    const playerKeys = new Set<string>();
    for (const card of this.state.zones.playerBattlefield) {
      const key = `player:${card.instanceId}`;
      playerKeys.add(key);
      let el = playerBody.querySelector<HTMLElement>(`[data-zone-key="${key}"]`);
      if (el) {
        updateCardElement(el, card, { size, onField: 'player' });
      } else {
        el = createCardElement(card, { size, onField: 'player' });
        el.dataset.zoneKey = key;
        playerBody.append(el);
        this.bindFieldTap(el, card.instanceId, 'player');
      }
    }
    this.removeStaleZoneChildren(playerBody, playerKeys);

    const handKeys = new Set<string>();
    for (const card of this.state.zones.hand) {
      const key = `hand:${card.instanceId}`;
      handKeys.add(key);
      const canDrag =
        card.data.tags.includes('character') ||
        card.data.tags.includes('equipment') ||
        card.data.tags.includes('item') ||
        (card.data.tags.includes('action') &&
          card.data.actionKind === 'attack' &&
          this.state.phase === 'battle');
      let el = handBody.querySelector<HTMLElement>(`[data-zone-key="${key}"]`);
      if (el) {
        updateCardElement(el, card, { size });
      } else {
        el = createCardElement(card, { size });
        el.dataset.zoneKey = key;
        handBody.append(el);
      }
      if (canDrag) {
        this.bindDrag(el, { kind: 'hand', instanceId: card.instanceId }, card);
      } else {
        this.unbindDrag(el);
      }
    }
    this.removeStaleZoneChildren(handBody, handKeys);

    this.refreshLayoutCache();
  }
}
