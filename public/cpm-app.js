import { RawCpmDisk } from "../src/cpm-disk.js";
import { CpmFileSystem, normalizeCpmName } from "../src/cpm-filesystem.js";
import { Cpm22Machine } from "../src/cpm22.js";
import { CpmTerminal, keyEventToCpmInput } from "./cpm-terminal.js";

const terminalElement = document.querySelector("#cpmTerminal");
const statusOutput = document.querySelector("#cpmStatus");
const resetButton = document.querySelector("#cpmReset");
const loadDiskButton = document.querySelector("#cpmLoadDisk");
const saveDiskButton = document.querySelector("#cpmSaveDisk");
const diskFileInput = document.querySelector("#cpmDiskFile");
const diskDriveSelect = document.querySelector("#cpmDiskDrive");
const refreshFilesButton = document.querySelector("#cpmRefreshFiles");
const fileDriveSelect = document.querySelector("#cpmFileDrive");
const fileList = document.querySelector("#cpmFileList");
const importFileButton = document.querySelector("#cpmImportFile");
const downloadFileButton = document.querySelector("#cpmDownloadFile");
const deleteFileButton = document.querySelector("#cpmDeleteFile");
const hostFileInput = document.querySelector("#cpmHostFile");

const terminal = new CpmTerminal(terminalElement);
let systemDiskBytes;
let companionDiskBytes;
let mountedDisks;
let machine;
let running = false;

async function loadDiskAsset(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`CP/M disk load failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadBundledDisks() {
  [systemDiskBytes, companionDiskBytes] = await Promise.all([
    loadDiskAsset("../ROM/cpm22-1.dsk"),
    loadDiskAsset("../ROM/cpm22-2.dsk")
  ]);
}

function createMachine(driveImages = mountedDisks?.map((disk) => disk.toBytes())) {
  mountedDisks = driveImages
    ? driveImages.map((bytes) => RawCpmDisk.z80simFloppy(bytes))
    : [
        RawCpmDisk.z80simFloppy(systemDiskBytes),
        RawCpmDisk.blankZ80simFloppy(),
        RawCpmDisk.z80simFloppy(companionDiskBytes)
      ];
  mountedDisks.forEach((disk) => new CpmFileSystem(disk).repairFullExtentRecordCounts());
  return new Cpm22Machine({
    drives: mountedDisks
  });
}

function resetMachine(driveImages) {
  machine = createMachine(driveImages);
  terminal.clear();
  refreshFileList();
  running = true;
  statusOutput.value = "Booting";
  terminalElement.focus();
}

function currentFileSystem() {
  return new CpmFileSystem(selectedFileDisk());
}

function refreshFileList() {
  if (!mountedDisks) return;
  const selected = fileList.value;
  const files = currentFileSystem().listFiles();
  fileList.replaceChildren(
    ...files.map((file) => {
      const option = document.createElement("option");
      option.value = file.name;
      option.textContent = `${file.name.padEnd(12, " ")} ${file.size.toString().padStart(6, " ")} bytes`;
      return option;
    })
  );
  if (selected && [...fileList.options].some((option) => option.value === selected)) {
    fileList.value = selected;
  } else if (fileList.options.length > 0) {
    fileList.selectedIndex = 0;
  }
}

function selectedFileName() {
  return fileList.value || "";
}

function hostFileNameToCpmName(name) {
  const cleaned = String(name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_$~!#%&'()@^`{}.-]+/g, "");
  const lastDot = cleaned.lastIndexOf(".");
  const baseSource = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
  const extensionSource = lastDot > 0 ? cleaned.slice(lastDot + 1) : "";
  const base = baseSource.replace(/\./g, "").slice(0, 8) || "HOSTFILE";
  const extension = extensionSource.replace(/\./g, "").slice(0, 3);
  return normalizeCpmName(extension ? `${base}.${extension}` : base);
}

function selectedDiskIndex(select) {
  return Number.parseInt(select.value, 10) || 0;
}

function selectedDiskImageDisk() {
  return mountedDisks[selectedDiskIndex(diskDriveSelect)];
}

function selectedFileDisk() {
  return mountedDisks[selectedDiskIndex(fileDriveSelect)];
}

