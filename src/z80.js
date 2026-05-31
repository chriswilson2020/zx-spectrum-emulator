export const FLAG = {
  S: 0x80,
  Z: 0x40,
  Y: 0x20,
  H: 0x10,
  X: 0x08,
  PV: 0x04,
  N: 0x02,
  C: 0x01
};

const REGISTER_CODES = ["B", "C", "D", "E", "H", "L", null, "A"];

function parity(value) {
  let bits = value & 0xff;
  bits ^= bits >> 4;
  bits ^= bits >> 2;
  bits ^= bits >> 1;
  return (bits & 1) === 0;
}

function szxyFlags(value) {
  const result = value & 0xff;
  let flags = result & (FLAG.S | FLAG.Y | FLAG.X);
  if (result === 0) flags |= FLAG.Z;
  return flags;
}

export class Z80 {
  constructor(memory, io = {}) {
    this.memory = memory;
    this.io = {
      read: io.read ?? (() => 0xff),
      write: io.write ?? (() => {})
    };
    this.reset();
  }

  reset() {
    this.A = 0;
    this.F = 0;
    this.B = 0;
    this.C = 0;
    this.D = 0;
    this.E = 0;
    this.H = 0;
    this.L = 0;

    this.A_ = 0;
    this.F_ = 0;
    this.B_ = 0;
    this.C_ = 0;
    this.D_ = 0;
    this.E_ = 0;
    this.H_ = 0;
    this.L_ = 0;

    this.IX = 0;
    this.IY = 0;
    this.SP = 0xffff;
    this.PC = 0;
    this.I = 0;
    this.R = 0;
    this.WZ = 0;
    this.IFF1 = false;
    this.IFF2 = false;
    this.interruptMode = 0;
    this.interruptDelay = 0;
    this.pendingInterrupt = false;
    this.interruptData = 0xff;
    this.pendingNmi = false;
    this.Q = 0;
    this.halted = false;
    this.tStates = 0;
  }

  get AF() {
    return (this.A << 8) | this.F;
  }

  set AF(value) {
    this.A = (value >> 8) & 0xff;
    this.F = value & 0xff;
  }

  get BC() {
    return (this.B << 8) | this.C;
  }

  set BC(value) {
    this.B = (value >> 8) & 0xff;
    this.C = value & 0xff;
  }

  get DE() {
    return (this.D << 8) | this.E;
  }

  set DE(value) {
    this.D = (value >> 8) & 0xff;
    this.E = value & 0xff;
  }

  get HL() {
    return (this.H << 8) | this.L;
  }

  set HL(value) {
    this.H = (value >> 8) & 0xff;
    this.L = value & 0xff;
  }

  step() {
    const interruptCycles = this.servicePendingInterrupt();
    if (interruptCycles !== 0) {
      this.tStates += interruptCycles;
      return interruptCycles;
    }

    if (this.halted) {
      this.tStates += 4;
      return 4;
    }

    const opcode = this.fetchOpcode();
    this.flagsTouched = false;
    const cycles = this.executeOpcode(opcode);
    if (!this.flagsTouched) this.Q = 0;
    if (this.interruptDelay > 0) this.interruptDelay -= 1;
    this.tStates += cycles;
    return cycles;
  }

  requestInterrupt(data = 0xff) {
    this.pendingInterrupt = true;
    this.interruptData = data & 0xff;
  }

  clearInterrupt() {
    this.pendingInterrupt = false;
  }

  requestNmi() {
    this.pendingNmi = true;
  }

  servicePendingInterrupt() {
    if (this.pendingNmi) return this.serviceNmi();
    if (!this.pendingInterrupt || !this.IFF1 || this.interruptDelay > 0) return 0;
    return this.serviceMaskableInterrupt();
  }

  serviceNmi() {
    this.pendingNmi = false;
    this.halted = false;
    this.IFF2 = this.IFF1;
    this.IFF1 = false;
    this.interruptDelay = 0;
    this.Q = 0;
    this.incrementRefresh();
    this.push16(this.PC);
    this.WZ = 0x0066;
    this.PC = this.WZ;
    return 11;
  }

  serviceMaskableInterrupt() {
    this.pendingInterrupt = false;
    this.halted = false;
    this.IFF1 = false;
    this.IFF2 = false;
    this.interruptDelay = 0;
    this.Q = 0;
    this.incrementRefresh();
    this.push16(this.PC);

    if (this.interruptMode === 2) {
      const vectorAddress = ((this.I << 8) | this.interruptData) & 0xffff;
      this.WZ = this.memory.read16(vectorAddress);
      this.PC = this.WZ;
      return 19;
    }

    if (this.interruptMode === 0 && (this.interruptData & 0xc7) === 0xc7) {
      this.WZ = this.interruptData & 0x38;
      this.PC = this.WZ;
      return 13;
    }

    this.WZ = 0x0038;
    this.PC = this.WZ;
    return 13;
  }

