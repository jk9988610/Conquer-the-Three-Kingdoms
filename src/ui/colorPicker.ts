/** HSV 色盘 + 透明度滑条 */
export interface ColorPickerValue {
  css: string;
  hex: string;
  alpha: number;
}

export interface ColorPickerHandle {
  element: HTMLElement;
  setFromCss: (css: string) => void;
}

export function createColorPicker(
  initial: ColorPickerValue,
  onChange: (v: ColorPickerValue) => void
): ColorPickerHandle {
  const wrap = document.createElement('div');
  wrap.className = 'color-picker';

  let hue = 0;
  let sat = 1;
  let val = 1;
  let alpha = initial.alpha;

  const wheel = document.createElement('canvas');
  wheel.className = 'color-picker__wheel';
  wheel.width = 120;
  wheel.height = 120;

  const preview = document.createElement('div');
  preview.className = 'color-picker__preview';

  const alphaRow = document.createElement('label');
  alphaRow.className = 'color-picker__alpha';
  alphaRow.innerHTML = `透明度 <input type="range" min="0" max="100" value="${Math.round(alpha * 100)}" data-alpha-range />`;
  const alphaRange = alphaRow.querySelector<HTMLInputElement>('[data-alpha-range]')!;

  wrap.append(wheel, preview, alphaRow);

  function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    const mod = i % 6;
    if (mod === 0) return [v, t, p];
    if (mod === 1) return [q, v, p];
    if (mod === 2) return [p, v, t];
    if (mod === 3) return [p, q, v];
    if (mod === 4) return [t, p, v];
    return [v, p, q];
  }

  function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    const s = max === 0 ? 0 : d / max;
    return [h, s, max];
  }

  function emit(): void {
    const [r, g, b] = hsvToRgb(hue, sat, val).map((n) => Math.round(n * 255));
    const css = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    const hex =
      '#' +
      [r, g, b]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
    preview.style.background = css;
    onChange({ css, hex, alpha });
  }

  function drawWheel(): void {
    const ctx = wheel.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = wheel;
    const cx = w / 2;
    const cy = h / 2;
    const R = w / 2 - 2;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * w + x) * 4;
        if (dist > R) {
          img.data[i + 3] = 0;
          continue;
        }
        const ang = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
        const s = dist / R;
        const [r, g, b] = hsvToRgb(ang, s, 1).map((n) => Math.round(n * 255));
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function pickFromWheel(clientX: number, clientY: number): void {
    const rect = wheel.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), cx - 2);
    const ang = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
    hue = ang;
    sat = dist / (cx - 2);
    val = 1;
    emit();
  }

  let wheelDragging = false;
  wheel.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    wheelDragging = true;
    wheel.setPointerCapture(e.pointerId);
    pickFromWheel(e.clientX, e.clientY);
  });
  wheel.addEventListener('pointermove', (e) => {
    if (!wheelDragging) return;
    pickFromWheel(e.clientX, e.clientY);
  });
  wheel.addEventListener('pointerup', () => {
    wheelDragging = false;
  });

  alphaRange.addEventListener('input', () => {
    alpha = Number(alphaRange.value) / 100;
    emit();
  });

  const init = initial.css.match(/rgba?\(([^)]+)\)/);
  if (init) {
    const parts = init[1].split(',').map((s) => Number(s.trim()));
    if (parts.length >= 3) {
      [hue, sat, val] = rgbToHsv(parts[0], parts[1], parts[2]);
      if (parts.length >= 4) alpha = parts[3];
    }
  }

  function setFromCss(css: string): void {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(',').map((s) => Number(s.trim()));
      if (parts.length >= 3) {
        [hue, sat, val] = rgbToHsv(parts[0], parts[1], parts[2]);
        if (parts.length >= 4) alpha = parts[3];
      }
    } else if (css.startsWith('#')) {
      let hex = css.slice(1);
      if (hex.length === 3) {
        hex = hex
          .split('')
          .map((ch) => ch + ch)
          .join('');
      }
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      [hue, sat, val] = rgbToHsv(r, g, b);
    }
    alphaRange.value = String(Math.round(alpha * 100));
    emit();
  }

  drawWheel();
  alphaRange.value = String(Math.round(alpha * 100));
  emit();

  return { element: wrap, setFromCss };
}