function remountMachine() {
  resetMachine(mountedDisks.map((disk) => disk.toBytes()));
}

function runSlice() {
  if (!running || !machine) return;

  const start = performance.now();
  let instructions = 0;
  while (performance.now() - start < 8 && instructions < 20_000 && !machine.halted) {
    machine.step();
    instructions += 1;
  }

  const output = machine.drainOutput();
  if (output) {
    terminal.write(output);
    if (output.includes("A>")) statusOutput.value = "Ready";
  }

  if (machine.halted) {
    running = false;
    statusOutput.value = "Halted";
  }
}

function frame() {
  runSlice();
  requestAnimationFrame(frame);
}

terminalElement.addEventListener("keydown", (event) => {
  if (!machine || machine.halted) return;
  const input = keyEventToCpmInput(event);
  if (!input) return;
  event.preventDefault();
  machine.queueInput(input);
});

terminalElement.addEventListener("pointerdown", () => {
  terminalElement.focus();
});

resetButton.addEventListener("click", () => resetMachine());

loadDiskButton.addEventListener("click", () => {
  diskFileInput.click();
});

saveDiskButton.addEventListener("click", () => {
  const disk = selectedDiskImageDisk();
  if (!disk) return;
  const driveName = String.fromCharCode(97 + selectedDiskIndex(diskDriveSelect));
  downloadBytes(disk.toBytes(), `cpm22-drive-${driveName}.dsk`);
  statusOutput.value = disk.dirty ? `Downloaded ${driveName.toUpperCase()}: dirty disk` : `Downloaded ${driveName.toUpperCase()}: disk`;
});

diskFileInput.addEventListener("change", async () => {
  const file = diskFileInput.files?.[0];
  diskFileInput.value = "";
  if (!file) return;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    RawCpmDisk.z80simFloppy(bytes);
    const drive = selectedDiskIndex(diskDriveSelect);
    const driveImages = mountedDisks.map((disk, index) => (index === drive ? bytes : disk.toBytes()));
    resetMachine(driveImages);
    refreshFileList();
    statusOutput.value = `Loaded ${file.name} into ${String.fromCharCode(65 + drive)}:`;
  } catch (error) {
    statusOutput.value = "Disk rejected";
    terminal.write(`\nDisk load error: ${error.message}\n`);
  }
});

refreshFilesButton.addEventListener("click", refreshFileList);
fileDriveSelect.addEventListener("change", refreshFileList);

importFileButton.addEventListener("click", () => {
  hostFileInput.click();
});

hostFileInput.addEventListener("change", async () => {
  const file = hostFileInput.files?.[0];
  hostFileInput.value = "";
  if (!file || !mountedDisks) return;

  try {
    const name = hostFileNameToCpmName(file.name);
    currentFileSystem().writeFile(name, new Uint8Array(await file.arrayBuffer()));
    const drive = selectedDiskIndex(fileDriveSelect);
    remountMachine();
    statusOutput.value = `Imported ${name} to ${String.fromCharCode(65 + drive)}:`;
  } catch (error) {
    statusOutput.value = "Import rejected";
    terminal.write(`\nFile import error: ${error.message}\n`);
  }
});

downloadFileButton.addEventListener("click", () => {
  const name = selectedFileName();
  if (!name || !mountedDisks) return;

  try {
    downloadBytes(currentFileSystem().readFile(name, { trimCtrlZ: true }), name.toLowerCase());
    statusOutput.value = `Downloaded ${name}`;
  } catch (error) {
    statusOutput.value = "Download failed";
    terminal.write(`\nFile download error: ${error.message}\n`);
  }
});

deleteFileButton.addEventListener("click", () => {
  const name = selectedFileName();
  if (!name || !mountedDisks) return;
  if (currentFileSystem().deleteFile(name)) {
    remountMachine();
    statusOutput.value = `Deleted ${name}`;
  }
});

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function main() {
  statusOutput.value = "Loading disks";
  await loadBundledDisks();
  resetMachine();
  requestAnimationFrame(frame);
}

main().catch((error) => {
  running = false;
  statusOutput.value = "Error";
  terminal.write(`CP/M error: ${error.message}\n`);
});
