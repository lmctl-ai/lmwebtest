import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';

export class StrList {
  constructor(items = []) {
    this._items = [...items];
  }
  len() { return BigInt(this._items.length); }
  at(idx) {
    const i = Number(idx);
    if (i < 0 || i >= this._items.length) throw new Error(`StrList index out of range: ${i}`);
    return this._items[i];
  }
  add(item) { this._items.push(String(item)); return this; }
  set(idx, item) {
    const i = Number(idx);
    if (i < 0 || i >= this._items.length) throw new Error(`StrList index out of range: ${i}`);
    this._items[i] = String(item);
    return this;
  }
  clear() { this._items = []; return this; }
  contains(item) { return this._items.includes(String(item)); }
  index_of(item) { return BigInt(this._items.indexOf(String(item))); }
  join(sep) { return this._items.join(String(sep)); }
}

export class IntList {
  constructor(items = []) {
    this._items = items.map(BigInt);
  }
  len() { return BigInt(this._items.length); }
  at(idx) {
    const i = Number(idx);
    if (i < 0 || i >= this._items.length) throw new Error(`IntList index out of range: ${i}`);
    return this._items[i];
  }
  add(item) { this._items.push(BigInt(item)); return this; }
  set(idx, item) {
    const i = Number(idx);
    if (i < 0 || i >= this._items.length) throw new Error(`IntList index out of range: ${i}`);
    this._items[i] = BigInt(item);
    return this;
  }
  clear() { this._items = []; return this; }
  contains(item) { return this._items.includes(BigInt(item)); }
  index_of(item) {
    const target = BigInt(item);
    return BigInt(this._items.findIndex(x => x === target));
  }
}

export class FloatList {
  constructor(items = []) {
    this._items = items.map(Number);
  }
  len() { return BigInt(this._items.length); }
  at(idx) {
    const i = Number(idx);
    if (i < 0 || i >= this._items.length) throw new Error(`FloatList index out of range: ${i}`);
    return this._items[i];
  }
  add(item) { this._items.push(Number(item)); return this; }
  set(idx, item) {
    const i = Number(idx);
    if (i < 0 || i >= this._items.length) throw new Error(`FloatList index out of range: ${i}`);
    this._items[i] = Number(item);
    return this;
  }
  clear() { this._items = []; return this; }
  contains(item) { return this._items.includes(Number(item)); }
  index_of(item) {
    const target = Number(item);
    return BigInt(this._items.indexOf(target));
  }
}

export class StrMap {
  constructor() {
    this._map = new Map();
  }
  len() { return BigInt(this._map.size); }
  has(k) { return this._map.has(String(k)); }
  get(k) {
    const val = this._map.get(String(k));
    if (val === undefined) throw new Error(`StrMap key not found: ${k}`);
    return val;
  }
  get_or(k, fallback) {
    const val = this._map.get(String(k));
    return val !== undefined ? val : String(fallback);
  }
  set(k, v) { this._map.set(String(k), String(v)); return this; }
  remove(k) { return this._map.delete(String(k)); }
  clear() { this._map.clear(); return this; }
  key_at(idx) {
    const i = Number(idx);
    const keys = Array.from(this._map.keys());
    if (i < 0 || i >= keys.length) throw new Error(`StrMap key index out of range: ${i}`);
    return keys[i];
  }
}

export class Report {
  constructor() {
    this.entries = [];
  }
  add(category, target, line, message) {
    this.entries.push({
      category: String(category),
      target: String(target),
      line: Number(line),
      message: String(message),
    });
  }
  fail_if_any() {
    if (this.entries.length > 0) {
      const err = new Error(`Report contains ${this.entries.length} findings: ${this.entries[0].message}`);
      err.isAppFailure = true;
      throw err;
    }
  }
  write_json(path) {
    writeFileSync(path, JSON.stringify(this.entries, null, 2) + '\n', 'utf8');
  }
  write_text(path) {
    const text = this.entries.map(e => `[${e.category}] ${e.target}:${e.line}: ${e.message}`).join('\n') + '\n';
    writeFileSync(path, text, 'utf8');
  }
}

