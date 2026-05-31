import assert from "node:assert/strict";
import test from "node:test";
import { FlatMemory } from "../src/memory.js";
import { FLAG, Z80 } from "../src/z80.js";

function makeCpu(program = [], start = 0, io) {
  const memory = new FlatMemory();
  memory.load(start, program);
  const cpu = new Z80(memory, io);
  cpu.PC = start;
  return { cpu, memory };
}

test("reset initializes documented main registers", () => {
  const { cpu } = makeCpu();

  assert.equal(cpu.AF, 0);
  assert.equal(cpu.BC, 0);
  assert.equal(cpu.DE, 0);
  assert.equal(cpu.HL, 0);
  assert.equal(cpu.IX, 0);
  assert.equal(cpu.IY, 0);
  assert.equal(cpu.SP, 0xffff);
  assert.equal(cpu.PC, 0);
});

test("NOP advances PC and consumes four T-states", () => {
  const { cpu } = makeCpu([0x00]);

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.PC, 1);
  assert.equal(cpu.tStates, 4);
});

test("LD r,n loads all 8-bit registers and (HL)", () => {
  const { cpu, memory } = makeCpu([
    0x06, 0x12, // LD B,$12
    0x0e, 0x34, // LD C,$34
    0x16, 0x56, // LD D,$56
    0x1e, 0x78, // LD E,$78
    0x26, 0x20, // LD H,$20
    0x2e, 0x00, // LD L,$00
    0x36, 0x9a, // LD (HL),$9A
    0x3e, 0xbc // LD A,$BC
  ]);

  while (cpu.PC < 16) cpu.step();

  assert.equal(cpu.B, 0x12);
  assert.equal(cpu.C, 0x34);
  assert.equal(cpu.D, 0x56);
  assert.equal(cpu.E, 0x78);
  assert.equal(cpu.HL, 0x2000);
  assert.equal(memory.read8(0x2000), 0x9a);
  assert.equal(cpu.A, 0xbc);
});

test("LD rr,nn loads 16-bit register pairs", () => {
  const { cpu } = makeCpu([
    0x01, 0x34, 0x12, // LD BC,$1234
    0x11, 0x78, 0x56, // LD DE,$5678
    0x21, 0xbc, 0x9a, // LD HL,$9ABC
    0x31, 0x00, 0x80 // LD SP,$8000
  ]);

  while (cpu.PC < 12) cpu.step();

  assert.equal(cpu.BC, 0x1234);
  assert.equal(cpu.DE, 0x5678);
  assert.equal(cpu.HL, 0x9abc);
  assert.equal(cpu.SP, 0x8000);
});

test("LD r,r transfers through registers and memory at HL", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x36, 0x5a, // LD (HL),$5A
    0x46, // LD B,(HL)
    0x78, // LD A,B
    0x77 // LD (HL),A
  ]);

  while (cpu.PC < 7) cpu.step();

  assert.equal(cpu.B, 0x5a);
  assert.equal(cpu.A, 0x5a);
  assert.equal(memory.read8(0x4000), 0x5a);
});

test("absolute memory load and store use little-endian addresses", () => {
  const { cpu, memory } = makeCpu([
    0x3e, 0x42, // LD A,$42
    0x32, 0x00, 0x80, // LD ($8000),A
    0x3e, 0x00, // LD A,$00
    0x3a, 0x00, 0x80 // LD A,($8000)
  ]);

  while (cpu.PC < 10) cpu.step();

  assert.equal(memory.read8(0x8000), 0x42);
  assert.equal(cpu.A, 0x42);
});

test("JP nn replaces PC with target address", () => {
  const { cpu } = makeCpu([0xc3, 0x34, 0x12]);

  assert.equal(cpu.step(), 10);
  assert.equal(cpu.PC, 0x1234);
});

test("HALT stops fetching opcodes until interrupted", () => {
  const { cpu } = makeCpu([0x76, 0x00]);

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.halted, true);
  assert.equal(cpu.PC, 1);

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.PC, 1);
  assert.equal(cpu.tStates, 8);
});

test("ADD A,r sets carry, half-carry, sign, and overflow flags", () => {
  const { cpu } = makeCpu([
    0x3e, 0x7f, // LD A,$7F
    0x06, 0x01, // LD B,$01
    0x80, // ADD A,B
    0x06, 0x80, // LD B,$80
    0x80 // ADD A,B
  ]);

  cpu.step();
  cpu.step();
  cpu.step();

  assert.equal(cpu.A, 0x80);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.C, 0);
  assert.equal(cpu.F & FLAG.N, 0);

  cpu.step();
  cpu.step();

  assert.equal(cpu.A, 0x00);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("ADC A,r includes the carry flag", () => {
  const { cpu } = makeCpu([
    0x3e, 0xff, // LD A,$FF
    0x06, 0x00, // LD B,$00
    0x80, // ADD A,B, sets no carry
    0x06, 0x01, // LD B,$01
    0x80, // ADD A,B, sets carry and zero
    0x88 // ADC A,B
  ]);

  while (cpu.PC < 10) cpu.step();

  assert.equal(cpu.A, 0x02);
  assert.equal(cpu.F & FLAG.C, 0);
});

test("SUB and SBC set subtraction flags and preserve borrow semantics", () => {
  const { cpu } = makeCpu([
    0x3e, 0x00, // LD A,$00
    0x06, 0x01, // LD B,$01
    0x90, // SUB B
    0x98 // SBC A,B
  ]);

  cpu.step();
  cpu.step();
  cpu.step();

  assert.equal(cpu.A, 0xff);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();

  assert.equal(cpu.A, 0xfd);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.C, 0);
});

test("AND, XOR, and OR update parity and logical flags", () => {
  const { cpu } = makeCpu([
    0x3e, 0xf0, // LD A,$F0
    0x06, 0x0f, // LD B,$0F
    0xa0, // AND B
    0xa8, // XOR B
    0xb0 // OR B
  ]);

  cpu.step();
  cpu.step();
  cpu.step();

  assert.equal(cpu.A, 0x00);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);

  cpu.step();

  assert.equal(cpu.A, 0x0f);
  assert.equal(cpu.F & FLAG.H, 0);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);

  cpu.step();

  assert.equal(cpu.A, 0x0f);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
});

test("CP compares without changing A and copies X/Y from operand", () => {
  const { cpu } = makeCpu([
    0x3e, 0x28, // LD A,$28
    0x06, 0x28, // LD B,$28
    0xb8 // CP B
  ]);

  while (cpu.PC < 5) cpu.step();

  assert.equal(cpu.A, 0x28);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.Y, FLAG.Y);
  assert.equal(cpu.F & FLAG.X, FLAG.X);
});

test("INC and DEC update flags while preserving carry", () => {
  const { cpu, memory } = makeCpu([
    0x06, 0x7f, // LD B,$7F
    0x04, // INC B
    0x05, // DEC B
    0x21, 0x00, 0x40, // LD HL,$4000
    0x36, 0x00, // LD (HL),$00
    0x35 // DEC (HL)
  ]);
  cpu.F = FLAG.C;

  cpu.step();
  cpu.step();

  assert.equal(cpu.B, 0x80);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();

  assert.equal(cpu.B, 0x7f);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  while (cpu.PC < 10) cpu.step();

  assert.equal(memory.read8(0x4000), 0xff);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
});

test("getState returns debugger-friendly register and flag snapshots", () => {
  const { cpu } = makeCpu([0x3e, 0x80]);

  cpu.step();
  const state = cpu.getState();

  assert.equal(state.registers.A, 0x80);
  assert.equal(state.registers.PC, 2);
  assert.equal(state.flags.S, false);
  assert.equal(state.pendingInterrupt, false);
  assert.equal(state.pendingNmi, false);
  assert.equal(state.halted, false);
  assert.equal(state.tStates, 7);
});

test("immediate ALU opcodes operate on the byte after the opcode", () => {
  const { cpu } = makeCpu([
    0x3e, 0x10, // LD A,$10
    0xc6, 0x22, // ADD A,$22
    0xce, 0x01, // ADC A,$01
    0xd6, 0x03, // SUB $03
    0xde, 0x04, // SBC A,$04
    0xe6, 0x0f, // AND $0F
    0xee, 0xff, // XOR $FF
    0xf6, 0x10, // OR $10
    0xfe, 0xfa // CP $FA
  ]);

  cpu.step();

  cpu.step();
  assert.equal(cpu.A, 0x32);

  cpu.step();
  assert.equal(cpu.A, 0x33);

  cpu.step();
  assert.equal(cpu.A, 0x30);

  cpu.step();
  assert.equal(cpu.A, 0x2c);

  cpu.step();
  assert.equal(cpu.A, 0x0c);

  cpu.step();
  assert.equal(cpu.A, 0xf3);

  cpu.step();
  assert.equal(cpu.A, 0xf3);

  cpu.step();
  assert.equal(cpu.A, 0xf3);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
  assert.equal(cpu.PC, 18);
});

