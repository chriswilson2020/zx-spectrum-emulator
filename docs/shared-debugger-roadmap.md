# Shared Debugger and Rewind Roadmap

Status: Approved for implementation planning

Last updated: 2026-08-02

Scope: TRS-80 Model III, TI-85-like, CP/M z80pack, and CP/M Z80-MBC2

This document is the canonical implementation roadmap for carrying the useful
ZX Spectrum debugger and workbench features into the other machine layers. It
is intentionally split into independently testable and deployable phases.

## Progress

| Phase | Deliverable | Status | Depends on | Tracking PR |
| --- | --- | --- | --- | --- |
| 0 | Shared debugger contracts and history adapters | Not started | — | — |
| 1 | Shared dock, float, resize, persistence, and pop-out workbench | Not started | Phase 0 contracts | — |
| 2 | Shared source workspace and documentation reference | Not started | Phase 0 contracts | — |
| 3 | TRS-80 deterministic rewind | Not started | Phases 0–1 | — |
| 4 | TI-85 sessions and deterministic rewind | Not started | Phases 0–1 | — |
| 5 | CP/M execution controls and deterministic rewind | Not started | Phases 0–1 | — |
| 6 | Machine-specific timing, tracing, and recordings | Not started | Stable Phases 3–5 | — |

Update this table when work begins, a phase is blocked, or a PR is merged. A
phase is complete only when all of its acceptance criteria pass on the deployed
site.

## Principles

- Share debugger infrastructure, not machine behaviour.
- Keep RZX, ULA contention, and the Spectrum floating bus Spectrum-specific.
- Preserve existing session formats unless a documented version migration is
  required.
- Never place copyrighted ROM contents in sessions, recordings, or history.
- Bound rewind memory use and avoid full-memory or full-disk copies per step.
- Treat terminal output, cassette position, interrupt schedules, and disk writes
  as state that must reverse deterministically.
- Ship one focused PR per phase or independently useful sub-phase.

## Target architecture

### Machine debug adapter

Each machine should expose an adapter consumed by shared browser controls. The
adapter should provide:

- a stable machine/profile identifier and state-format version;
- instruction stepping and a meaningful larger step (`frame` or CP/M `slice`);
- capture and restoration of non-memory machine state;
- declarations for every mutable memory region;
- immediate display/debug rendering hooks;
- optional capture and restoration of external side effects;
- reset, ROM change, profile change, and media change notifications that
  invalidate incompatible history.

The adapter must not require every machine to rename its native memory fields.
Spectrum RAM, TRS-80 RAM/video RAM, TI-85 RAM, and CP/M `memory.bytes` should be
declared as named regions.

### Shared history engine

Generalize the current reverse-delta history to support:

- multiple typed-array memory regions;
- versioned core and peripheral state;
- configurable entry and byte limits;
- instruction, frame, slice, and input-event metadata;
- machine-specific journals such as CP/M disk-sector before-images;
- deterministic restoration after repeated forward/backward operations;
- a clear invalidation reason surfaced in the UI.

The default browser budget should remain 64 MB unless profiling demonstrates a
better cross-machine value. The history is transient and is not included in
portable session files.

### Shared debug controller

Centralize:

- Run/Pause;
- Step Instruction;
- Step Frame or Step Slice;
- Step Back;
- rewind-timeline scrubbing;
- history button and status updates;
- immediate render after stepping or restoration;
- audio/output resynchronization after rewind;
- history clearing after incompatible state changes.

### Shared workbench controller

Extend the existing window controller with:

- a separate persisted layout namespace per machine and hardware profile;
- dock, float, drag, resize, reset-layout, and pop-out actions;
- safe handling for blocked or manually closed pop-outs;
- live canvas, text, register, memory, source, and terminal mirrors;
- accessible labels and keyboard operation;
- responsive fallback behaviour on narrow screens.

### Shared source workspace

Provide:

- plain address-prefixed ASM/listing parsing;
- sjasmplus `.sld.txt` source-level data parsing;
- source-to-address and address-to-source lookup;
- current-PC highlighting;
- symbol search;
- the categorized sjasmplus reference;
- optional machine-specific reference categories.

Source files are read-only debugger inputs and must never modify emulated RAM.

## Phase 0 — Shared foundations

Goal: introduce the shared contracts and migrate Spectrum to them without a
visible behaviour change.

### Work

- [ ] Define the machine debug adapter interface.
- [ ] Convert history from a single `machine.ram` assumption to named memory
  regions.
