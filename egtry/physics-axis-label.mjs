// Labels use ten significant digits. Node and browser libm can also differ by
// a few ulps; cancellation near zero must be measured against the axis span.
export function axisLabelMatches(labels,key,unit,lo,hi){
 if(![lo,hi].every(Number.isFinite))return false;
 const prefix=`${key} (${unit}): `,span=Math.max(Math.abs(lo),Math.abs(hi),Math.abs(hi-lo));
 return labels.some(label=>{
  if(!label.startsWith(prefix))return false;
  const parts=label.slice(prefix.length).split(' … ');
  if(parts.length!==2||parts.some(p=>!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(p)))return false;
  return parts.map(Number).every((actual,i)=>{
   const expected=[lo,hi][i];
   return Number.isFinite(actual)&&Math.abs(actual-expected)<=6e-10*Math.max(Math.abs(actual),Math.abs(expected))+32*Number.EPSILON*span;
  });
 });
}