test("PUSH and POP preserve register pairs through little-endian stack memory", () => {
  const { cpu, memory } = makeCpu([
    0x01, 0x34, 0x12, // LD BC,$1234
    0x11, 0x78, 0x56, // LD DE,$5678
    0xc5, // PUSH BC
    0xd1 // POP DE
  ]);
  cpu.SP = 0x8000;

  cpu.step();
  cpu.step();
  cpu.step();

  assert.equal(cpu.SP, 0x7ffe);
  assert.equal(memory.read8(0x7ffe), 0x34);
  assert.equal(memory.read8(0x7fff), 0x12);

  cpu.step();

  assert.equal(cpu.DE, 0x1234);
  assert.equal(cpu.SP, 0x8000);
});

test("PUSH and POP support all Z80 register pair encodings", () => {
  const { cpu } = makeCpu([
    0x01, 0x01, 0x10, // LD BC,$1001
    0x11, 0x02, 0x20, // LD DE,$2002
    0x21, 0x03, 0x30, // LD HL,$3003
    0xc5, // PUSH BC
    0xd5, // PUSH DE
    0xe5, // PUSH HL
    0xf5, // PUSH AF
    0xf1, // POP AF
    0xd1, // POP DE
    0xe1, // POP HL
    0xc1 // POP BC
  ]);
  cpu.AF = 0x4004;
  cpu.SP = 0x9000;

  while (cpu.PC < 17) cpu.step();

  assert.equal(cpu.AF, 0x4004);
  assert.equal(cpu.DE, 0x3003);
  assert.equal(cpu.HL, 0x2002);
  assert.equal(cpu.BC, 0x1001);
  assert.equal(cpu.SP, 0x9000);
});

test("CALL pushes the following PC and RET restores it", () => {
  const { cpu, memory } = makeCpu([
    0xcd, 0x06, 0x00, // CALL $0006
    0x3e, 0x42, // LD A,$42
    0x76, // HALT
    0x06, 0x99, // LD B,$99
    0xc9 // RET
  ]);
  cpu.SP = 0x8000;

  cpu.step();

  assert.equal(cpu.PC, 0x0006);
  assert.equal(cpu.SP, 0x7ffe);
  assert.equal(memory.read8(0x7ffe), 0x03);
  assert.equal(memory.read8(0x7fff), 0x00);

  cpu.step();
  cpu.step();

  assert.equal(cpu.B, 0x99);
  assert.equal(cpu.PC, 0x0003);
  assert.equal(cpu.SP, 0x8000);

  cpu.step();
  assert.equal(cpu.A, 0x42);
});

test("RST pushes PC and jumps to the encoded restart vector", () => {
  const { cpu, memory } = makeCpu([0xef]); // RST $28
  cpu.SP = 0x8000;

  assert.equal(cpu.step(), 11);

  assert.equal(cpu.PC, 0x28);
  assert.equal(cpu.SP, 0x7ffe);
  assert.equal(memory.read8(0x7ffe), 0x01);
  assert.equal(memory.read8(0x7fff), 0x00);
});

test("JR applies signed relative offsets from the following instruction", () => {
  const { cpu } = makeCpu([
    0x18, 0x02, // JR +2
    0x3e, 0x00, // LD A,$00, skipped
    0x3e, 0x42, // LD A,$42
    0x18, 0xfe // JR -2, back to itself
  ]);

  assert.equal(cpu.step(), 12);
  assert.equal(cpu.PC, 4);

  cpu.step();
  assert.equal(cpu.A, 0x42);

  assert.equal(cpu.step(), 12);
  assert.equal(cpu.PC, 6);
});

test("conditional JR supports taken and untaken Z/C conditions", () => {
  const { cpu } = makeCpu([
    0x3e, 0x01, // LD A,$01
    0xfe, 0x01, // CP $01, sets Z
    0x20, 0x02, // JR NZ,+2, not taken
    0x28, 0x02, // JR Z,+2, taken
    0x3e, 0x00, // LD A,$00, skipped
    0xfe, 0x02, // CP $02, sets C
    0x30, 0x02, // JR NC,+2, not taken
    0x38, 0x02, // JR C,+2, taken
    0x3e, 0xff, // LD A,$FF, skipped
    0x76 // HALT
  ]);

  while (!cpu.halted) cpu.step();

  assert.equal(cpu.A, 0x01);
  assert.equal(cpu.PC, 19);
});

test("DJNZ decrements B and loops until B reaches zero", () => {
  const { cpu } = makeCpu([
    0x06, 0x03, // LD B,$03
    0x10, 0xfe, // DJNZ -2
    0x76 // HALT
  ]);

  cpu.step();

  assert.equal(cpu.step(), 13);
  assert.equal(cpu.B, 0x02);
  assert.equal(cpu.PC, 2);

  assert.equal(cpu.step(), 13);
  assert.equal(cpu.B, 0x01);
  assert.equal(cpu.PC, 2);

  assert.equal(cpu.step(), 8);
  assert.equal(cpu.B, 0x00);
  assert.equal(cpu.PC, 4);
});

test("conditional JP checks all condition flag groups", () => {
  const { cpu } = makeCpu([
    0x3e, 0x00, // LD A,$00
    0xfe, 0x00, // CP $00, Z set, C clear, PV clear, S clear
    0xc2, 0x20, 0x00, // JP NZ,$0020, not taken
    0xca, 0x0b, 0x00, // JP Z,$000B, taken
    0x76, // HALT, skipped
    0xd2, 0x0f, 0x00, // JP NC,$000F, taken
    0x76, // HALT, skipped
    0x3e, 0x80, // LD A,$80
    0xfe, 0x00, // CP $00, M set, PO true
    0xea, 0x1b, 0x00, // JP PE,$001B, not taken
    0xe2, 0x1a, 0x00, // JP PO,$001A, taken
    0x76, // HALT, skipped
    0xf2, 0x24, 0x00, // JP P,$0024, not taken
    0xfa, 0x21, 0x00, // JP M,$0021, taken
    0x76, // HALT, skipped
    0x76 // HALT
  ]);

  while (!cpu.halted) cpu.step();

  assert.equal(cpu.PC, 0x22);
});

test("conditional CALL and RET use taken and untaken cycle timings", () => {
  const { cpu } = makeCpu([
    0x3e, 0x01, // LD A,$01
    0xfe, 0x01, // CP $01, sets Z
    0xc4, 0x10, 0x00, // CALL NZ,$0010, not taken
    0xcc, 0x10, 0x00, // CALL Z,$0010, taken
    0x3e, 0x42, // LD A,$42
    0x76, // HALT
    0x00,
    0x00,
    0x00,
    0x3e, 0x99, // LD A,$99 at $0010
    0xc0, // RET NZ, not taken
    0xc8 // RET Z, taken
  ]);
  cpu.SP = 0x8000;

  cpu.step();
  cpu.step();
  assert.equal(cpu.step(), 10);
  assert.equal(cpu.PC, 7);

  assert.equal(cpu.step(), 17);
  assert.equal(cpu.PC, 0x10);
  assert.equal(cpu.SP, 0x7ffe);

  cpu.step();
  assert.equal(cpu.A, 0x99);

  assert.equal(cpu.step(), 5);
  assert.equal(cpu.PC, 0x13);

  assert.equal(cpu.step(), 11);
  assert.equal(cpu.PC, 0x0a);
  assert.equal(cpu.SP, 0x8000);

  cpu.step();
  assert.equal(cpu.A, 0x42);
});

test("INC rr and DEC rr update 16-bit pairs without changing flags", () => {
  const { cpu } = makeCpu([
    0x01, 0xff, 0xff, // LD BC,$FFFF
    0x11, 0x00, 0x00, // LD DE,$0000
    0x21, 0x34, 0x12, // LD HL,$1234
    0x31, 0x00, 0x80, // LD SP,$8000
    0x03, // INC BC
    0x1b, // DEC DE
    0x23, // INC HL
    0x3b // DEC SP
  ]);
  cpu.F = FLAG.S | FLAG.C;

  while (cpu.PC < 16) cpu.step();

  assert.equal(cpu.BC, 0x0000);
  assert.equal(cpu.DE, 0xffff);
  assert.equal(cpu.HL, 0x1235);
  assert.equal(cpu.SP, 0x7fff);
  assert.equal(cpu.F, FLAG.S | FLAG.C);
});

test("ADD HL,rr updates H/N/C and keeps S/Z/PV from previous flags", () => {
  const { cpu } = makeCpu([
    0x21, 0xff, 0x0f, // LD HL,$0FFF
    0x01, 0x01, 0x00, // LD BC,$0001
    0x09, // ADD HL,BC
    0x11, 0x00, 0xf0, // LD DE,$F000
    0x19 // ADD HL,DE
  ]);
  cpu.F = FLAG.S | FLAG.Z | FLAG.PV | FLAG.N | FLAG.C;

  cpu.step();
  cpu.step();
  cpu.step();

  assert.equal(cpu.HL, 0x1000);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.N, 0);
  assert.equal(cpu.F & FLAG.C, 0);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);

  cpu.step();
  cpu.step();

  assert.equal(cpu.HL, 0x0000);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("ADD HL,HL and ADD HL,SP use the same 16-bit ALU path", () => {
  const { cpu } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x29, // ADD HL,HL
    0x31, 0x00, 0x80, // LD SP,$8000
    0x39 // ADD HL,SP
  ]);

  cpu.step();
  cpu.step();
  assert.equal(cpu.HL, 0x8000);
  assert.equal(cpu.F & FLAG.C, 0);

  cpu.step();
  cpu.step();
  assert.equal(cpu.HL, 0x0000);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("LD SP,HL copies HL into the stack pointer", () => {
  const { cpu } = makeCpu([
    0x21, 0x34, 0x12, // LD HL,$1234
    0xf9 // LD SP,HL
  ]);

  cpu.step();
  assert.equal(cpu.step(), 6);

  assert.equal(cpu.SP, 0x1234);
});

