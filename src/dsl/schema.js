import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(__dirname, '../../schema/lmwebtest.dsl.json');
// In a `bun build --compile` executable the schema is an embedded file (build.sh passes it as an entrypoint).
async function loadSchemaBytes() {
  try {
    return readFileSync(SCHEMA_PATH);
  } catch (error) {
    const embedded = typeof Bun !== 'undefined' && Bun.embeddedFiles.find(f => /lmwebtest\.dsl/.test(f.name));
    if (!embedded) throw error;
    return Buffer.from(await embedded.arrayBuffer());
  }
}
export const SCHEMA_BYTES = await loadSchemaBytes();
export const SCHEMA_JSON = JSON.parse(SCHEMA_BYTES.toString('utf8'));
export const SCHEMA_SHA256 = createHash('sha256').update(SCHEMA_BYTES).digest();

export function getSchemaSummary() {
  const lines = [];
  // Contexts
  if (SCHEMA_JSON.context) {
    for (const [name, type] of Object.entries(SCHEMA_JSON.context)) {
      lines.push(`context ${name}: ${type}`);
    }
  }
  // Free functions
  if (SCHEMA_JSON.functions) {
    for (const [name, overloads] of Object.entries(SCHEMA_JSON.functions)) {
      for (const sig of overloads) {
        lines.push(`fn ${name}(${sig.params.join(', ')}) -> ${sig.returns}`);
      }
    }
  }
  // Methods by type
  if (SCHEMA_JSON.types) {
    for (const [typeName, typeDef] of Object.entries(SCHEMA_JSON.types)) {
      lines.push(`${typeName}:`);
      if (typeDef.methods) {
        for (const [methodName, overloads] of Object.entries(typeDef.methods)) {
          for (const sig of overloads) {
            lines.push(`  method ${typeName}.${methodName}(${sig.params.join(', ')}) -> ${sig.returns}`);
          }
        }
      }
    }
  }
  return lines.join('\n') + '\n';
}

export function getCanonicalSignatures() {
  // Canonical signatures including stdlib, matching `lmscript --dsl-signatures schema/lmwebtest.dsl.json`
  const sigs = [];

  // Contexts
  if (SCHEMA_JSON.context) {
    for (const [name, type] of Object.entries(SCHEMA_JSON.context)) {
      sigs.push(`context ${name}: ${type}`);
    }
  }

  // Std functions
  const stdFns = [
    'fn assert_close(float, float, float) -> void',
    'fn file_append(string, string) -> void',
    'fn file_exists(string) -> bool',
    'fn file_lines(string) -> StrList',
    'fn file_read(string) -> string',
    'fn file_write(string, string) -> void',
    'fn float_list() -> FloatList',
    'fn int_list() -> IntList',
    'fn math_abs(float) -> float',
    'fn math_abs(int) -> int',
    'fn math_ceil(float) -> float',
    'fn math_ceil(int) -> int',
    'fn math_floor(float) -> float',
    'fn math_floor(int) -> int',
    'fn math_max(float, float) -> float',
    'fn math_max(int, int) -> int',
    'fn math_min(float, float) -> float',
    'fn math_min(int, int) -> int',
    'fn math_pow(float, float) -> float',
    'fn math_pow(int, int) -> int',
    'fn math_round(float) -> float',
    'fn math_round(int) -> int',
    'fn math_sqrt(float) -> float',
    'fn math_sqrt(int) -> int',
    'fn print(string) -> void',
    'fn str_contains(string, string) -> bool',
    'fn str_ends_with(string, string) -> bool',
    'fn str_find(string, string) -> int',
    'fn str_is_float(string) -> bool',
    'fn str_is_int(string) -> bool',
    'fn str_len(string) -> int',
    'fn str_list() -> StrList',
    'fn str_lower(string) -> string',
    'fn str_map() -> StrMap',
    'fn str_match(string, string) -> bool',
    'fn str_repeat(string, int) -> string',
    'fn str_replace(string, string, string) -> string',
    'fn str_split(string, string) -> StrList',
    'fn str_starts_with(string, string) -> bool',
    'fn str_substr(string, int, int) -> string',
    'fn str_to_float(string) -> float',
    'fn str_to_int(string) -> int',
    'fn str_trim(string) -> string',
    'fn str_upper(string) -> string',
  ];
  sigs.push(...stdFns);

  // Std methods
  const stdMethods = [
    'method FloatList.add(float) -> FloatList',
    'method FloatList.at(int) -> float',
    'method FloatList.clear() -> FloatList',
    'method FloatList.contains(float) -> bool',
    'method FloatList.index_of(float) -> int',
    'method FloatList.len() -> int',
    'method FloatList.set(int, float) -> FloatList',
    'method IntList.add(int) -> IntList',
    'method IntList.at(int) -> int',
    'method IntList.clear() -> IntList',
    'method IntList.contains(int) -> bool',
    'method IntList.index_of(int) -> int',
    'method IntList.len() -> int',
    'method IntList.set(int, int) -> IntList',
    'method StrList.add(string) -> StrList',
    'method StrList.at(int) -> string',
    'method StrList.clear() -> StrList',
    'method StrList.contains(string) -> bool',
    'method StrList.index_of(string) -> int',
    'method StrList.join(string) -> string',
    'method StrList.len() -> int',
    'method StrList.set(int, string) -> StrList',
    'method StrMap.clear() -> StrMap',
    'method StrMap.get(string) -> string',
    'method StrMap.get_or(string, string) -> string',
    'method StrMap.has(string) -> bool',
    'method StrMap.key_at(int) -> string',
    'method StrMap.len() -> int',
    'method StrMap.remove(string) -> bool',
    'method StrMap.set(string, string) -> StrMap',
  ];

  // Host methods
  if (SCHEMA_JSON.types) {
    for (const [typeName, typeDef] of Object.entries(SCHEMA_JSON.types)) {
      if (typeDef.methods) {
        for (const [methodName, overloads] of Object.entries(typeDef.methods)) {
          for (const sig of overloads) {
            sigs.push(`method ${typeName}.${methodName}(${sig.params.join(', ')}) -> ${sig.returns}`);
          }
        }
      }
    }
  }

  sigs.push(...stdMethods);
  sigs.sort();
  return sigs.join('\n') + '\n';
}
