import { MidiSampler } from '../audio/midiSampler';
import { buyFromShop, playCharacterFromHand } from '../game/actions';
import { createCardInstance, setPhase } from '../game/state';
import type { GameState } from '../game/types';
import { scaleTcgToFit, type TcgScaledSize } from '../tcg/dimensions';
import {
  createCardElement,
  createDragGhost,
} from './cardElement';
import { attachPointerDrag } from './pointerDrag';

export interface GameBoardCallbacks {
  onStateChange: (state: GameState) => void;
}

export class GameBoard {
  private root: HTMLElement;
  private state: GameState;
  private callbacks: GameBoardCallbacks;
  private cardSize: TcgScaledSize = scaleTcgToFit(120);
  private dragCleanups: (() => void)[] = [];
  private music = new MidiSampler();
  private musicOn = false;

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
          <button type="button" class="btn" data-action="toggle-phase">切换阶段</button>
          <button type="button" class="btn" data-action="toggle-music">音乐</button>
        </div>
      </header>
      <main class="game-board__main">
        <section class="zone zone--top" aria-label="敌方战场或商店">
          <h2 class="zone__label" data-top-label></h2>
          <div class="zone__cards zone__cards--shop" data-top-cards></div>
        </section>
        <section class="zone zone--player-battle" aria-label="我方战场">
          <h2 class="zone__label">我方战场</h2>
          <div class="zone__cards zone__cards--drop" data-player-battle-cards></div>
        </section>
        <section class="zone zone--hand" aria-label="手牌">
          <h2 class="zone__label">手牌</h2>
          <div class="zone__cards" data-hand-cards></div>
        </section>
        <section class="zone zone--reserved" aria-label="预留区">
          <h2 class="zone__label">预留区</h2>
          <p class="zone__placeholder">下方功能预留（装备/物品使用等）</p>
        </section>
      </main>
      <p class="game-board__hint">拖拽「角色」手牌至我方战场；准备阶段可在商店购买</p>
    `;

    this.bindControls();
    this.render();
    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();
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
        this.commitState(setPhase(this.state, next));
      });

    this.root
      .querySelector('[data-action="toggle-music"]')
      ?.addEventListener('click', () => {
        this.musicOn = !this.musicOn;
        if (this.musicOn) {
          this.music.playMelody();
        } else {
          this.music.stop();
        }
        this.updateMusicButton();
      });
  }

  private updateMusicButton(): void {
    const btn = this.root.querySelector('[data-action="toggle-music"]');
    if (btn) {
      btn.textContent = this.musicOn ? '音乐：开' : '音乐';
    }
  }

  private handleResize(): void {
    const handZone = this.root.querySelector<HTMLElement>('[data-hand-cards]');
    if (!handZone) return;
    const maxH = Math.min(140, Math.max(72, window.innerHeight * 0.12));
    const maxW = (handZone.clientWidth - 32) / 4;
    this.cardSize = scaleTcgToFit(maxH, maxW);
    this.render();
  }

  private commitState(state: GameState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
    this.render();
  }

  private clearDrags(): void {
    for (const fn of this.dragCleanups) fn();
    this.dragCleanups = [];
  }

  private getDropZone(): HTMLElement | null {
    return this.root.querySelector('[data-player-battle-cards]');
  }

  private render(): void {
    this.clearDrags();

    const goldEl = this.root.querySelector('[data-gold]');
    const phaseLabel = this.root.querySelector('[data-phase-label]');
    const topLabel = this.root.querySelector('[data-top-label]');
    const topCards = this.root.querySelector('[data-top-cards]');
    const playerBattle = this.root.querySelector('[data-player-battle-cards]');
    const handCards = this.root.querySelector('[data-hand-cards]');

    if (!goldEl || !phaseLabel || !topLabel || !topCards || !playerBattle || !handCards) {
      return;
    }

    const isPrep = this.state.phase === 'prep';
    goldEl.textContent = `金币 ${this.state.gold}`;
    phaseLabel.textContent = isPrep ? '准备阶段' : '战斗阶段';
    topLabel.textContent = isPrep ? '商店' : '敌方战场';
    this.root.dataset.phase = this.state.phase;

    topCards.innerHTML = '';
    playerBattle.innerHTML = '';
    handCards.innerHTML = '';

    if (isPrep) {
      for (const listing of this.state.shopListings) {
        if (listing.stock === 0) continue;
        const display = createCardInstance(listing.template);
        const price = listing.template.price ?? 0;
        const el = createCardElement(display, {
          size: this.cardSize,
          showTags: true,
          shopPrice: price,
          onBuy: () => this.tryBuy(listing.template.id),
        });
        topCards.append(el);
      }
    } else {
      for (const card of this.state.zones.enemyBattlefield) {
        topCards.append(
          createCardElement(card, { size: this.cardSize, showTags: true })
        );
      }
    }

    for (const card of this.state.zones.playerBattlefield) {
      playerBattle.append(
        createCardElement(card, { size: this.cardSize, showTags: true })
      );
    }

    for (const card of this.state.zones.hand) {
      const isCharacter = card.data.tags.includes('character');
      const el = createCardElement(card, {
        size: this.cardSize,
        draggableToBattle: isCharacter,
        showTags: true,
      });
      if (isCharacter) {
        this.dragCleanups.push(
          attachPointerDrag({
            source: el,
            instanceId: card.instanceId,
            onDrop: (id) => this.tryPlay(id),
            getDropZone: () => this.getDropZone(),
            createGhost: createDragGhost,
          })
        );
      }
      handCards.append(el);
    }
  }

  private tryPlay(instanceId: string): void {
    const result = playCharacterFromHand(this.state, instanceId);
    if (result.ok) {
      this.commitState(result.state);
    } else {
      this.showToast(result.reason);
    }
  }

  private tryBuy(templateId: string): void {
    const result = buyFromShop(this.state, templateId);
    if (result.ok) {
      this.commitState(result.state);
      this.showToast('购买成功，已加入手牌');
    } else {
      this.showToast(result.reason);
    }
  }

  private showToast(message: string): void {
    let toast = this.root.querySelector('.game-board__toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'game-board__toast';
      this.root.append(toast);
    }
    toast.textContent = message;
    toast.classList.add('game-board__toast--visible');
    window.setTimeout(() => {
      toast?.classList.remove('game-board__toast--visible');
    }, 2200);
  }
}