test("accumulator rotate instructions update A and carry while preserving S/Z/PV", () => {
  const { cpu } = makeCpu([
    0x3e, 0x81, // LD A,$81
    0x07, // RLCA -> $03, C set
    0x17, // RLA -> $07, old C shifted in
    0x0f, // RRCA -> $83, C set
    0x1f // RRA -> $C1, old C shifted in, C set
  ]);
  cpu.F = FLAG.S | FLAG.Z | FLAG.PV;

  cpu.step();

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.A, 0x03);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);

  cpu.step();
  assert.equal(cpu.A, 0x07);
  assert.equal(cpu.F & FLAG.C, 0);

  cpu.step();
  assert.equal(cpu.A, 0x83);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();
  assert.equal(cpu.A, 0xc1);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("CPL complements A and sets H/N while preserving C", () => {
  const { cpu } = makeCpu([
    0x3e, 0x55, // LD A,$55
    0x2f // CPL
  ]);
  cpu.F = FLAG.C | FLAG.Z;

  cpu.step();
  assert.equal(cpu.step(), 4);

  assert.equal(cpu.A, 0xaa);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.Y, FLAG.Y);
  assert.equal(cpu.F & FLAG.X, FLAG.X);
});

test("SCF and CCF manipulate carry and half-carry from the previous carry", () => {
  const { cpu } = makeCpu([
    0x3e, 0x28, // LD A,$28
    0x37, // SCF
    0x3f, // CCF
    0x3f // CCF
  ]);
  cpu.F = FLAG.N | FLAG.H | FLAG.Z | FLAG.Y | FLAG.X;

  cpu.step();
  cpu.step();

  assert.equal(cpu.F & FLAG.C, FLAG.C);
  assert.equal(cpu.F & FLAG.H, 0);
  assert.equal(cpu.F & FLAG.N, 0);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.Y, FLAG.Y);
  assert.equal(cpu.F & FLAG.X, FLAG.X);

  cpu.step();
  assert.equal(cpu.F & FLAG.C, 0);
  assert.equal(cpu.F & FLAG.H, FLAG.H);

  cpu.step();
  assert.equal(cpu.F & FLAG.C, FLAG.C);
  assert.equal(cpu.F & FLAG.H, 0);
});

test("DAA adjusts A after BCD addition", () => {
  const { cpu } = makeCpu([
    0x3e, 0x15, // LD A,$15
    0xc6, 0x27, // ADD A,$27 -> $3C
    0x27 // DAA -> $42
  ]);

  while (cpu.PC < 5) cpu.step();

  assert.equal(cpu.A, 0x42);
  assert.equal(cpu.F & FLAG.C, 0);
  assert.equal(cpu.F & FLAG.N, 0);
});

test("DAA adjusts A and carry after overflowing BCD addition", () => {
  const { cpu } = makeCpu([
    0x3e, 0x88, // LD A,$88
    0xc6, 0x88, // ADD A,$88 -> $10 with carry
    0x27 // DAA -> $76 with carry
  ]);

  while (cpu.PC < 5) cpu.step();

  assert.equal(cpu.A, 0x76);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("DAA adjusts A after BCD subtraction and keeps N", () => {
  const { cpu } = makeCpu([
    0x3e, 0x42, // LD A,$42
    0xd6, 0x27, // SUB $27 -> $1B
    0x27 // DAA -> $15
  ]);

  while (cpu.PC < 5) cpu.step();

  assert.equal(cpu.A, 0x15);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.C, 0);
});

test("CB rotate and shift operations update registers and flags", () => {
  const { cpu } = makeCpu([
    0x06, 0x81, // LD B,$81
    0xcb, 0x00, // RLC B -> $03, C set
    0xcb, 0x08, // RRC B -> $81, C set
    0xcb, 0x10, // RL B -> $03, C set
    0xcb, 0x18, // RR B -> $81, C set
    0xcb, 0x20, // SLA B -> $02, C set
    0xcb, 0x28, // SRA B -> $01, C clear
    0xcb, 0x30, // SLL B -> $03, C clear
    0xcb, 0x38 // SRL B -> $01, C set
  ]);

  cpu.step();

  cpu.step();
  assert.equal(cpu.B, 0x03);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();
  assert.equal(cpu.B, 0x81);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
  assert.equal(cpu.F & FLAG.S, FLAG.S);

  cpu.step();
  assert.equal(cpu.B, 0x03);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();
  assert.equal(cpu.B, 0x81);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();
  assert.equal(cpu.B, 0x02);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();
  assert.equal(cpu.B, 0x01);
  assert.equal(cpu.F & FLAG.C, 0);

  cpu.step();
  assert.equal(cpu.B, 0x03);

  cpu.step();
  assert.equal(cpu.B, 0x01);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("CB rotate and shift operations work on memory at HL", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x36, 0x80, // LD (HL),$80
    0xcb, 0x06 // RLC (HL)
  ]);

  cpu.step();
  cpu.step();

  assert.equal(cpu.step(), 15);
  assert.equal(memory.read8(0x4000), 0x01);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("CB BIT tests bits without changing the operand and preserves carry", () => {
  const { cpu } = makeCpu([
    0x06, 0x28, // LD B,$28
    0xcb, 0x40, // BIT 0,B, clear
    0xcb, 0x50, // BIT 2,B, clear
    0xcb, 0x68 // BIT 5,B, set
  ]);
  cpu.F = FLAG.C;

  cpu.step();

  cpu.step();
  assert.equal(cpu.B, 0x28);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
  assert.equal(cpu.F & FLAG.Y, FLAG.Y);
  assert.equal(cpu.F & FLAG.X, FLAG.X);

  cpu.step();
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);

  cpu.step();
  assert.equal(cpu.F & FLAG.Z, 0);
});

test("CB BIT 7 sets sign when the tested bit is set", () => {
  const { cpu } = makeCpu([
    0x3e, 0x80, // LD A,$80
    0xcb, 0x7f // BIT 7,A
  ]);

  cpu.step();
  cpu.step();

  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.Z, 0);
});

test("CB RES and SET update registers and memory at HL", () => {
  const { cpu, memory } = makeCpu([
    0x06, 0xff, // LD B,$FF
    0xcb, 0x80, // RES 0,B -> $FE
    0xcb, 0xf8, // SET 7,B -> still $FE
    0x21, 0x00, 0x40, // LD HL,$4000
    0x36, 0x00, // LD (HL),$00
    0xcb, 0xe6, // SET 4,(HL)
    0xcb, 0xa6 // RES 4,(HL)
  ]);

  cpu.step();
  cpu.step();
  assert.equal(cpu.B, 0xfe);

  cpu.step();
  assert.equal(cpu.B, 0xfe);

  cpu.step();
  cpu.step();

  assert.equal(cpu.step(), 15);
  assert.equal(memory.read8(0x4000), 0x10);

  assert.equal(cpu.step(), 15);
  assert.equal(memory.read8(0x4000), 0x00);
});

test("CPU accepts generic I/O hooks for future port instructions", () => {
  const writes = [];
  const { cpu } = makeCpu([], 0, {
    read: (port) => port & 0xff,
    write: (port, value) => writes.push([port, value])
  });

  assert.equal(cpu.io.read(0x1234), 0x34);
  cpu.io.write(0x00fe, 0x07);
  assert.deepEqual(writes, [[0x00fe, 0x07]]);
});

