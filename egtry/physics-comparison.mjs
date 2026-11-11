// Optional basic overlays and explicit analytic worked comparisons implement
// the two comparison forms in the shared authoring contract. No implicit skip.
export function comparisonContract(config,hasBasic){
 if(hasBasic)return'overlay';
 const a=config.analyticComparison;
 if(!a?.limit||!a.units||!Array.isArray(a.steps)||a.steps.length<3||a.steps.some(s=>!Array.isArray(s)||s.length!==2||s.some(t=>typeof t!=='string'||!t.trim())))throw Error('Missing basic overlay or explicit analytic comparison with limit, units and three worked steps');
 return'analytic';
}
export function checkAnalyticSteps(config,steps){
 comparisonContract(config,false);
 const compact=s=>s.replace(/\s+/g,' ').trim();
 if(config.analyticComparison.steps.some(([equation,note])=>!steps.some(s=>compact(s.equation)===compact(equation)&&compact(s.explanation)===compact(note))))throw Error('Visible analytic comparison differs from the reviewed worked steps');
}
