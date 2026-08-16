/**
 * Capgo 原生桥接 — 不依赖 @capgo npm import，内置包与热更包均可运行
 */

import { OTA_WWW_MANIFEST } from './config';

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options?: object) => Promise<unknown>;
  Plugins?: { CapacitorUpdater?: Record<string, (options?: object) => Promise<unknown>> };
};

function cap(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativeShell(): boolean {
  return cap()?.isNativePlatform?.() === true;
}

async function nativeCall(method: string, options: object = {}): Promise<unknown> {
  const c = cap();
  if (!c) throw new Error('Capacitor 不可用');
  if (typeof c.nativePromise === 'function') {
    return c.nativePromise('CapacitorUpdater', method, options);
  }
  const plugin = c.Plugins?.CapacitorUpdater;
  if (plugin?.[method]) return plugin[method](options);
  throw new Error(`CapacitorUpdater.${method} 不可用`);
}

function normalizeVersionParts(v: unknown): number[] {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (!s || s === 'builtin' || s === 'built-in' || s === 'internal') {
    return [0, 0, 0];
  }
  const parts = s.replace(/[^0-9.]/g, '').split('.');
  const nums = parts.map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n));
  if (!nums.length) return [0, 0, 0];
  while (nums.length < 3) nums.push(0);
  return nums;
}

function semverGt(a: unknown, b: unknown): boolean {
  const pa = normalizeVersionParts(a);
  const pb = normalizeVersionParts(b);
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

type WwwManifest = { version: string; url: string; checksum?: string };

async function fetchWwwManifest(): Promise<WwwManifest> {
  const url = `${OTA_WWW_MANIFEST}?nocache=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`清单 HTTP ${res.status}`);
  }
  const manifest = (await res.json()) as WwwManifest;
  if (!manifest?.version || !manifest?.url) {
    throw new Error('清单格式错误');
  }
  return manifest;
}

type BundleInfo = { bundle?: { version?: string } };

async function currentBundleInfo(): Promise<BundleInfo> {
  try {
    return ((await nativeCall('current')) as BundleInfo) || {};
  } catch {
    return {};
  }
}

function formatLabel(cur: BundleInfo): string {
  const v = cur?.bundle?.version;
  return v ? `热更 ${v}` : '热更 内置';
}

export async function getBundleVersionLabelNative(): Promise<string> {
  if (!isNativeShell()) return '';
  return formatLabel(await currentBundleInfo());
}

export async function fetchOnlineOtaVersion(): Promise<string> {
  const manifest = await fetchWwwManifest();
  return manifest.version;
}

export type WebOtaStatus = {
  local: string;
  online: string | null;
  newer: boolean;
  status: string;
};

export async function checkWebOtaStatus(localVersion = 'dev'): Promise<WebOtaStatus> {
  try {
    const online = await fetchOnlineOtaVersion();
    const newer = semverGt(online, localVersion);
    return {
      local: localVersion,
      online,
      newer,
      status: newer
        ? `网页 ${localVersion} → 线上 ${online} · 请强制刷新或清缓存`
        : `网页 ${localVersion} → 线上 ${online} · 已最新`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      local: localVersion,
      online: null,
      newer: false,
      status: `清单失败: ${msg}`,
    };
  }
}

export async function notifyAppReadyNative(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await nativeCall('notifyAppReady');
  } catch (err) {
    console.warn('[ota] notifyAppReady failed', err);
  }
}

export type OtaBootstrapResult = {
  updated: boolean;
  label: string;
  status: string;
};

export async function runOtaBootstrapNative(): Promise<OtaBootstrapResult> {
  if (!isNativeShell()) {
    return { updated: false, label: '', status: '' };
  }

  let status = '';
  try {
    const cur = await currentBundleInfo();
    const current = cur?.bundle?.version || '0.0.0';
    const label = formatLabel(cur);

    const manifest = await fetchWwwManifest();

    status = `本机 ${current} → 线上 ${manifest.version}`;

    if (!semverGt(manifest.version, current)) {
      return { updated: false, label, status: `${status} · 已最新` };
    }

    status = `${status} · 下载中…`;
    const bundle = await nativeCall('download', {
      version: manifest.version,
      url: manifest.url,
      checksum: manifest.checksum,
    });

    status = `${status} · 切换中…`;
    await nativeCall('set', bundle as object);
    return {
      updated: true,
      label: `热更 ${manifest.version}`,
      status: `${status} · 完成 · 正在重载…`,
    };
  } catch (err) {
    const label = await getBundleVersionLabelNative();
    const msg = err instanceof Error ? err.message : String(err);
    return {
      updated: false,
      label,
      status: status ? `${status} · 失败: ${msg}` : `失败: ${msg}`,
    };
  }
}