test("ED NEG subtracts A from zero and sets arithmetic flags", () => {
  const { cpu } = makeCpu([
    0x3e, 0x01, // LD A,$01
    0xed, 0x44, // NEG
    0x3e, 0x80, // LD A,$80
    0xed, 0x4c // NEG alias
  ]);

  cpu.step();
  assert.equal(cpu.step(), 8);
  assert.equal(cpu.A, 0xff);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();
  cpu.step();
  assert.equal(cpu.A, 0x80);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("ED RETN/RETI return from stack and copy IFF2 into IFF1", () => {
  const { cpu } = makeCpu([
    0xed, 0x45, // RETN
    0xed, 0x4d // RETI
  ]);
  cpu.SP = 0x8000;
  cpu.push16(0x0002);
  cpu.IFF1 = false;
  cpu.IFF2 = true;

  assert.equal(cpu.step(), 14);
  assert.equal(cpu.PC, 0x0002);
  assert.equal(cpu.IFF1, true);

  cpu.push16(0x1234);
  cpu.IFF1 = true;
  cpu.IFF2 = false;

  assert.equal(cpu.step(), 14);
  assert.equal(cpu.PC, 0x1234);
  assert.equal(cpu.IFF1, false);
});

test("ED interrupt mode instructions set IM 0, 1, and 2", () => {
  const { cpu } = makeCpu([
    0xed, 0x46, // IM 0
    0xed, 0x56, // IM 1
    0xed, 0x5e // IM 2
  ]);

  cpu.interruptMode = 2;
  cpu.step();
  assert.equal(cpu.interruptMode, 0);

  cpu.step();
  assert.equal(cpu.interruptMode, 1);

  cpu.step();
  assert.equal(cpu.interruptMode, 2);
});

test("ED LD I/R,A and LD A,I/R transfer special registers and flags", () => {
  const { cpu } = makeCpu([
    0x3e, 0x80, // LD A,$80
    0xed, 0x47, // LD I,A
    0x3e, 0x28, // LD A,$28
    0xed, 0x4f, // LD R,A
    0xed, 0x57, // LD A,I
    0xed, 0x5f // LD A,R
  ]);
  cpu.IFF2 = true;

  cpu.step();
  assert.equal(cpu.step(), 9);
  assert.equal(cpu.I, 0x80);

  cpu.step();
  assert.equal(cpu.step(), 9);
  assert.equal(cpu.R, 0x28);

  cpu.step();
  assert.equal(cpu.A, 0x80);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);

  cpu.step();
  assert.equal(cpu.A, 0x2c);
  assert.equal(cpu.F & FLAG.Y, FLAG.Y);
  assert.equal(cpu.F & FLAG.X, FLAG.X);
});

test("ED 16-bit memory stores write BC DE HL SP to absolute addresses", () => {
  const { cpu, memory } = makeCpu([
    0x01, 0x34, 0x12, // LD BC,$1234
    0x11, 0x78, 0x56, // LD DE,$5678
    0x21, 0xbc, 0x9a, // LD HL,$9ABC
    0x31, 0x00, 0x80, // LD SP,$8000
    0xed, 0x43, 0x00, 0x40, // LD ($4000),BC
    0xed, 0x53, 0x02, 0x40, // LD ($4002),DE
    0xed, 0x63, 0x04, 0x40, // LD ($4004),HL
    0xed, 0x73, 0x06, 0x40 // LD ($4006),SP
  ]);

  while (cpu.PC < 28) cpu.step();

  assert.equal(memory.read16(0x4000), 0x1234);
  assert.equal(memory.read16(0x4002), 0x5678);
  assert.equal(memory.read16(0x4004), 0x9abc);
  assert.equal(memory.read16(0x4006), 0x8000);
});

test("ED 16-bit memory loads read absolute values into BC DE HL SP", () => {
  const { cpu, memory } = makeCpu([
    0xed, 0x4b, 0x00, 0x40, // LD BC,($4000)
    0xed, 0x5b, 0x02, 0x40, // LD DE,($4002)
    0xed, 0x6b, 0x04, 0x40, // LD HL,($4004)
    0xed, 0x7b, 0x06, 0x40 // LD SP,($4006)
  ]);
  memory.write16(0x4000, 0x1234);
  memory.write16(0x4002, 0x5678);
  memory.write16(0x4004, 0x9abc);
  memory.write16(0x4006, 0x8000);

  while (cpu.PC < 16) cpu.step();

  assert.equal(cpu.BC, 0x1234);
  assert.equal(cpu.DE, 0x5678);
  assert.equal(cpu.HL, 0x9abc);
  assert.equal(cpu.SP, 0x8000);
});

test("ED ADC HL,rr supports all register pairs and carry-in", () => {
  const { cpu } = makeCpu([
    0x21, 0x00, 0x10, // LD HL,$1000
    0x01, 0x01, 0x00, // LD BC,$0001
    0xed, 0x4a, // ADC HL,BC
    0x11, 0x02, 0x00, // LD DE,$0002
    0xed, 0x5a, // ADC HL,DE
    0xed, 0x6a, // ADC HL,HL
    0x31, 0x00, 0x40, // LD SP,$4000
    0xed, 0x7a // ADC HL,SP
  ]);
  cpu.F = FLAG.C;

  cpu.step();
  cpu.step();
  cpu.step();
  assert.equal(cpu.HL, 0x1002);

  cpu.step();
  cpu.step();
  assert.equal(cpu.HL, 0x1004);

  cpu.step();
  assert.equal(cpu.HL, 0x2008);

  cpu.step();
  cpu.step();
  assert.equal(cpu.HL, 0x6008);
  assert.equal(cpu.F & FLAG.C, 0);
  assert.equal(cpu.F & FLAG.N, 0);
});

test("ED ADC HL,rr sets zero, carry, half-carry, and overflow flags", () => {
  const { cpu } = makeCpu([
    0x21, 0xff, 0x7f, // LD HL,$7FFF
    0x01, 0x01, 0x00, // LD BC,$0001
    0xed, 0x4a, // ADC HL,BC -> $8000 overflow
    0x01, 0x00, 0x80, // LD BC,$8000
    0xed, 0x4a // ADC HL,BC -> $0000 carry
  ]);

  cpu.step();
  cpu.step();
  cpu.step();

  assert.equal(cpu.HL, 0x8000);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.C, 0);

  cpu.step();
  cpu.step();

  assert.equal(cpu.HL, 0x0000);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("ED SBC HL,rr supports all register pairs and carry-in", () => {
  const { cpu } = makeCpu([
    0x21, 0x00, 0x20, // LD HL,$2000
    0x01, 0x01, 0x00, // LD BC,$0001
    0xed, 0x42, // SBC HL,BC
    0x11, 0x02, 0x00, // LD DE,$0002
    0xed, 0x52, // SBC HL,DE
    0xed, 0x62, // SBC HL,HL
    0x31, 0x01, 0x00, // LD SP,$0001
    0xed, 0x72 // SBC HL,SP
  ]);
  cpu.F = FLAG.C;

  cpu.step();
  cpu.step();
  cpu.step();
  assert.equal(cpu.HL, 0x1ffe);

  cpu.step();
  cpu.step();
  assert.equal(cpu.HL, 0x1ffc);

  cpu.step();
  assert.equal(cpu.HL, 0x0000);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);

  cpu.step();
  cpu.step();
  assert.equal(cpu.HL, 0xffff);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("ED SBC HL,rr sets half-carry and overflow on signed boundary cases", () => {
  const { cpu } = makeCpu([
    0x21, 0x00, 0x80, // LD HL,$8000
    0x01, 0x01, 0x00, // LD BC,$0001
    0xed, 0x42, // SBC HL,BC -> $7FFF overflow
    0x21, 0x00, 0x00, // LD HL,$0000
    0x01, 0x01, 0x00, // LD BC,$0001
    0xed, 0x42 // SBC HL,BC -> $FFFF borrow
  ]);

  cpu.step();
  cpu.step();
  cpu.step();

  assert.equal(cpu.HL, 0x7fff);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.C, 0);

  cpu.step();
  cpu.step();
  cpu.step();

  assert.equal(cpu.HL, 0xffff);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("ED IN r,(C) reads ports into registers and sets flags from the value", () => {
  const reads = [];
  const values = [0x00, 0x81, 0x28, 0xff];
  const { cpu } = makeCpu([
    0x01, 0xfe, 0x12, // LD BC,$12FE
    0xed, 0x40, // IN B,(C)
    0xed, 0x48, // IN C,(C)
    0xed, 0x68, // IN L,(C)
    0xed, 0x78 // IN A,(C)
  ], 0, {
    read: (port) => {
      reads.push(port);
      return values.shift();
    }
  });
  cpu.F = FLAG.C;

  cpu.step();

  cpu.step();
  assert.equal(cpu.B, 0x00);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();
  assert.equal(cpu.C, 0x81);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);

  cpu.step();
  assert.equal(cpu.L, 0x28);
  assert.equal(cpu.F & FLAG.Y, FLAG.Y);
  assert.equal(cpu.F & FLAG.X, FLAG.X);

  cpu.step();
  assert.equal(cpu.A, 0xff);
  assert.equal(reads.length, 4);
  assert.deepEqual(reads, [0x12fe, 0x00fe, 0x0081, 0x0081]);
});

test("ED IN (C) reads the port for flags without changing registers", () => {
  const { cpu } = makeCpu([
    0x01, 0xfe, 0x12, // LD BC,$12FE
    0xed, 0x70 // IN (C)
  ], 0, {
    read: () => 0x40
  });

  cpu.step();
  cpu.step();

  assert.equal(cpu.BC, 0x12fe);
  assert.equal(cpu.F & FLAG.Z, 0);
  assert.equal(cpu.F & FLAG.PV, 0);
});

test("ED OUT (C),r writes selected registers to the 16-bit port address", () => {
  const writes = [];
  const { cpu } = makeCpu([
    0x01, 0xfe, 0x12, // LD BC,$12FE
    0x3e, 0x55, // LD A,$55
    0xed, 0x79, // OUT (C),A
    0x16, 0xaa, // LD D,$AA
    0xed, 0x51 // OUT (C),D
  ], 0, {
    write: (port, value) => writes.push([port, value])
  });

  while (cpu.PC < 11) cpu.step();

  assert.deepEqual(writes, [
    [0x12fe, 0x55],
    [0x12fe, 0xaa]
  ]);
});

test("ED OUT (C),0 writes zero for the undocumented register slot", () => {
  const writes = [];
  const { cpu } = makeCpu([
    0x01, 0xfe, 0x12, // LD BC,$12FE
    0xed, 0x71 // OUT (C),0
  ], 0, {
    write: (port, value) => writes.push([port, value])
  });

  cpu.step();
  cpu.step();

  assert.deepEqual(writes, [[0x12fe, 0x00]]);
});

test("ED LDI copies one byte forward and updates HL DE BC and flags", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x11, 0x00, 0x50, // LD DE,$5000
    0x01, 0x02, 0x00, // LD BC,$0002
    0x3e, 0x10, // LD A,$10
    0xed, 0xa0 // LDI
  ]);
  memory.write8(0x4000, 0x22);
  cpu.F = FLAG.C | FLAG.S | FLAG.Z;

  while (cpu.PC < 13) cpu.step();

  assert.equal(memory.read8(0x5000), 0x22);
  assert.equal(cpu.HL, 0x4001);
  assert.equal(cpu.DE, 0x5001);
  assert.equal(cpu.BC, 0x0001);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.H, 0);
  assert.equal(cpu.F & FLAG.N, 0);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
});

