/**
 * 基于 Web Audio 的简单 MIDI 风格回放（音符数据内嵌，不加载音乐文件）。
 */

type MidiEvent = { note: number; start: number; duration: number; velocity?: number };

/** 短旋律：准备阶段氛围（C 大调琶音） */
const PREP_MELODY: MidiEvent[] = [
  { note: 60, start: 0, duration: 0.35 },
  { note: 64, start: 0.35, duration: 0.35 },
  { note: 67, start: 0.7, duration: 0.35 },
  { note: 72, start: 1.05, duration: 0.5 },
  { note: 67, start: 1.6, duration: 0.35 },
  { note: 64, start: 1.95, duration: 0.5 },
];

const A4 = 440;

function midiToFreq(note: number): number {
  return A4 * Math.pow(2, (note - 69) / 12);
}

export class MidiSampler {
  private ctx: AudioContext | null = null;
  private loopTimer: number | null = null;
  private playing = false;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  playMelody(events: MidiEvent[] = PREP_MELODY, loop = true): void {
    this.stop();
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    this.playing = true;

    const schedule = () => {
      if (!this.playing || !this.ctx) return;
      const t0 = this.ctx.currentTime + 0.05;
      for (const ev of events) {
        this.scheduleNote(ev, t0);
      }
      const total =
        events.reduce((m, e) => Math.max(m, e.start + e.duration), 0) + 0.4;
      this.loopTimer = window.setTimeout(() => {
        if (this.playing && loop) schedule();
      }, total * 1000);
    };

    schedule();
  }

  private scheduleNote(ev: MidiEvent, t0: number): void {
    const ctx = this.ctx!;
    const start = t0 + ev.start;
    const end = start + ev.duration;
    const vel = (ev.velocity ?? 72) / 127;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(ev.note);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.14 * vel, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.05);
  }

  stop(): void {
    this.playing = false;
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
