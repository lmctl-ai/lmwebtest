// Behavioral checks shared by the physics CLI and its adversarial fixtures.
export async function perceptible(locator, {ink = true} = {}) {
  if (!await locator.isVisible()) return false;
  return locator.evaluate((el, ink) => {
    const rect=el.getBoundingClientRect();
    if(rect.width<1 || rect.height<1) return false;
    for(let node=el;node;node=node.parentElement) {
      const style=getComputedStyle(node);
      if(Number(style.opacity)<.05 || style.visibility==='hidden' || style.display==='none' || style.contentVisibility==='hidden') return false;
    }
    if(!ink)return true;
    const rgba=text=>{const m=/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(text);return m?[Number(m[1]),Number(m[2]),Number(m[3]),m[4]===undefined?1:Number(m[4])]:null;};
    const color=getComputedStyle(el).color,foreground=rgba(color);
    if(color==='transparent'||foreground?.[3]===0)return false;
    if(!foreground)return true;
    const layers=[];for(let node=el;node;node=node.parentElement){const c=rgba(getComputedStyle(node).backgroundColor);if(c)layers.push(c);}
    let background=[255,255,255];for(const c of layers.reverse())background=background.map((v,i)=>c[i]*c[3]+v*(1-c[3]));
    return background.some((v,i)=>Math.abs(foreground[i]*foreground[3]+v*(1-foreground[3])-v)>2);
  }, ink);
}
export async function canvasPixels(canvas) {
  if(!await perceptible(canvas,{ink:false}))throw Error('Canvas is hidden');
  return canvas.evaluate(el=>{
    const ctx=el.getContext('2d');if(!ctx)throw Error('Expected Canvas 2D model');
    const bytes=ctx.getImageData(0,0,el.width,el.height).data;let hash=2166136261,varied=0;
    for(let i=0;i<bytes.length;i+=4){
      if(bytes[i]!==bytes[0]||bytes[i+1]!==bytes[1]||bytes[i+2]!==bytes[2]||bytes[i+3]!==bytes[3])varied++;
      for(let j=0;j<4;j++)hash=Math.imul(hash^bytes[i+j],16777619)>>>0;
    }
    return {hash,varied,width:el.width,height:el.height};
  });
}
export function validateWorkedText(contents) {
  for(const {equation,explanation} of contents) {
    if(/(?:=>|\$\{|\bundefined\b|\bNaN\b|\bInfinity\b|\[object Object\]|\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)/.test(equation))throw Error('Worked replay leaks code or an invalid value: '+equation);
    if(/numerical\s+(?:SI\s+)?inputs/i.test(explanation)&&!/[0-9]/.test(equation))throw Error('Numeric substitution contains no substituted numbers: '+equation);
  }
}

export async function workedReplay(scope, {player = '.mb-player', steps = '.bb-step', line = '.bb-line', note = '.bb-note',minimumSteps=4} = {}) {
  const board = scope.locator(player).first();
  await board.waitFor({state:'visible',timeout:4000});
  const step = board.getByRole('button',{name:'Step',exact:true});
  const handle=await board.elementHandle(),snapshots=[];
  for(let i=0;i<100;i++) {
    // Read one consistent DOM snapshot; avoid a protocol round trip per text node.
    const snapshot=await board.evaluate((node,selectors)=>{
      const cache=new Map();
      function visible(el) {
        if(!el)return false;
        if(cache.has(el))return cache.get(el);
        const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
        const own=rect.width>=1&&rect.height>=1&&style.display!=='none'&&style.visibility!=='hidden'&&style.contentVisibility!=='hidden'&&Number(style.opacity)>=.05;
        let ok=own;
        for(let parent=el.parentElement;ok&&parent;parent=parent.parentElement) {
          const style=getComputedStyle(parent);
          if(style.display==='none'||style.visibility==='hidden'||style.contentVisibility==='hidden'||Number(style.opacity)<.05)ok=false;
        }
        cache.set(el,ok);return ok;
      }
      // Bounding boxes and opacity alone do not detect white-on-white steps.
      // Composite ordinary CSS backgrounds from the page inward before comparing ink.
      function indistinguishableInk(el) {
        const rgba=text=>{
          const m=/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(text);
          return m?[Number(m[1]),Number(m[2]),Number(m[3]),m[4]===undefined?1:Number(m[4])]:null;
        };
        const ink=rgba(getComputedStyle(el).color);if(!ink)return false;
        const layers=[];
        for(let node=el;node;node=node.parentElement){const color=rgba(getComputedStyle(node).backgroundColor);if(color)layers.push(color);}
        let background=[255,255,255];
        for(const color of layers.reverse())background=background.map((channel,i)=>color[i]*color[3]+channel*(1-color[3]));
        return background.every((channel,i)=>Math.abs(ink[i]*ink[3]+channel*(1-ink[3])-channel)<=2);
      }
      function readable(el) {
        if(!visible(el))return false;
        const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text,seen=false;
        while(text=walker.nextNode()) {
          if(!text.textContent.trim()||text.parentElement.closest('annotation, annotation-xml, mphantom'))continue;
          seen=true;const parent=text.parentElement,color=getComputedStyle(parent).color;
          if(!visible(parent)||color==='transparent'||/rgba\([^)]*,\s*0\)/.test(color)||indistinguishableInk(parent))return false;
        }
        return seen;
      }
      const contents=[];
      for(const row of node.querySelectorAll(selectors.steps)) {
        if(!visible(row))return {error:'Worked step is hidden'};
        const equation=row.querySelector(selectors.line),caption=row.querySelector(selectors.note);
        if(!readable(equation)||!readable(caption))return {error:'Worked equation or explanation is hidden or empty'};
        contents.push({equation:equation.textContent.trim(),explanation:caption.innerText.trim()});
      }
      return {contents};
    },{steps,line,note});
    if(snapshot.error)throw Error(snapshot.error);
    const contents=snapshot.contents;validateWorkedText(contents);snapshots.push(contents);
    if(await step.isDisabled()) {
      if(contents.length<minimumSteps)throw Error('Worked solution needs the law, substitution, calculation and check');
      if(!snapshots.some((s,i)=>i&&s.length>snapshots[i-1].length))throw Error('Worked replay never advances step by step');
      return contents;
    }
    await step.click();
    await scope.page().waitForFunction(({element,selector,count})=>element.querySelectorAll(selector).length>count,{element:handle,selector:steps,count:contents.length},{timeout:4000});
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
    const step=Number(await input.getAttribute('step'));
    let delta=Number.isFinite(step)&&step>0?step:initial!==0?Math.abs(initial)*.1:Number.isFinite(min)&&Number.isFinite(max)?(max-min)/10:1;
    if(Number.isFinite(min)&&Number.isFinite(max)&&delta>max-min)delta=(max-min)/10;
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
        if(observe&&JSON.stringify(await observe())===JSON.stringify(initialObservation)) throw Error('Static model canvas did not reflect changed parameters');
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
