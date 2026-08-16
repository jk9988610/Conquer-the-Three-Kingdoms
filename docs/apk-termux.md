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

### 平板 Termux 装到本机（最常见）

在 **同一台平板** 的 Termux 里编译时，**不要用 `adb install`**，通常会报：

```text
adb: no devices/emulators found
```

本机 Termux 不会自动出现在 `adb devices` 里。请用 **复制到「下载」+ 点安装**。

**推荐（一条命令复制）：**

```bash
cd ~/Conquer-the-Three-Kingdoms
npm run apk:copy
```

然后在 **文件管理器 → 下载 → tcg-debug.apk** 点安装。

**首次若提示找不到 Download 目录**，分两步（**不要在一行里混着输**）：

```bash
termux-setup-storage
```

出现 `Do you want to continue? (y/n)` 时 **只输入 `y` 再回车**，等脚本结束。

```bash
npm run apk:copy
```

**手动复制（等价于 apk:copy）：**

```bash
cp android/app/build/outputs/apk/debug/app-debug.apk \
  ~/storage/shared/Download/tcg-debug.apk
```

注意：`tcg-debug.apk` 是 **要复制到的文件路径**，不要单独敲路径当命令（会报 Permission denied）。

若共享存储仍不可用，可先放到主目录：

```bash
cp android/app/build/outputs/apk/debug/app-debug.apk ~/tcg-debug.apk
```

打开 **文件管理器 → 下载 → tcg-debug.apk** 安装。若提示不允许安装未知应用，给文件管理器或 Termux 开安装权限。

**或用系统安装器直接拉起：**

```bash
npm run apk:copy

am start -a android.intent.action.VIEW \
  -d file:///storage/emulated/0/Download/tcg-debug.apk \
  -t application/vnd.android.package-archive
```

### 要不要手动复制？

| 场景 | 做法 |
|------|------|
| **平板 Termux → 装到本机** | 复制到 Download，**不用 adb** |
| **电脑 USB 连平板** | 电脑上 `adb install -r …` |
| **无线调试**（Android 11+） | `adb pair` + `adb connect` 后再 `adb install` |
| 传到别的设备 | 复制、`scp` 或网盘 |

### 确认文件位置

```bash
cd ~/Conquer-the-Three-Kingdoms/android/app/build/outputs/apk/debug
realpath app-debug.apk
ls -lh app-debug.apk
```

### 复制到 Termux 主目录（备份用）

```bash
cp app-debug.apk ~/tcg-debug.apk
```

### 用 adb 安装（电脑或已配对无线调试）

**在电脑** 通过 USB（平板已开 USB 调试）：

```bash
adb devices          # 应显示 device
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**无线调试**（开发者选项 → 无线调试 → 配对码）：

```bash
adb pair 192.168.x.x:xxxxx    # 配对端口 + 配对码
adb connect 192.168.x.x:xxxxx # 连接端口
adb devices
adb install -r ~/Conquer-the-Three-Kingdoms/android/app/build/outputs/apk/debug/app-debug.apk
```

覆盖安装（保留数据）用 `-r`。

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

**adb: no devices/emulators found**

在 **平板 Termux 本机** 执行 `adb install` 时出现此报错是正常的：本机不会自动作为 adb 设备出现。请改用上文 **「平板 Termux 装到本机」** 的复制 + 点安装方式；只有电脑 USB 或无线调试配对成功后才用 `adb install`。

**白屏**

- 确认 `www/index.html` 内资源为相对路径（`./assets/…`），不要用 Pages 的 `/Conquer-the-Three-Kingdoms/` 前缀构建 APK。
- 必须用 `npm run cap:sync`（会触发 `CAPACITOR_BUILD`），不要直接把 `dist/`（Pages 构建）拷进 `android/`。

**热更不生效**

- 看 `updates/www.json` 的 `version` 是否大于本机 bundle。
- OTA 版本须为 `1.0.x`，与 APK `versionName 1.0` 一致。
- 确认 CI 日志中 `build-ota.mjs` 成功且 zip 体积合理（非几十 KB）。

**卡图不显示 / APK 没有加载图片 / 蓝色色块**

- **热更包必须含 `cards/*.png`**：若 CI 只打出约 125KB 的 zip、无卡图，热更后仍会显示蓝色默认块（`1.0.19` 即此类包，无法靠该版本修复）。
- 合并本修复后，CI 会在 **未捆绑卡图时直接失败**，避免再发布空卡图 OTA。
- 卡图来源：网页「绘制」**上传云端**（Supabase `card-art`），或把 `*.png` 放入 `public/cards/` 后 `npm run build-art-manifest`。
- Termux 打 APK 时 `cap:sync` 日志应出现 **「已捆绑 N 张卡图」**；若无，检查联网与 Supabase 清单。
- App 需 **联网** 才能从 Supabase 回退拉取（本地 `www/cards/` 为空时）。

```bash
cd ~/Conquer-the-Three-Kingdoms
git pull origin main
npm run cap:sync
npm run apk:debug
# 再复制到 Download 安装，或覆盖安装
```

- 已装旧 APK 也可 **联网打开 App** 等待 OTA 热更（合并 `main` 后 CI 会发布新 bundle）。
- 打开游戏 **状态** 面板可查看：`热更 1.0.xx`、`已载 PNG` 数量；点 **检查热更** 可确认是否更新成功。
- **v0.3.54** 是应用版本号（`package.json`），**不会**因 OTA 变化；热更版本显示为 **热更 1.0.xx**。
- 构建时可显式指定（与 CI 相同）：

```bash
export VITE_ART_MANIFEST_URL='https://yjqkotqmglxjhlrhynsu.supabase.co/storage/v1/object/public/card-art/manifest.json'
npm run cap:sync
```
