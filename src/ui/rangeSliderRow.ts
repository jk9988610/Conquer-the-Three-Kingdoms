export interface RangeSliderRowOptions {
  label: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  className?: string;
  formatValue?: (value: number) => string;
  /** 滑条拖动过程中（input） */
  onInput?: (value: number) => void;
  /** 松手或步进按钮（change / click） */
  onChange: (value: number) => void;
}

export interface RangeSliderRowHandle {
  root: HTMLElement;
  setValue: (value: number, options?: { silent?: boolean }) => void;
  getValue: () => number;
}

export function createRangeSliderRow(options: RangeSliderRowOptions): RangeSliderRowHandle {
  const min = options.min ?? 0;
  const max = options.max ?? 100;
  const step = options.step ?? 1;
  let value = clamp(options.value ?? min, min, max);
  const format = options.formatValue ?? ((v: number) => String(v));

  const root = document.createElement('div');
  root.className = ['range-slider-row', options.className].filter(Boolean).join(' ');

  const head = document.createElement('div');
  head.className = 'range-slider-row__head';

  const labelEl = document.createElement('span');
  labelEl.className = 'range-slider-row__label';
  labelEl.textContent = options.label;

  const controls = document.createElement('div');
  controls.className = 'range-slider-row__controls';

  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 'btn range-slider-row__step';
  minusBtn.setAttribute('aria-label', '减小');
  minusBtn.textContent = '−';

  const valEl = document.createElement('span');
  valEl.className = 'range-slider-row__val';
  valEl.textContent = format(value);

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'btn range-slider-row__step';
  plusBtn.setAttribute('aria-label', '增大');
  plusBtn.textContent = '+';

  controls.append(minusBtn, valEl, plusBtn);
  head.append(labelEl, controls);

  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'range-slider-row__range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);

  root.append(head);
  if (options.description) {
    const desc = document.createElement('span');
    desc.className = 'range-slider-row__desc';
    desc.textContent = options.description;
    root.append(desc);
  }
  root.append(range);

  const stopBubble = (e: Event): void => {
    e.stopPropagation();
  };
  range.addEventListener('pointerdown', stopBubble);
  range.addEventListener('touchstart', stopBubble, { passive: true });

  function emitChange(): void {
    valEl.textContent = format(value);
    range.value = String(value);
    options.onChange(value);
  }

  function setValue(next: number, opts: { silent?: boolean } = {}): void {
    value = clamp(next, min, max);
    valEl.textContent = format(value);
    range.value = String(value);
    if (!opts.silent) options.onChange(value);
  }

  range.addEventListener('input', () => {
    value = clamp(Number(range.value) || min, min, max);
    valEl.textContent = format(value);
    range.value = String(value);
    if (options.onInput) options.onInput(value);
    else emitChange();
  });

  range.addEventListener('change', () => {
    value = clamp(Number(range.value) || min, min, max);
    valEl.textContent = format(value);
    range.value = String(value);
    emitChange();
  });

  minusBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setValue(value - step);
  });

  plusBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setValue(value + step);
  });

  return {
    root,
    setValue,
    getValue: () => value,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