- [ ] Add versioned non-memory state capture and restoration.
- [ ] Extract shared run, step, reverse, and timeline control logic.
- [ ] Add history invalidation events and user-facing reasons.
- [ ] Migrate the Spectrum page to the shared interfaces.
- [ ] Add a reusable adapter conformance-test harness.
- [ ] Document the contracts in `docs/architecture.md`.

### Acceptance criteria

- Spectrum instruction, frame, continuous, and RZX rewind remain deterministic.
- Spectrum UI behaviour and session/snapshot compatibility do not regress.
- Memory usage remains within the configured history budget.
- The conformance suite detects omitted state and incorrect restoration order.
- The full test suite and opcode coverage remain green.

## Phase 1 — Workbench on every machine

Goal: make every existing debugger view dockable, floating, resizable,
persistent, and available as a live pop-out.

### Work

- [ ] Add workbench identifiers to TRS-80 display, registers, disassembly,
  memory, keyboard, and cassette panels.
- [ ] Add workbench identifiers to TI-85 LCD, registers, disassembly, memory,
  keypad, display, and machine panels.
- [ ] Add workbench identifiers to CP/M terminal, registers, disassembly,
  controller, console, and trace panels.
- [ ] Namespace saved layouts by machine/profile.
- [ ] Add Reset Layout per machine.
- [ ] Verify canvas and text pop-out mirroring.
- [ ] Verify keyboard accessibility and mobile fallback layouts.

### Acceptance criteria

- Layouts persist independently for Spectrum, TRS-80, TI-85, z80pack, and
  Z80-MBC2.
- Closing or blocking a pop-out cannot stop the emulator.
- Every pop-out displays current live state.
- Existing machine input remains focused and usable.
- No machine execution behaviour changes in this phase.

## Phase 2 — Source workspace and reference

Goal: give every Z80 machine the same source-following tools.

### Work

- [ ] Extract the Spectrum listing parser and PC highlighter.
- [ ] Implement a tested sjasmplus SLD parser.
- [ ] Add source, symbol, and reference panels to all machine pages.
- [ ] Add TRS-80 memory map, keyboard, cassette, and ROM-call reference entries.
- [ ] Add TI-85 banking, ports, LCD, keypad, and interrupt reference entries.
- [ ] Add CP/M BDOS, BIOS, memory map, and profile-specific I/O reference
  entries.
- [ ] Detect and explain source files that do not match the active address
  space/profile.

### Acceptance criteria

- Plain listings and SLD data both follow the current PC.
- Source loading is read-only and cannot mutate machine state.
- Search works across assembler and machine-specific categories.
- Malformed and mismatched files produce clear diagnostics.

## Phase 3 — TRS-80 rewind

Goal: make the Model III the first non-Spectrum reverse-debugging target.

### Work

- [ ] Adapt 48K RAM and 1K video RAM as separate history regions.
- [ ] Capture CPU, halted state, frame, keyboard, and text-input queue state.
- [ ] Extend cassette state with active pulse index, level, timing, cursor, and
  playback status.
- [ ] Add Step Back and the rewind timeline.
- [ ] Capture manual steps and continuous execution.
- [ ] Resynchronize screen and input latches after restoration.
- [ ] Preserve existing portable session compatibility.

### Acceptance criteria

- Reversal restores CPU, RAM, video, keyboard, typer, and cassette state.
- Rewinding and replaying cassette input produces the same result.
- Continuous rewind stays within the memory and frame-time budgets.
- Existing ROM startup, BASIC typing, CAS fast-load, and session tests pass.

## Phase 4 — TI-85 sessions and rewind

Goal: add complete portable state before enabling reverse execution.

### Work

- [ ] Add versioned `saveState()` and `restoreState()` to `Ti85Machine`.
- [ ] Capture CPU, 32K RAM, ROM bank, LCD, keypad, ON key, interrupts, timer
  deadline, power mode, link port, frame, and halted state.
- [ ] Add a ROM fingerprint without exporting ROM bytes.
- [ ] Add Save Session and Load Session controls.
- [ ] Add Step Back and the rewind timeline.
- [ ] Add immediate LCD refresh after forward and reverse steps.
- [ ] Add timer-interrupt countdown and LCD-controller diagnostics.

### Acceptance criteria

- Sessions restore identical CPU, RAM, LCD, banking, and interrupt state.
- Incompatible ROM fingerprints are rejected before mutation.
- Session files contain no ROM data.
- Rewind across bank changes, ON interrupts, timer interrupts, and LCD writes is
  deterministic.
- Existing keypad, LCD, banking, and ROM workflow tests pass.

