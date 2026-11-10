// Behavioral checks shared by the physics CLI and its adversarial fixtures.
async function perceptible(locator) {
  if (!await locator.isVisible()) return false;
  return locator.evaluate(el => {
    const rect=el.getBoundingClientRect();
    if(rect.width<1 || rect.height<1) return false;
    for(let node=el;node;node=node.parentElement) {
      const style=getComputedStyle(node);
      if(Number(style.opacity)<.05 || style.visibility==='hidden' || style.display==='none' || style.contentVisibility==='hidden') return false;
    }
    const color=getComputedStyle(el).color;
    return !/rgba\([^)]*,\s*0\)/.test(color) && color!=='transparent';
  });
}
export async function workedReplay(scope, {player = '.mb-player', steps = '.bb-step', line = '.bb-line', note = '.bb-note'} = {}) {
  const board = scope.locator(player).first();
  await board.waitFor({state: 'visible', timeout: 4000});
  const step = board.getByRole('button', {name: 'Step', exact: true});
  const snapshots = [];
  for (let i = 0; i < 100; i++) {
    const rows = board.locator(steps);
    const contents = [];
    for (let r = 0; r < await rows.count(); r++) {
      const row = rows.nth(r);
      if (!await perceptible(row)) throw Error('Worked step is hidden');
      const equation = row.locator(line).first(), caption = row.locator(note).first();
      if (!await perceptible(equation) || !await perceptible(caption)) throw Error('Worked equation or explanation is hidden');
      const eq = (await equation.textContent()).trim(), text = (await caption.innerText()).trim();
      if (!eq || !text) throw Error('Worked equation or explanation is empty');
      contents.push({equation: eq, explanation: text});
    }
    snapshots.push(contents);
    if (await step.isDisabled()) {
      if (contents.length < 4) throw Error('Worked solution needs the law, substitution, calculation and check');
      if (!snapshots.some((s, i) => i && s.length > snapshots[i-1].length)) throw Error('Worked replay never advances step by step');
      return contents;
    }
    const count = contents.length;
    await step.click(); // Stops autoplay as well as advancing the shared player.
    await scope.page().waitForFunction(({element, selector, count}) => element.querySelectorAll(selector).length > count, {element: await board.elementHandle(), selector: steps, count}, {timeout: 4000});
  }
  throw Error('Worked replay did not finish within 100 steps');
}

export function splitAnswer(answer) {
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+(.+?)\s*$/i.exec(answer);
  if (!match || !Number.isFinite(Number(match[1]))) throw Error('Worked answer must have a finite numeric value and explicit unit');
  return {value: Number(match[1]), unit: match[2]};
}

