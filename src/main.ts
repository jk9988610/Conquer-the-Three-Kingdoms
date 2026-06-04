import './style.css';
import { createInitialState } from './game/state';
import type { CardData, GameState } from './game/types';
import { GameBoard } from './ui/gameBoard';

const sampleHand: CardData[] = [
  {
    id: 'char-liu',
    name: '刘备',
    tags: ['character'],
    description: '仁德之主',
  },
  {
    id: 'char-guan',
    name: '关羽',
    tags: ['character'],
    description: '武圣',
  },
  {
    id: 'char-zhang',
    name: '张飞',
    tags: ['character'],
    description: '万夫不当',
  },
  {
    id: 'action-demo',
    name: '突击（预留）',
    tags: ['action'],
    description: '动作卡暂未实现打出',
  },
];

let gameState: GameState = createInitialState(sampleHand);

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('未找到 #app 容器');
}

new GameBoard(app, gameState, {
  onStateChange: (state) => {
    gameState = state;
  },
});
