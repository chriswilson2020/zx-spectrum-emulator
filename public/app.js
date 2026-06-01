import { BeeperAudio } from "./audio.js";
import { loadBasicProgram, renumberBasicProgram } from "./basic.js";
import {
  disassembleWindow,
  hexByte,
  hexWord,
  readBasicStatus,
  readMemoryRows,
  readSystemVariables
} from "./debugger.js";
import { Spectrum48 } from "../src/spectrum48.js";
import {
  basicTextToSpectrumKeyTaps,
  shouldCaptureModernKeyEvent,
  spectrumKeysForModernKey
} from "./keyboard.js";
import { loadTapEntry, parseTapeFile, tapEntries } from "./tape.js";

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
const stepFrameButton = document.querySelector("#stepFrame");
const stepInstructionButton = document.querySelector("#stepInstruction");
const resetButton = document.querySelector("#reset");
const typeHelloButton = document.querySelector("#typeHello");
const audioToggleButton = document.querySelector("#audioToggle");
const pasteForm = document.querySelector("#pasteForm");
const pasteTextInput = document.querySelector("#pasteText");
const tapFileInput = document.querySelector("#tapFile");
const tapList = document.querySelector("#tapList");
const tapLoadButton = document.querySelector("#tapLoad");
const registerGrid = document.querySelector("#registerGrid");
const flagGrid = document.querySelector("#flagGrid");
const basicStatusPanel = document.querySelector("#basicStatus");
const disassemblyPanel = document.querySelector("#disassembly");
const memoryInspector = document.querySelector("#memoryInspector");

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
let currentTapBlocks = [];
let currentTapEntries = [];
let selectedTapEntryIndex = -1;

function formatWord(value) {
  return value.toString(16).padStart(4, "0").toUpperCase();
}

function renderKeyValueGrid(container, rows, className = "") {
  container.replaceChildren(
    ...rows.map(([label, value]) => {
      const item = document.createElement("div");
      if (className) item.className = className;
      const labelElement = document.createElement("span");
      labelElement.textContent = label;
      const valueElement = document.createElement("strong");
      valueElement.textContent = value;
      item.append(labelElement, valueElement);
      return item;
    })
  );
}

async function loadRom() {
  const response = await fetch(new URL("../ROM/48.rom", import.meta.url));
  if (!response.ok) throw new Error(`ROM load failed: ${response.status}`);
  rom = new Uint8Array(await response.arrayBuffer());
}