export async function quantitySolver(root, replay, {parameter = '[data-quantity-parameter]', result = '[data-quantity-result]', calculate = '[data-action="calculate"]', observe, scenarios = []} = {}) {
  const output = root.locator(result).first();
  if (!await perceptible(output)) throw Error('Quantity result is hidden');
  const answerText = text => text.split(/[=:]/).at(-1).trim();
  const before = (await output.innerText()).trim(); splitAnswer(answerText(before));
  const initialObservation = observe ? await observe() : null;
  const originalSteps = await replay(root);
  const inputs = root.locator(parameter), apply = root.locator(calculate);
  const update = async (input, value) => {
    await input.fill(value); await input.dispatchEvent('change');
    if (await apply.count()) await apply.first().click();
  };
  if (!await inputs.count()) throw Error('Quantity solver has no editable parameters');
  for (let i = 0; i < await inputs.count(); i++) {
    const input = inputs.nth(i), raw = await input.inputValue(), initial = Number(raw);
    if (!await input.isVisible() || !await input.isEnabled() || !Number.isFinite(initial)) continue;
    const min = Number(await input.getAttribute('min') ?? '-Infinity'), max = Number(await input.getAttribute('max') ?? 'Infinity');
    const delta = Math.max(1, Math.abs(initial) * .1);
    for (const next of [...new Set([initial+delta,initial-delta,initial+2*delta,initial-2*delta,initial+10*delta,initial-10*delta,initial+1,initial-1])].filter(n=>n>=min&&n<=max)) {
      await update(input,String(next));
      const after = (await output.innerText()).trim();
      if (after !== before) {
        splitAnswer(answerText(after));
        if (observe && JSON.stringify(await observe()) === JSON.stringify(initialObservation)) throw Error('Static model canvas did not reflect changed parameters');
        const changedSteps = await replay(root);
        if (JSON.stringify(changedSteps) === JSON.stringify(originalSteps)) throw Error('Quantity output changed but worked steps did not');
        await update(input,raw);
        if ((await output.innerText()).trim() !== before) throw Error('Quantity result did not restore with original parameters');
        return {before, after, originalSteps, changedSteps};
      }
      await update(input,raw);
    }
  }
  // Optional valid givens from a source/author scenario file contain inputs only,
  // never expected results. They cover discrete gates and constrained domains.
  const scenarioNames = await inputs.evaluateAll(els=>els.map(el=>el.name));
  const originals = await Promise.all(Array.from({length:await inputs.count()},(_,i)=>inputs.nth(i).inputValue()));
  const setScenario = async given => {
    for(const [name,value] of Object.entries(given)) {
      const i=scenarioNames.indexOf(name);
      if(i<0 || !Number.isFinite(value)) throw Error('Invalid named quantity scenario');
      await inputs.nth(i).fill(String(value));
    }
    if(await apply.count()) await apply.first().click();
    else for(const name of Object.keys(given)) await inputs.nth(scenarioNames.indexOf(name)).dispatchEvent('change');
  };
  const restore = async()=>{
    for(let i=0;i<originals.length;i++) await inputs.nth(i).fill(originals[i]);
    if(await apply.count()) await apply.first().click();
    else for(let i=0;i<originals.length;i++) await inputs.nth(i).dispatchEvent('change');
  };
  for(const given of scenarios) {
    await setScenario(given);
    let applied=true;
    for(const [name,value] of Object.entries(given))if(Number(await inputs.nth(scenarioNames.indexOf(name)).inputValue())!==value)applied=false;
    if(!applied){await restore();continue;}
    const after=(await output.innerText()).trim();
    if(after!==before) {
      splitAnswer(answerText(after));
      if(observe&&JSON.stringify(await observe())===JSON.stringify(initialObservation)) throw Error('Static model canvas did not reflect changed parameters');
      const changedSteps=await replay(root);
      if(JSON.stringify(changedSteps)===JSON.stringify(originalSteps)) throw Error('Quantity output changed but worked steps did not');
      await restore();
      if((await output.innerText()).trim()!==before) throw Error('Quantity result did not restore with original parameters');
      return {before,after,originalSteps,changedSteps,interaction:'declared valid-input scenario',given};
    }
    await restore();
  }
  // The finite real-state UI applies coupled givens together. A normalized
  // amplitude pair cannot be tested by changing either coordinate alone.
  const names = await inputs.evaluateAll(els => els.map(el=>el.name));
  if (await apply.count() && names.includes('a') && names.includes('b')) {
    const ai = inputs.nth(names.indexOf('a')), bi = inputs.nth(names.indexOf('b'));
    const ar = await ai.inputValue(), br = await bi.inputValue();
    for (const [av,bv] of [[1,0],[0,1],[.6,.8],[.8,.6]]) {
      await ai.fill(String(av)); await bi.fill(String(bv)); await apply.first().click();
      const after=(await output.innerText()).trim();
      if(after!==before) {
        splitAnswer(answerText(after));
        const changedSteps=await replay(root);
        if(JSON.stringify(changedSteps)===JSON.stringify(originalSteps)) throw Error('Quantity output changed but worked steps did not');
        await ai.fill(ar); await bi.fill(br); await apply.first().click();
        if((await output.innerText()).trim()!==before) throw Error('Quantity result did not restore with original parameters');
        return {before,after,originalSteps,changedSteps,interaction:'coordinated normalized real amplitudes'};
      }
    }
    await ai.fill(ar); await bi.fill(br); await apply.first().click();
  }
  throw Error('Quantity parameters do not change the calculated result');
}
