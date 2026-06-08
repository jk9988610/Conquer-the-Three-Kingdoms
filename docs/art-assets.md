# 卡图资源：PNG + 渲染 JSON

## 文件说明

| 文件 | 说明 |
|------|------|
| `{artKey}.png` | 60×84 卡面像素图（绘制页「导出资源包」） |
| `{artKey}.meta.json` | 渲染层：高亮/光晕/呼吸标记 + 速度 |
| `manifest.json` | 清单：列出所有 `artKey` → png + meta（由脚本生成） |

`meta.json` 示例：

```json
{
  "version": 1,
  "artKey": "lvbu",
  "highlightB64": "...",
  "highlightBreathSpeed": 50
}
```

## 最简工作流（GitHub）

1. 游戏内打开 **绘制** → 画好 → **导出资源包**（同时下载 `.png` 与 `.meta.json`）
2. 将两个文件放入仓库 `public/cards/`
3. 运行 `npm run build-art-manifest`（合并为 `manifest.json`）
4. `git add public/cards && git commit && git push`
5. 部署后刷新页面，卡牌自动加载 PNG

## Supabase（CDN / 日后素材商店）

### 一次性配置

1. Supabase 控制台 → **Storage** → 新建桶 `card-art`，勾选 **Public**
2. 复制项目 URL 与 **service_role** 密钥（仅用于本机/CI 上传脚本）

### 上传

```bash
npm run build-art-manifest
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
npm run upload-art
```

或一步：`npm run sync-art`（需已设置环境变量）。

脚本会上传 `public/cards/*` 并把 `manifest.json` 的 `baseUrl` 改为 Supabase 公共地址。

### 前端指向 Supabase

`.env` 或部署环境：

```
VITE_ART_MANIFEST_URL=https://xxxx.supabase.co/storage/v1/object/public/card-art/manifest.json
```

仍可将 `manifest.json` 提交 GitHub；`baseUrl` 指向 Supabase 时，PNG 从 CDN 加载。

## GitHub + Supabase 合并建议

| 存 GitHub | 存 Supabase |
|-----------|-------------|
| `*.meta.json`（小、可 diff） | `*.png`（二进制） |
| `manifest.json`（结构） | 同上，或仅 CDN |

流程：meta 与 manifest 走 Git PR；PNG 用 `upload-art` 推 Supabase；manifest 的 `baseUrl` 指向 Supabase。

## 环境变量

见仓库根目录 `.env.example`。