test("ED LDIR repeats until BC reaches zero", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x11, 0x00, 0x50, // LD DE,$5000
    0x01, 0x03, 0x00, // LD BC,$0003
    0xed, 0xb0, // LDIR
    0x76 // HALT
  ]);
  memory.load(0x4000, [0xaa, 0xbb, 0xcc]);

  while (!cpu.halted) cpu.step();

  assert.deepEqual([...memory.bytes.slice(0x5000, 0x5003)], [0xaa, 0xbb, 0xcc]);
  assert.equal(cpu.HL, 0x4003);
  assert.equal(cpu.DE, 0x5003);
  assert.equal(cpu.BC, 0);
  assert.equal(cpu.PC, 12);
  assert.equal(cpu.F & FLAG.PV, 0);
});

test("ED LDIR repeated flags use repeated PC high byte for X/Y", () => {
  const { cpu, memory } = makeCpu([0xed, 0xb0], 0x11d4);
  cpu.A = 0xde;
  cpu.F = FLAG.S | FLAG.Z | FLAG.Y | FLAG.X | FLAG.H;
  cpu.BC = 0xd0e4;
  cpu.DE = 0x5780;
  cpu.HL = 0x5d41;
  memory.write8(0x5d41, 0x2e);

  assert.equal(cpu.step(), 21);
  assert.equal(cpu.PC, 0x11d4);
  assert.equal(cpu.WZ, 0x11d5);
  assert.equal(cpu.F, FLAG.S | FLAG.Z | FLAG.PV);
});

test("ED LDD and LDDR copy backward", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x02, 0x40, // LD HL,$4002
    0x11, 0x02, 0x50, // LD DE,$5002
    0x01, 0x03, 0x00, // LD BC,$0003
    0xed, 0xb8, // LDDR
    0x76 // HALT
  ]);
  memory.load(0x4000, [0x11, 0x22, 0x33]);

  while (!cpu.halted) cpu.step();

  assert.deepEqual([...memory.bytes.slice(0x5000, 0x5003)], [0x11, 0x22, 0x33]);
  assert.equal(cpu.HL, 0x3fff);
  assert.equal(cpu.DE, 0x4fff);
  assert.equal(cpu.BC, 0);
});

test("ED CPI compares A with memory and advances while preserving A and carry", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x01, 0x02, 0x00, // LD BC,$0002
    0x3e, 0x42, // LD A,$42
    0xed, 0xa1 // CPI
  ]);
  memory.write8(0x4000, 0x40);
  cpu.F = FLAG.C;

  while (cpu.PC < 10) cpu.step();

  assert.equal(cpu.A, 0x42);
  assert.equal(cpu.HL, 0x4001);
  assert.equal(cpu.BC, 0x0001);
  assert.equal(cpu.F & FLAG.Z, 0);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("ED CPIR stops when it finds a match", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x01, 0x03, 0x00, // LD BC,$0003
    0x3e, 0x42, // LD A,$42
    0xed, 0xb1, // CPIR
    0x76 // HALT
  ]);
  memory.load(0x4000, [0x10, 0x42, 0x99]);

  while (!cpu.halted) cpu.step();

  assert.equal(cpu.HL, 0x4002);
  assert.equal(cpu.BC, 0x0001);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
});

test("ED CPIR repeated flags use repeated PC high byte across page boundary", () => {
  const { cpu, memory } = makeCpu([0xed, 0xb1], 0x9fff);
  cpu.A = 0x26;
  cpu.F = FLAG.C;
  cpu.BC = 0xc780;
  cpu.HL = 0x5208;
  memory.write8(0x5208, 0xcb);

  assert.equal(cpu.step(), 21);
  assert.equal(cpu.PC, 0x9fff);
  assert.equal(cpu.WZ, 0xa000);
  assert.equal(cpu.F, FLAG.H | FLAG.X | FLAG.PV | FLAG.N | FLAG.C);
});

test("ED CPDR repeats backward until BC reaches zero when no match is found", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x02, 0x40, // LD HL,$4002
    0x01, 0x03, 0x00, // LD BC,$0003
    0x3e, 0x42, // LD A,$42
    0xed, 0xb9, // CPDR
    0x76 // HALT
  ]);
  memory.load(0x4000, [0x10, 0x20, 0x30]);

  while (!cpu.halted) cpu.step();

  assert.equal(cpu.HL, 0x3fff);
  assert.equal(cpu.BC, 0);
  assert.equal(cpu.F & FLAG.Z, 0);
  assert.equal(cpu.F & FLAG.PV, 0);
});

test("ED INI reads from port BC into (HL), increments HL, and decrements B", () => {
  const reads = [];
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x01, 0xfe, 0x02, // LD BC,$02FE
    0xed, 0xa2 // INI
  ], 0, {
    read: (port) => {
      reads.push(port);
      return 0x80;
    }
  });

  while (cpu.PC < 8) cpu.step();

  assert.deepEqual(reads, [0x02fe]);
  assert.equal(memory.read8(0x4000), 0x80);
  assert.equal(cpu.HL, 0x4001);
  assert.equal(cpu.B, 0x01);
  assert.equal(cpu.C, 0xfe);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.Z, 0);
});

test("ED INIR repeats input until B reaches zero", () => {
  const values = [0x11, 0x22, 0x33];
  const reads = [];
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x01, 0xfe, 0x03, // LD BC,$03FE
    0xed, 0xb2, // INIR
    0x76 // HALT
  ], 0, {
    read: (port) => {
      reads.push(port);
      return values.shift();
    }
  });

  while (!cpu.halted) cpu.step();

  assert.deepEqual([...memory.bytes.slice(0x4000, 0x4003)], [0x11, 0x22, 0x33]);
  assert.deepEqual(reads, [0x03fe, 0x02fe, 0x01fe]);
  assert.equal(cpu.HL, 0x4003);
  assert.equal(cpu.B, 0);
  assert.equal(cpu.PC, 9);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
});

test("ED IND and INDR move input backward", () => {
  const values = [0xaa, 0xbb];
  const { cpu, memory } = makeCpu([
    0x21, 0x01, 0x40, // LD HL,$4001
    0x01, 0xfe, 0x02, // LD BC,$02FE
    0xed, 0xba, // INDR
    0x76 // HALT
  ], 0, {
    read: () => values.shift()
  });

  while (!cpu.halted) cpu.step();

  assert.deepEqual([...memory.bytes.slice(0x4000, 0x4002)], [0xbb, 0xaa]);
  assert.equal(cpu.HL, 0x3fff);
  assert.equal(cpu.B, 0);
});

test("ED OUTI writes (HL) to port BC, increments HL, and decrements B", () => {
  const writes = [];
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x01, 0xfe, 0x02, // LD BC,$02FE
    0xed, 0xa3 // OUTI
  ], 0, {
    write: (port, value) => writes.push([port, value])
  });
  memory.write8(0x4000, 0x7f);

  while (cpu.PC < 8) cpu.step();

  assert.deepEqual(writes, [[0x01fe, 0x7f]]);
  assert.equal(cpu.HL, 0x4001);
  assert.equal(cpu.B, 0x01);
  assert.equal(cpu.C, 0xfe);
  assert.equal(cpu.F & FLAG.N, 0);
});

test("ED OUTI flags use the updated L byte for carry and half-carry", () => {
  const writes = [];
  const { cpu, memory } = makeCpu([0xed, 0xa3], 0, {
    write: (port, value) => writes.push([port, value])
  });
  cpu.BC = 0xd80a;
  cpu.HL = 0x0590;
  memory.write8(0x0590, 0xf2);

  assert.equal(cpu.step(), 16);
  assert.deepEqual(writes, [[0xd70a, 0xf2]]);
  assert.equal(cpu.B, 0xd7);
  assert.equal(cpu.HL, 0x0591);
  assert.equal(cpu.WZ, 0xd70b);
  assert.equal(cpu.F, FLAG.S | FLAG.H | FLAG.PV | FLAG.N | FLAG.C);
});

test("ED OTIR repeats output until B reaches zero", () => {
  const writes = [];
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x01, 0xfe, 0x03, // LD BC,$03FE
    0xed, 0xb3, // OTIR
    0x76 // HALT
  ], 0, {
    write: (port, value) => writes.push([port, value])
  });
  memory.load(0x4000, [0x11, 0x22, 0x33]);

  while (!cpu.halted) cpu.step();

  assert.deepEqual(writes, [
    [0x02fe, 0x11],
    [0x01fe, 0x22],
    [0x00fe, 0x33]
  ]);
  assert.equal(cpu.HL, 0x4003);
  assert.equal(cpu.B, 0);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
});

