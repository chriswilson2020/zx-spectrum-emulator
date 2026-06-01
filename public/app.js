import { BeeperAudio } from "/public/audio.js";
import { loadBasicProgram, renumberBasicProgram } from "/public/basic.js";
import { Spectrum48 } from "/src/spectrum48.js";
import {
  basicTextToSpectrumKeyTaps,
  shouldCaptureModernKeyEvent,
  spectrumKeysForModernKey
} from "/public/keyboard.js";

const canvas = document.querySelector("#screen");
const context = canvas.getContext("2d");
const statusOutput = document.querySelector("#status");
const frameOutput = document.querySelector("#frame");
const pcOutput = document.querySelector("#pc");
const borderOutput = document.querySelector("#border");
const lastKeyOutput = document.querySelector("#lastKey");
const mappedKeysOutput = document.querySelector("#mappedKeys");
const heldKeysOutput = document.querySelector("#heldKeys");
const runPauseButton = document.querySelector("#runPause");
const resetButton = document.querySelector("#reset");
const typeHelloButton = document.querySelector("#typeHello");
const audioToggleButton = document.querySelector("#audioToggle");
const pasteForm = document.querySelector("#pasteForm");
const pasteTextInput = document.querySelector("#pasteText");

let rom;
let machine;
let audio;
let audioEnabled = false;
let running = true;
let flashOn = false;
let physicalShiftDown = false;
const activeChords = new Map();
let lastModernKey = "-";
let lastMappedKeys = [];

function formatWord(value) {
  return value.toString(16).padStart(4, "0").toUpperCase();
}

async function loadRom() {
  const response = await fetch("/ROM/48.rom");
  if (!response.ok) throw new Error(`ROM load failed: ${response.status}`);
  rom = new Uint8Array(await response.arrayBuffer());
}

function resetMachine() {
  machine = new Spectrum48({ rom });
  audio?.reset(machine.cpu.tStates);
  statusOutput.value = "Running";
}

function pumpAudio() {
  const events = machine.drainBeeperEvents();
  if (!audioEnabled || !audio) return;
  audio.push(events, machine.cpu.tStates);
}

function runMachineFrame() {
  machine.runFrame();
  pumpAudio();
}

function runFrames(count) {
  for (let frame = 0; frame < count; frame += 1) {
    runMachineFrame();
  }
}

function tapSpectrumKeys(keys, holdFrames = 4, gapFrames = 4) {
  for (const key of keys) machine.pressKey(key);
  runFrames(holdFrames);
  for (const key of keys) machine.releaseKey(key);
  runFrames(gapFrames);
}

function typeHelloWorldProgram() {
  resetMachine();
  runFrames(180);

  const sequence = [
    ["1"],
    ["0"],
    ["P"],
    ["SYMBOL SHIFT", "P"],
    ["H"],
    ["E"],
    ["L"],
    ["L"],
    ["O"],
    ["SPACE"],
    ["W"],
    ["O"],
    ["R"],
    ["L"],
    ["D"],
    ["SYMBOL SHIFT", "P"],
    ["ENTER"],
    ["R"],
    ["ENTER"]
  ];

  for (const keys of sequence) tapSpectrumKeys(keys);
  runFrames(60);
  statusOutput.value = "HELLO WORLD typed";
}

function typeModernText(text, { reset = false } = {}) {
  if (reset) {
    resetMachine();
    runFrames(180);
  }

  let normalizedText = String(text).replace(/\r\n?/g, "\n");
  let lines = normalizedText.split("\n");
  let numberedLines = lines.filter((line) => /^\s*\d+/.test(line));
  let commandLines = lines.filter((line) => line.trim() && !/^\s*\d+/.test(line));
  let didRenumber = false;

  if (numberedLines.length > 0) {
    try {
      loadBasicProgram(machine, numberedLines.join("\n"));
    } catch (error) {
      if (!/Invalid BASIC line number/.test(error.message)) throw error;
      normalizedText = renumberBasicProgram(normalizedText);
      pasteTextInput.value = normalizedText;
      lines = normalizedText.split("\n");
      numberedLines = lines.filter((line) => /^\s*\d+/.test(line));
      commandLines = lines.filter((line) => line.trim() && !/^\s*\d+/.test(line));
      loadBasicProgram(machine, numberedLines.join("\n"));
      didRenumber = true;
    }
  }

  const commandText = commandLines.length > 0 ? `${commandLines.join("\n")}\n` : "RUN\n";
  const submittedText = numberedLines.length > 0 ? commandText : /\r?\n$/.test(text) ? text : `${text}\n`;
  const taps = basicTextToSpectrumKeyTaps(submittedText);
  for (const keys of taps) tapSpectrumKeys(keys);
  runFrames(20);
  statusOutput.value = numberedLines.length > 0 && didRenumber
    ? `Renumbered and loaded ${numberedLines.length} lines, typed ${taps.length} keys`
    : numberedLines.length > 0
      ? `Loaded ${numberedLines.length} lines, typed ${taps.length} keys`
    : `Typed ${taps.length} keys`;
}