  executeOpcode(opcode) {
    if (opcode === 0x00) return 4; // NOP

    if (opcode === 0x76) {
      this.halted = true;
      return 4;
    }

    if ((opcode & 0xcf) === 0x03) {
      const code = (opcode >> 4) & 0x03;
      this.writeRegisterPairByCode(code, this.readRegisterPairByCode(code) + 1);
      return 6;
    }

    if ((opcode & 0xcf) === 0x0b) {
      const code = (opcode >> 4) & 0x03;
      this.writeRegisterPairByCode(code, this.readRegisterPairByCode(code) - 1);
      return 6;
    }

    if ((opcode & 0xcf) === 0x09) {
      this.addHL(this.readRegisterPairByCode((opcode >> 4) & 0x03));
      return 11;
    }

    if ((opcode & 0xc7) === 0x04) {
      const registerCode = (opcode >> 3) & 0x07;
      this.writeRegisterByCode(registerCode, this.inc8(this.readRegisterByCode(registerCode)));
      return registerCode === 6 ? 11 : 4;
    }

    if ((opcode & 0xc7) === 0x05) {
      const registerCode = (opcode >> 3) & 0x07;
      this.writeRegisterByCode(registerCode, this.dec8(this.readRegisterByCode(registerCode)));
      return registerCode === 6 ? 11 : 4;
    }

    if ((opcode & 0xc7) === 0x06) {
      const registerCode = (opcode >> 3) & 0x07;
      this.writeRegisterByCode(registerCode, this.fetch8());
      return registerCode === 6 ? 10 : 7;
    }

    if ((opcode & 0xcf) === 0x01) {
      this.writeRegisterPairByCode((opcode >> 4) & 0x03, this.fetch16());
      return 10;
    }

    if ((opcode & 0xc0) === 0x40) {
      const destination = (opcode >> 3) & 0x07;
      const source = opcode & 0x07;
      this.writeRegisterByCode(destination, this.readRegisterByCode(source));
      return destination === 6 || source === 6 ? 7 : 4;
    }

    if ((opcode & 0xc0) === 0x80) {
      const operation = (opcode >> 3) & 0x07;
      const source = opcode & 0x07;
      this.executeAlu(operation, this.readRegisterByCode(source));
      return source === 6 ? 7 : 4;
    }

    if ((opcode & 0xc7) === 0xc6) {
      this.executeAlu((opcode >> 3) & 0x07, this.fetch8());
      return 7;
    }

    if (opcode === 0xcb) {
      this.Q = 0;
      return this.executeCbOpcode(this.fetchOpcode());
    }

    if (opcode === 0xed) {
      this.Q = 0;
      return this.executeEdOpcode(this.fetchOpcode());
    }

    if (opcode === 0xdd) {
      this.Q = 0;
      return this.executeIndexOpcode("IX", this.fetchOpcode());
    }

    if (opcode === 0xfd) {
      this.Q = 0;
      return this.executeIndexOpcode("IY", this.fetchOpcode());
    }

    if ((opcode & 0xcf) === 0xc5) {
      this.push16(this.readPushPopRegisterPairByCode((opcode >> 4) & 0x03));
      return 11;
    }

    if ((opcode & 0xcf) === 0xc1) {
      this.writePushPopRegisterPairByCode((opcode >> 4) & 0x03, this.pop16());
      return 10;
    }

    if ((opcode & 0xc7) === 0xc7) {
      this.push16(this.PC);
      this.WZ = opcode & 0x38;
      this.PC = this.WZ;
      return 11;
    }

    if ((opcode & 0xc7) === 0xc0) {
      if (this.conditionMet((opcode >> 3) & 0x07)) {
        this.WZ = this.pop16();
        this.PC = this.WZ;
        return 11;
      }
      return 5;
    }

    if ((opcode & 0xc7) === 0xc2) {
      this.WZ = this.fetch16();
      if (this.conditionMet((opcode >> 3) & 0x07)) this.PC = this.WZ;
      return 10;
    }

    if ((opcode & 0xc7) === 0xc4) {
      this.WZ = this.fetch16();
      if (this.conditionMet((opcode >> 3) & 0x07)) {
        this.push16(this.PC);
        this.PC = this.WZ;
        return 17;
      }
      return 10;
    }

    switch (opcode) {
      case 0x07:
        this.rlca();
        return 4;
      case 0x0f:
        this.rrca();
        return 4;
      case 0x10: {
        const offset = this.fetchRelativeOffset();
        this.B = (this.B - 1) & 0xff;
        if (this.B !== 0) {
          this.WZ = (this.PC + offset) & 0xffff;
          this.PC = this.WZ;
          return 13;
        }
        return 8;
      }
      case 0x17:
        this.rla();
        return 4;
      case 0x08:
        [this.A, this.A_] = [this.A_, this.A];
        [this.F, this.F_] = [this.F_, this.F];
        return 4;
      case 0x02:
        this.memory.write8(this.BC, this.A);
        this.WZ = (this.A << 8) | ((this.BC + 1) & 0xff);
        return 7;
      case 0x0a:
        this.WZ = this.BC;
        this.A = this.memory.read8(this.WZ);
        this.WZ = (this.WZ + 1) & 0xffff;
        return 7;
      case 0x12:
        this.memory.write8(this.DE, this.A);
        this.WZ = (this.A << 8) | ((this.DE + 1) & 0xff);
        return 7;
      case 0x1a:
        this.WZ = this.DE;
        this.A = this.memory.read8(this.WZ);
        this.WZ = (this.WZ + 1) & 0xffff;
        return 7;
      case 0x18:
        this.relativeJump();
        return 12;
      case 0x1f:
        this.rra();
        return 4;
      case 0x20:
      case 0x28:
      case 0x30:
      case 0x38: {
        const offset = this.fetchRelativeOffset();
        const conditionCode = (opcode >> 3) & 0x03;
        if (this.conditionMet(conditionCode)) {
          this.WZ = (this.PC + offset) & 0xffff;
          this.PC = this.WZ;
          return 12;
        }
        return 7;
      }
      case 0x27:
        this.daa();
        return 4;
      case 0x2f:
        this.cpl();
        return 4;
      case 0x22:
        this.WZ = this.fetch16();
        this.memory.write16(this.WZ, this.HL);
        this.WZ = (this.WZ + 1) & 0xffff;
        return 16;
      case 0x2a:
        this.WZ = this.fetch16();
        this.HL = this.memory.read16(this.WZ);
        this.WZ = (this.WZ + 1) & 0xffff;
        return 16;
      case 0x32:
        this.WZ = this.fetch16();
        this.memory.write8(this.WZ, this.A);
        this.WZ = (this.A << 8) | ((this.WZ + 1) & 0xff);
        return 13;
      case 0x37:
        this.scf();
        return 4;
      case 0x3a:
        this.WZ = this.fetch16();
        this.A = this.memory.read8(this.WZ);
        this.WZ = (this.WZ + 1) & 0xffff;
        return 13;
      case 0x3f:
        this.ccf();
        return 4;
      case 0xd3:
        this.WZ = (this.A << 8) | this.fetch8();
        this.io.write(this.WZ, this.A);
        this.WZ = (this.WZ & 0xff00) | ((this.WZ + 1) & 0xff);
        return 11;
      case 0xdb:
        this.WZ = (this.A << 8) | this.fetch8();
        this.A = this.io.read(this.WZ) & 0xff;
        this.WZ = (this.WZ + 1) & 0xffff;
        return 11;
      case 0xd9:
        this.exx();
        return 4;
      case 0xeb:
        [this.DE, this.HL] = [this.HL, this.DE];
        return 4;
      case 0xf3:
        this.IFF1 = false;
        this.IFF2 = false;
        this.interruptDelay = 0;
        return 4;
      case 0xe3:
        this.HL = this.exchangeStack16(this.HL);
        return 19;
      case 0xe9:
        this.PC = this.HL;
        return 4;
      case 0xfb:
        this.IFF1 = true;
        this.IFF2 = true;
        this.interruptDelay = 2;
        return 4;
      case 0xf9:
        this.SP = this.HL;
        return 6;
      case 0xc9:
        this.WZ = this.pop16();
        this.PC = this.WZ;
        return 10;
      case 0xcd: {
        this.WZ = this.fetch16();
        this.push16(this.PC);
        this.PC = this.WZ;
        return 17;
      }
      case 0xc3:
        this.WZ = this.fetch16();
        this.PC = this.WZ;
        return 10;
      default:
        throw new Error(`Unimplemented opcode 0x${opcode.toString(16).padStart(2, "0")}`);
    }
  }

