import {readFile,writeFile} from 'node:fs/promises';
import {exclusiveTimelineCpu} from './timeline-exclusive-cpu.mjs';
const path=process.argv[2];if(!path)throw Error('须指定本机Trace JSON');
const d=JSON.parse(await readFile(path,'utf8')),r=d.report;
if(r.status!=='collected'||r.eventsTruncated||r.dataLossOccurred!==false)throw Error('Trace未完整采集，拒绝当完整CPU证据');
const frames=Number.isSafeInteger(r.endState?.frameNumber)&&Number.isSafeInteger(r.startState?.frameNumber)?r.endState.frameNumber-r.startState.frameNumber:null;
const cpu=exclusiveTimelineCpu(d.traceEvents,{frames});
const report={source:path,performanceTest:false,traceOpenBegins:r.openBegins,cpu};
const out=path.replace(/\.json$/,'')+'.main-cpu.json';await writeFile(out,JSON.stringify(report,null,2));console.log(JSON.stringify({path:out,...report}));
