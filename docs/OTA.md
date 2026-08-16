# OTA 自动更新（征战三国 TCG）

APK 是 Capacitor 壳，**日常改 `src/` 合并 `main` 即可热更新**；只有改原生壳、Capacitor 插件或 OTA 引导逻辑时才需重打 APK。

流程与 [elecdog 仓库 OTA](https://github.com/jk9988610/elecdog/blob/main/docs/OTA.md) 一致，差异在于本项目用 **Vite 打包**（`dist/` / `www/`），而非裸 ES module。

---

## 一、工作流

```text
合并 main
  → CI：stamp 版本 → npm run build（Pages dist）→ build-ota.mjs（www + zip）
  → Pages 发布 dist/ 与 dist/updates/www.json + zip
  → 用户打开 APK（联网）
  → 拉清单 → 下载 zip → 切换 bundle → 刷新
```

| 角色 | 操作 |
|------|------|
| 开发者 | 改 `src/` → 合并 `main`，等 Pages 部署（约 1 分钟） |
| 用户（已装 APK） | 打开 App 自动检查；**无需 Termux、无需重装** |
| 壳层变更 | 提高 `versionCode`、更新 `updates/apk.json`、重打 APK |

---

## 二、与 elecdog 的对照

| 维度 | elecdog | 征战三国 TCG |
|------|---------|--------------|
| 前端构建 | 无 bundler，`prepare-www` 复制 `src/` + `node_modules` | Vite → `dist/`（Pages）/ `www/`（APK/OTA） |
| Pages base | `/elecdog/` | `/Conquer-the-Three-Kingdoms/` |
| APK/OTA base | 相对路径 + import map | `CAPACITOR_BUILD=true` → `base: './'` |
| OTA 清单 | `…/elecdog/updates/www.json` | `…/Conquer-the-Three-Kingdoms/updates/www.json` |
| appId | `com.elecdog.observer` | `com.tcg.threekingdoms` |
| OTA zip 体积 | ~500KB（含 node_modules） | ~数百 KB（Vite 打包后，无 node_modules） |

---

## 三、关键文件

| 文件 | 作用 |
|------|------|
| `src/ota/native-bridge.ts` | Capgo 原生桥（`nativePromise`，不 import `@capgo/*`） |
| `src/ota/config.ts` | OTA 清单 URL |
| `src/site-build.ts` | 网页构建版本（CI / `build-ota` 写入） |
| `src/main.ts` | 启动 → OTA → 游戏 → `notifyAppReady` |
| `scripts/prepare-www.mjs` | `CAPACITOR_BUILD` 构建到 `www/` |
| `scripts/build-ota.mjs` | Capgo CLI 打 zip + `updates/www.json` |
| `capacitor.config.json` | `webDir: www`，`autoUpdate: false` |
| `updates/apk.json` | 整包 APK 更新（少见） |

---

## 四、版本号规则

```text
OTA 版本 = 1.0.${GITHUB_RUN_NUMBER}
```

须与 APK `versionName "1.0"` 同主版本。若 OTA 用 `0.30.x` 而壳为 `1.0`，semver 会认为无需更新。

---

## 五、验收

```bash
curl -s https://jk9988610.github.io/Conquer-the-Three-Kingdoms/updates/www.json

curl -sI "https://jk9988610.github.io/Conquer-the-Three-Kingdoms/updates/www-1.0.1.zip" | head -3
```

APK：启动不白屏；合并 main 后联网重启应拉取新 bundle。

---

## 六、Termux 打 APK

详见 [apk-termux.md](./apk-termux.md)。

---

## 七、踩坑（来自 elecdog 实测）

1. **勿在浏览器顶层 import `@capgo/*`** — 仅 APK 内通过 `native-bridge` 调原生。
2. **CI 必须 `npm ci`** — 否则 Capgo 相关依赖缺失。
3. **每次启动须 `notifyAppReady()`** — 否则 Capgo 回滚热更包。
4. **清单 CDN 缓存** — `native-bridge` 拉清单带 `?nocache=` 时间戳。
5. **Pages 与 APK 双构建** — Pages 用 `GITHUB_PAGES=true`（绝对 base）；OTA/APK 用 `CAPACITOR_BUILD=true`（`base: './'`），不可混用同一 `dist/`。
