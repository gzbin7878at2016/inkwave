// 用确定性时钟验证嵌套归属、返回/异常及原方法恢复，不启动游戏或连接手机。
import assert from 'node:assert/strict';
import {createBossStageProbe} from './boss-stage-probe.mjs';
const saved=Object.getOwnPropertyDescriptor(globalThis,'performance');let tick=0;
Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>tick,timeOrigin:0}});
try{
 const character={update(){tick+=2;return 17;}},weapon={update(){tick+=3;}},bot={update(){tick+=4;}};
 const actor={character,weaponRunner:weapon,bot,update(){tick++;assert.equal(this.character.update(),17);this.weaponRunner.update();}};
 const m={actors:[actor],update(){tick++;actor.update();bot.update();}};
 const g={_updateHud(){tick++;},match:m},original=m.update;
 // 与真机工具相同，直接序列化工厂到目标执行上下文。
 const factory=(0,eval)(`(${createBossStageProbe.toString()})`),p=factory(g,{});p.bind(m);
 p.begin(true,5000,1/60);p.enterDriver();tick+=2;p.leave();p.enterGame();m.update();g._updateHud();p.leave();p.end();
 const report=p.summary(),get=label=>report.rows.find(r=>r.label===label);
 assert.equal(report.frames,1);assert.equal(get('match').totalMs,11);assert.equal(get('match').selfMs,1);
 assert.equal(get('actors').totalMs,6);assert.equal(get('actors').selfMs,1);
 assert.equal(get('gameFrame').totalMs,12);assert.equal(get('gameFrame').selfMs,0);assert.equal(get('testDirector').totalMs,2);
 // 非playing调用不计入；绑定重复实例不重复包装。
 p.bind(m);p.begin(false,0,0);m.update();p.end();assert.equal(p.summary().frames,1);
 p.dispose();assert.equal(m.update,original);p.dispose();
 const error=new Error('expected'),boom={update(){throw error;}},g2={match:null},m2={actors:[{update:boom.update}]};
 const p2=factory(g2,{});p2.bind(m2);p2.begin(true,0,0);p2.enterGame();assert.throws(()=>m2.actors[0].update(),e=>e===error);p2.leave();p2.end();
 assert.equal(p2.summary().frames,1);p2.dispose();
 console.log('通过：嵌套包含/自身时间、同名归并、非实战不计、序列化工厂、返回值/异常、幂等绑定与恢复');
}finally{Object.defineProperty(globalThis,'performance',saved);}