## Phase 5 — CP/M controls and rewind

Goal: provide safe reverse debugging across both CP/M hardware profiles.

### Work

- [ ] Add explicit Run/Pause and Step Instruction controls.
- [ ] Add Step Slice as the larger execution unit; do not label it as a video
  frame.
- [ ] Adapt 64K `memory.bytes`, machine state, console queues, and terminal
  state.
- [ ] Add sector-level before-image journals for z80pack and Z80-MBC2 disks.
- [ ] Define IndexedDB persistence behaviour when execution is rewound.
- [ ] Add Step Back and the rewind timeline.
- [ ] Invalidate history on profile, disk, foreign-disk, or session changes.
- [ ] Add recent BIOS/BDOS and disk-I/O trace events.

### Persistence rule

Rewinding changes the live in-memory disk but must not immediately overwrite a
persisted work disk. Persistence resumes only when forward execution continues
from the selected timeline position. Loading or replacing media clears history.

### Acceptance criteria

- CPU, RAM, controller, console, terminal cursor/screen, and disk sectors
  reverse together.
- No checkpoint contains a complete disk-image copy.
- Both z80pack and Z80-MBC2 pass boot, prompt, `DIR`, file, and session tests.
- Rewind cannot silently corrupt IndexedDB or bundled disk images.
- Blocking console input remains correct after restoration.

## Phase 6 — Machine-specific advanced tools

Goal: build appropriate diagnostics rather than copying Spectrum-only concepts.

### Work

- [ ] Add TRS-80 CRT/cassette timing and waveform views where supported by the
  machine model.
- [ ] Add TI-85 LCD-controller, timer-interrupt, power, and link-port timelines.
- [ ] Add CP/M BIOS/BDOS call, disk I/O, and console event timelines.
- [ ] Design a generic Z80 Machine Lab deterministic recording format.
- [ ] Record machine identity, state version, starting checkpoint, timing, and
  input/I/O events without ROM contents.
- [ ] Keep RZX import and playback confined to Spectrum profiles.

### Acceptance criteria

- Diagnostics reflect real machine concepts and do not present a fake raster
  where none exists.
- Recordings reject mismatched machine profiles or ROM fingerprints.
- Replaying a recording reaches the same checkpoint hashes in automated tests.

## Validation gates for every phase

- [ ] Unit tests for new adapters, state fields, parsers, and journals.
- [ ] State round-trip test: capture, mutate every field, restore, compare.
- [ ] Reverse-sequence test: execute, reverse, replay, compare checkpoint hashes.
- [ ] Memory-budget and history-trimming tests.
- [ ] Existing machine boot and workflow regression tests.
- [ ] `npm test` passes.
- [ ] `npm run coverage:opcodes` remains 100% for all decoder families.
- [ ] `git diff --check` passes.
- [ ] Real-browser desktop and narrow-screen checks pass without console errors.
- [ ] GitHub Pages deployment is verified before the phase is marked complete.

## Performance budgets

- History allocation must remain within its configured byte limit.
- Continuous capture should not reduce the visible update rate below the
  machine page's existing behaviour on a typical desktop browser.
- No history entry may contain a complete CP/M disk image.
- Pop-out synchronization should be throttled and stop when the window closes.
- Debug rendering must remain separate from CPU correctness and timing.

## Known risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Missing peripheral state produces nondeterministic rewind | Adapter conformance and mutate-every-field round-trip tests |
| Full state copies create excessive garbage collection | Typed-array reverse deltas and fixed byte budgets |
| CP/M disk rewind conflicts with IndexedDB | Sector journals and explicit deferred-persistence rules |
| TRS-80 cassette rewind resumes at the wrong pulse | Capture pulse index, level, deadline, cursor, and playback state |
| TI-85 session uses the wrong ROM | Store and validate a ROM fingerprint; never export ROM bytes |
| Pop-outs steal input or survive navigation | Read-only mirrors, lifecycle cleanup, and focus tests |
| Shared UI abstraction leaks machine-specific assumptions | Adapter contracts and profile-specific integration tests |

## Explicit non-goals

- Porting RZX to non-Spectrum machines.
- Applying Spectrum ULA contention or floating-bus behaviour elsewhere.
- Calling CP/M execution slices video frames.
- Exporting user-supplied ROM images in sessions or recordings.
- Combining all phases into one large pull request.

## Completion definition

This roadmap is complete when every phase is marked Complete in the progress
table, every acceptance checklist is satisfied, all validation gates pass, and
the deployed pages expose the finished behaviour for every supported machine
profile.