function resetMachine() {
  machine = new Spectrum48({ rom });
  if (currentTapBlocks.length > 0) machine.setTapeBlocks(currentTapBlocks);
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

function stepInstruction() {
  machine.step();
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

function typeCommand(text) {
  const submittedText = /\n$/.test(text) ? text : `${text}\n`;
  const taps = basicTextToSpectrumKeyTaps(submittedText);
  for (const keys of taps) tapSpectrumKeys(keys);
  runFrames(20);
  return taps.length;
}

function renderTapList() {
  tapList.replaceChildren(
    ...currentTapEntries.map((entry, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === selectedTapEntryIndex ? "tap-entry selected" : "tap-entry";
      button.disabled = !entry.loadable;
      const checksum = entry.headerBlock.checksumValid && entry.dataBlock?.checksumValid ? "OK" : "Bad";
      const name = document.createElement("span");
      name.textContent = entry.header.name || "(unnamed)";
      const type = document.createElement("strong");
      type.textContent = entry.header.typeName;
      const details = document.createElement("small");
      details.textContent = `${entry.header.length} bytes · checksum ${checksum}`;
      button.append(name, type, details);
      button.addEventListener("click", () => {
        selectedTapEntryIndex = index;
        tapLoadButton.disabled = !entry.loadable;
        renderTapList();
      });
      return button;
    })
  );

  if (currentTapEntries.length === 0) {
    tapList.textContent = "No loadable header blocks found";
  }
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
  updateDebugger();

  requestAnimationFrame(draw);
}

function updateDebugger() {
  const state = machine.cpu.getState();
  const registers = state.registers;
  renderKeyValueGrid(registerGrid, [
    ["AF", hexWord(registers.AF)],
    ["BC", hexWord(registers.BC)],
    ["DE", hexWord(registers.DE)],
    ["HL", hexWord(registers.HL)],
    ["IX", hexWord(registers.IX)],
    ["IY", hexWord(registers.IY)],
    ["SP", hexWord(registers.SP)],
    ["PC", hexWord(registers.PC)],
    ["I", hexByte(registers.I)],
    ["R", hexByte(registers.R)],
    ["IM", String(state.interruptMode)],
    ["T", String(state.tStates)]
  ], "register-cell");

  flagGrid.replaceChildren(
    ...["S", "Z", "Y", "H", "X", "PV", "N", "C"].map((flag) => {
      const flagElement = document.createElement("span");
      flagElement.className = state.flags[flag] ? "flag on" : "flag";
      flagElement.textContent = flag;
      return flagElement;
    })
  );

  const basic = readBasicStatus(machine);
  const pointerRows = Object.entries(basic.pointers).map(([name, value]) => [name, hexWord(value)]);
  renderKeyValueGrid(basicStatusPanel, [
    ["ERR", basic.errText],
    ["LINE", String(basic.currentLine)],
    ["SUB", String(basic.subStatement)],
    ...pointerRows
  ], "basic-cell");

  disassemblyPanel.replaceChildren(
    ...disassembleWindow((address) => machine.read8(address), registers.PC, { beforeBytes: 6, count: 9 }).map((row) => {
      const item = document.createElement("li");
      item.className = row.isPc ? "current" : "";
      const address = document.createElement("span");
      address.className = "addr";
      address.textContent = hexWord(row.address);
      const bytes = document.createElement("span");
      bytes.className = "bytes";
      bytes.textContent = row.bytes.map(hexByte).join(" ");
      const text = document.createElement("span");
      text.className = "asm";
      text.textContent = row.text;
      item.append(address, bytes, text);
      return item;
    })
  );

  const memorySections = [
    ["PROG", basic.pointers.PROG, 3],
    ["VARS", basic.pointers.VARS, 2],
    ["E_LINE", basic.pointers.E_LINE, 2],
    ["Screen", 0x4000, 2],
    ["SysVars", 0x5c00, 4]
  ];
  memoryInspector.replaceChildren(
    ...memorySections.map(([title, address, rows]) => {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = `${title} ${hexWord(address)}`;
      const listing = document.createElement("pre");
      listing.textContent = readMemoryRows((readAddress) => machine.read8(readAddress), address, {
        rows,
        bytesPerRow: 8
      }).map((row) => `${hexWord(row.address)}  ${row.bytes.map(hexByte).join(" ")}`).join("\n");
      section.append(heading, listing);
      return section;
    })
  );

  const systemVariableRows = readSystemVariables(machine).slice(0, 6);
  const systemSection = document.createElement("section");
  const systemHeading = document.createElement("h3");
  systemHeading.textContent = "Pointers";
  const systemList = document.createElement("pre");
  systemList.textContent = systemVariableRows
    .map((item) => `${item.name.padEnd(6, " ")} ${hexWord(item.address)} ${item.size === 1 ? hexByte(item.value) : hexWord(item.value)}`)
    .join("\n");
  systemSection.append(systemHeading, systemList);
  memoryInspector.append(systemSection);
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

stepFrameButton.addEventListener("click", () => {
  running = false;
  runPauseButton.textContent = "Run";
  runPauseButton.setAttribute("aria-label", "Run");
  runMachineFrame();
  updateDebugger();
  statusOutput.value = "Stepped one frame";
});

stepInstructionButton.addEventListener("click", () => {
  running = false;
  runPauseButton.textContent = "Run";
  runPauseButton.setAttribute("aria-label", "Run");
  stepInstruction();
  updateDebugger();
  statusOutput.value = "Stepped one instruction";
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

tapFileInput.addEventListener("change", async () => {
  const file = tapFileInput.files?.[0];
  if (!file) return;

  try {
    const blocks = parseTapeFile(await file.arrayBuffer());
    currentTapBlocks = blocks;
    machine.setTapeBlocks(blocks);
    currentTapEntries = tapEntries(blocks);
    selectedTapEntryIndex = currentTapEntries.findIndex((entry) => entry.loadable);
    tapLoadButton.disabled = selectedTapEntryIndex === -1;
    renderTapList();
    statusOutput.value = `Parsed and mounted ${blocks.length} TAP blocks`;
  } catch (error) {
    currentTapBlocks = [];
    machine.clearTape();
    currentTapEntries = [];
    selectedTapEntryIndex = -1;
    tapLoadButton.disabled = true;
    renderTapList();
    statusOutput.value = error.message;
  }
});

tapLoadButton.addEventListener("click", () => {
  const entry = currentTapEntries[selectedTapEntryIndex];
  if (!entry) return;

  try {
    const result = loadTapEntry(machine, entry);
    machine.setTapeCursor((entry.dataBlock?.index ?? entry.headerBlock.index) + 1);
    let typedKeys = 0;
    if (result.kind === "BASIC" && result.autoStartLine !== null) {
      typedKeys = typeCommand(`RUN ${result.autoStartLine}`);
    }
    statusOutput.value = result.kind === "BASIC"
      ? `Loaded TAP BASIC ${result.name || "(unnamed)"}${typedKeys ? `, typed ${typedKeys} keys` : ""}`
      : `Loaded TAP CODE ${result.name || "(unnamed)"} at ${hexWord(result.start)}`;
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