export function registerStdFns(reg) {
  reg.set('fn print(string) -> void', (text) => {
    process.stdout.write(text + '\n');
  });

  reg.set('fn assert_close(float, float, float) -> void', (a, b, tol) => {
    if (Math.abs(Number(a) - Number(b)) > Number(tol)) {
      throw new Error(`assert_close failed: |${a} - ${b}| > ${tol}`);
    }
  });

  reg.set('fn file_read(string) -> string', (path) => readFileSync(path, 'utf8'));
  reg.set('fn file_write(string, string) -> void', (path, content) => writeFileSync(path, content, 'utf8'));
  reg.set('fn file_append(string, string) -> void', (path, content) => appendFileSync(path, content, 'utf8'));
  reg.set('fn file_exists(string) -> bool', (path) => existsSync(path));
  reg.set('fn file_lines(string) -> StrList', (path) => {
    const content = readFileSync(path, 'utf8');
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return new StrList(lines);
  });

  reg.set('fn str_list() -> StrList', () => new StrList());
  reg.set('fn int_list() -> IntList', () => new IntList());
  reg.set('fn float_list() -> FloatList', () => new FloatList());
  reg.set('fn str_map() -> StrMap', () => new StrMap());

  // String helpers
  reg.set('fn str_len(string) -> int', (s) => BigInt(s.length));
  reg.set('fn str_lower(string) -> string', (s) => s.toLowerCase());
  reg.set('fn str_upper(string) -> string', (s) => s.toUpperCase());
  reg.set('fn str_trim(string) -> string', (s) => s.trim());
  reg.set('fn str_starts_with(string, string) -> bool', (s, prefix) => s.startsWith(prefix));
  reg.set('fn str_ends_with(string, string) -> bool', (s, suffix) => s.endsWith(suffix));
  reg.set('fn str_contains(string, string) -> bool', (s, sub) => s.includes(sub));
  reg.set('fn str_find(string, string) -> int', (s, sub) => BigInt(s.indexOf(sub)));
  reg.set('fn str_substr(string, int, int) -> string', (s, start, len) => {
    const st = Number(start);
    const ln = Number(len);
    return s.slice(st, st + ln);
  });
  reg.set('fn str_replace(string, string, string) -> string', (s, from, to) => s.replaceAll(from, to));
  reg.set('fn str_repeat(string, int) -> string', (s, count) => s.repeat(Number(count)));
  reg.set('fn str_split(string, string) -> StrList', (s, sep) => new StrList(s.split(sep)));
  reg.set('fn str_match(string, string) -> bool', (s, pattern) => new RegExp(pattern).test(s));
  reg.set('fn str_to_int(string) -> int', (s) => BigInt(parseInt(s, 10)));
  reg.set('fn str_to_float(string) -> float', (s) => parseFloat(s));
  reg.set('fn str_is_int(string) -> bool', (s) => /^-?[0-9]+$/.test(s.trim()));
  reg.set('fn str_is_float(string) -> bool', (s) => !Number.isNaN(parseFloat(s)) && Number.isFinite(parseFloat(s)));

  // Math helpers
  reg.set('fn math_abs(float) -> float', (x) => Math.abs(x));
  reg.set('fn math_abs(int) -> int', (x) => (x < 0n ? -x : x));
  reg.set('fn math_floor(float) -> float', (x) => Math.floor(x));
  reg.set('fn math_floor(int) -> int', (x) => x);
  reg.set('fn math_ceil(float) -> float', (x) => Math.ceil(x));
  reg.set('fn math_ceil(int) -> int', (x) => x);
  reg.set('fn math_round(float) -> float', (x) => Math.round(x));
  reg.set('fn math_round(int) -> int', (x) => x);
  reg.set('fn math_sqrt(float) -> float', (x) => Math.sqrt(x));
  reg.set('fn math_sqrt(int) -> int', (x) => BigInt(Math.floor(Math.sqrt(Number(x)))));
  reg.set('fn math_pow(float, float) -> float', (base, exp) => Math.pow(base, exp));
  reg.set('fn math_pow(int, int) -> int', (base, exp) => base ** exp);
  reg.set('fn math_min(float, float) -> float', (a, b) => Math.min(a, b));
  reg.set('fn math_min(int, int) -> int', (a, b) => (a < b ? a : b));
  reg.set('fn math_max(float, float) -> float', (a, b) => Math.max(a, b));
  reg.set('fn math_max(int, int) -> int', (a, b) => (a > b ? a : b));
}
