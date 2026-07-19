import { Trs80Model3Machine } from "../src/trs80-model3.js";
import { disassembleWindow, hexByte, hexWord, readMemoryRows } from "./debugger.js";
import { loadTrs80CasEntry, parseCas, trs80CasEntries } from "./trs80-cassette.js";
import { Trs80KeyLatch, Trs80TextTyper, keyEventToTrs80Key } from "./trs80-keyboard.js";

const screenElement = document.querySelector("#trs80Screen");
const statusOutput = document.querySelector("#trs80Status");
const romFileInput = document.querySelector("#trs80RomFile");
const runPauseButton = document.querySelector("#trs80RunPause");
const stepFrameButton = document.querySelector("#trs80StepFrame");
const stepInstructionButton = document.querySelector("#trs80StepInstruction");
const resetButton = document.querySelector("#trs80Reset");
const saveSessionButton = document.querySelector("#trs80SaveSession");
const loadSessionButton = document.querySelector("#trs80LoadSession");
const sessionFileInput = document.querySelector("#trs80SessionFile");
const typeText = document.querySelector("#trs80TypeText");
const typeButton = document.querySelector("#trs80TypeButton");
const startupHButton = document.querySelector("#trs80StartupH");
const startupLButton = document.querySelector("#trs80StartupL");
const enterButton = document.querySelector("#trs80Enter");
const casFileInput = document.querySelector("#trs80CasFile");
const casList = document.querySelector("#trs80CasList");
const casLoadButton = document.querySelector("#trs80CasLoad");
const casPlayButton = document.querySelector("#trs80CasPlay");
const casStopButton = document.querySelector("#trs80CasStop");
const registerGrid = document.querySelector("#trs80RegisterGrid");
const flagGrid = document.querySelector("#trs80FlagGrid");
const disassemblyList = document.querySelector("#trs80Disassembly");
const keyboardState = document.querySelector("#trs80KeyboardState");
const keyboardMatrix = document.querySelector("#trs80KeyboardMatrix");
const displayState = document.querySelector("#trs80DisplayState");
const memoryInspector = document.querySelector("#trs80MemoryInspector");

let machine;
let keyLatch;
let textTyper;
let running = false;
let animationFrame = 0;
let currentCasEntries = [];
let selectedCasEntryIndex = -1;
const DEFAULT_ROM_URL = new URL("../ROM/Model3-RevC-2EF8.bin", import.meta.url);

const FLAG_BITS = [
  ["S", 0x80],
  ["Z", 0x40],
  ["Y", 0x20],
  ["H", 0x10],
  ["X", 0x08],
  ["P/V", 0x04],
  ["N", 0x02],
  ["C", 0x01]
];

const TRS80_MEMORY_SECTIONS = [
  ["ROM", 0x0000, 4],
  ["Keyboard", 0x3800, 4],
  ["Video", 0x3c00, 4],
  ["RAM", 0x4000, 4]
];

function setControlsEnabled(enabled) {
  runPauseButton.disabled = !enabled;
  stepFrameButton.disabled = !enabled;
  stepInstructionButton.disabled = !enabled;
  resetButton.disabled = !enabled;
  saveSessionButton.disabled = !enabled;
  loadSessionButton.disabled = !enabled;
  typeButton.disabled = !enabled;
  startupHButton.disabled = !enabled;
  startupLButton.disabled = !enabled;
  enterButton.disabled = !enabled;
  updateCassetteControls();
}

