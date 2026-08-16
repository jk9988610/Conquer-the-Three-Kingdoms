#!/usr/bin/env node
/**
 * 为 Gradle 写入 android/local.properties（sdk.dir）
 * Termux / 本机：优先 ANDROID_HOME，其次常见路径，最后尝试从 elecdog 复制
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const localProps = join(androidDir, 'local.properties');

function hasAndroidSdk(dir) {
  if (!dir || !existsSync(dir)) return false;
  return existsSync(join(dir, 'platforms')) || existsSync(join(dir, 'build-tools'));
}

function readSdkFromLocalProperties(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('sdk.dir='));
  if (!line) return null;
  const value = line.slice('sdk.dir='.length).trim();
  return value.replace(/\\/g, '/');
}

function writeLocalProperties(sdkDir) {
  const normalized = sdkDir.replace(/\\/g, '/');
  writeFileSync(localProps, `sdk.dir=${normalized}\n`);
  console.log(`已写入 android/local.properties → ${normalized}`);
}

if (existsSync(localProps)) {
  const existing = readSdkFromLocalProperties(localProps);
  if (existing && hasAndroidSdk(existing)) {
    console.log(`android/local.properties 已存在且有效 → ${existing}`);
    process.exit(0);
  }
}

const prefix = process.env.PREFIX || '';
const candidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  join(homedir(), 'android-sdk'),
  join(homedir(), 'Android', 'Sdk'),
  '/data/data/com.termux/files/home/android-sdk',
  prefix ? join(prefix, 'share', 'android-sdk') : null,
  prefix ? join(prefix, 'opt', 'android-sdk') : null,
  join(homedir(), 'elecdog', 'android-sdk'),
].filter(Boolean);

let sdkDir = candidates.find((p) => hasAndroidSdk(p));

if (!sdkDir) {
  const elecdogProps = join(homedir(), 'elecdog', 'android', 'local.properties');
  const fromElecdog = readSdkFromLocalProperties(elecdogProps);
  if (fromElecdog && hasAndroidSdk(fromElecdog)) {
    sdkDir = fromElecdog;
    console.log(`从 elecdog 读取 SDK 路径: ${elecdogProps}`);
  }
}

if (!sdkDir) {
  console.error(`
未找到 Android SDK。征战三国与 elecdog 共用同一套 SDK，任选一种方式：

【最快】若 elecdog 能编 APK，直接复制：
  cp ~/elecdog/android/local.properties android/local.properties

【或】在 Termux 设置环境变量后重试：
  export ANDROID_HOME=$HOME/android-sdk    # 改成你的实际路径
  echo "sdk.dir=$ANDROID_HOME" > android/local.properties

【或】运行本脚本前 export ANDROID_HOME=你的SDK路径

常见 Termux 路径：
  $HOME/android-sdk
  $PREFIX/share/android-sdk
`);
  process.exit(1);
}

writeLocalProperties(sdkDir);
