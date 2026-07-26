import { BeeperAudio } from "./audio.js";
import { ASSEMBLER_REFERENCE } from "./assembler-reference.js";
import { exportBasicProgram, loadBasicProgram, renumberBasicProgram } from "./basic.js";
import {
  disassembleWindow,
  hexByte,
  hexWord,
  readBasicStatus,
  readMemoryRows,
  readSystemVariables
} from "./debugger.js";
import { MachineHistory } from "./history.js";
import { Spectrum48 } from "../src/spectrum48.js";
import {
  basicTextToSpectrumKeyTaps,
  shouldCaptureModernKeyEvent,
  shouldPreventBrowserScrollKey,
  spectrumKeysForModernKey
} from "./keyboard.js";
import { applyZ80Snapshot, createZ80Snapshot } from "./snapshot.js";
import { parseRzx, RzxPlayback } from "./rzx.js";
import { loadTapEntry, parseTapeFile, tapEntries } from "./tape.js";

const canvas = document.querySelector("#screen");
const context = canvas.getContext("2d");
const rasterOverlay = document.querySelector("#rasterOverlay");
const rasterContext = rasterOverlay.getContext("2d");
const statusOutput = document.querySelector("#status");
const frameOutput = document.querySelector("#frame");
const pcOutput = document.querySelector("#pc");
const borderOutput = document.querySelector("#border");
const rasterLineOutput = document.querySelector("#rasterLine");
const rasterColumnOutput = document.querySelector("#rasterColumn");
const rasterTStateOutput = document.querySelector("#rasterTState");
const screenRasterOutput = document.querySelector("#screenRaster");
const lastKeyOutput = document.querySelector("#lastKey");
const mappedKeysOutput = document.querySelector("#mappedKeys");
const heldKeysOutput = document.querySelector("#heldKeys");
const runPauseButton = document.querySelector("#runPause");
const stepFrameButton = document.querySelector("#stepFrame");
const stepInstructionButton = document.querySelector("#stepInstruction");
const stepBackButton = document.querySelector("#stepBack");
const resetButton = document.querySelector("#reset");
const typeHelloButton = document.querySelector("#typeHello");
const audioToggleButton = document.querySelector("#audioToggle");
const romFileInput = document.querySelector("#romFile");
const immediateScreenInput = document.querySelector("#immediateScreen");
const showRasterOverlayInput = document.querySelector("#showRasterOverlay");
const pasteForm = document.querySelector("#pasteForm");
const pasteTextInput = document.querySelector("#pasteText");
const basicFileInput = document.querySelector("#basicFile");
const basicExportButton = document.querySelector("#basicExport");
const tapFileInput = document.querySelector("#tapFile");
const tapList = document.querySelector("#tapList");
const tapLoadButton = document.querySelector("#tapLoad");
const snapshotFileInput = document.querySelector("#snapshotFile");
const snapshotSaveButton = document.querySelector("#snapshotSave");
const rzxFileInput = document.querySelector("#rzxFile");
const rzxStepButton = document.querySelector("#rzxStep");
const rzxPlayPauseButton = document.querySelector("#rzxPlayPause");
const rzxStatusOutput = document.querySelector("#rzxStatus");
const toolTabButtons = document.querySelectorAll("[data-tool-tab]");
const toolPanels = document.querySelectorAll("[data-tool-panel]");
const registerGrid = document.querySelector("#registerGrid");
const flagGrid = document.querySelector("#flagGrid");
const basicStatusPanel = document.querySelector("#basicStatus");
const disassemblyPanel = document.querySelector("#disassembly");
const memoryInspector = document.querySelector("#memoryInspector");
const sourceFileInput = document.querySelector("#sourceFile");
const sourceListing = document.querySelector("#sourceListing");
const assemblerSearchInput = document.querySelector("#assemblerSearch");
const assemblerReference = document.querySelector("#assemblerReference");

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
const executionHistory = new MachineHistory({ limit: 256 });
let rzxPlayback;
let rzxPlaying = false;
let sourceRows = [];

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
  clearExecutionHistory();
  clearRzxPlayback();
  statusOutput.value = "Running";
}

function mountRom(bytes, message) {
  const nextRom = Uint8Array.from(bytes);
  const nextMachine = new Spectrum48({ rom: nextRom });
  if (currentTapBlocks.length > 0) nextMachine.setTapeBlocks(currentTapBlocks);

  rom = nextRom;
  machine = nextMachine;
  running = true;
  runPauseButton.textContent = "Pause";
  runPauseButton.setAttribute("aria-label", "Pause");
  audio?.reset(machine.cpu.tStates);
  clearExecutionHistory();
  clearRzxPlayback();
  statusOutput.value = message;
  refreshDebugDisplay();
}

