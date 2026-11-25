import { vi } from 'vitest';
import { VoiceInput } from './voice-input';

function devices() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as ((e: AudioProcessingEvent) => void) | null };
  const close = vi.fn().mockResolvedValue(undefined);
  class Audio {
    sampleRate = 16000;
    destination = {};
    createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    createScriptProcessor = () => processor;
    close = close;
    resume = vi.fn().mockResolvedValue(undefined);
  }
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('AudioContext', Audio);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  return { stop, stream, processor, close };
}

describe('VoiceInput', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('records mono WAV, transcribes only on stop and cleans every audio resource', async () => {
    const fake = devices();
    const fetch = vi.fn().mockResolvedValue(new Response('{"text":"Consulta"}'));
    vi.stubGlobal('fetch', fetch);
    const result = vi.fn();
    const voice = new VoiceInput(result);
    await voice.start();
    expect(voice.state()).toBe('recording');
    expect(fetch).not.toHaveBeenCalled();
    fake.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(16000).fill(0.1) } } as unknown as AudioProcessingEvent);
    await voice.stop();
    expect(fake.stop).toHaveBeenCalledTimes(1);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/chat/transcribe');
    expect(options.body.type).toBe('audio/wav');
    expect(options.body.size).toBe(32044);
    expect(result).toHaveBeenCalledWith('Consulta');
    expect(voice.state()).toBe('idle');
  });

  it('cancel/destroy during permission stops late tracks and never records or fetches', async () => {
    for (const action of ['cancel', 'destroy', 'stop'] as const) {
      const fake = devices();
      let resolve!: (stream: MediaStream) => void;
      vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise((done) => { resolve = done; }));
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const voice = new VoiceInput(vi.fn());
      const starting = voice.start();
      await voice[action]();
      resolve(fake.stream);
      await starting;
      expect(fake.stop).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
      expect(voice.state()).toBe('idle');
    }
  });

  it('abort ignores late transcription and releases microphone before network response', async () => {
    const fake = devices();
    let resolve!: (response: Response) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    const result = vi.fn();
    const voice = new VoiceInput(result);
    await voice.start();
    fake.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(160) } } as unknown as AudioProcessingEvent);
    const stopping = voice.stop();
    expect(fake.stop).toHaveBeenCalledTimes(1);
    voice.destroy();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    resolve(new Response('{"text":"late"}'));
    await stopping;
    expect(result).not.toHaveBeenCalled();
    expect(voice.state()).toBe('idle');
  });

  it('bounds recording at 30 seconds and reports unsupported/denied/error paths', async () => {
    vi.useFakeTimers();
    const fake = devices();
    const fetch = vi.fn().mockRejectedValue(new Error('private'));
    vi.stubGlobal('fetch', fetch);
    const result = vi.fn();
    const voice = new VoiceInput(result);
    await voice.start();
    fake.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(160) } } as unknown as AudioProcessingEvent);
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveBeenCalled();
    expect(fake.stop).toHaveBeenCalledTimes(1);
    expect(voice.state()).toBe('idle');
    expect(voice.error()).not.toContain('private');
    expect(voice.error()).not.toBe('');
    vi.stubGlobal('isSecureContext', false);
    await voice.start();
    expect(voice.error()).toContain('dispositivo');
    vi.stubGlobal('isSecureContext', true);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new Error('permission'));
    await voice.start();
    expect(voice.state()).toBe('idle');
    expect(voice.error()).toContain('micrófono');
  });
});