  fetch8() {
    const value = this.memory.read8(this.PC);
    this.PC = (this.PC + 1) & 0xffff;
    return value;
  }

  fetchOpcode() {
    const value = this.fetch8();
    this.incrementRefresh();
    return value;
  }

  incrementRefresh() {
    this.R = (this.R & 0x80) | ((this.R + 1) & 0x7f);
  }

  fetch16() {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return lo | (hi << 8);
  }

  fetchRelativeOffset() {
    const value = this.fetch8();
    return value & 0x80 ? value - 0x100 : value;
  }

  relativeJump() {
    const offset = this.fetchRelativeOffset();
    this.WZ = (this.PC + offset) & 0xffff;
    this.PC = this.WZ;
  }

  conditionMet(code) {
    switch (code) {
      case 0:
        return (this.F & FLAG.Z) === 0;
      case 1:
        return (this.F & FLAG.Z) !== 0;
      case 2:
        return (this.F & FLAG.C) === 0;
      case 3:
        return (this.F & FLAG.C) !== 0;
      case 4:
        return (this.F & FLAG.PV) === 0;
      case 5:
        return (this.F & FLAG.PV) !== 0;
      case 6:
        return (this.F & FLAG.S) === 0;
      case 7:
        return (this.F & FLAG.S) !== 0;
      default:
        throw new Error(`Invalid condition code ${code}`);
    }
  }

  touchFlags() {
    this.flagsTouched = true;
    this.Q = this.F;
  }

  readRegisterByCode(code) {
    if (code === 6) return this.memory.read8(this.HL);
    return this[REGISTER_CODES[code]];
  }

  writeRegisterByCode(code, value) {
    if (code === 6) {
      this.memory.write8(this.HL, value);
      return;
    }

    this[REGISTER_CODES[code]] = value & 0xff;
  }

  readRegisterPairByCode(code) {
    switch (code) {
      case 0:
        return this.BC;
      case 1:
        return this.DE;
      case 2:
        return this.HL;
      case 3:
        return this.SP;
      default:
        throw new Error(`Invalid register-pair code ${code}`);
    }
  }

  writeRegisterPairByCode(code, value) {
    switch (code) {
      case 0:
        this.BC = value;
        break;
      case 1:
        this.DE = value;
        break;
      case 2:
        this.HL = value;
        break;
      case 3:
        this.SP = value & 0xffff;
        break;
      default:
        throw new Error(`Invalid register-pair code ${code}`);
    }
  }