test("ED OTIR repeat applies post-repeat undocumented flag correction", () => {
  const writes = [];
  const { cpu, memory } = makeCpu([0xed, 0xb3], 0x10ee, {
    write: (port, value) => writes.push([port, value])
  });
  cpu.BC = 0xbafa;
  cpu.HL = 0xb4a3;
  memory.write8(0xb4a3, 0xc6);

  assert.equal(cpu.step(), 21);
  assert.deepEqual(writes, [[0xb9fa, 0xc6]]);
  assert.equal(cpu.PC, 0x10ee);
  assert.equal(cpu.WZ, 0x10ef);
  assert.equal(cpu.F, FLAG.S | FLAG.PV | FLAG.N | FLAG.C);
});

test("ED OUTD and OTDR move output backward", () => {
  const writes = [];
  const { cpu, memory } = makeCpu([
    0x21, 0x01, 0x40, // LD HL,$4001
    0x01, 0xfe, 0x02, // LD BC,$02FE
    0xed, 0xbb, // OTDR
    0x76 // HALT
  ], 0, {
    write: (port, value) => writes.push([port, value])
  });
  memory.load(0x4000, [0xaa, 0xbb]);

  while (!cpu.halted) cpu.step();

  assert.deepEqual(writes, [
    [0x01fe, 0xbb],
    [0x00fe, 0xaa]
  ]);
  assert.equal(cpu.HL, 0x3fff);
  assert.equal(cpu.B, 0);
});

test("base JP (HL) and EX (SP),HL mirror indexed control primitives", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x34, 0x12, // LD HL,$1234
    0xe3, // EX (SP),HL
    0xe9 // JP (HL)
  ]);
  cpu.SP = 0x8000;
  memory.write16(0x8000, 0x0004);

  assert.equal(cpu.step(), 10);
  assert.equal(cpu.step(), 19);
  assert.equal(cpu.HL, 0x0004);
  assert.equal(memory.read16(0x8000), 0x1234);

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.PC, 0x0004);
});

test("DD/FD LD index,nn and absolute memory transfers work for IX and IY", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x34, 0x12, // LD IX,$1234
    0xfd, 0x21, 0x78, 0x56, // LD IY,$5678
    0xdd, 0x22, 0x00, 0x40, // LD ($4000),IX
    0xfd, 0x22, 0x02, 0x40, // LD ($4002),IY
    0xdd, 0x2a, 0x02, 0x40, // LD IX,($4002)
    0xfd, 0x2a, 0x00, 0x40 // LD IY,($4000)
  ]);

  while (cpu.PC < 24) cpu.step();

  assert.equal(memory.read16(0x4000), 0x1234);
  assert.equal(memory.read16(0x4002), 0x5678);
  assert.equal(cpu.IX, 0x5678);
  assert.equal(cpu.IY, 0x1234);
});

test("DD/FD INC and DEC update IX and IY without changing flags", () => {
  const { cpu } = makeCpu([
    0xdd, 0x21, 0xff, 0xff, // LD IX,$FFFF
    0xfd, 0x21, 0x00, 0x00, // LD IY,$0000
    0xdd, 0x23, // INC IX
    0xfd, 0x2b // DEC IY
  ]);
  cpu.F = FLAG.S | FLAG.C;

  while (cpu.PC < 12) cpu.step();

  assert.equal(cpu.IX, 0x0000);
  assert.equal(cpu.IY, 0xffff);
  assert.equal(cpu.F, FLAG.S | FLAG.C);
});

test("DD/FD ADD index,rr updates IX/IY and 16-bit flags", () => {
  const { cpu } = makeCpu([
    0xdd, 0x21, 0xff, 0x0f, // LD IX,$0FFF
    0x01, 0x01, 0x00, // LD BC,$0001
    0xdd, 0x09, // ADD IX,BC
    0xfd, 0x21, 0x00, 0x80, // LD IY,$8000
    0x11, 0x00, 0x80, // LD DE,$8000
    0xfd, 0x19, // ADD IY,DE
    0xdd, 0x29, // ADD IX,IX
    0x31, 0x00, 0xe0, // LD SP,$E000
    0xfd, 0x39 // ADD IY,SP
  ]);

  cpu.step();
  cpu.step();
  cpu.step();
  assert.equal(cpu.IX, 0x1000);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.N, 0);
  assert.equal(cpu.F & FLAG.C, 0);

  cpu.step();
  cpu.step();
  cpu.step();
  assert.equal(cpu.IY, 0x0000);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();
  assert.equal(cpu.IX, 0x2000);

  cpu.step();
  cpu.step();
  assert.equal(cpu.IY, 0xe000);
});

test("DD/FD PUSH POP and EX (SP),index use little-endian stack values", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x34, 0x12, // LD IX,$1234
    0xdd, 0xe5, // PUSH IX
    0xfd, 0xe1, // POP IY
    0xfd, 0xe3 // EX (SP),IY
  ]);
  cpu.SP = 0x8000;
  memory.write16(0x8000, 0xabcd);

  cpu.step();
  assert.equal(cpu.step(), 15);
  assert.equal(cpu.SP, 0x7ffe);
  assert.equal(memory.read16(0x7ffe), 0x1234);

  assert.equal(cpu.step(), 14);
  assert.equal(cpu.IY, 0x1234);
  assert.equal(cpu.SP, 0x8000);

  assert.equal(cpu.step(), 23);
  assert.equal(cpu.IY, 0xabcd);
  assert.equal(memory.read16(0x8000), 0x1234);
});

test("DD/FD LD SP,index and JP (index) use IX/IY", () => {
  const { cpu } = makeCpu([
    0xdd, 0x21, 0x34, 0x12, // LD IX,$1234
    0xdd, 0xf9, // LD SP,IX
    0xfd, 0x21, 0x0c, 0x00, // LD IY,$000C
    0xfd, 0xe9, // JP (IY)
    0x76 // HALT
  ]);

  cpu.step();
  assert.equal(cpu.step(), 10);
  assert.equal(cpu.SP, 0x1234);

  cpu.step();
  assert.equal(cpu.step(), 8);
  assert.equal(cpu.PC, 0x000c);

  cpu.step();
  assert.equal(cpu.halted, true);
});

test("DD/FD LD index high and low immediate bytes update IX/IY without touching HL", () => {
  const { cpu } = makeCpu([
    0x21, 0xcd, 0xab, // LD HL,$ABCD
    0xdd, 0x26, 0x12, // LD IXH,$12
    0xdd, 0x2e, 0x34, // LD IXL,$34
    0xfd, 0x26, 0x56, // LD IYH,$56
    0xfd, 0x2e, 0x78 // LD IYL,$78
  ]);

  while (cpu.PC < 15) cpu.step();

  assert.equal(cpu.HL, 0xabcd);
  assert.equal(cpu.IX, 0x1234);
  assert.equal(cpu.IY, 0x5678);
});

test("DD/FD INC and DEC index byte registers update flags", () => {
  const { cpu } = makeCpu([
    0xdd, 0x21, 0x7f, 0x00, // LD IX,$007F
    0xfd, 0x21, 0x00, 0x80, // LD IY,$8000
    0xdd, 0x24, // INC IXH -> $01
    0xdd, 0x2c, // INC IXL -> $80 overflow
    0xfd, 0x25, // DEC IYH -> $7F overflow
    0xfd, 0x2d // DEC IYL -> $FF
  ]);
  cpu.F = FLAG.C;

  cpu.step();
  cpu.step();

  cpu.step();
  assert.equal(cpu.IX, 0x017f);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  cpu.step();
  assert.equal(cpu.IX, 0x0180);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);

  cpu.step();
  assert.equal(cpu.IY, 0x7f00);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);

  cpu.step();
  assert.equal(cpu.IY, 0x7fff);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
});

test("DD/FD LD r,index-byte and LD index-byte,r transfer through normal registers", () => {
  const { cpu } = makeCpu([
    0xdd, 0x21, 0x34, 0x12, // LD IX,$1234
    0xfd, 0x21, 0x78, 0x56, // LD IY,$5678
    0xdd, 0x44, // LD B,IXH
    0xdd, 0x4d, // LD C,IXL
    0xfd, 0x62, // LD IYH,D
    0xfd, 0x6b, // LD IYL,E
    0xdd, 0x60, // LD IXH,B
    0xdd, 0x69 // LD IXL,C
  ]);
  cpu.D = 0xab;
  cpu.E = 0xcd;

  while (cpu.PC < 22) cpu.step();

  assert.equal(cpu.B, 0x12);
  assert.equal(cpu.C, 0x34);
  assert.equal(cpu.IY, 0xabcd);
  assert.equal(cpu.IX, 0x1234);
});

test("DD/FD LD index-byte,index-byte works within the selected index register", () => {
  const { cpu } = makeCpu([
    0xdd, 0x21, 0x34, 0x12, // LD IX,$1234
    0xfd, 0x21, 0x78, 0x56, // LD IY,$5678
    0xdd, 0x65, // LD IXH,IXL -> $3434
    0xfd, 0x6c // LD IYL,IYH -> $5656
  ]);

  while (cpu.PC < 12) cpu.step();

  assert.equal(cpu.IX, 0x3434);
  assert.equal(cpu.IY, 0x5656);
});

