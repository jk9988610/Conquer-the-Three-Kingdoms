import { playCharacterFromHand } from '../game/actions';
import { setPhase } from '../game/state';
import type { GameState } from '../game/types';
import { scaleTcgToFit, type TcgScaledSize } from '../tcg/dimensions';
import { createCardElement } from './cardElement';

export interface GameBoardCallbacks {
  onStateChange: (state: GameState) => void;
}

export class GameBoard {
  private root: HTMLElement;
  private state: GameState;
  private callbacks: GameBoardCallbacks;
  private cardSize: TcgScaledSize = scaleTcgToFit(120);

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
        <h1 class="game-board__title">TCG 卡牌框架</h1>
        <div class="game-board__controls">
          <span class="game-board__phase" data-phase-label></span>
          <button type="button" class="btn" data-action="toggle-phase">切换阶段</button>
        </div>
      </header>
      <main class="game-board__main">
        <section class="zone zone--top" data-zone="top" aria-label="敌方战场或商店">
          <h2 class="zone__label" data-top-label></h2>
          <div class="zone__cards" data-top-cards></div>
        </section>
        <section class="zone zone--player-battle" data-zone="player-battle" aria-label="我方战场">
          <h2 class="zone__label">我方战场</h2>
          <div class="zone__cards zone__cards--drop" data-player-battle-cards></div>
        </section>
        <section class="zone zone--hand" data-zone="hand" aria-label="手牌">
          <h2 class="zone__label">手牌</h2>
          <div class="zone__cards" data-hand-cards></div>
        </section>
      </main>
      <p class="game-board__hint">点击或拖拽「角色」手牌至我方战场打出</p>
    `;

    this.bindControls();
    this.bindDropDelegation();
    this.render();
    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();
  }

  updateState(state: GameState): void {
    this.state = state;
    this.render();
  }

  private bindControls(): void {
    const toggleBtn = this.root.querySelector<HTMLButtonElement>(
      '[data-action="toggle-phase"]'
    );
    toggleBtn?.addEventListener('click', () => {
      const next = this.state.phase === 'prep' ? 'battle' : 'prep';
      const newState = setPhase(this.state, next);
      this.commitState(newState);
    });
  }

  private bindDropDelegation(): void {
    this.root.addEventListener('dragover', (e) => {
      const zone = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-player-battle-cards]'
      );
      if (!zone) return;
      e.preventDefault();
      zone.classList.add('zone__cards--drag-over');
    });
    this.root.addEventListener('dragleave', (e) => {
      const zone = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-player-battle-cards]'
      );
      if (!zone) return;
      const related = e.relatedTarget as Node | null;
      if (related && zone.contains(related)) return;
      zone.classList.remove('zone__cards--drag-over');
    });
    this.root.addEventListener('drop', (e) => {
      const zone = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-player-battle-cards]'
      );
      if (!zone) return;
      e.preventDefault();
      zone.classList.remove('zone__cards--drag-over');
      const id = e.dataTransfer?.getData('text/plain');
      if (id) this.tryPlay(id);
    });
  }

  private handleResize(): void {
    const handZone = this.root.querySelector<HTMLElement>('[data-hand-cards]');
    if (!handZone) return;
    const maxH = Math.min(140, Math.max(72, window.innerHeight * 0.14));
    const maxW = (handZone.clientWidth - 32) / 4;
    this.cardSize = scaleTcgToFit(maxH, maxW);
    this.render();
  }

  private commitState(state: GameState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
    this.render();
  }

  private render(): void {
    const phaseLabel = this.root.querySelector('[data-phase-label]');
    const topLabel = this.root.querySelector('[data-top-label]');
    const topCards = this.root.querySelector('[data-top-cards]');
    const playerBattle = this.root.querySelector('[data-player-battle-cards]');
    const handCards = this.root.querySelector('[data-hand-cards]');

    if (
      !phaseLabel ||
      !topLabel ||
      !topCards ||
      !playerBattle ||
      !handCards
    ) {
      return;
    }

    const isPrep = this.state.phase === 'prep';
    phaseLabel.textContent = isPrep ? '准备阶段' : '战斗阶段';
    topLabel.textContent = isPrep ? '商店区' : '敌方战场';
    this.root.dataset.phase = this.state.phase;

    topCards.innerHTML = '';
    playerBattle.innerHTML = '';
    handCards.innerHTML = '';

    const topList = isPrep
      ? this.state.zones.shop
      : this.state.zones.enemyBattlefield;
    for (const card of topList) {
      topCards.append(
        createCardElement(card, { size: this.cardSize, showTags: true })
      );
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
        playable: isCharacter,
        showTags: true,
      });
      if (isCharacter) {
        this.attachPlayHandlers(el, card.instanceId);
      }
      handCards.append(el);
    }
  }

  private attachPlayHandlers(el: HTMLElement, instanceId: string): void {
    el.addEventListener('click', () => this.tryPlay(instanceId));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.tryPlay(instanceId);
      }
    });
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', instanceId);
      el.classList.add('tcg-card--dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('tcg-card--dragging');
    });
  }

  private tryPlay(instanceId: string): void {
    const result = playCharacterFromHand(this.state, instanceId);
    if (result.ok) {
      this.commitState(result.state);
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
