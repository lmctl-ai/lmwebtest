// Small local QA assets are buffered already; honor browser media byte ranges.
export function sendAsset(req,res,bytes,contentType='application/octet-stream'){
 const size=bytes.length,headers={'content-type':contentType,'accept-ranges':'bytes'};let start=0,end=size-1,status=200;
 // RFC 9110 section14.2: ranges apply to GET; unsupported units/sets are ignored.
 if(req.method==='GET'&&/^bytes=/i.test(req.headers.range??'')&&!req.headers.range.includes(',')){
  const match=/^bytes=(\d*)-(\d*)$/i.exec(req.headers.range);let valid=!!match&&(match[1]!==''||match[2]!=='')&&size>0;
  if(valid){if(match[1]===''){const suffix=Number(match[2]);valid=suffix>0;start=Math.max(0,size-suffix);}else{start=Number(match[1]);end=match[2]===''?size-1:Math.min(Number(match[2]),size-1);valid=Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start;}}
  if(!valid){res.writeHead(416,{...headers,'content-range':`bytes */${size}`,'content-length':0});res.end();return;}
  status=206;headers['content-range']=`bytes ${start}-${end}/${size}`;
 }
 headers['content-length']=Math.max(0,end-start+1);res.writeHead(status,headers);res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1));
}