test("DD/FD ALU operations can use index high and low bytes", () => {
  const { cpu } = makeCpu([
    0xdd, 0x21, 0x01, 0x10, // LD IX,$1001
    0xfd, 0x21, 0x0f, 0xf0, // LD IY,$F00F
    0x3e, 0x10, // LD A,$10
    0xdd, 0x85, // ADD A,IXL -> $11
    0xdd, 0x8c, // ADC A,IXH -> $21
    0xfd, 0xa4, // AND IYH -> $20
    0xfd, 0xad, // XOR IYL -> $2F
    0xfd, 0xb5, // OR IYL -> $2F
    0xdd, 0xbc // CP IXH
  ]);

  while (cpu.PC < 22) cpu.step();

  assert.equal(cpu.A, 0x2f);
  assert.equal(cpu.F & FLAG.Z, 0);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
});

test("DD/FD LD (index+d),n handles positive and negative displacements", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x00, 0x40, // LD IX,$4000
    0xfd, 0x21, 0x00, 0x50, // LD IY,$5000
    0xdd, 0x36, 0x05, 0xaa, // LD (IX+5),$AA
    0xfd, 0x36, 0xfe, 0xbb // LD (IY-2),$BB
  ]);

  while (cpu.PC < 16) cpu.step();

  assert.equal(memory.read8(0x4005), 0xaa);
  assert.equal(memory.read8(0x4ffe), 0xbb);
});

test("DD/FD LD r,(index+d) and LD (index+d),r move bytes through indexed memory", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x00, 0x40, // LD IX,$4000
    0xfd, 0x21, 0x00, 0x50, // LD IY,$5000
    0xdd, 0x46, 0x03, // LD B,(IX+3)
    0xfd, 0x4e, 0xff, // LD C,(IY-1)
    0xdd, 0x70, 0x04, // LD (IX+4),B
    0xfd, 0x71, 0xfe // LD (IY-2),C
  ]);
  memory.write8(0x4003, 0x12);
  memory.write8(0x4fff, 0x34);

  while (cpu.PC < 20) cpu.step();

  assert.equal(cpu.B, 0x12);
  assert.equal(cpu.C, 0x34);
  assert.equal(memory.read8(0x4004), 0x12);
  assert.equal(memory.read8(0x4ffe), 0x34);
});

test("DD/FD LD H/L,(index+d) and LD (index+d),H/L use normal registers", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x00, 0x40, // LD IX,$4000
    0xfd, 0x21, 0x00, 0x50, // LD IY,$5000
    0xdd, 0x66, 0x03, // LD H,(IX+3)
    0xfd, 0x6e, 0xff, // LD L,(IY-1)
    0xdd, 0x75, 0x04, // LD (IX+4),L
    0xfd, 0x74, 0xfe // LD (IY-2),H
  ]);
  memory.write8(0x4003, 0x12);
  memory.write8(0x4fff, 0x34);

  while (cpu.PC < 20) cpu.step();

  assert.equal(cpu.IX, 0x4000);
  assert.equal(cpu.IY, 0x5000);
  assert.equal(cpu.HL, 0x1234);
  assert.equal(memory.read8(0x4004), 0x34);
  assert.equal(memory.read8(0x4ffe), 0x12);
});

test("DD/FD INC and DEC (index+d) update indexed memory and flags", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x00, 0x40, // LD IX,$4000
    0xfd, 0x21, 0x00, 0x50, // LD IY,$5000
    0xdd, 0x34, 0x01, // INC (IX+1)
    0xfd, 0x35, 0xff // DEC (IY-1)
  ]);
  memory.write8(0x4001, 0x7f);
  memory.write8(0x4fff, 0x00);
  cpu.F = FLAG.C;

  cpu.step();
  cpu.step();

  assert.equal(cpu.step(), 23);
  assert.equal(memory.read8(0x4001), 0x80);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  assert.equal(cpu.step(), 23);
  assert.equal(memory.read8(0x4fff), 0xff);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
  assert.equal(cpu.F & FLAG.H, FLAG.H);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("DD/FD ALU operations can read through indexed displacement", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x00, 0x40, // LD IX,$4000
    0xfd, 0x21, 0x00, 0x50, // LD IY,$5000
    0x3e, 0x10, // LD A,$10
    0xdd, 0x86, 0x01, // ADD A,(IX+1)
    0xfd, 0x8e, 0xff, // ADC A,(IY-1)
    0xdd, 0xa6, 0x02, // AND (IX+2)
    0xfd, 0xae, 0xfe, // XOR (IY-2)
    0xdd, 0xb6, 0x03, // OR (IX+3)
    0xfd, 0xbe, 0xfd // CP (IY-3)
  ]);
  memory.write8(0x4001, 0x01);
  memory.write8(0x4fff, 0x02);
  memory.write8(0x4002, 0x0f);
  memory.write8(0x4ffe, 0xff);
  memory.write8(0x4003, 0x10);
  memory.write8(0x4ffd, 0xfc);

  while (cpu.PC < 27) cpu.step();

  assert.equal(cpu.A, 0xfc);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.N, FLAG.N);
});

test("DDCB/FDCB rotate and shift indexed memory and copy results to target registers", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x00, 0x40, // LD IX,$4000
    0xfd, 0x21, 0x00, 0x50, // LD IY,$5000
    0xdd, 0xcb, 0x01, 0x00, // RLC (IX+1),B
    0xfd, 0xcb, 0xff, 0x2f // SRA (IY-1),A
  ]);
  memory.write8(0x4001, 0x81);
  memory.write8(0x4fff, 0x81);

  cpu.step();
  cpu.step();

  assert.equal(cpu.step(), 23);
  assert.equal(memory.read8(0x4001), 0x03);
  assert.equal(cpu.B, 0x03);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  assert.equal(cpu.step(), 23);
  assert.equal(memory.read8(0x4fff), 0xc0);
  assert.equal(cpu.A, 0xc0);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
});

test("DDCB/FDCB rotate and shift target code 6 updates only indexed memory", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x00, 0x40, // LD IX,$4000
    0xdd, 0xcb, 0xfe, 0x36 // SLL (IX-2)
  ]);
  memory.write8(0x3ffe, 0x40);
  cpu.B = 0x99;

  cpu.step();
  cpu.step();

  assert.equal(memory.read8(0x3ffe), 0x81);
  assert.equal(cpu.B, 0x99);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
});

test("DDCB/FDCB BIT tests indexed memory without changing memory or registers", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x00, 0x40, // LD IX,$4000
    0xfd, 0x21, 0x00, 0x50, // LD IY,$5000
    0xdd, 0xcb, 0x01, 0x46, // BIT 0,(IX+1)
    0xfd, 0xcb, 0xff, 0x7e // BIT 7,(IY-1)
  ]);
  memory.write8(0x4001, 0x00);
  memory.write8(0x4fff, 0x80);
  cpu.B = 0x12;
  cpu.F = FLAG.C;

  cpu.step();
  cpu.step();

  assert.equal(cpu.step(), 20);
  assert.equal(memory.read8(0x4001), 0x00);
  assert.equal(cpu.B, 0x12);
  assert.equal(cpu.F & FLAG.Z, FLAG.Z);
  assert.equal(cpu.F & FLAG.PV, FLAG.PV);
  assert.equal(cpu.F & FLAG.C, FLAG.C);

  assert.equal(cpu.step(), 20);
  assert.equal(memory.read8(0x4fff), 0x80);
  assert.equal(cpu.F & FLAG.S, FLAG.S);
  assert.equal(cpu.F & FLAG.Z, 0);
});

test("DDCB/FDCB RES and SET update indexed memory and optionally copy to registers", () => {
  const { cpu, memory } = makeCpu([
    0xdd, 0x21, 0x00, 0x40, // LD IX,$4000
    0xfd, 0x21, 0x00, 0x50, // LD IY,$5000
    0xdd, 0xcb, 0x01, 0x86, // RES 0,(IX+1)
    0xdd, 0xcb, 0x01, 0xc0, // SET 0,(IX+1),B
    0xfd, 0xcb, 0xfe, 0xb9, // RES 7,(IY-2),C
    0xfd, 0xcb, 0xfe, 0xf1 // SET 6,(IY-2),C
  ]);
  memory.write8(0x4001, 0xff);
  memory.write8(0x4ffe, 0x80);

  cpu.step();
  cpu.step();

  cpu.step();
  assert.equal(memory.read8(0x4001), 0xfe);

  cpu.step();
  assert.equal(memory.read8(0x4001), 0xff);
  assert.equal(cpu.B, 0xff);

  cpu.step();
  assert.equal(memory.read8(0x4ffe), 0x00);
  assert.equal(cpu.C, 0x00);

  cpu.step();
  assert.equal(memory.read8(0x4ffe), 0x40);
  assert.equal(cpu.C, 0x40);
});

