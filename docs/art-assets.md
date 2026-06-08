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

## 与 Card-World 共用 Supabase 项目

[Card-World](https://github.com/jk9988610/Card-World) 已配置同一 Supabase 项目（`js/cloud-config.js`）：

| 桶 / 表 | 用途 |
|---------|------|
| `art` + `art_shop_works` | Card World **素材商店**（用户上传 pixel/v1 + PNG） |
| `audio` + `published_works` | HarmonyForge 编曲发布 |
| **`card-art`** | **征战三国**正式卡图（本仓库 `upload-art` 脚本） |

Card-World 的 GitHub Pages **不在 CI 里调 Supabase**；静态页部署后，浏览器用 anon key 直连 API。本游戏同理：清单 URL 指向 Supabase 公共地址即可。

### SQL Editor 执行顺序（征战三国专用桶）

在 [Supabase Dashboard](https://supabase.com/dashboard) → **SQL Editor** → New query，按顺序执行：

1. `supabase/schema-card-art-bucket.sql` — 创建 `card-art` 公共桶  
2. `supabase/schema-card-art-storage-policies.sql` — 读取/上传策略  
3. （可选）`supabase/schema-card-art-catalog.sql` — 日后商店「审核上架」用目录表  

若桶已在 Dashboard 建好，文件 1 的 `INSERT` 会因 `on conflict` 安全跳过，仍建议执行文件 2。

### 上传后公共 URL 模板

```
https://yjqkotqmglxjhlrhynsu.supabase.co/storage/v1/object/public/card-art/manifest.json
https://yjqkotqmglxjhlrhynsu.supabase.co/storage/v1/object/public/card-art/lvbu.png
```

`.env`：

```
VITE_ART_MANIFEST_URL=https://yjqkotqmglxjhlrhynsu.supabase.co/storage/v1/object/public/card-art/manifest.json
SUPABASE_URL=https://yjqkotqmglxjhlrhynsu.supabase.co
```

## GitHub Pages 部署（自动联网加载卡图）

推送 `main` 分支后，`.github/workflows/deploy-pages.yml` 自动构建并发布：

- 站点：`https://jk9988610.github.io/Conquer-the-Three-Kingdoms/`
- 构建时注入 `VITE_ART_MANIFEST_URL` → 打开页面自动从 Supabase 拉 `manifest.json` 与 PNG
- **上传新卡图后无需重新部署页面**（只要更新 Supabase 上的 manifest 与 PNG）

### 一次性设置

1. **必须先做：** [Settings → Pages](https://github.com/jk9988610/Conquer-the-Three-Kingdoms/settings/pages) → **Source** 选 **GitHub Actions**（未做会报 `Get Pages site failed` / `Not Found`）
2. **Actions** 里 Re-run **Deploy to GitHub Pages**，或 push 到 `main` 触发
3. 完成 Supabase 第 1～2 步 SQL 后，用 `npm run upload-art` 上传卡图（日后可做 CI 自动上传）

排错详见 `docs/deploy-pages.md`。

本地开发仍为 `npm run dev`（`base: /`）；仅 CI 构建使用 `/Conquer-the-Three-Kingdoms/` 前缀。

## 环境变量

见仓库根目录 `.env.example`。
