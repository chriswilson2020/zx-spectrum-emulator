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

export function keyEventToTrs80Key(event) {
  if (event.code === "ShiftLeft") return "LEFT SHIFT";
  if (event.code === "ShiftRight") return "RIGHT SHIFT";
  if (KEY_MAP.has(event.key)) return KEY_MAP.get(event.key);

  const upper = event.key.length === 1 ? event.key.toUpperCase() : "";
  if (/^[A-Z0-9]$/.test(upper)) return upper;
  return undefined;
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
