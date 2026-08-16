# Termux 打 APK（征战三国）

前提：你已在 Termux 按 [elecdog](https://github.com/jk9988610/elecdog) 流程装好 **Node、Java、Android SDK、Gradle**。本仓库与 elecdog 使用同一套 Capacitor + Capgo OTA 命令，仅包名与 URL 不同。

---

## 一、首次打 APK

```bash
# 1. 克隆并进入仓库
cd ~
git clone https://github.com/jk9988610/Conquer-the-Three-Kingdoms.git
cd Conquer-the-Three-Kingdoms

# 2. 安装依赖
npm install

# 3. 配置 Android SDK（新仓库必须；与 elecdog 共用同一 SDK）
node scripts/setup-android-sdk.mjs
# 若 elecdog 能编而这里失败，直接复制：
# cp ~/elecdog/android/local.properties android/local.properties

# 4. 同步 www + Android（内部会 CAPACITOR_BUILD 构建到 www/）
npm run cap:sync

# 5. 打 debug APK
npm run apk:debug
```

产出路径：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

安装：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 二、日常热更新（默认路径）

**改 `src/` 合并 `main` 后**，GitHub Actions 会自动：

1. `npm run build` → Pages 站点 `dist/`
2. `build-ota.mjs` → `www/` + `updates/www.json` + zip
3. 部署到 `https://jk9988610.github.io/Conquer-the-Three-Kingdoms/`

已装 APK 的用户：**联网打开 App** 或重启，自动拉取 OTA，**无需 Termux**。

---

## 三、仅本地验证 OTA 包

```bash
export VITE_ART_MANIFEST_URL='https://yjqkotqmglxjhlrhynsu.supabase.co/storage/v1/object/public/card-art/manifest.json'

# 先打 Pages dist（可选，用于对照网页版）
export GITHUB_PAGES=true
npm run build

# 生成 OTA zip + updates/（会写入 src/site-build.ts 版本号）
OTA_VERSION=1.0.99 node scripts/build-ota.mjs
```

检查 `updates/www.json` 与 `updates/www-1.0.99.zip`。

---

## 四、何时需要重打 APK

| 情况 | 操作 |
|------|------|
| 只改游戏逻辑 / UI / `src/` | 合并 `main`，等 OTA |
| 改 `android/`、Capacitor 插件、`src/ota/` | `versionCode` +1，`updates/apk.json`，`npm run apk:debug` |
| 首次安装 | 打 APK 并安装 |

`android/app/build.gradle`：

```gradle
versionCode 2        // 递增
versionName "1.0"    // 与 OTA 主版本一致
```

---

## 五、与 elecdog Termux 命令对照

| elecdog | 征战三国 TCG |
|---------|--------------|
| `cd elecdog` | `cd Conquer-the-Three-Kingdoms` |
| `npm run cap:sync` | 相同 |
| `npm run apk:debug` | 相同 |
| OTA 清单 `…/elecdog/updates/www.json` | `…/Conquer-the-Three-Kingdoms/updates/www.json` |
| `com.elecdog.observer` | `com.tcg.threekingdoms` |

---

## 六、常见问题

**SDK location not found**

Gradle 报错 `SDK location not found` / 缺少 `android/local.properties`：

```bash
# 方法一（推荐）：从已能编译的 elecdog 复制
cp ~/elecdog/android/local.properties android/local.properties

# 方法二：自动探测
node scripts/setup-android-sdk.mjs

# 方法三：手动指定
export ANDROID_HOME=$HOME/android-sdk   # 你的实际 SDK 路径
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

npm run apk:debug
```

elecdog 与征战三国 **共用同一 SDK**，无需重复安装；只需每个仓库各有一份 `local.properties`（该文件不入 git）。

**白屏**

- 确认 `www/index.html` 内资源为相对路径（`./assets/…`），不要用 Pages 的 `/Conquer-the-Three-Kingdoms/` 前缀构建 APK。
- 必须用 `npm run cap:sync`（会触发 `CAPACITOR_BUILD`），不要直接把 `dist/`（Pages 构建）拷进 `android/`。

**热更不生效**

- 看 `updates/www.json` 的 `version` 是否大于本机 bundle。
- OTA 版本须为 `1.0.x`，与 APK `versionName 1.0` 一致。
- 确认 CI 日志中 `build-ota.mjs` 成功且 zip 体积合理（非几十 KB）。

**卡图不显示**

- APK 与网页均依赖 Supabase 卡图清单；构建时可设 `VITE_ART_MANIFEST_URL`（CI 已配置）。
