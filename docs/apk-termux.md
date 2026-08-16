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

Termux 完整路径示例：

```text
~/Conquer-the-Three-Kingdoms/android/app/build/outputs/apk/debug/app-debug.apk
/data/data/com.termux/files/home/Conquer-the-Three-Kingdoms/android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run apk:debug` 成功后，**APK 只在这里**，不会自动出现在别的目录。

---

## 二、APK 在哪、要不要复制、怎么安装

### 要不要手动复制？

| 用途 | 要不要复制 |
|------|------------|
| Termux 里用 `adb install` 安装 | **不用复制**，直接用路径安装 |
| 拷到平板「下载」等目录，用文件管理器点安装 | **需要复制** |
| 传到别的设备 | 需要复制或 `scp` |

### 确认文件位置

在 APK 目录下（或任意位置用完整路径）：

```bash
cd ~/Conquer-the-Three-Kingdoms/android/app/build/outputs/apk/debug
realpath app-debug.apk
ls -lh app-debug.apk
```

### 复制到方便找的位置

**复制到 Termux 主目录：**

```bash
cp app-debug.apk ~/tcg-debug.apk
```

**复制到平板「下载」目录（用文件管理器安装）：**

```bash
mkdir -p /sdcard/Download
cp app-debug.apk /sdcard/Download/tcg-debug.apk
```

然后在 **文件管理器 → 下载** 里找到 `tcg-debug.apk` 点击安装。

若 `/sdcard` 不可用，先授权存储再复制：

```bash
termux-setup-storage   # 按提示在系统里点「允许」
cp app-debug.apk ~/storage/shared/Download/tcg-debug.apk
```

### 用 adb 安装（无需复制）

在仓库根目录：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

若已在 `apk/debug` 目录：

```bash
adb install -r app-debug.apk
```

覆盖安装（保留数据）同样用 `-r`。

---

## 三、日常热更新（默认路径）

**改 `src/` 合并 `main` 后**，GitHub Actions 会自动：

1. `npm run build` → Pages 站点 `dist/`
2. `build-ota.mjs` → `www/` + `updates/www.json` + zip
3. 部署到 `https://jk9988610.github.io/Conquer-the-Three-Kingdoms/`

已装 APK 的用户：**联网打开 App** 或重启，自动拉取 OTA，**无需 Termux**。

---

## 四、仅本地验证 OTA 包

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

## 五、何时需要重打 APK

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

## 六、与 elecdog Termux 命令对照

| elecdog | 征战三国 TCG |
|---------|--------------|
| `cd elecdog` | `cd Conquer-the-Three-Kingdoms` |
| `npm run cap:sync` | 相同 |
| `npm run apk:debug` | 相同 |
| OTA 清单 `…/elecdog/updates/www.json` | `…/Conquer-the-Three-Kingdoms/updates/www.json` |
| `com.elecdog.observer` | `com.tcg.threekingdoms` |

---

## 七、常见问题

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
