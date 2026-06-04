# Conquer-the-Three-Kingdoms

TCG 尺寸标准的卡牌游戏前端框架（Vite + TypeScript）。

## 卡牌规格

- 标准尺寸：**宽 63.5 × 高 88.9**（逻辑单位，等比缩放）
- 内框边距：左右 **3%**，上下 **4%**
- 卡面分层：**像素画图像层**（程序绘制）+ **文本层**（名称、描述）

## 区域

| 区域 | 说明 |
|------|------|
| 上半 | 准备阶段 **商店**；战斗阶段 **敌方战场** |
| 下半 | **我方战场**（拖拽角色上场） |
| 手牌 | 我方手牌 |
| 预留区 | 装备/物品使用等（待实现） |

## 当前功能

- 手牌含 **吕布** 等角色；**仅拖拽** 上场（无点击上场，避免长按选中文字）
- 玩家初始 **1000 金币**
- 商店：**治疗药水**（30 金，选中角色治疗 20 生命）、**方天画戟**（100 金，+10 攻击）
- **MIDI 风格背景音乐**：Web Audio 采样器，音符数据内嵌（无音频文件）
- 像素画：吕布、药水、方天画戟等均由 `canvas` 代码绘制

## 开发

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Termux 若 `Illegal instruction`，请使用 `vite@5.4.11`。

## 目录

```
src/
  tcg/dimensions.ts
  game/catalog.ts      # 卡牌与商店定义
  game/types.ts
  game/state.ts
  game/actions.ts
  art/pixelArt.ts      # 程序像素画
  audio/midiSampler.ts # MIDI 风格采样回放
  ui/cardElement.ts
  ui/pointerDrag.ts
  ui/gameBoard.ts
```
