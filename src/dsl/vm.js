import { readFileSync } from 'node:fs';
import { SCHEMA_SHA256 } from './schema.js';
import { registerStdFns, Report, StrList, IntList, FloatList, StrMap } from './std.js';
import { Web, checkBrowserError } from './web.js';

const OP = {
  PUSH_INT: 0x01,
  PUSH_STR: 0x02,
  PUSH_BOOL: 0x03,
  LOAD_LOCAL: 0x04,
  STORE_LOCAL: 0x05,
  LOAD_CTX: 0x06,
  CALL_FN: 0x07,
  CALL_METHOD: 0x08,
  EQ: 0x09,
  NE: 0x0A,
  NOT: 0x0B,
  JUMP: 0x0C,
  JUMP_IF_FALSE: 0x0D,
  JUMP_IF_TRUE: 0x0E,
  DUP: 0x0F,
  POP: 0x10,
  HALT: 0x11,
  PUSH_FLOAT: 0x12,
  ADD_I: 0x13,
  SUB_I: 0x14,
  MUL_I: 0x15,
  DIV_I: 0x16,
  ADD_F: 0x17,
  SUB_F: 0x18,
  MUL_F: 0x19,
  DIV_F: 0x1A,
  NEG_I: 0x1B,
  NEG_F: 0x1C,
  LT_I: 0x1D,
  LE_I: 0x1E,
  GT_I: 0x1F,
  GE_I: 0x20,
  LT_F: 0x21,
  LE_F: 0x22,
  GT_F: 0x23,
  GE_F: 0x24,
  I2F: 0x25,
  CONCAT: 0x26,
  I2S: 0x27,
  F2S: 0x28,
  B2S: 0x29,
  FOR_RANGE: 0x2f,
  FOR_NEXT: 0x31,
  MATH: 0x32,
  MOD_I: 0x33,
  WHILE_BEGIN: 0x34,
  WHILE_TEST: 0x35,
  LOOP_BACK: 0x36,
};

const MATH_ARITY = [
  1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 1, 1, 1, 1, 1, 2, 2, 3
];

const MATH_FNS = [
  (x) => Math.sin(Number(x)),
  (x) => Math.cos(Number(x)),
  (x) => Math.sqrt(Number(x)),
  (x) => Math.abs(Number(x)),
  (x) => Math.floor(Number(x)),
  (a, b) => Math.pow(Number(a), Number(b)),
  (a, b) => Math.min(Number(a), Number(b)),
  (a, b) => Math.max(Number(a), Number(b)),
  (x, min, max) => Math.min(Math.max(Number(x), Number(min)), Number(max)),
  (a, b, t) => Number(a) + (Number(b) - Number(a)) * Number(t),
  (t) => { t = Math.max(0, Math.min(1, Number(t))); return t * t * (3 - 2 * t); },
  (t) => { t = Math.max(0, Math.min(1, Number(t))); return t * t; },
  (t) => { t = Math.max(0, Math.min(1, Number(t))); return t * (2 - t); },
  (x) => BigInt(Math.trunc(Number(x))),
  (x) => (BigInt(x) < 0n ? -BigInt(x) : BigInt(x)),
  (a, b) => (BigInt(a) < BigInt(b) ? BigInt(a) : BigInt(b)),
  (a, b) => (BigInt(a) > BigInt(b) ? BigInt(a) : BigInt(b)),
  (x, min, max) => {
    let xi = BigInt(x), mi = BigInt(min), ma = BigInt(max);
    return xi < mi ? mi : xi > ma ? ma : xi;
  },
];

