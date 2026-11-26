import { signal } from '@angular/core';

type VoiceState = 'idle' | 'permission' | 'recording' | 'transcribing';
const MAX_SECONDS = 30;

/** One recording at a time; generation tokens invalidate permission/network races. */
export class VoiceInput {
  readonly state = signal<VoiceState>('idle');
  readonly error = signal('');
  private generation = 0;
  private destroyed = false;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private samples: Float32Array[] = [];
  private frames = 0;
  private rate = 16000;

  constructor(private readonly onTranscript: (text: string) => void) {}

  busy(): boolean { return this.state() !== 'idle'; }

  async start(): Promise<void> {
    if (this.busy() || this.destroyed) return;
    this.error.set('');
    if (!globalThis.isSecureContext || !globalThis.navigator?.mediaDevices?.getUserMedia ||
        typeof AudioContext === 'undefined') {
      this.error.set('La grabación no está disponible en este dispositivo. Usá el teclado.');
      return;
    }
    const generation = ++this.generation;
    this.state.set('permission');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
      if (this.destroyed || generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.context = new AudioContext({ sampleRate: 16000 });
      this.rate = this.context.sampleRate;
      if (this.rate < 16000 || this.rate > 48000) throw new Error('unsupported rate');
      this.source = this.context.createMediaStreamSource(stream);
      // ScriptProcessor avoids a separately hosted AudioWorklet module. Its output
      // remains silent (no microphone feedback); only mono input is collected.
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) => {
        if (generation !== this.generation || this.state() !== 'recording') return;
        const input = event.inputBuffer.getChannelData(0);
        const remaining = this.rate * MAX_SECONDS - this.frames;
        const chunk = input.slice(0, Math.max(0, remaining));
        this.samples.push(chunk);
        this.frames += chunk.length;
        if (this.frames >= this.rate * MAX_SECONDS) void this.stop();
      };
      this.source.connect(this.processor);
      this.processor.connect(this.context.destination);
      await this.context.resume();
      if (generation !== this.generation || this.destroyed) return;
      this.state.set('recording');
      this.timer = setTimeout(() => void this.stop(), MAX_SECONDS * 1000);
    } catch {
      if (generation !== this.generation || this.destroyed) return;
      this.cleanupAudio();
      this.state.set('idle');
      this.error.set('No pude acceder al micrófono. Revisá el permiso o usá el teclado.');
    }
  }

  async stop(): Promise<void> {
    if (this.state() === 'permission') { this.cancel(); return; }
    if (this.state() !== 'recording') return;
    const generation = this.generation;
    const audio = this.wav();
    this.cleanupAudio();
    if (audio.size <= 44) {
      this.state.set('idle');
      this.error.set('No se grabó audio. Podés volver a intentarlo.');
      return;
    }
    this.state.set('transcribing');
    const controller = new AbortController();
    this.controller = controller;
    this.timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch('/api/v1/chat/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio,
        signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) throw new Error('transcription failed');
      const raw = await response.text();
      if (raw.length > 65_536) throw new Error('oversized response');
      const payload: unknown = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || !('text' in payload) ||
          typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 16000) {
        throw new Error('invalid response');
      }
      if (!this.destroyed && generation === this.generation && !controller.signal.aborted) {
        this.onTranscript(payload.text);
      }
    } catch {
      if (!this.destroyed && generation === this.generation) {
        this.error.set('No pude transcribir el audio. Tu borrador se conserva; podés usar el teclado.');
      }
    } finally {
      if (generation === this.generation) {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        this.controller = undefined;
        this.state.set('idle');
      }
    }
  }

  cancel(): void {
    ++this.generation;
    this.controller?.abort();
    this.controller = undefined;
    this.cleanupAudio();
    this.state.set('idle');
  }

  destroy(): void { this.destroyed = true; this.cancel(); }

  private cleanupAudio(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); }
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => undefined);
    this.processor = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.context = undefined;
    this.samples = [];
    this.frames = 0;
  }

  private wav(): Blob {
    const bytes = new ArrayBuffer(44 + this.frames * 2);
    const view = new DataView(bytes);
    const label = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    label(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true);
    label(8, 'WAVE'); label(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, this.rate, true); view.setUint32(28, this.rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    label(36, 'data'); view.setUint32(40, this.frames * 2, true);
    let offset = 44;
    for (const chunk of this.samples) {
      for (const value of chunk) {
        const sample = Math.max(-1, Math.min(1, value));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }
}
