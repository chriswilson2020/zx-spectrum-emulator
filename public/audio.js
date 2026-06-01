export const SPECTRUM_T_STATES_PER_SECOND = 3_494_400;

export function createBeeperSamples(
  events,
  {
    fromTState,
    toTState,
    initialLevel,
    sampleRate,
    tStatesPerSecond = SPECTRUM_T_STATES_PER_SECOND,
    amplitude = 0.18
  }
) {
  const durationTStates = Math.max(0, toTState - fromTState);
  const sampleCount = Math.max(0, Math.round((durationTStates / tStatesPerSecond) * sampleRate));
  const samples = new Float32Array(sampleCount);
  let level = initialLevel;
  let eventIndex = 0;
  const sortedEvents = [...events].sort((a, b) => a.tState - b.tState);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const tState = fromTState + Math.floor((sampleIndex / sampleRate) * tStatesPerSecond);
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].tState <= tState) {
      level = sortedEvents[eventIndex].on;
      eventIndex += 1;
    }
    samples[sampleIndex] = level ? amplitude : 0;
  }

  while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].tState <= toTState) {
    level = sortedEvents[eventIndex].on;
    eventIndex += 1;
  }

  return { samples, level };
}

export class BeeperAudio {
  constructor({ AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
    if (!AudioContextClass) throw new Error("Web Audio is not available");
    this.context = new AudioContextClass();
    this.nextTime = this.context.currentTime;
    this.level = false;
    this.lastTState = 0;
  }

  async resume() {
    if (this.context.state !== "running") await this.context.resume();
  }

  reset(tState = 0) {
    this.level = false;
    this.lastTState = tState;
    this.nextTime = this.context.currentTime;
  }

  push(events, toTState) {
    const { samples, level } = createBeeperSamples(events, {
      fromTState: this.lastTState,
      toTState,
      initialLevel: this.level,
      sampleRate: this.context.sampleRate
    });

    this.level = level;
    this.lastTState = toTState;
    if (samples.length === 0) return;

    const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startTime = Math.max(this.context.currentTime + 0.02, this.nextTime);
    source.start(startTime);
    this.nextTime = startTime + buffer.duration;
  }
}
