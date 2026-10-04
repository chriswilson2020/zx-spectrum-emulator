import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RawCpmDisk } from "../src/cpm-disk.js";
import { Cpm22Machine } from "../src/cpm22.js";

const DEFAULT_DISK = "ROM/cpm22-1.dsk";
const DEFAULT_BOOT_INSTRUCTIONS = 100_000;
const DEFAULT_COMMAND_INSTRUCTIONS = 1_000_000;

export function createCpm22Machine({ disk = DEFAULT_DISK } = {}) {
  return new Cpm22Machine({
    drives: [RawCpmDisk.z80simFloppy(readFileSync(disk))]
  });
}

export function runCpm22Session(options = {}) {
  const machine = createCpm22Machine(options);
  const boot = machine.runUntilOutput("A>", {
    maxInstructions: options.bootInstructions ?? DEFAULT_BOOT_INSTRUCTIONS
  });
  if (!boot.matched) throw new Error("CP/M did not reach A> during boot");

  if (options.command) {
    const command = options.command;
    const result =
      command.trim().toUpperCase() === "BYE"
        ? runByeCommand(machine, command, options)
        : machine.runCommand(command, {
            maxInstructions: options.commandInstructions ?? DEFAULT_COMMAND_INSTRUCTIONS
          });
    if (!result.matched) throw new Error(`CP/M command did not complete: ${options.command}`);
  }

  return {
    machine,
    output: machine.getOutput()
  };
}

function runByeCommand(machine, command, options) {
  const normalizedCommand = command.endsWith("\r") || command.endsWith("\n") ? command : `${command}\r`;
  machine.queueInput(normalizedCommand);
  const result = machine.run({ maxInstructions: options.commandInstructions ?? DEFAULT_COMMAND_INSTRUCTIONS });
  result.matched = result.halted;
  return result;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--disk") {
      options.disk = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--disk=")) {
      options.disk = arg.slice("--disk=".length);
    } else if (arg === "--command") {
      options.command = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--command=")) {
      options.command = arg.slice("--command=".length);
    } else if (arg === "--boot-instructions") {
      options.bootInstructions = Number(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--boot-instructions=")) {
      options.bootInstructions = Number(arg.slice("--boot-instructions=".length));
    } else if (arg === "--command-instructions") {
      options.commandInstructions = Number(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--command-instructions=")) {
      options.commandInstructions = Number(arg.slice("--command-instructions=".length));
    } else if (!options.command) {
      options.command = arg;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = runCpm22Session(options);
  process.stdout.write(result.output);
  if (!result.output.endsWith("\n")) process.stdout.write("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