  addHL(value) {
    const before = this.HL;
    const operand = value & 0xffff;
    const total = before + operand;
    const result = total & 0xffff;

    this.WZ = (before + 1) & 0xffff;
    this.HL = result;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.PV)) | ((result >> 8) & (FLAG.Y | FLAG.X));
    if (((before & 0x0fff) + (operand & 0x0fff)) > 0x0fff) this.F |= FLAG.H;
    if (total > 0xffff) this.F |= FLAG.C;
    this.touchFlags();
  }

  addIndex(indexRegister, value) {
    const before = this[indexRegister];
    const operand = value & 0xffff;
    const total = before + operand;
    const result = total & 0xffff;

    this.WZ = (before + 1) & 0xffff;
    this[indexRegister] = result;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.PV)) | ((result >> 8) & (FLAG.Y | FLAG.X));
    if (((before & 0x0fff) + (operand & 0x0fff)) > 0x0fff) this.F |= FLAG.H;
    if (total > 0xffff) this.F |= FLAG.C;
    this.touchFlags();
  }

  adcHL(value) {
    const before = this.HL;
    const operand = value & 0xffff;
    const carry = this.F & FLAG.C ? 1 : 0;
    const total = before + operand + carry;
    const result = total & 0xffff;

    this.WZ = (before + 1) & 0xffff;
    this.HL = result;
    this.F = ((result >> 8) & (FLAG.S | FLAG.Y | FLAG.X)) | (result === 0 ? FLAG.Z : 0);
    if (((before & 0x0fff) + (operand & 0x0fff) + carry) > 0x0fff) this.F |= FLAG.H;
    if (((before ^ ~operand) & (before ^ result) & 0x8000) !== 0) this.F |= FLAG.PV;
    if (total > 0xffff) this.F |= FLAG.C;
    this.touchFlags();
  }

  sbcHL(value) {
    const before = this.HL;
    const operand = value & 0xffff;
    const carry = this.F & FLAG.C ? 1 : 0;
    const subtrahend = operand + carry;
    const result = (before - subtrahend) & 0xffff;

    this.WZ = (before + 1) & 0xffff;
    this.HL = result;
    this.F = ((result >> 8) & (FLAG.S | FLAG.Y | FLAG.X)) | FLAG.N | (result === 0 ? FLAG.Z : 0);
    if ((before & 0x0fff) < ((operand & 0x0fff) + carry)) this.F |= FLAG.H;
    if (((before ^ operand) & (before ^ result) & 0x8000) !== 0) this.F |= FLAG.PV;
    if (before < subtrahend) this.F |= FLAG.C;
    this.touchFlags();
  }

  rlca() {
    const carry = (this.A >> 7) & 1;
    this.A = ((this.A << 1) | carry) & 0xff;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.PV)) | (this.A & (FLAG.Y | FLAG.X));
    if (carry) this.F |= FLAG.C;
    this.touchFlags();
  }

  rrca() {
    const carry = this.A & 1;
    this.A = ((carry << 7) | (this.A >> 1)) & 0xff;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.PV)) | (this.A & (FLAG.Y | FLAG.X));
    if (carry) this.F |= FLAG.C;
    this.touchFlags();
  }

  rla() {
    const oldCarry = this.F & FLAG.C ? 1 : 0;
    const newCarry = (this.A >> 7) & 1;
    this.A = ((this.A << 1) | oldCarry) & 0xff;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.PV)) | (this.A & (FLAG.Y | FLAG.X));
    if (newCarry) this.F |= FLAG.C;
    this.touchFlags();
  }

  rra() {
    const oldCarry = this.F & FLAG.C ? 1 : 0;
    const newCarry = this.A & 1;
    this.A = ((oldCarry << 7) | (this.A >> 1)) & 0xff;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.PV)) | (this.A & (FLAG.Y | FLAG.X));
    if (newCarry) this.F |= FLAG.C;
    this.touchFlags();
  }

  daa() {
    const before = this.A;
    const oldCarry = (this.F & FLAG.C) !== 0;
    let correction = 0;
    let carry = oldCarry;

    if ((this.F & FLAG.H) !== 0 || (before & 0x0f) > 9) {
      correction |= 0x06;
    }

    if (oldCarry || before > 0x99) {
      correction |= 0x60;
      carry = true;
    }

    const result = (this.F & FLAG.N) !== 0 ? (before - correction) & 0xff : (before + correction) & 0xff;
    const preservedSubtract = this.F & FLAG.N;
    const halfCarry = ((before ^ result) & FLAG.H) !== 0;

    this.A = result;
    this.F = szxyFlags(result) | preservedSubtract;
    if (halfCarry) this.F |= FLAG.H;
    if (parity(result)) this.F |= FLAG.PV;
    if (carry) this.F |= FLAG.C;
    this.touchFlags();
  }

  cpl() {
    this.A = (~this.A) & 0xff;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.PV | FLAG.C)) | FLAG.H | FLAG.N | (this.A & (FLAG.Y | FLAG.X));
    this.touchFlags();
  }

  scf() {
    const xySource = this.Q === 0 ? this.A | this.F : this.A;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.PV)) | (xySource & (FLAG.Y | FLAG.X)) | FLAG.C;
    this.touchFlags();
  }

  ccf() {
    const oldCarry = this.F & FLAG.C;
    const xySource = this.Q === 0 ? this.A | this.F : this.A;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.PV)) | (xySource & (FLAG.Y | FLAG.X));
    if (oldCarry) this.F |= FLAG.H;
    else this.F |= FLAG.C;
    this.touchFlags();
  }

  readPushPopRegisterPairByCode(code) {
    switch (code) {
      case 0:
        return this.BC;
      case 1:
        return this.DE;
      case 2:
        return this.HL;
      case 3:
        return this.AF;
      default:
        throw new Error(`Invalid push/pop register-pair code ${code}`);
    }
  }

  writePushPopRegisterPairByCode(code, value) {
    switch (code) {
      case 0:
        this.BC = value;
        break;
      case 1:
        this.DE = value;
        break;
      case 2:
        this.HL = value;
        break;
      case 3:
        this.AF = value;
        break;
      default:
        throw new Error(`Invalid push/pop register-pair code ${code}`);
    }
  }

  push16(value) {
    this.SP = (this.SP - 1) & 0xffff;
    this.memory.write8(this.SP, value >> 8);
    this.SP = (this.SP - 1) & 0xffff;
    this.memory.write8(this.SP, value);
  }

  pop16() {
    const lo = this.memory.read8(this.SP);
    this.SP = (this.SP + 1) & 0xffff;
    const hi = this.memory.read8(this.SP);
    this.SP = (this.SP + 1) & 0xffff;
    return lo | (hi << 8);
  }

  exchangeStack16(value) {
    const stackValue = this.memory.read16(this.SP);
    this.WZ = stackValue;
    this.memory.write16(this.SP, value);
    return stackValue;
  }

  exx() {
    [this.B, this.B_] = [this.B_, this.B];
    [this.C, this.C_] = [this.C_, this.C];
    [this.D, this.D_] = [this.D_, this.D];
    [this.E, this.E_] = [this.E_, this.E];
    [this.H, this.H_] = [this.H_, this.H];
    [this.L, this.L_] = [this.L_, this.L];
  }

  executeAlu(operation, value) {
    switch (operation) {
      case 0:
        this.addA(value);
        break;
      case 1:
        this.adcA(value);
        break;
      case 2:
        this.subA(value);
        break;
      case 3:
        this.sbcA(value);
        break;
      case 4:
        this.andA(value);
        break;
      case 5:
        this.xorA(value);
        break;
      case 6:
        this.orA(value);
        break;
      case 7:
        this.cpA(value);
        break;
      default:
        throw new Error(`Invalid ALU operation ${operation}`);
    }
  }

  executeCbOpcode(opcode) {
    const group = opcode >> 6;
    const y = (opcode >> 3) & 0x07;
    const registerCode = opcode & 0x07;
    const value = this.readRegisterByCode(registerCode);

    if (group === 0) {
      this.writeRegisterByCode(registerCode, this.rotateShift(y, value));
      return registerCode === 6 ? 15 : 8;
    }

    if (group === 1) {
      this.bit(y, value, registerCode === 6 ? (this.WZ >> 8) & 0xff : value);
      return registerCode === 6 ? 12 : 8;
    }

    if (group === 2) {
      this.writeRegisterByCode(registerCode, value & ~(1 << y));
      return registerCode === 6 ? 15 : 8;
    }

    this.writeRegisterByCode(registerCode, value | (1 << y));
    return registerCode === 6 ? 15 : 8;
  }

  executeEdOpcode(opcode) {
    let value;

    switch (opcode) {
      case 0x44:
      case 0x4c:
      case 0x54:
      case 0x5c:
      case 0x64:
      case 0x6c:
      case 0x74:
      case 0x7c:
        this.neg();
        return 8;
      case 0x45:
      case 0x55:
      case 0x5d:
      case 0x65:
      case 0x6d:
      case 0x75:
      case 0x7d:
        this.retn();
        return 14;
      case 0x4d:
        this.retn();
        return 14;
      case 0x40:
      case 0x48:
      case 0x50:
      case 0x58:
      case 0x60:
      case 0x68:
      case 0x70:
      case 0x78:
        this.inFromC((opcode >> 3) & 0x07);
        return 12;
      case 0x41:
      case 0x49:
      case 0x51:
      case 0x59:
      case 0x61:
      case 0x69:
      case 0x71:
      case 0x79:
        this.outToC((opcode >> 3) & 0x07);
        return 12;
      case 0x42:
      case 0x52:
      case 0x62:
      case 0x72:
        this.sbcHL(this.readRegisterPairByCode((opcode >> 4) & 0x03));
        return 15;
      case 0x4a:
      case 0x5a:
      case 0x6a:
      case 0x7a:
        this.adcHL(this.readRegisterPairByCode((opcode >> 4) & 0x03));
        return 15;
      case 0x46:
      case 0x4e:
      case 0x66:
      case 0x6e:
        this.interruptMode = 0;
        return 8;
      case 0x56:
      case 0x76:
        this.interruptMode = 1;
        return 8;
      case 0x5e:
      case 0x7e:
        this.interruptMode = 2;
        return 8;
      case 0x47:
        this.I = this.A;
        return 9;
      case 0x4f:
        this.R = this.A;
        return 9;
      case 0x57:
        this.ldAFromSpecial(this.I);
        return 9;
      case 0x5f:
        this.ldAFromSpecial(this.R);
        return 9;
      case 0x67:
        this.rrd();
        return 18;
      case 0x6f:
        this.rld();
        return 18;
      case 0xa0:
        this.ldi(1);
        return 16;
      case 0xa1:
        this.cpi(1);
        return 16;
      case 0xa2:
        this.ini(1);
        return 16;
      case 0xa3:
        this.outi(1);
        return 16;
      case 0xa8:
        this.ldi(-1);
        return 16;
      case 0xa9:
        this.cpi(-1);
        return 16;
      case 0xaa:
        this.ini(-1);
        return 16;
      case 0xab:
        this.outi(-1);
        return 16;
      case 0xb0:
        this.ldi(1);
        if (this.BC !== 0) {
          this.PC = (this.PC - 2) & 0xffff;
          this.WZ = (this.PC + 1) & 0xffff;
          this.F = (this.F & ~(FLAG.Y | FLAG.X)) | ((this.PC >> 8) & (FLAG.Y | FLAG.X));
          this.touchFlags();
          return 21;
        }
        return 16;
      case 0xb1:
        this.cpi(1);
        if (this.BC !== 0 && (this.F & FLAG.Z) === 0) {
          this.PC = (this.PC - 2) & 0xffff;
          this.WZ = (this.PC + 1) & 0xffff;
          this.F = (this.F & ~(FLAG.Y | FLAG.X)) | ((this.PC >> 8) & (FLAG.Y | FLAG.X));
          this.touchFlags();
          return 21;
        }
        return 16;
      case 0xb2:
        value = this.ini(1);
        if (this.B !== 0) {
          this.PC = (this.PC - 2) & 0xffff;
          this.WZ = (this.PC + 1) & 0xffff;
          this.postBlockIoRepeat(value);
          return 21;
        }
        return 16;
      case 0xb3:
        value = this.outi(1);
        if (this.B !== 0) {
          this.PC = (this.PC - 2) & 0xffff;
          this.WZ = (this.PC + 1) & 0xffff;
          this.postBlockIoRepeat(value);
          return 21;
        }
        return 16;
      case 0xb8:
        this.ldi(-1);
        if (this.BC !== 0) {
          this.PC = (this.PC - 2) & 0xffff;
          this.WZ = (this.PC + 1) & 0xffff;
          this.F = (this.F & ~(FLAG.Y | FLAG.X)) | ((this.PC >> 8) & (FLAG.Y | FLAG.X));
          this.touchFlags();
          return 21;
        }
        return 16;
      case 0xb9:
        this.cpi(-1);
        if (this.BC !== 0 && (this.F & FLAG.Z) === 0) {
          this.PC = (this.PC - 2) & 0xffff;
          this.WZ = (this.PC + 1) & 0xffff;
          this.F = (this.F & ~(FLAG.Y | FLAG.X)) | ((this.PC >> 8) & (FLAG.Y | FLAG.X));
          this.touchFlags();
          return 21;
        }
        return 16;
      case 0xba:
        value = this.ini(-1);
        if (this.B !== 0) {
          this.PC = (this.PC - 2) & 0xffff;
          this.WZ = (this.PC + 1) & 0xffff;
          this.postBlockIoRepeat(value);
          return 21;
        }
        return 16;
      case 0xbb:
        value = this.outi(-1);
        if (this.B !== 0) {
          this.PC = (this.PC - 2) & 0xffff;
          this.WZ = (this.PC + 1) & 0xffff;
          this.postBlockIoRepeat(value);
          return 21;
        }
        return 16;
      case 0x43:
      case 0x53:
      case 0x63:
      case 0x73:
        this.WZ = this.fetch16();
        this.memory.write16(this.WZ, this.readRegisterPairByCode((opcode >> 4) & 0x03));
        this.WZ = (this.WZ + 1) & 0xffff;
        return 20;
      case 0x4b:
      case 0x5b:
      case 0x6b:
      case 0x7b:
        this.WZ = this.fetch16();
        this.writeRegisterPairByCode((opcode >> 4) & 0x03, this.memory.read16(this.WZ));
        this.WZ = (this.WZ + 1) & 0xffff;
        return 20;
      default:
        return 8;
    }
  }

  executeIndexOpcode(indexRegister, opcode) {
    if (opcode === 0xcb) {
      const address = this.fetchIndexedAddress(indexRegister);
      return this.executeIndexedCbOpcode(address, this.fetch8());
    }

    if ((opcode & 0xc7) === 0x04 && ((opcode >> 3) & 0x07) === 6) {
      const address = this.fetchIndexedAddress(indexRegister);
      this.memory.write8(address, this.inc8(this.memory.read8(address)));
      return 23;
    }

    if ((opcode & 0xc7) === 0x05 && ((opcode >> 3) & 0x07) === 6) {
      const address = this.fetchIndexedAddress(indexRegister);
      this.memory.write8(address, this.dec8(this.memory.read8(address)));
      return 23;
    }

    if ((opcode & 0xc7) === 0x04 && ((opcode >> 3) & 0x07) !== 6) {
      const registerCode = (opcode >> 3) & 0x07;
      this.writeIndexRegisterByCode(indexRegister, registerCode, this.inc8(this.readIndexRegisterByCode(indexRegister, registerCode)));
      return 8;
    }

    if ((opcode & 0xc7) === 0x05 && ((opcode >> 3) & 0x07) !== 6) {
      const registerCode = (opcode >> 3) & 0x07;
      this.writeIndexRegisterByCode(indexRegister, registerCode, this.dec8(this.readIndexRegisterByCode(indexRegister, registerCode)));
      return 8;
    }

    if ((opcode & 0xc7) === 0x06 && ((opcode >> 3) & 0x07) === 6) {
      const address = this.fetchIndexedAddress(indexRegister);
      this.memory.write8(address, this.fetch8());
      return 19;
    }

    if ((opcode & 0xc7) === 0x06 && ((opcode >> 3) & 0x07) !== 6) {
      this.writeIndexRegisterByCode(indexRegister, (opcode >> 3) & 0x07, this.fetch8());
      return 11;
    }

    if ((opcode & 0xc0) === 0x40 && opcode !== 0x76 && (((opcode >> 3) & 0x07) === 6 || (opcode & 0x07) === 6)) {
      const destination = (opcode >> 3) & 0x07;
      const source = opcode & 0x07;
      const address = this.fetchIndexedAddress(indexRegister);

      if (destination === 6) {
        this.memory.write8(address, this.readRegisterByCode(source));
      } else {
        this.writeRegisterByCode(destination, this.memory.read8(address));
      }

      return 19;
    }

    if ((opcode & 0xc0) === 0x40 && opcode !== 0x76 && ((opcode >> 3) & 0x07) !== 6 && (opcode & 0x07) !== 6) {
      const destination = (opcode >> 3) & 0x07;
      const source = opcode & 0x07;
      this.writeIndexRegisterByCode(indexRegister, destination, this.readIndexRegisterByCode(indexRegister, source));
      return 8;
    }

    if ((opcode & 0xc0) === 0x80 && (opcode & 0x07) === 6) {
      this.executeAlu((opcode >> 3) & 0x07, this.memory.read8(this.fetchIndexedAddress(indexRegister)));
      return 19;
    }

    if ((opcode & 0xc0) === 0x80 && (opcode & 0x07) !== 6) {
      this.executeAlu((opcode >> 3) & 0x07, this.readIndexRegisterByCode(indexRegister, opcode & 0x07));
      return 8;
    }

    switch (opcode) {
      case 0x09:
        this.addIndex(indexRegister, this.BC);
        return 15;
      case 0x19:
        this.addIndex(indexRegister, this.DE);
        return 15;
      case 0x21:
        this[indexRegister] = this.fetch16();
        return 14;
      case 0x22:
        this.WZ = this.fetch16();
        this.memory.write16(this.WZ, this[indexRegister]);
        this.WZ = (this.WZ + 1) & 0xffff;
        return 20;
      case 0x23:
        this[indexRegister] = (this[indexRegister] + 1) & 0xffff;
        return 10;
      case 0x29:
        this.addIndex(indexRegister, this[indexRegister]);
        return 15;
      case 0x2a:
        this.WZ = this.fetch16();
        this[indexRegister] = this.memory.read16(this.WZ);
        this.WZ = (this.WZ + 1) & 0xffff;
        return 20;
      case 0x2b:
        this[indexRegister] = (this[indexRegister] - 1) & 0xffff;
        return 10;
      case 0x39:
        this.addIndex(indexRegister, this.SP);
        return 15;
      case 0xe1:
        this[indexRegister] = this.pop16();
        return 14;
      case 0xe3:
        this[indexRegister] = this.exchangeStack16(this[indexRegister]);
        return 23;
      case 0xe5:
        this.push16(this[indexRegister]);
        return 15;
      case 0xe9:
        this.PC = this[indexRegister];
        return 8;
      case 0xf9:
        this.SP = this[indexRegister];
        return 10;
      default:
        return this.executeOpcode(opcode) + 4;
    }
  }

  readIndexRegisterByCode(indexRegister, code) {
    if (code === 4) return (this[indexRegister] >> 8) & 0xff;
    if (code === 5) return this[indexRegister] & 0xff;
    return this.readRegisterByCode(code);
  }

  writeIndexRegisterByCode(indexRegister, code, value) {
    const byte = value & 0xff;

    if (code === 4) {
      this[indexRegister] = (byte << 8) | (this[indexRegister] & 0x00ff);
      return;
    }

    if (code === 5) {
      this[indexRegister] = (this[indexRegister] & 0xff00) | byte;
      return;
    }

    this.writeRegisterByCode(code, byte);
  }

  fetchIndexedAddress(indexRegister) {
    this.WZ = (this[indexRegister] + this.fetchRelativeOffset()) & 0xffff;
    return this.WZ;
  }

  executeIndexedCbOpcode(address, opcode) {
    const group = opcode >> 6;
    const y = (opcode >> 3) & 0x07;
    const registerCode = opcode & 0x07;
    const value = this.memory.read8(address);

    if (group === 0) {
      const result = this.rotateShift(y, value);
      this.memory.write8(address, result);
      if (registerCode !== 6) this.writeRegisterByCode(registerCode, result);
      return 23;
    }

    if (group === 1) {
      this.bit(y, value, (address >> 8) & 0xff);
      return 20;
    }

    if (group === 2) {
      const result = value & ~(1 << y);
      this.memory.write8(address, result);
      if (registerCode !== 6) this.writeRegisterByCode(registerCode, result);
      return 23;
    }

    const result = value | (1 << y);
    this.memory.write8(address, result);
    if (registerCode !== 6) this.writeRegisterByCode(registerCode, result);
    return 23;
  }

  rotateShift(operation, value) {
    const operand = value & 0xff;
    let result;
    let carry;

    switch (operation) {
      case 0: // RLC
        carry = (operand >> 7) & 1;
        result = ((operand << 1) | carry) & 0xff;
        break;
      case 1: // RRC
        carry = operand & 1;
        result = ((carry << 7) | (operand >> 1)) & 0xff;
        break;
      case 2: // RL
        carry = (operand >> 7) & 1;
        result = ((operand << 1) | (this.F & FLAG.C ? 1 : 0)) & 0xff;
        break;
      case 3: // RR
        carry = operand & 1;
        result = ((this.F & FLAG.C ? 0x80 : 0) | (operand >> 1)) & 0xff;
        break;
      case 4: // SLA
        carry = (operand >> 7) & 1;
        result = (operand << 1) & 0xff;
        break;
      case 5: // SRA
        carry = operand & 1;
        result = (operand & 0x80) | (operand >> 1);
        break;
      case 6: // SLL/SLS, undocumented but commonly implemented.
        carry = (operand >> 7) & 1;
        result = ((operand << 1) | 1) & 0xff;
        break;
      case 7: // SRL
        carry = operand & 1;
        result = operand >> 1;
        break;
      default:
        throw new Error(`Invalid CB rotate/shift operation ${operation}`);
    }

    this.F = szxyFlags(result);
    if (parity(result)) this.F |= FLAG.PV;
    if (carry) this.F |= FLAG.C;
    this.touchFlags();
    return result;
  }

  bit(bit, value, xySource = value) {
    const mask = 1 << bit;
    const isSet = (value & mask) !== 0;

    this.F = (this.F & FLAG.C) | FLAG.H | (xySource & (FLAG.Y | FLAG.X));
    if (!isSet) this.F |= FLAG.Z | FLAG.PV;
    if (bit === 7 && isSet) this.F |= FLAG.S;
    this.touchFlags();
  }

  inFromC(registerCode) {
    const port = this.BC;
    this.WZ = (port + 1) & 0xffff;
    const value = this.io.read(port) & 0xff;
    if (registerCode !== 6) this.writeRegisterByCode(registerCode, value);
    this.F = (this.F & FLAG.C) | szxyFlags(value);
    if (parity(value)) this.F |= FLAG.PV;
    this.touchFlags();
  }

  outToC(registerCode) {
    const port = this.BC;
    const value = registerCode === 6 ? 0 : this.readRegisterByCode(registerCode);
    this.io.write(port, value);
    this.WZ = (port + 1) & 0xffff;
  }

  rrd() {
    this.WZ = (this.HL + 1) & 0xffff;
    const value = this.memory.read8(this.HL);
    this.memory.write8(this.HL, ((this.A & 0x0f) << 4) | (value >> 4));
    this.A = (this.A & 0xf0) | (value & 0x0f);
    this.F = (this.F & FLAG.C) | szxyFlags(this.A);
    if (parity(this.A)) this.F |= FLAG.PV;
    this.touchFlags();
  }

  rld() {
    this.WZ = (this.HL + 1) & 0xffff;
    const value = this.memory.read8(this.HL);
    this.memory.write8(this.HL, ((value << 4) & 0xf0) | (this.A & 0x0f));
    this.A = (this.A & 0xf0) | (value >> 4);
    this.F = (this.F & FLAG.C) | szxyFlags(this.A);
    if (parity(this.A)) this.F |= FLAG.PV;
    this.touchFlags();
  }

  ldi(direction) {
    const value = this.memory.read8(this.HL);
    this.memory.write8(this.DE, value);
    this.HL = (this.HL + direction) & 0xffff;
    this.DE = (this.DE + direction) & 0xffff;
    this.BC = (this.BC - 1) & 0xffff;

    const sum = (this.A + value) & 0xff;
    this.F = (this.F & (FLAG.S | FLAG.Z | FLAG.C)) | (sum & FLAG.X) | ((sum << 4) & FLAG.Y);
    if (this.BC !== 0) this.F |= FLAG.PV;
    this.touchFlags();
  }

  cpi(direction) {
    this.WZ = (this.WZ + direction) & 0xffff;
    const value = this.memory.read8(this.HL);
    const before = this.A;
    const result = (before - value) & 0xff;
    const halfCarry = (before & 0x0f) < (value & 0x0f);

    this.HL = (this.HL + direction) & 0xffff;
    this.BC = (this.BC - 1) & 0xffff;

    const adjusted = (result - (halfCarry ? 1 : 0)) & 0xff;
    this.F = (this.F & FLAG.C) | (result & FLAG.S) | (result === 0 ? FLAG.Z : 0) | FLAG.N | (adjusted & FLAG.X) | ((adjusted << 4) & FLAG.Y);
    if (halfCarry) this.F |= FLAG.H;
    if (this.BC !== 0) this.F |= FLAG.PV;
    this.touchFlags();
  }

  ini(direction) {
    const port = this.BC;
    const value = this.io.read(port) & 0xff;
    this.memory.write8(this.HL, value);
    this.HL = (this.HL + direction) & 0xffff;
    this.B = (this.B - 1) & 0xff;
    this.WZ = (port + direction) & 0xffff;
    this.setBlockIoFlags(value, (this.C + direction) & 0xff);
    return value;
  }

  outi(direction) {
    const value = this.memory.read8(this.HL);
    this.HL = (this.HL + direction) & 0xffff;
    this.B = (this.B - 1) & 0xff;
    const port = this.BC;
    this.io.write(port, value);
    this.WZ = (port + direction) & 0xffff;
    this.setBlockIoFlags(value, this.L);
    return value;
  }

  setBlockIoFlags(value, lowOperand) {
    const operand = value & 0xff;
    const lowPort = lowOperand & 0xff;
    const sum = operand + lowPort;

    this.F = (this.B & (FLAG.S | FLAG.Y | FLAG.X)) | (this.B === 0 ? FLAG.Z : 0);
    if ((operand & FLAG.S) !== 0) this.F |= FLAG.N;
    if (sum > 0xff) this.F |= FLAG.H | FLAG.C;
    if (parity(((sum & 0x07) ^ this.B) & 0xff)) this.F |= FLAG.PV;
    this.touchFlags();
  }

  postBlockIoRepeat(value) {
    const operand = value & 0xff;
    this.F = (this.F & ~(FLAG.Y | FLAG.X)) | ((this.PC >> 8) & (FLAG.Y | FLAG.X));

    if ((this.F & FLAG.C) !== 0) {
      const parityInput = operand & FLAG.S ? (this.B - 1) & 0x07 : (this.B + 1) & 0x07;
      if (!parity(parityInput)) this.F ^= FLAG.PV;
      if (operand & FLAG.S) {
        if ((this.B & 0x0f) === 0) this.F |= FLAG.H;
        else this.F &= ~FLAG.H;
      } else {
        if ((this.B & 0x0f) === 0x0f) this.F |= FLAG.H;
        else this.F &= ~FLAG.H;
      }
      this.touchFlags();
      return;
    }

    if (!parity(this.B & 0x07)) this.F ^= FLAG.PV;
    this.touchFlags();
  }

  addA(value) {
    const operand = value & 0xff;
    const before = this.A;
    const total = before + operand;
    const result = total & 0xff;

    this.A = result;
    this.F = szxyFlags(result);
    if (((before & 0x0f) + (operand & 0x0f)) > 0x0f) this.F |= FLAG.H;
    if (((before ^ ~operand) & (before ^ result) & 0x80) !== 0) this.F |= FLAG.PV;
    if (total > 0xff) this.F |= FLAG.C;
    this.touchFlags();
  }

  adcA(value) {
    const operand = value & 0xff;
    const carry = this.F & FLAG.C ? 1 : 0;
    const before = this.A;
    const total = before + operand + carry;
    const result = total & 0xff;

    this.A = result;
    this.F = szxyFlags(result);
    if (((before & 0x0f) + (operand & 0x0f) + carry) > 0x0f) this.F |= FLAG.H;
    if (((before ^ ~operand) & (before ^ result) & 0x80) !== 0) this.F |= FLAG.PV;
    if (total > 0xff) this.F |= FLAG.C;
    this.touchFlags();
  }

  subA(value) {
    const operand = value & 0xff;
    const before = this.A;
    const result = (before - operand) & 0xff;

    this.A = result;
    this.F = szxyFlags(result) | FLAG.N;
    if ((before & 0x0f) < (operand & 0x0f)) this.F |= FLAG.H;
    if (((before ^ operand) & (before ^ result) & 0x80) !== 0) this.F |= FLAG.PV;
    if (before < operand) this.F |= FLAG.C;
    this.touchFlags();
  }

  neg() {
    const before = this.A;
    const result = (-before) & 0xff;

    this.A = result;
    this.F = szxyFlags(result) | FLAG.N;
    if ((before & 0x0f) !== 0) this.F |= FLAG.H;
    if (before === 0x80) this.F |= FLAG.PV;
    if (before !== 0) this.F |= FLAG.C;
    this.touchFlags();
  }

  retn() {
    this.WZ = this.pop16();
    this.PC = this.WZ;
    this.IFF1 = this.IFF2;
  }

  ldAFromSpecial(value) {
    this.A = value & 0xff;
    this.F = (this.F & FLAG.C) | szxyFlags(this.A);
    if (this.IFF2) this.F |= FLAG.PV;
    this.touchFlags();
  }

  sbcA(value) {
    const operand = value & 0xff;
    const carry = this.F & FLAG.C ? 1 : 0;
    const before = this.A;
    const subtrahend = operand + carry;
    const result = (before - subtrahend) & 0xff;

    this.A = result;
    this.F = szxyFlags(result) | FLAG.N;
    if ((before & 0x0f) < ((operand & 0x0f) + carry)) this.F |= FLAG.H;
    if (((before ^ operand) & (before ^ result) & 0x80) !== 0) this.F |= FLAG.PV;
    if (before < subtrahend) this.F |= FLAG.C;
    this.touchFlags();
  }

  andA(value) {
    const result = this.A & value;
    this.A = result & 0xff;
    this.F = szxyFlags(this.A) | FLAG.H;
    if (parity(this.A)) this.F |= FLAG.PV;
    this.touchFlags();
  }

  xorA(value) {
    this.A = (this.A ^ value) & 0xff;
    this.F = szxyFlags(this.A);
    if (parity(this.A)) this.F |= FLAG.PV;
    this.touchFlags();
  }

  orA(value) {
    this.A = (this.A | value) & 0xff;
    this.F = szxyFlags(this.A);
    if (parity(this.A)) this.F |= FLAG.PV;
    this.touchFlags();
  }

  cpA(value) {
    const operand = value & 0xff;
    const before = this.A;
    const result = (before - operand) & 0xff;

    this.F = (result & FLAG.S) | (result === 0 ? FLAG.Z : 0) | FLAG.N | (operand & (FLAG.Y | FLAG.X));
    if ((before & 0x0f) < (operand & 0x0f)) this.F |= FLAG.H;
    if (((before ^ operand) & (before ^ result) & 0x80) !== 0) this.F |= FLAG.PV;
    if (before < operand) this.F |= FLAG.C;
    this.touchFlags();
  }

  inc8(value) {
    const before = value & 0xff;
    const result = (before + 1) & 0xff;
    const carry = this.F & FLAG.C;

    this.F = szxyFlags(result) | carry;
    if ((before & 0x0f) === 0x0f) this.F |= FLAG.H;
    if (before === 0x7f) this.F |= FLAG.PV;
    this.touchFlags();
    return result;
  }

  dec8(value) {
    const before = value & 0xff;
    const result = (before - 1) & 0xff;
    const carry = this.F & FLAG.C;

    this.F = szxyFlags(result) | FLAG.N | carry;
    if ((before & 0x0f) === 0x00) this.F |= FLAG.H;
    if (before === 0x80) this.F |= FLAG.PV;
    this.touchFlags();
    return result;
  }

  getState() {
    return {
      registers: {
        A: this.A,
        F: this.F,
        B: this.B,
        C: this.C,
        D: this.D,
        E: this.E,
        H: this.H,
        L: this.L,
        AF: this.AF,
        BC: this.BC,
        DE: this.DE,
        HL: this.HL,
        IX: this.IX,
        IY: this.IY,
        SP: this.SP,
        PC: this.PC,
        I: this.I,
        R: this.R
      },
      flags: {
        S: Boolean(this.F & FLAG.S),
        Z: Boolean(this.F & FLAG.Z),
        Y: Boolean(this.F & FLAG.Y),
        H: Boolean(this.F & FLAG.H),
        X: Boolean(this.F & FLAG.X),
        PV: Boolean(this.F & FLAG.PV),
        N: Boolean(this.F & FLAG.N),
        C: Boolean(this.F & FLAG.C)
      },
      interruptMode: this.interruptMode,
      IFF1: this.IFF1,
      IFF2: this.IFF2,
      interruptDelay: this.interruptDelay,
      pendingInterrupt: this.pendingInterrupt,
      interruptData: this.interruptData,
      pendingNmi: this.pendingNmi,
      halted: this.halted,
      tStates: this.tStates
    };
  }
}