function draw() {
  if (!machine) return;

  if (running) {
    runMachineFrame();
    flashOn = Math.floor(machine.frame / 16) % 2 === 1;
  } else {
    pumpAudio();
  }

  const frame = machine.renderFrameRgba({ flashOn });
  const imageData = new ImageData(frame, Spectrum48.FRAME_WIDTH, Spectrum48.FRAME_HEIGHT);
  context.putImageData(imageData, 0, 0);

  frameOutput.textContent = String(machine.frame);
  pcOutput.textContent = formatWord(machine.cpu.PC);
  borderOutput.textContent = String(machine.borderColor);
  lastKeyOutput.textContent = lastModernKey;
  mappedKeysOutput.textContent = lastMappedKeys.length ? lastMappedKeys.join(" + ") : "-";
  heldKeysOutput.textContent = machine.getPressedKeys().join(" + ") || "-";

  requestAnimationFrame(draw);
}

window.addEventListener("keydown", (event) => {
  if (!shouldCaptureModernKeyEvent(event)) return;
  if (event.repeat) return;

  const keys = spectrumKeysForModernKey(event);
  if (keys?.length && machine) {
    event.preventDefault();
    lastModernKey = event.key === " " ? "Space" : event.key;
    lastMappedKeys = keys;
    activeChords.set(event.code, keys);
    if (keys[0] === "CAPS SHIFT" && keys.length === 1) physicalShiftDown = true;
    if (physicalShiftDown && keys.includes("SYMBOL SHIFT")) machine.releaseKey("CAPS SHIFT");
    for (const key of keys) machine.pressKey(key);
    return;
  }
});

window.addEventListener("keyup", (event) => {
  if (!shouldCaptureModernKeyEvent(event)) return;
  const keys = activeChords.get(event.code) ?? spectrumKeysForModernKey(event);
  if (keys?.length && machine) {
    event.preventDefault();
    activeChords.delete(event.code);
    for (const key of keys) machine.releaseKey(key);
    if (keys[0] === "CAPS SHIFT" && keys.length === 1) physicalShiftDown = false;
    if (physicalShiftDown && keys.includes("SYMBOL SHIFT")) machine.pressKey("CAPS SHIFT");
    return;
  }
});

runPauseButton.addEventListener("click", () => {
  running = !running;
  runPauseButton.textContent = running ? "Pause" : "Run";
  runPauseButton.setAttribute("aria-label", running ? "Pause" : "Run");
  statusOutput.value = running ? "Running" : "Paused";
});

resetButton.addEventListener("click", () => {
  resetMachine();
});

typeHelloButton.addEventListener("click", () => {
  typeHelloWorldProgram();
});

audioToggleButton.addEventListener("click", async () => {
  try {
    audio ??= new BeeperAudio();
    await audio.resume();
    audioEnabled = !audioEnabled;
    audio.reset(machine.cpu.tStates);
    audioToggleButton.textContent = audioEnabled ? "Sound On" : "Sound Off";
    audioToggleButton.setAttribute("aria-pressed", String(audioEnabled));
    statusOutput.value = audioEnabled ? "Sound enabled" : "Sound disabled";
  } catch (error) {
    statusOutput.value = error.message;
  }
});

pasteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    typeModernText(pasteTextInput.value, { reset: true });
  } catch (error) {
    statusOutput.value = error.message;
  }
});

try {
  await loadRom();
  resetMachine();
  draw();
} catch (error) {
  statusOutput.value = error.message;
}