test("EX AF,AF' swaps main and alternate accumulator/flags", () => {
  const { cpu } = makeCpu([0x08, 0x08]);
  cpu.AF = 0x1234;
  cpu.A_ = 0xab;
  cpu.F_ = 0xcd;

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.AF, 0xabcd);
  assert.equal(cpu.A_, 0x12);
  assert.equal(cpu.F_, 0x34);

  cpu.step();
  assert.equal(cpu.AF, 0x1234);
  assert.equal(cpu.A_, 0xab);
  assert.equal(cpu.F_, 0xcd);
});

test("EXX swaps BC DE HL with alternate register sets", () => {
  const { cpu } = makeCpu([0xd9]);
  cpu.BC = 0x1234;
  cpu.DE = 0x5678;
  cpu.HL = 0x9abc;
  cpu.B_ = 0xaa;
  cpu.C_ = 0xbb;
  cpu.D_ = 0xcc;
  cpu.E_ = 0xdd;
  cpu.H_ = 0xee;
  cpu.L_ = 0xff;

  assert.equal(cpu.step(), 4);

  assert.equal(cpu.BC, 0xaabb);
  assert.equal(cpu.DE, 0xccdd);
  assert.equal(cpu.HL, 0xeeff);
  assert.equal(cpu.B_, 0x12);
  assert.equal(cpu.C_, 0x34);
  assert.equal(cpu.D_, 0x56);
  assert.equal(cpu.E_, 0x78);
  assert.equal(cpu.H_, 0x9a);
  assert.equal(cpu.L_, 0xbc);
});

test("EX DE,HL swaps the two 16-bit register pairs", () => {
  const { cpu } = makeCpu([
    0x11, 0x34, 0x12, // LD DE,$1234
    0x21, 0x78, 0x56, // LD HL,$5678
    0xeb // EX DE,HL
  ]);

  while (cpu.PC < 7) cpu.step();

  assert.equal(cpu.DE, 0x5678);
  assert.equal(cpu.HL, 0x1234);
});

test("DI and EI update interrupt flip-flops", () => {
  const { cpu } = makeCpu([0xfb, 0xf3]);

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.IFF1, true);
  assert.equal(cpu.IFF2, true);

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.IFF1, false);
  assert.equal(cpu.IFF2, false);
});

test("EI delays maskable interrupt acceptance until after the following instruction", () => {
  const { cpu, memory } = makeCpu([
    0xfb, // EI
    0x00, // NOP, still protected by EI delay
    0x00 // would be next instruction, but interrupt is accepted first
  ]);
  cpu.SP = 0x9000;
  cpu.interruptMode = 1;
  cpu.requestInterrupt();

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.PC, 0x0001);
  assert.equal(cpu.IFF1, true);

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.PC, 0x0002);
  assert.equal(cpu.IFF1, true);

  assert.equal(cpu.step(), 13);
  assert.equal(cpu.PC, 0x0038);
  assert.equal(cpu.IFF1, false);
  assert.equal(cpu.IFF2, false);
  assert.equal(cpu.SP, 0x8ffe);
  assert.equal(memory.read16(cpu.SP), 0x0002);
});

test("maskable IM 1 interrupt wakes HALT and pushes the halted PC", () => {
  const { cpu, memory } = makeCpu([0x76]);
  cpu.SP = 0x8000;
  cpu.IFF1 = true;
  cpu.IFF2 = true;
  cpu.interruptMode = 1;

  assert.equal(cpu.step(), 4);
  assert.equal(cpu.halted, true);
  assert.equal(cpu.PC, 0x0001);

  cpu.requestInterrupt();

  assert.equal(cpu.step(), 13);
  assert.equal(cpu.halted, false);
  assert.equal(cpu.PC, 0x0038);
  assert.equal(memory.read16(cpu.SP), 0x0001);
});

test("maskable IM 2 interrupt jumps through the I:data vector", () => {
  const { cpu, memory } = makeCpu([0x00]);
  cpu.SP = 0x8000;
  cpu.IFF1 = true;
  cpu.IFF2 = true;
  cpu.interruptMode = 2;
  cpu.I = 0x80;
  memory.write16(0x80fe, 0x4567);
  cpu.requestInterrupt(0xfe);

  assert.equal(cpu.step(), 19);
  assert.equal(cpu.PC, 0x4567);
  assert.equal(cpu.WZ, 0x4567);
  assert.equal(memory.read16(cpu.SP), 0x0000);
});

test("maskable IM 0 supports RST opcodes supplied by the interrupting device", () => {
  const { cpu, memory } = makeCpu([0x00]);
  cpu.SP = 0x8000;
  cpu.IFF1 = true;
  cpu.IFF2 = true;
  cpu.interruptMode = 0;
  cpu.requestInterrupt(0xcf); // RST $08

  assert.equal(cpu.step(), 13);
  assert.equal(cpu.PC, 0x0008);
  assert.equal(memory.read16(cpu.SP), 0x0000);
});

test("NMI is accepted even when maskable interrupts are disabled", () => {
  const { cpu, memory } = makeCpu([0x00]);
  cpu.SP = 0x8000;
  cpu.IFF1 = true;
  cpu.IFF2 = false;
  cpu.requestNmi();

  assert.equal(cpu.step(), 11);
  assert.equal(cpu.PC, 0x0066);
  assert.equal(cpu.IFF1, false);
  assert.equal(cpu.IFF2, true);
  assert.equal(memory.read16(cpu.SP), 0x0000);
});

test("LD A,(BC/DE) and LD (BC/DE),A transfer accumulator indirectly", () => {
  const { cpu, memory } = makeCpu([
    0x01, 0x00, 0x40, // LD BC,$4000
    0x11, 0x00, 0x50, // LD DE,$5000
    0x3e, 0x12, // LD A,$12
    0x02, // LD (BC),A
    0x3e, 0x34, // LD A,$34
    0x12, // LD (DE),A
    0x0a, // LD A,(BC)
    0x1a // LD A,(DE)
  ]);

  while (cpu.PC < 14) cpu.step();

  assert.equal(memory.read8(0x4000), 0x12);
  assert.equal(memory.read8(0x5000), 0x34);
  assert.equal(cpu.A, 0x34);
});

test("base LD (nn),HL and LD HL,(nn) use little-endian absolute memory", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x34, 0x12, // LD HL,$1234
    0x22, 0x00, 0x40, // LD ($4000),HL
    0x21, 0x00, 0x00, // LD HL,$0000
    0x2a, 0x00, 0x40 // LD HL,($4000)
  ]);

  while (cpu.PC < 12) cpu.step();

  assert.equal(memory.read16(0x4000), 0x1234);
  assert.equal(cpu.HL, 0x1234);
});

test("direct OUT (n),A and IN A,(n) use A as high port byte", () => {
  const writes = [];
  const reads = [];
  const { cpu } = makeCpu([
    0x3e, 0x12, // LD A,$12
    0xd3, 0xfe, // OUT ($FE),A
    0xdb, 0x7f // IN A,($7F)
  ], 0, {
    read: (port) => {
      reads.push(port);
      return 0xab;
    },
    write: (port, value) => writes.push([port, value])
  });

  cpu.step();
  assert.equal(cpu.step(), 11);
  assert.deepEqual(writes, [[0x12fe, 0x12]]);

  assert.equal(cpu.step(), 11);
  assert.deepEqual(reads, [0x127f]);
  assert.equal(cpu.A, 0xab);
});

test("DD/FD prefixes fall back to ordinary base opcodes when no index form exists", () => {
  const { cpu } = makeCpu([
    0xdd, 0x00, // DD NOP
    0xfd, 0x3e, 0x42, // FD LD A,$42
    0xdd, 0xc3, 0x09, 0x00, // DD JP $0009
    0x76 // HALT
  ]);

  assert.equal(cpu.step(), 8);
  assert.equal(cpu.PC, 2);

  assert.equal(cpu.step(), 11);
  assert.equal(cpu.A, 0x42);

  assert.equal(cpu.step(), 14);
  assert.equal(cpu.PC, 0x0009);

  cpu.step();
  assert.equal(cpu.halted, true);
});

test("undefined ED opcodes behave as no-op instructions", () => {
  const { cpu } = makeCpu([
    0xed, 0x00,
    0x3e, 0x42 // LD A,$42
  ]);

  assert.equal(cpu.step(), 8);
  assert.equal(cpu.PC, 2);

  cpu.step();
  assert.equal(cpu.A, 0x42);
});

test("ED RRD and RLD rotate nibbles between A and (HL)", () => {
  const { cpu, memory } = makeCpu([
    0x21, 0x00, 0x40, // LD HL,$4000
    0x3e, 0x12, // LD A,$12
    0xed, 0x67, // RRD
    0xed, 0x6f // RLD
  ]);
  memory.write8(0x4000, 0x34);
  cpu.F = FLAG.C;

  cpu.step();
  cpu.step();

  assert.equal(cpu.step(), 18);
  assert.equal(cpu.A, 0x14);
  assert.equal(memory.read8(0x4000), 0x23);
  assert.equal(cpu.F & FLAG.C, FLAG.C);
  assert.equal(cpu.F & FLAG.H, 0);
  assert.equal(cpu.F & FLAG.N, 0);

  assert.equal(cpu.step(), 18);
  assert.equal(cpu.A, 0x12);
  assert.equal(memory.read8(0x4000), 0x34);
});
