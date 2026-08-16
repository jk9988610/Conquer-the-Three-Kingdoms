/** 启动后写入，供界面显示 OTA / 卡图加载状态 */

export interface BootStatus {
  appVersion: string;
  /** CI / OTA 网页包版本（1.0.xx） */
  siteOtaVersion: string;
  /** APK 热更 bundle：内置 / 热更 1.0.xx */
  otaBundleLabel: string;
  otaDetail: string;
  artManifestUrl: string;
  artEntryCount: number;
  artImageLoaded: number;
  artLoadHint: string;
  nativeShell: boolean;
}

const bootStatus: BootStatus = {
  appVersion: '0.0.0',
  siteOtaVersion: 'dev',
  otaBundleLabel: '',
  otaDetail: '',
  artManifestUrl: '',
  artEntryCount: 0,
  artImageLoaded: 0,
  artLoadHint: '',
  nativeShell: false,
};

export function setBootStatus(patch: Partial<BootStatus>): void {
  Object.assign(bootStatus, patch);
}

export function getBootStatus(): Readonly<BootStatus> {
  return bootStatus;
}

export function formatVersionLine(status: BootStatus): string {
  const parts = [`v${status.appVersion}`];
  if (status.nativeShell && status.otaBundleLabel) {
    parts.push(status.otaBundleLabel);
  } else if (status.siteOtaVersion && status.siteOtaVersion !== 'dev') {
    parts.push(`网页 ${status.siteOtaVersion}`);
  }
  return parts.join(' · ');
}
