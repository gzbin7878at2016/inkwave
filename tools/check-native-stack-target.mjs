import assert from 'node:assert/strict';
import {validateNativeStackTarget as validate} from './native-stack-target.mjs';
const input={serial:'PHONE123',appPid:100,forwardList:'PHONE123 tcp:9223 localabstract:webview_devtools_remote_100',markers:[{pid:200,tid:201}],ps:'USER PID TID PPID CMD\nu0 200 201 1 CrRendererMain\nu0 300 301 1 CrRendererMain'};
assert.deepEqual(validate(input),{rendererPid:200,rendererMainTid:201,appPid:100});
for(const patch of [{forwardList:'OTHER tcp:9223 localabstract:webview_devtools_remote_100'},{forwardList:'PHONE123 tcp:9223 localabstract:webview_devtools_remote_999'},{markers:[]},{markers:[{pid:200,tid:201},{pid:300,tid:301}]},{markers:[{pid:200,tid:301}]},{ps:'PID CMD\n200 CrRendererMain'},{markers:[{pid:-1,tid:201}]}])assert.throws(()=>validate({...input,...patch}));
assert.equal(validate({...input,markers:[input.markers[0],input.markers[0]]}).rendererPid,200);
console.log('通过：专用转发/唯一标记/真实线程归属及错设备错进程拒绝');