async function loadDefaultRom() {
  try {
    const response = await fetch(DEFAULT_ROM_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    mountRom(new Uint8Array(await response.arrayBuffer()), "Bundled ROM loaded");
  } catch {
    statusOutput.value = "Load a 14K Model III ROM";
    renderUnavailableScreen();
  }
}

function mountRom(bytes, message) {
  try {
    machine = new Trs80Model3Machine({ rom: bytes });
    keyLatch = new Trs80KeyLatch(machine);
    textTyper = new Trs80TextTyper(keyLatch);
    machine.setCassetteBlocks(currentCasEntries.map((entry) => entry.block));
    running = true;
    runPauseButton.textContent = "Pause";
    runPauseButton.setAttribute("aria-label", "Pause");
    setControlsEnabled(true);
    statusOutput.value = message;
    screenElement.focus();
    render();
  } catch (error) {
    machine = undefined;
    keyLatch = undefined;
    textTyper = undefined;
    running = false;
    setControlsEnabled(false);
    statusOutput.value = error.message;
    renderUnavailableScreen();
  }
}

function renderUnavailableScreen() {
  screenElement.textContent = Array.from({ length: 16 }, (_, row) =>
    row === 7 ? "LOAD MODEL III ROM".padEnd(64, " ") : " ".repeat(64)
  ).join("\n");
  registerGrid.replaceChildren();
  flagGrid.replaceChildren();
  disassemblyList.replaceChildren();
  keyboardState.replaceChildren();
  keyboardMatrix.replaceChildren();
  displayState.replaceChildren();
  memoryInspector.replaceChildren();
}

function render() {
  if (!machine) {
    renderUnavailableScreen();
    return;
  }

  screenElement.textContent = machine.renderTextDisplay().join("\n");
  updateCassetteControls();
  updateDebugDrawer();
}

function updateDebugDrawer() {
  const state = machine.getDebugState();
  const registers = state.cpu.registers;
  const pairs = [
    ["AF", registers.AF],
    ["BC", registers.BC],
    ["DE", registers.DE],
    ["HL", registers.HL],
    ["IX", registers.IX],
    ["IY", registers.IY],
    ["SP", registers.SP],
    ["PC", registers.PC],
    ["T", state.cpu.tStates],
    ["IM", state.cpu.interruptMode],
    ["IFF1", state.cpu.iff1 ? 1 : 0],
    ["IFF2", state.cpu.iff2 ? 1 : 0]
  ];

  renderKeyValueGrid(registerGrid, pairs.map(([name, value]) => [name, name === "T" ? String(value) : hexWord(value)]), "register-cell");
  flagGrid.replaceChildren(...FLAG_BITS.map(([name, mask]) => {
    const flag = document.createElement("span");
    flag.className = `flag${(registers.F & mask) !== 0 ? " on" : ""}`;
    flag.textContent = name;
    return flag;
  }));

  disassemblyList.replaceChildren(...disassembleWindow((address) => machine.read8(address), registers.PC, { beforeBytes: 6, count: 9 }).map((row) => {
    const item = document.createElement("li");
    if (row.isPc) item.classList.add("current");

    const address = document.createElement("span");
    address.className = "addr";
    address.textContent = hexWord(row.address);

    const bytes = document.createElement("span");
    bytes.className = "bytes";
    bytes.textContent = row.bytes.map(hexByte).join(" ");

    const asm = document.createElement("span");
    asm.className = "asm";
    asm.textContent = row.text;

    item.append(address, bytes, asm);
    return item;
  }));

  renderKeyValueGrid(keyboardState, [
    ["Held", state.keyboard.pressedKeys.join(" ") || "-"],
    ["Count", String(state.keyboard.pressedKeys.length)]
  ], "basic-cell");
  renderKeyboardMatrix(state.keyboard.matrix);
  renderKeyValueGrid(displayState, [
    ["Frame", String(state.frame)],
    ["Size", `${state.display.columns}x${state.display.rows}`],
    ["Video", `${hexWord(state.display.videoStart)}-${hexWord(state.display.videoEnd)}`],
    ["Chars", String(state.display.nonSpaceCharacters)],
    ["CAS", `${state.cassette.cursor}/${state.cassette.blocks}`],
    ["Tape", state.cassette.playing ? "play" : "-"],
    ["EAR", state.cassette.inputLevel ? "1" : "0"],
    ["Run", running ? "yes" : "no"]
  ], "basic-cell");
  renderMemoryInspector();
}

function renderKeyValueGrid(container, rows, className = "") {
  container.replaceChildren(
    ...rows.map(([label, value]) => {
      const cell = document.createElement("div");
      if (className) cell.className = className;
      const name = document.createElement("span");
      name.textContent = label;
      const content = document.createElement("strong");
      content.textContent = value;
      cell.append(name, content);
      return cell;
    })
  );
}

function renderKeyboardMatrix(rows) {
  keyboardMatrix.replaceChildren(...rows.map((row) => {
    const item = document.createElement("div");
    item.className = row.value ? "active" : "";

    const address = document.createElement("span");
    address.textContent = hexWord(row.address);

    const value = document.createElement("strong");
    value.textContent = hexByte(row.value);

    const keys = document.createElement("em");
    keys.textContent = row.keys.join(" ") || "-";

    item.append(address, value, keys);
    return item;
  }));
}

function renderMemoryInspector() {
  memoryInspector.replaceChildren(
    ...TRS80_MEMORY_SECTIONS.map(([title, address, rows]) => {
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
}

function setKeyFromEvent(event, pressed) {
  if (!machine || !keyLatch || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const key = keyEventToTrs80Key(event);
  if (!key) return;

  event.preventDefault();
  if (pressed) keyLatch.press(key);
  else keyLatch.release(key);
  render();
}

function tick() {
  if (running && machine) {
    machine.runFrame();
    if (!textTyper?.advanceFrame()) keyLatch?.advanceFrame();
    render();
  }
  animationFrame = requestAnimationFrame(tick);
}

runPauseButton.addEventListener("click", () => {
  running = !running;
  runPauseButton.textContent = running ? "Pause" : "Run";
  runPauseButton.setAttribute("aria-label", running ? "Pause" : "Run");
});

stepFrameButton.addEventListener("click", () => {
  if (!machine) return;
  running = false;
  runPauseButton.textContent = "Run";
  runPauseButton.setAttribute("aria-label", "Run");
  machine.runFrame();
  render();
});

stepInstructionButton.addEventListener("click", () => {
  if (!machine) return;
  running = false;
  runPauseButton.textContent = "Run";
  runPauseButton.setAttribute("aria-label", "Run");
  machine.step();
  render();
});

resetButton.addEventListener("click", () => {
  if (!machine) return;
  machine.reset();
  running = true;
  runPauseButton.textContent = "Pause";
  runPauseButton.setAttribute("aria-label", "Pause");
  render();
  screenElement.focus();
});

romFileInput.addEventListener("change", async () => {
  const file = romFileInput.files?.[0];
  if (!file) return;
  mountRom(new Uint8Array(await file.arrayBuffer()), `${file.name} loaded`);
});

saveSessionButton.addEventListener("click", () => {
  if (!machine) return;
  downloadBytes(JSON.stringify(machine.saveState()), "trs80-model3-session.json", "application/json");
  statusOutput.value = "Saved TRS-80 session";
});

loadSessionButton.addEventListener("click", () => {
  sessionFileInput.click();
});

sessionFileInput.addEventListener("change", async () => {
  const file = sessionFileInput.files?.[0];
  if (!file || !machine) return;

  try {
    machine.restoreState(JSON.parse(await file.text()));
    keyLatch = new Trs80KeyLatch(machine);
    textTyper = new Trs80TextTyper(keyLatch);
    running = !machine.halted;
    runPauseButton.textContent = running ? "Pause" : "Run";
    runPauseButton.setAttribute("aria-label", running ? "Pause" : "Run");
    statusOutput.value = `Loaded TRS-80 session ${file.name}`;
    render();
    screenElement.focus();
  } catch (error) {
    statusOutput.value = `Session load failed: ${error.message}`;
  } finally {
    sessionFileInput.value = "";
  }
});

casFileInput.addEventListener("change", async () => {
  const file = casFileInput.files?.[0];
  if (!file) return;
  try {
    const blocks = parseCas(new Uint8Array(await file.arrayBuffer()));
    currentCasEntries = trs80CasEntries(blocks);
    selectedCasEntryIndex = currentCasEntries.findIndex((entry) => entry.loadable);
    machine?.setCassetteBlocks(blocks);
    renderCasList();
    statusOutput.value = `Mounted ${file.name}: ${currentCasEntries.length} CAS block${currentCasEntries.length === 1 ? "" : "s"}`;
  } catch (error) {
    currentCasEntries = [];
    selectedCasEntryIndex = -1;
    machine?.clearCassette();
    renderCasList();
    statusOutput.value = `CAS load failed: ${error.message}`;
  }
  updateCassetteControls();
  render();
});

typeButton.addEventListener("click", () => {
  if (!textTyper) return;
  textTyper.enqueue(typeText.value);
  running = true;
  runPauseButton.textContent = "Pause";
  runPauseButton.setAttribute("aria-label", "Pause");
  screenElement.focus();
});

startupHButton.addEventListener("click", () => queueText("H"));
startupLButton.addEventListener("click", () => queueText("L"));
enterButton.addEventListener("click", () => queueText("\n"));

casLoadButton.addEventListener("click", () => {
  if (!machine) return;
  const entry = currentCasEntries[selectedCasEntryIndex];
  if (!entry?.loadable) return;
  try {
    const result = loadTrs80CasEntry(machine, entry);
    machine.setCassetteCursor(selectedCasEntryIndex + 1);
    if (result.kind === "SYSTEM") {
      running = true;
      runPauseButton.textContent = "Pause";
      runPauseButton.setAttribute("aria-label", "Pause");
      statusOutput.value = `Loaded CAS SYSTEM ${result.name || "(unnamed)"} at ${hexWord(result.start)}, entry ${hexWord(result.entryPoint)}`;
    } else {
      statusOutput.value = `Loaded CAS BASIC ${result.name || "(unnamed)"} (${result.lineCount} line${result.lineCount === 1 ? "" : "s"})`;
    }
    render();
    screenElement.focus();
  } catch (error) {
    statusOutput.value = `CAS load failed: ${error.message}`;
  }
});

casPlayButton.addEventListener("click", () => {
  if (!machine) return;
  machine.startCassettePlayback({ startIndex: Math.max(0, selectedCasEntryIndex) });
  running = true;
  runPauseButton.textContent = "Pause";
  runPauseButton.setAttribute("aria-label", "Pause");
  statusOutput.value = "Cassette playing";
  updateCassetteControls();
  screenElement.focus();
});

casStopButton.addEventListener("click", () => {
  machine?.stopCassettePlayback();
  statusOutput.value = "Cassette stopped";
  updateCassetteControls();
  render();
});

function queueText(text) {
  if (!textTyper) return;
  textTyper.enqueue(text);
  running = true;
  runPauseButton.textContent = "Pause";
  runPauseButton.setAttribute("aria-label", "Pause");
  screenElement.focus();
}

function renderCasList() {
  if (currentCasEntries.length === 0) {
    casList.textContent = "No cassette mounted";
    return;
  }

  casList.replaceChildren(...currentCasEntries.map((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === selectedCasEntryIndex ? "selected" : "";
    button.disabled = !entry.loadable;
    button.textContent = casEntryLabel(entry);
    button.addEventListener("click", () => {
      selectedCasEntryIndex = index;
      renderCasList();
      updateCassetteControls();
    });
    return button;
  }));
}

function updateCassetteControls() {
  const hasMachine = Boolean(machine);
  const hasSelection = selectedCasEntryIndex >= 0 && currentCasEntries[selectedCasEntryIndex]?.loadable;
  const selectedEntry = currentCasEntries[selectedCasEntryIndex];
  casLoadButton.textContent = selectedEntry?.kind === "SYSTEM"
    ? "Load SYSTEM"
    : selectedEntry?.kind === "BASIC"
      ? "Load BASIC"
      : "Load CAS";
  casLoadButton.disabled = !hasMachine || !hasSelection;
  casPlayButton.disabled = !hasMachine || currentCasEntries.length === 0;
  casStopButton.disabled = !hasMachine || !machine?.cassettePlaying;
}

function casEntryLabel(entry) {
  if (entry.kind === "SYSTEM") {
    return `${entry.kind} ${entry.name || "(unnamed)"} ${entry.recordCount} record${entry.recordCount === 1 ? "" : "s"} entry ${hexWord(entry.entryPoint)}`;
  }
  return `${entry.kind} ${entry.name || "(unnamed)"} ${entry.lineCount} line${entry.lineCount === 1 ? "" : "s"}`;
}

function downloadBytes(bytes, filename, type = "application/octet-stream") {
  const blob = new Blob([bytes], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

screenElement.addEventListener("keydown", (event) => setKeyFromEvent(event, true));
screenElement.addEventListener("keyup", (event) => setKeyFromEvent(event, false));
window.addEventListener("blur", () => {
  if (!machine || !keyLatch) return;
  textTyper?.clear();
  keyLatch.releaseAll();
  render();
});

renderUnavailableScreen();
renderCasList();
loadDefaultRom();
animationFrame = requestAnimationFrame(tick);

window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame));
