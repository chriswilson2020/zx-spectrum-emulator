const KEY_MAP = new Map([
  ["Enter", "ENTER"],
  [" ", "SPACE"],
  ["Backspace", "CLEAR"],
  ["Escape", "BREAK"],
  ["ArrowUp", "UP"],
  ["ArrowDown", "DOWN"],
  ["ArrowLeft", "LEFT"],
  ["ArrowRight", "RIGHT"],
  [":", ":"],
  [";", ";"],
  [",", ","],
  ["-", "-"],
  [".", "."],
  ["/", "/"]
]);

const SHIFT_KEY = "LEFT SHIFT";
const DIRECT_TEXT_KEYS = new Map([
  [" ", ["SPACE"]],
  ["\n", ["ENTER"]],
  ["\r", ["ENTER"]],
  ["@", ["@"]],
  [":", [":"]],
  [";", [";"]],
  [",", [","]],
  ["-", ["-"]],
  [".", ["."]],
  ["/", ["/"]]
]);

const SHIFT_TEXT_KEYS = new Map([
  ["!", ["1"]],
  ['"', ["2"]],
  ["#", ["3"]],
  ["$", ["4"]],
  ["%", ["5"]],
  ["&", ["6"]],
  ["'", ["7"]],
  ["(", ["8"]],
  [")", ["9"]],
  ["*", [":"]],
  ["+", [";"]],
  ["<", [","]],
  ["=", ["-"]],
  [">", ["."]],
  ["?", ["/"]]
]);

export function keyEventToTrs80Key(event) {
  if (event.code === "ShiftLeft") return "LEFT SHIFT";
  if (event.code === "ShiftRight") return "RIGHT SHIFT";
  if (KEY_MAP.has(event.key)) return KEY_MAP.get(event.key);

  const upper = event.key.length === 1 ? event.key.toUpperCase() : "";
  if (/^[A-Z0-9]$/.test(upper)) return upper;
  return undefined;
}

export function textToTrs80KeyTaps(text) {
  return Array.from(text, charToTrs80KeyTap);
}

function charToTrs80KeyTap(char) {
  if (DIRECT_TEXT_KEYS.has(char)) return DIRECT_TEXT_KEYS.get(char);
  if (/^[A-Za-z0-9]$/.test(char)) return [char.toUpperCase()];
  if (SHIFT_TEXT_KEYS.has(char)) return [SHIFT_KEY, ...SHIFT_TEXT_KEYS.get(char)];
  throw new Error(`Unsupported TRS-80 character: ${char}`);
}

export class Trs80KeyLatch {
  constructor(machine, { releaseHoldFrames = 3 } = {}) {
    this.machine = machine;
    this.releaseHoldFrames = releaseHoldFrames;
    this.heldKeys = new Set();
    this.pendingReleases = new Map();
  }

  press(key) {
    this.pendingReleases.delete(key);
    if (this.heldKeys.has(key)) return false;
    this.heldKeys.add(key);
    this.machine.pressKey(key);
    return true;
  }

  release(key) {
    if (!this.heldKeys.has(key)) return false;
    this.pendingReleases.set(key, this.releaseHoldFrames);
    return true;
  }

  releaseNow(key) {
    this.pendingReleases.delete(key);
    if (!this.heldKeys.has(key)) return false;
    this.heldKeys.delete(key);
    this.machine.releaseKey(key);
    return true;
  }

  advanceFrame() {
    for (const [key, frames] of [...this.pendingReleases]) {
      if (frames > 1) {
        this.pendingReleases.set(key, frames - 1);
      } else {
        this.pendingReleases.delete(key);
        this.heldKeys.delete(key);
        this.machine.releaseKey(key);
      }
    }
  }

  releaseAll() {
    for (const key of this.heldKeys) this.machine.releaseKey(key);
    this.heldKeys.clear();
    this.pendingReleases.clear();
  }

  pressedKeys() {
    return [...this.heldKeys].sort();
  }
}

export class Trs80TextTyper {
  constructor(latch, { holdFrames = 2, gapFrames = 1 } = {}) {
    this.latch = latch;
    this.holdFrames = holdFrames;
    this.gapFrames = gapFrames;
    this.queue = [];
    this.activeTap = [];
    this.phase = "idle";
    this.framesRemaining = 0;
  }

  enqueue(text) {
    this.queue.push(...textToTrs80KeyTaps(text));
  }

  enqueueTap(keys) {
    this.queue.push([...keys]);
  }

  clear() {
    this.releaseActiveTap();
    this.queue = [];
    this.phase = "idle";
    this.framesRemaining = 0;
  }

  pendingCount() {
    return this.queue.length + (this.activeTap.length > 0 ? 1 : 0);
  }

  advanceFrame() {
    this.latch.advanceFrame();

    if (this.phase === "holding") {
      this.framesRemaining -= 1;
      if (this.framesRemaining <= 0) {
        this.releaseActiveTap();
        this.phase = "gap";
        this.framesRemaining = this.gapFrames;
      }
      return true;
    }

    if (this.phase === "gap") {
      this.framesRemaining -= 1;
      if (this.framesRemaining > 0) return true;
      this.phase = "idle";
    }

    if (this.queue.length === 0) return false;
    this.activeTap = this.queue.shift();
    for (const key of this.activeTap) this.latch.press(key);
    this.phase = "holding";
    this.framesRemaining = this.holdFrames;
    return true;
  }

  releaseActiveTap() {
    for (const key of this.activeTap) this.latch.releaseNow(key);
    this.activeTap = [];
  }
}