class BytecodeReader {
  constructor(buffer) {
    this.buf = buffer;
    this.pos = 0;
  }
  need(n) {
    if (this.pos + n > this.buf.length) {
      const err = new Error(`truncated bytecode: needed ${n} bytes at ${this.pos}, file has ${this.buf.length}`);
      err.code = 'LOAD_BAD_BYTECODE';
      err.phase = 'load';
      throw err;
    }
  }
  u8() { this.need(1); return this.buf[this.pos++]; }
  u16() { this.need(2); const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }
  i16() { this.need(2); const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
  i32() { this.need(4); const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  i64() { this.need(8); const v = this.buf.readBigInt64BE(this.pos); this.pos += 8; return v; }
  f64() { this.need(8); const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v; }
  bytes(len) {
    this.need(len);
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }
}

export class Program {
  constructor() {
    this.constants = [];
    this.imports = [];
    this.contexts = [];
    this.locals = [];
    this.maxStack = 0;
    this.code = Buffer.alloc(0);
    this.lines = [];
  }

  static load(bytecodeBuffer) {
    const r = new BytecodeReader(bytecodeBuffer);
    const magic = r.bytes(4).toString('latin1');
    if (magic !== 'DSLB') {
      const err = new Error(`not a DSL bytecode file: bad magic (expected 'DSLB', found ${magic})`);
      err.code = 'LOAD_BAD_BYTECODE';
      err.phase = 'load';
      throw err;
    }

    const version = r.u16();
    if (version !== 5 && version !== 6) {
      const err = new Error(`unsupported bytecode version ${version} (expected version 5 or 6)`);
      err.code = 'LOAD_BAD_BYTECODE';
      err.phase = 'load';
      throw err;
    }

    const hash = r.bytes(32);
    if (!hash.equals(SCHEMA_SHA256)) {
      const err = new Error('bytecode schema hash does not match host schema');
      err.code = 'LOAD_SCHEMA_MISMATCH';
      err.phase = 'load';
      throw err;
    }

    const p = new Program();

    // Constants
    const constCount = r.u32();
    for (let i = 0; i < constCount; i++) {
      const tag = r.u8();
      if (tag !== 1) {
        const err = new Error(`unknown constant tag ${tag} at index ${i}`);
        err.code = 'LOAD_BAD_BYTECODE';
        err.phase = 'load';
        throw err;
      }
      const len = r.u32();
      p.constants.push(r.bytes(len).toString('utf8'));
    }

    // Imports
    const importCount = r.u16();
    for (let i = 0; i < importCount; i++) {
      const constIdx = r.u32();
      p.imports.push(p.constants[constIdx]);
    }

    // Contexts
    const contextCount = r.u16();
    for (let i = 0; i < contextCount; i++) {
      const nameIdx = r.u32();
      const typeIdx = r.u32();
      p.contexts.push({
        name: p.constants[nameIdx],
        type: p.constants[typeIdx],
      });
    }

    // Locals
    const localCount = r.u16();
    for (let i = 0; i < localCount; i++) {
      const typeIdx = r.u32();
      const hidden = r.u8();
      p.locals.push({
        type: p.constants[typeIdx],
        hidden: hidden !== 0,
      });
    }

    p.maxStack = r.u16();
    const codeLen = r.u32();
    p.code = r.bytes(codeLen);

    const lineCount = r.u32();
    for (let i = 0; i < lineCount; i++) {
      p.lines.push({
        pc: r.u32(),
        line: r.u32(),
        column: r.u16(),
      });
    }

    return p;
  }

  getLine(pc) {
    let result = { line: 0, column: 0 };
    for (const l of this.lines) {
      if (l.pc <= pc) {
        result = l;
      } else {
        break;
      }
    }
    return result;
  }

  async run(contextObjects) {
    const fnRegistry = new Map();
    registerStdFns(fnRegistry);

    const stack = [];
    const locals = new Array(this.locals.length).fill(null);
    let pc = 0;
    const code = this.code;

    const u8 = () => code[pc++];
    const u16 = () => { const v = code.readUInt16BE(pc); pc += 2; return v; };
    const i32 = () => { const v = code.readInt32BE(pc); pc += 4; return v; };
    const i64 = () => { const v = code.readBigInt64BE(pc); pc += 8; return v; };
    const f64 = () => { const v = code.readDoubleBE(pc); pc += 8; return v; };

    const pop = () => {
      if (stack.length === 0) {
        const err = new Error('operand stack underflow');
        err.code = 'RUN_ERROR';
        throw err;
      }
      return stack.pop();
    };

    const push = (val) => stack.push(val);

    while (pc < code.length) {
      const currentInsnPc = pc;
      const op = u8();

      try {
        switch (op) {
          case OP.PUSH_INT: {
            push(i64());
            break;
          }
          case OP.PUSH_FLOAT: {
            push(f64());
            break;
          }
          case OP.PUSH_STR: {
            const idx = code.readUInt32BE(pc);
            pc += 4;
            push(this.constants[idx]);
            break;
          }
          case OP.PUSH_BOOL: {
            push(u8() !== 0);
            break;
          }
          case OP.LOAD_LOCAL: {
            const slot = u16();
            push(locals[slot]);
            break;
          }
          case OP.STORE_LOCAL: {
            const slot = u16();
            locals[slot] = pop();
            break;
          }
          case OP.LOAD_CTX: {
            const ctxIdx = u16();
            const ctxDecl = this.contexts[ctxIdx];
            const obj = contextObjects[ctxDecl.name];
            if (!obj) {
              throw new Error(`context object '${ctxDecl.name}' not provided`);
            }
            push(obj);
            break;
          }
          case OP.CALL_FN: {
            const importIdx = u16();
            const argc = u8();
            const sig = this.imports[importIdx];
            const fn = fnRegistry.get(sig);
            if (!fn) throw new Error(`unbound function import: ${sig}`);

            const args = new Array(argc);
            for (let i = argc - 1; i >= 0; i--) args[i] = pop();

            const res = await fn(...args);
            if (!sig.endsWith('-> void')) push(res);
            break;
          }
          case OP.CALL_METHOD: {
            const importIdx = u16();
            const argc = u8();
            const sig = this.imports[importIdx];

            const args = new Array(argc);
            for (let i = argc - 1; i >= 0; i--) args[i] = pop();
            const target = pop();

            // Method signature form: "method TypeName.methodName(param1, param2) -> ReturnType"
            const match = /^method [^.]+\.([^(]+)/.exec(sig);
            const methodName = match ? match[1] : '';

            if (!target || typeof target[methodName] !== 'function') {
              throw new Error(`target object does not have method ${methodName} (${sig})`);
            }

            const res = await target[methodName](...args);
            if (!sig.endsWith('-> void')) push(res);
            break;
          }
          case OP.EQ: {
            const b = pop();
            const a = pop();
            push(a === b);
            break;
          }
          case OP.NE: {
            const b = pop();
            const a = pop();
            push(a !== b);
            break;
          }
          case OP.NOT: {
            const a = pop();
            push(!a);
            break;
          }
          case OP.JUMP: {
            const rel = i32();
            pc += rel;
            break;
          }
          case OP.JUMP_IF_FALSE: {
            const rel = i32();
            const cond = pop();
            if (!cond) pc += rel;
            break;
          }
          case OP.JUMP_IF_TRUE: {
            const rel = i32();
            const cond = pop();
            if (cond) pc += rel;
            break;
          }
          case OP.DUP: {
            const top = stack[stack.length - 1];
            push(top);
            break;
          }
          case OP.POP: {
            pop();
            break;
          }
          case OP.HALT: {
            return;
          }
          case OP.ADD_I: {
            const b = pop(), a = pop();
            push(BigInt.asIntN(64, BigInt(a) + BigInt(b)));
            break;
          }
          case OP.SUB_I: {
            const b = pop(), a = pop();
            push(BigInt.asIntN(64, BigInt(a) - BigInt(b)));
            break;
          }
          case OP.MUL_I: {
            const b = pop(), a = pop();
            push(BigInt.asIntN(64, BigInt(a) * BigInt(b)));
            break;
          }
          case OP.DIV_I: {
            const b = pop(), a = pop();
            if (BigInt(b) === 0n) throw new Error('integer division by zero');
            push(BigInt.asIntN(64, BigInt(a) / BigInt(b)));
            break;
          }
          case OP.MOD_I: {
            const b = pop(), a = pop();
            if (BigInt(b) === 0n) throw new Error('integer remainder by zero');
            push(BigInt.asIntN(64, BigInt(a) % BigInt(b)));
            break;
          }
          case OP.ADD_F: {
            const b = pop(), a = pop();
            push(Number(a) + Number(b));
            break;
          }
          case OP.SUB_F: {
            const b = pop(), a = pop();
            push(Number(a) - Number(b));
            break;
          }
          case OP.MUL_F: {
            const b = pop(), a = pop();
            push(Number(a) * Number(b));
            break;
          }
          case OP.DIV_F: {
            const b = pop(), a = pop();
            push(Number(a) / Number(b));
            break;
          }
          case OP.NEG_I: {
            const a = pop();
            push(BigInt.asIntN(64, -BigInt(a)));
            break;
          }
          case OP.NEG_F: {
            const a = pop();
            push(-Number(a));
            break;
          }
          case OP.LT_I: {
            const b = pop(), a = pop();
            push(BigInt(a) < BigInt(b));
            break;
          }
          case OP.LE_I: {
            const b = pop(), a = pop();
            push(BigInt(a) <= BigInt(b));
            break;
          }
          case OP.GT_I: {
            const b = pop(), a = pop();
            push(BigInt(a) > BigInt(b));
            break;
          }
          case OP.GE_I: {
            const b = pop(), a = pop();
            push(BigInt(a) >= BigInt(b));
            break;
          }
          case OP.LT_F: {
            const b = pop(), a = pop();
            push(Number(a) < Number(b));
            break;
          }
          case OP.LE_F: {
            const b = pop(), a = pop();
            push(Number(a) <= Number(b));
            break;
          }
          case OP.GT_F: {
            const b = pop(), a = pop();
            push(Number(a) > Number(b));
            break;
          }
          case OP.GE_F: {
            const b = pop(), a = pop();
            push(Number(a) >= Number(b));
            break;
          }
          case OP.I2F: {
            const a = pop();
            push(Number(a));
            break;
          }
          case OP.CONCAT: {
            const b = pop(), a = pop();
            push(String(a) + String(b));
            break;
          }
          case OP.I2S: {
            const a = pop();
            push(String(a));
            break;
          }
          case OP.F2S: {
            const a = pop();
            push(String(a));
            break;
          }
          case OP.B2S: {
            const a = pop();
            push(String(a));
            break;
          }
          case OP.FOR_RANGE: {
            const counterSlot = u16();
            const endSlot = u16();
            const exitRel = i32();
            const finish = pop();
            const begin = pop();
            locals[endSlot] = BigInt(finish);
            locals[counterSlot] = BigInt(begin);
            if (locals[counterSlot] >= locals[endSlot]) {
              pc += exitRel;
            }
            break;
          }
          case OP.FOR_NEXT: {
            const endSlot = u16();
            const backRel = i32();
            const counterSlot = endSlot - 1;
            locals[counterSlot] = BigInt.asIntN(64, locals[counterSlot] + 1n);
            if (locals[counterSlot] < locals[endSlot]) {
              pc += backRel;
            }
            break;
          }
          case OP.MATH: {
            const fnId = u8();
            const arity = MATH_ARITY[fnId];
            const margs = new Array(arity);
            for (let i = arity - 1; i >= 0; i--) margs[i] = pop();
            push(MATH_FNS[fnId](...margs));
            break;
          }
          case OP.WHILE_BEGIN: {
            break;
          }
          case OP.WHILE_TEST: {
            const exitRel = i32();
            const cond = pop();
            if (!cond) pc += exitRel;
            break;
          }
          case OP.LOOP_BACK: {
            const backRel = i32();
            pc += backRel;
            break;
          }
          default: {
            throw new Error(`unknown opcode 0x${op.toString(16)} at pc ${currentInsnPc}`);
          }
        }
      } catch (err) {
        const lineInfo = this.getLine(currentInsnPc);
        err.line = lineInfo.line;
        err.column = lineInfo.column;
        throw checkBrowserError(err);
      }
    }
  }
}

export async function executeDslFile(filePath) {
  let web = null;
  const report = new Report();
  try {
    let bytes;
    try {
      bytes = readFileSync(filePath);
    } catch (e) {
      const err = new Error(`cannot read bytecode file: ${e.message}`);
      err.phase = 'load';
      err.code = 'LOAD_BAD_BYTECODE';
      throw err;
    }

    const program = Program.load(bytes);
    web = new Web();

    await program.run({ web, report });

    // Output success envelope
    process.stdout.write('LMCODE_RETURN_BEGIN\n{"ok":true,"result":null}\nLMCODE_RETURN_END\n');
    return 0;
  } catch (err) {
    const isApp = Boolean(err.isAppFailure);
    const phase = err.phase || (isApp ? 'app' : 'run');
    const code = err.code || (isApp ? 'APP_FAIL' : 'RUN_HOST');
    const exitCode = isApp ? 4 : 3;

    const payload = {
      ok: false,
      phase,
      code,
      message: err.message,
    };
    if (err.line && err.line > 0) payload.line = err.line;
    if (err.column && err.column > 0) payload.column = err.column;

    process.stdout.write(`LMCODE_RETURN_BEGIN\n${JSON.stringify(payload)}\nLMCODE_RETURN_END\n`);
    return exitCode;
  } finally {
    if (web) {
      try { await web.close(); } catch {}
    }
  }
}