function updateHistoryControls() {
  stepBackButton.disabled = executionHistory.size === 0;
}

function clearExecutionHistory() {
  executionHistory.clear();
  updateHistoryControls();
}

function captureExecutionState(label) {
  executionHistory.capture(machine, label, rzxPlayback
    ? { rzxEventIndex: rzxPlayback.eventIndex, rzxFrameIndex: rzxPlayback.frameIndex }
    : null);
  updateHistoryControls();
}

function clearRzxPlayback() {
  rzxPlayback = undefined;
  rzxPlaying = false;
  if (!rzxStepButton) return;
  rzxStepButton.disabled = true;
  rzxPlayPauseButton.disabled = true;
  rzxPlayPauseButton.textContent = "Play RZX";
  rzxStatusOutput.value = "No RZX recording loaded";
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

function drawSpectrumScreen() {
  const frame = machine.renderFrameRgba({ flashOn });
  const imageData = new ImageData(frame, Spectrum48.FRAME_WIDTH, Spectrum48.FRAME_HEIGHT);
  context.putImageData(imageData, 0, 0);
  drawRasterOverlay();
}

function drawRasterOverlay() {
  rasterContext.clearRect(0, 0, rasterOverlay.width, rasterOverlay.height);
  if (!showRasterOverlayInput.checked || !machine) return;

  const raster = machine.getRasterPosition();
  rasterContext.save();
  rasterContext.strokeStyle = "rgba(243, 212, 71, 0.95)";
  rasterContext.fillStyle = "rgba(243, 212, 71, 0.95)";
  rasterContext.lineWidth = 1;
  rasterContext.shadowColor = "rgba(243, 212, 71, 0.85)";
  rasterContext.shadowBlur = 5;
  rasterContext.beginPath();
  rasterContext.moveTo(0, raster.line + 0.5);
  rasterContext.lineTo(Spectrum48.FRAME_WIDTH, raster.line + 0.5);
  rasterContext.stroke();
  rasterContext.beginPath();
  rasterContext.arc(raster.column, raster.line, 3, 0, Math.PI * 2);
  rasterContext.fill();
  rasterContext.restore();
}

function updateRasterTelemetry() {
  const raster = machine.getRasterPosition();
  rasterLineOutput.textContent = String(raster.line);
  rasterColumnOutput.textContent = String(raster.column);
  rasterTStateOutput.textContent = String(raster.tStateInFrame);
  screenRasterOutput.value = `Raster ${raster.line}:${raster.column} · T ${raster.tStateInFrame}`;
}

function refreshDebugDisplay() {
  drawSpectrumScreen();
  updateDebugger();
  updateRasterTelemetry();
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

function downloadBytes(bytes, filename, type = "application/octet-stream") {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function selectToolPanel(name) {
  for (const button of toolTabButtons) {
    const selected = button.dataset.toolTab === name;
    button.setAttribute("aria-selected", String(selected));
  }

  for (const panel of toolPanels) {
    const selected = panel.dataset.toolPanel === name;
    panel.hidden = !selected;
    panel.classList.toggle("active", selected);
  }
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
    if (rzxPlaying && rzxPlayback) {
      try {
        captureExecutionState("RZX frame");
        const frame = rzxPlayback.stepFrame();
        if (!frame || rzxPlayback.done) {
          rzxPlaying = false;
          running = false;
          rzxPlayPauseButton.textContent = "Play RZX";
          statusOutput.value = `RZX playback complete (${rzxPlayback.frameIndex} frames)`;
        }
        rzxStatusOutput.value = `${rzxPlayback.frameIndex}/${rzxPlayback.recording.frameCount} frames`;
      } catch (error) {
        rzxPlaying = false;
        running = false;
        rzxPlayPauseButton.textContent = "Play RZX";
        statusOutput.value = error.message;
      }
    } else {
      runMachineFrame();
    }
    flashOn = Math.floor(machine.frame / 16) % 2 === 1;
  } else {
    pumpAudio();
  }

  drawSpectrumScreen();
  frameOutput.textContent = String(machine.frame);
  pcOutput.textContent = formatWord(machine.cpu.PC);
  borderOutput.textContent = String(machine.borderColor);
  updateRasterTelemetry();
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
  highlightSourceLine(registers.PC);
}

function sourceAddress(line) {
  const match = line.match(/^\s*(?:\d+\s+)?(?:0x|\$)?([0-9a-f]{4})(?=[:\s])/i);
  return match ? Number.parseInt(match[1], 16) : null;
}

function renderSource(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  sourceListing.replaceChildren(...lines.map((line) => {
    const item = document.createElement("li");
    item.textContent = line || " ";
    const address = sourceAddress(line);
    if (address !== null) item.dataset.address = String(address);
    return item;
  }));
  sourceRows = Array.from(sourceListing.children);
  if (machine) highlightSourceLine(machine.cpu.PC);
}

function highlightSourceLine(pc) {
  for (const row of sourceRows) {
    row.classList.toggle("current", Number(row.dataset.address) === pc);
  }
}

function renderAssemblerReference(query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  const entries = ASSEMBLER_REFERENCE.filter((entry) =>
    !normalizedQuery || `${entry.category} ${entry.syntax} ${entry.description}`.toLowerCase().includes(normalizedQuery)
  );
  assemblerReference.replaceChildren(...entries.map((entry) => {
    const article = document.createElement("article");
    const category = document.createElement("small");
    category.textContent = entry.category;
    const syntax = document.createElement("code");
    syntax.textContent = entry.syntax;
    const description = document.createElement("p");
    description.textContent = entry.description;
    article.append(category, syntax, description);
    return article;
  }));
  if (entries.length === 0) assemblerReference.textContent = "No matching directives or functions";
}

function stepRzxFrame() {
  if (!rzxPlayback || rzxPlayback.done) return;
  captureExecutionState("RZX frame");
  const frame = rzxPlayback.stepFrame();
  rzxStatusOutput.value = `${rzxPlayback.frameIndex}/${rzxPlayback.recording.frameCount} frames`;
  if (!frame || rzxPlayback.done) {
    rzxStepButton.disabled = true;
    rzxPlayPauseButton.disabled = true;
    statusOutput.value = `RZX playback complete (${rzxPlayback.frameIndex} frames)`;
  } else {
    statusOutput.value = `RZX frame ${rzxPlayback.frameIndex}`;
  }
  refreshDebugDisplay();
}

window.addEventListener("keydown", (event) => {
  if (!shouldCaptureModernKeyEvent(event)) return;
  if (shouldPreventBrowserScrollKey(event)) event.preventDefault();
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
  if (running && !rzxPlaying) clearExecutionHistory();
  runPauseButton.textContent = running ? "Pause" : "Run";
  runPauseButton.setAttribute("aria-label", running ? "Pause" : "Run");
  statusOutput.value = running ? "Running" : "Paused";
});

stepFrameButton.addEventListener("click", () => {
  running = false;
  rzxPlaying = false;
  rzxPlayPauseButton.textContent = "Play RZX";
  runPauseButton.textContent = "Run";
  runPauseButton.setAttribute("aria-label", "Run");
  captureExecutionState("Frame");
  runMachineFrame();
  if (immediateScreenInput.checked) refreshDebugDisplay();
  else updateDebugger();
  statusOutput.value = "Stepped one frame";
});

stepInstructionButton.addEventListener("click", () => {
  running = false;
  rzxPlaying = false;
  rzxPlayPauseButton.textContent = "Play RZX";
  runPauseButton.textContent = "Run";
  runPauseButton.setAttribute("aria-label", "Run");
  captureExecutionState("Instruction");
  stepInstruction();
  if (immediateScreenInput.checked) refreshDebugDisplay();
  else updateDebugger();
  statusOutput.value = "Stepped one instruction";
});

stepBackButton.addEventListener("click", () => {
  running = false;
  rzxPlaying = false;
  runPauseButton.textContent = "Run";
  runPauseButton.setAttribute("aria-label", "Run");
  rzxPlayPauseButton.textContent = "Play RZX";
  const entry = executionHistory.stepBack(machine);
  if (!entry) return;
  if (entry.metadata && rzxPlayback) {
    rzxPlayback.eventIndex = entry.metadata.rzxEventIndex;
    rzxPlayback.frameIndex = entry.metadata.rzxFrameIndex;
    rzxStepButton.disabled = false;
    rzxPlayPauseButton.disabled = false;
    rzxStatusOutput.value = `${rzxPlayback.frameIndex}/${rzxPlayback.recording.frameCount} frames`;
  }
  updateHistoryControls();
  audio?.reset(machine.cpu.tStates);
  refreshDebugDisplay();
  statusOutput.value = `Reversed ${entry.label.toLowerCase()}`;
});

resetButton.addEventListener("click", () => {
  resetMachine();
  refreshDebugDisplay();
});

romFileInput.addEventListener("change", async () => {
  const file = romFileInput.files?.[0];
  if (!file) return;

  try {
    mountRom(new Uint8Array(await file.arrayBuffer()), `Loaded ${file.name}`);
  } catch (error) {
    statusOutput.value = error.message;
  } finally {
    romFileInput.value = "";
  }
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

for (const button of toolTabButtons) {
  button.addEventListener("click", () => {
    selectToolPanel(button.dataset.toolTab);
  });
}

showRasterOverlayInput.addEventListener("change", drawRasterOverlay);

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

snapshotFileInput.addEventListener("change", async () => {
  const file = snapshotFileInput.files?.[0];
  if (!file) return;

  try {
    const snapshot = applyZ80Snapshot(machine, await file.arrayBuffer());
    currentTapBlocks = [];
    currentTapEntries = [];
    selectedTapEntryIndex = -1;
    tapLoadButton.disabled = true;
    renderTapList();
    audio?.reset(machine.cpu.tStates);
    clearExecutionHistory();
    clearRzxPlayback();
    statusOutput.value = `Loaded ${snapshot.format} snapshot ${file.name}`;
    refreshDebugDisplay();
  } catch (error) {
    statusOutput.value = error.message;
  } finally {
    snapshotFileInput.value = "";
  }
});

snapshotSaveButton.addEventListener("click", () => {
  const bytes = createZ80Snapshot(machine);
  downloadBytes(bytes, "zx-spectrum-state.z80");
  statusOutput.value = "Saved current machine state as a Z80 snapshot";
});

rzxFileInput.addEventListener("change", async () => {
  const file = rzxFileInput.files?.[0];
  if (!file) return;

  try {
    const recording = await parseRzx(await file.arrayBuffer());
    rzxPlayback = new RzxPlayback(machine, recording);
    rzxPlaying = false;
    running = false;
    runPauseButton.textContent = "Run";
    runPauseButton.setAttribute("aria-label", "Run");
    clearExecutionHistory();
    rzxStepButton.disabled = false;
    rzxPlayPauseButton.disabled = false;
    rzxPlayPauseButton.textContent = "Play RZX";
    rzxStatusOutput.value = `0/${recording.frameCount} frames · ${recording.creator}`;
    statusOutput.value = `Loaded RZX ${file.name}`;
  } catch (error) {
    clearRzxPlayback();
    statusOutput.value = error.message;
  } finally {
    rzxFileInput.value = "";
  }
});

rzxStepButton.addEventListener("click", () => {
  try {
    running = false;
    rzxPlaying = false;
    runPauseButton.textContent = "Run";
    rzxPlayPauseButton.textContent = "Play RZX";
    stepRzxFrame();
  } catch (error) {
    statusOutput.value = error.message;
  }
});

rzxPlayPauseButton.addEventListener("click", () => {
  if (!rzxPlayback || rzxPlayback.done) return;
  rzxPlaying = !rzxPlaying;
  running = rzxPlaying;
  runPauseButton.textContent = rzxPlaying ? "Pause" : "Run";
  runPauseButton.setAttribute("aria-label", rzxPlaying ? "Pause" : "Run");
  rzxPlayPauseButton.textContent = rzxPlaying ? "Pause RZX" : "Play RZX";
  statusOutput.value = rzxPlaying ? "Playing RZX recording" : "RZX playback paused";
});

basicFileInput.addEventListener("change", async () => {
  const file = basicFileInput.files?.[0];
  if (!file) return;

  try {
    let text = await file.text();
    try {
      loadBasicProgram(machine, text);
    } catch (error) {
      if (!/Invalid BASIC line number/.test(error.message)) throw error;
      text = renumberBasicProgram(text);
      loadBasicProgram(machine, text);
    }
    pasteTextInput.value = text;
    statusOutput.value = `Loaded BASIC source ${file.name}`;
    refreshDebugDisplay();
  } catch (error) {
    statusOutput.value = error.message;
  } finally {
    basicFileInput.value = "";
  }
});

basicExportButton.addEventListener("click", () => {
  try {
    const text = `${exportBasicProgram(machine)}\n`;
    downloadBytes(text, "zx-spectrum-program.bas", "text/plain;charset=utf-8");
    statusOutput.value = "Exported current BASIC program";
  } catch (error) {
    statusOutput.value = error.message;
  }
});

sourceFileInput.addEventListener("change", async () => {
  const file = sourceFileInput.files?.[0];
  if (!file) return;
  try {
    renderSource(await file.text());
    statusOutput.value = `Loaded source ${file.name}`;
  } catch (error) {
    statusOutput.value = error.message;
  } finally {
    sourceFileInput.value = "";
  }
});

assemblerSearchInput.addEventListener("input", () => {
  renderAssemblerReference(assemblerSearchInput.value);
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
  renderAssemblerReference();
  await loadRom();
  resetMachine();
  draw();
} catch (error) {
  statusOutput.value = error.message;
}
