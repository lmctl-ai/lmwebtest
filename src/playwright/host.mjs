/**
 * lmcode host for Playwright: `lmwebtest playwright --lmcode FILE`.
 *
 * The lmcode VM (lmcode-js) is synchronous. Playwright is async and runs in a
 * worker thread (worker.js); every host call is a blocking round trip.
 */

import { existsSync, readFileSync } from 'node:fs';
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import path from 'node:path';
import { pathToFileURL } from "node:url";

import * as vendoredRuntime from './lmcode-js/src/index.mjs';
import methods from './methods.cjs';

const { HANDLE_TYPES, FUNCTIONS, table, buildSchema } = methods;

const usage = 'usage: --lmcode-schema [--json] | --lmcode-signatures | --lmcode FILE ...';

export const schemaBytes = Buffer.from(JSON.stringify(buildSchema(), null, 2) + '\n');

/** The lmcode-js runtime: $LMCODE_JS if set, else the vendored snapshot (bundled into the executable). */
async function loadRuntime() {
  if (process.env.LMCODE_JS) {
    const entry = path.join(path.resolve(process.env.LMCODE_JS), 'src', 'index.mjs');
    if (!existsSync(entry))
      throw new Error(`LMCODE_JS=${process.env.LMCODE_JS} has no src/index.mjs`);
    return import(pathToFileURL(entry).href);
  }
  return vendoredRuntime;
}

class Bridge {
  constructor() {
    this.sab = new SharedArrayBuffer(4);
    this.flag = new Int32Array(this.sab);
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.worker = new Worker(new URL(typeof Bun !== 'undefined' ? './playwright/worker.cjs' : './worker.cjs', import.meta.url), {
      workerData: { sab: this.sab, port: port2 },
      transferList: [port2],
    });
  }

  /** Let the worker boot (Bun needs an event-loop turn on this thread) before any blocking call.
   *  When compiled with `bun build --compile src/cli.js src/playwright/worker.cjs`, the worker is an embedded entrypoint. */
  ready() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Playwright worker did not start')), 30000);
      this.port.once('message', () => { clearTimeout(timer); resolve(); });
      this.worker.once('error', reject);
    });
  }

  call(msg) {
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage(msg);
    for (;;) {
      Atomics.wait(this.flag, 0, 0, 1000);
      if (Atomics.load(this.flag, 0) !== 0)
        break;
    }
    const received = receiveMessageOnPort(this.port);
    if (!received)
      throw new Error('Playwright worker exited unexpectedly');
    const reply = received.message;
    if (!reply.ok)
      throw new Error(reply.error);
    return reply.value;
  }

  async close() {
    try { this.call({ op: 'shutdown' }); } catch {}
    await this.worker.terminate();
    this.port.close();
  }
}

/** A handle as the VM sees it: plain object, wrapped in a VmObject by the registry. */
const handle = id => ({ id });

function buildRegistry(rt, bridge) {
  const registry = rt.createRegistry().context('pw', 'Playwright');
  const opts = { ints: 'number' };

  for (const type of HANDLE_TYPES) {
    for (const [name, overloads] of table.get(type)) {
      overloads.forEach((ov, ovl) => {
        const sig = `method ${type}.${name}(${ov.params.join(', ')}) -> ${ov.returns}`;
        registry.method(sig, (self, ...args) => {
          const out = bridge.call({ op: 'call', type, name, ovl, self: self?.id, args });
          if (ov.returns === 'void')
            return undefined;
          if (out && typeof out === 'object' && 'h' in out)
            return handle(out.h);
          return out;
        }, { ...opts, dry: dryFor(ov.returns) });
      });
    }
  }
  for (const f of FUNCTIONS) {
    registry.fn(`fn ${f.name}(int) -> ${f.returns}`, id => {
      const out = bridge.call({ op: 'as', id, type: f.type });
      return handle(out.h);
    }, { ...opts });
  }
  return registry;
}

function dryFor() {
  return undefined;
}

export function signatures(rt) {
  const bridge = { call() { throw new Error('not running'); } };
  return buildRegistry(rt, bridge).signatures();
}

export async function main(args) {
  let rt;
  const out = s => process.stdout.write(s);
  if (args.length === 1 && args[0] === '--lmcode-schema' || args.length === 2 && args[0] === '--lmcode-schema' && args[1] === '--json') {
    if (args.length === 2) {
      out(schemaBytes);
    } else {
      rt = await loadRuntime();
      out(signatures(rt).join('\n') + '\n');
    }
    return 0;
  }
  rt = await loadRuntime();
  if (args.length === 1 && args[0] === '--lmcode-signatures') {
    out(signatures(rt).join('\n') + '\n');
    return 0;
  }

  const failFrame = (phase, error) => {
    const result = rt.failureFrame(phase, error);
    out(result.frame);
    return result.code;
  };

  const files = [];
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== '--lmcode' || i + 1 >= args.length)
      return failFrame('cli', new rt.LmcodeError('CLI_USAGE', usage));
    files.push(args[i + 1]);
  }
  if (!files.length)
    return failFrame('cli', new rt.LmcodeError('CLI_USAGE', usage));

  let results;
  try {
    results = rt.InvocationResults.fromCommand(files);
  } catch (error) {
    return failFrame('cli', error);
  }

  const bridge = new Bridge();
  try {
    await bridge.ready();
    const registry = buildRegistry(rt, bridge);
    const context = new rt.Context({ pw: {} });
    context.setDry(results.dryMode());
    const contract = rt.resultContractFromSchema(schemaBytes);
    for (const { file, index } of results.registrationsCopy()) {
      let phase = 'load';
      try {
        const program = rt.Program.load(readFileSync(file), schemaBytes, registry);
        results.select(index, registry, contract);
        phase = 'run';
        program.run(context);
        results.complete(index);
      } catch (error) {
        results.fail(index, phase, error);
        break;
      }
    }
  } finally {
    await bridge.close();
  }
  const frame = results.writeFrame();
  out(frame.frame);
  return frame.code;
}
