// 编译并执行实际BossDisplayPlugin；最小Android/Capacitor替身只验证窗口字段所有权，不模拟系统采纳。
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
const root=resolve('releases/investigation/native-boss-display'),out=join(root,'classes');
const jdk=process.env.INKWAVE_JAVA_HOME||join(homedir(),'.cache/demoink-android/ms-jdk/jdk-21.0.12.1+1');
const files={
 'android/os/Build.java':`package android.os; public class Build { public static class VERSION { public static int SDK_INT=34; } public static class VERSION_CODES { public static final int S=31; } }`,
 'android/content/pm/ApplicationInfo.java':`package android.content.pm; public class ApplicationInfo { public int category=0; }`,
 'android/app/GameManager.java':`package android.app; public class GameManager { public int mode=1; public boolean fail; public int getGameMode(){if(fail)throw new SecurityException();return mode;} }`,
 'android/content/Context.java':`package android.content; public class Context { public android.content.pm.ApplicationInfo info=new android.content.pm.ApplicationInfo(); public android.app.GameManager manager=new android.app.GameManager(); public android.content.pm.ApplicationInfo getApplicationInfo(){return info;} public <T> T getSystemService(Class<T> cls){return cls.cast(manager);} }`,
 'android/view/WindowManager.java':`package android.view; public class WindowManager { public static class LayoutParams { public float preferredRefreshRate; public int preferredDisplayModeId; } }`,
 'android/view/Display.java':`package android.view; public class Display {
 public Mode current=new Mode(2,1200,2652,120), sixty=new Mode(1,1200,2652,60); public Mode[] modes={sixty,current};
 public Mode getMode(){return current;} public Mode[] getSupportedModes(){return modes;} public float getRefreshRate(){return current.fps;}
 public static class Mode { int id,w,h; float fps; public Mode(int id,int w,int h,float fps){this.id=id;this.w=w;this.h=h;this.fps=fps;}
 public int getModeId(){return id;} public int getPhysicalWidth(){return w;} public int getPhysicalHeight(){return h;} public float getRefreshRate(){return fps;} } }`,
 'android/view/View.java':`package android.view; public class View { public Display display=new Display(); public Display getDisplay(){return display;} }`,
 'android/view/Window.java':`package android.view; public class Window { public WindowManager.LayoutParams attrs=new WindowManager.LayoutParams(); public View decor=new View(); public int writes;
 public WindowManager.LayoutParams getAttributes(){return attrs;} public View getDecorView(){return decor;} public void setAttributes(WindowManager.LayoutParams p){attrs=p;writes++;} }`,
 'android/app/Activity.java':`package android.app; public class Activity extends android.content.Context { public android.view.Window window=new android.view.Window(); public android.view.Window getWindow(){return window;} public boolean isFinishing(){return false;} public void runOnUiThread(Runnable r){r.run();} }`,
 'com/getcapacitor/JSObject.java':`package com.getcapacitor; public class JSObject extends java.util.HashMap<String,Object> { }`,
 'com/getcapacitor/Plugin.java':`package com.getcapacitor; public class Plugin { private android.app.Activity activity=new android.app.Activity(); public android.app.Activity getActivity(){return activity;} public android.content.Context getContext(){return activity;} protected void handleOnPause(){} protected void handleOnResume(){} protected void handleOnDestroy(){} }`,
 'com/getcapacitor/PluginCall.java':`package com.getcapacitor; public class PluginCall { public boolean active; public JSObject value; public PluginCall(boolean active){this.active=active;} public Boolean getBoolean(String key,boolean fallback){return active;} public void resolve(JSObject v){value=v;} public void reject(String reason){throw new RuntimeException(reason);} }`,
 'com/getcapacitor/PluginMethod.java':`package com.getcapacitor; public @interface PluginMethod { }`,
 'com/getcapacitor/annotation/CapacitorPlugin.java':`package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }`,
 'com/demoink/inkwave/BossDisplayTest.java':`package com.demoink.inkwave;
 import android.view.*; import com.getcapacitor.*;
 public class BossDisplayTest {
 static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);}
 static JSObject set(BossDisplayPlugin p,boolean active){PluginCall c=new PluginCall(active);p.setBossActive(c);return c.value;}
 static BossDisplayPlugin make(){BossDisplayPlugin p=new BossDisplayPlugin();p.handleOnResume();return p;}
 public static void main(String[] args){
 BossDisplayPlugin p=make();Window w=p.getActivity().getWindow();w.attrs.preferredRefreshRate=90;
 JSObject s=set(p,true);check(w.attrs.preferredDisplayModeId==1&&w.attrs.preferredRefreshRate==60,"same resolution mode request");
 check((float)s.get("observedRefreshRate")==120&&(int)s.get("observedModeId")==2,"request must not pretend adoption");
 check((int)s.get("observedWidth")==1200&&(int)s.get("observedHeight")==2652,"physical resolution unchanged");
 int writes=w.writes;set(p,true);check(w.writes==writes,"repeated request changed attributes");
 p.handleOnPause();check(w.attrs.preferredDisplayModeId==0&&w.attrs.preferredRefreshRate==90,"pause restore both fields");
 p.handleOnResume();check(w.attrs.preferredDisplayModeId==1&&w.attrs.preferredRefreshRate==60,"resume reapply");
 p.handleOnDestroy();check(w.attrs.preferredDisplayModeId==0&&w.attrs.preferredRefreshRate==90,"destroy restore");
 p=make();w=p.getActivity().getWindow();w.attrs.preferredDisplayModeId=99;w.attrs.preferredRefreshRate=90;
 s=set(p,true);check(w.writes==0&&w.attrs.preferredDisplayModeId==99&&w.attrs.preferredRefreshRate==90&&s.get("reason").equals("existing-display-mode-preference"),"existing preference ownership");
 p=make();w=p.getActivity().getWindow();w.decor.display.modes=new Display.Mode[]{new Display.Mode(3,1440,3200,60),w.decor.display.current};
 s=set(p,true);check(w.writes==0&&s.get("reason").equals("no-same-resolution-60hz"),"never choose different resolution");
 p=make();w=p.getActivity().getWindow();w.decor.display.modes=new Display.Mode[]{w.decor.display.current};check(!(boolean)set(p,true).get("owned")&&w.writes==0,"missing mode fallback");
 p=make();w=p.getActivity().getWindow();w.decor.display=null;check(!(boolean)set(p,true).get("owned")&&w.writes==0,"missing display fallback");
 p=make();w=p.getActivity().getWindow();set(p,true);w.attrs.preferredDisplayModeId=77;w.attrs.preferredRefreshRate=75;set(p,false);
 check(w.attrs.preferredDisplayModeId==77&&w.attrs.preferredRefreshRate==75,"external change not overwritten");
 p=make();w=p.getActivity().getWindow();w.attrs.preferredRefreshRate=90;set(p,true);w.attrs.preferredRefreshRate=75;set(p,false);
 check(w.attrs.preferredDisplayModeId==0&&w.attrs.preferredRefreshRate==75,"restore mode ownership independently");
 p=make();w=p.getActivity().getWindow();w.attrs.preferredRefreshRate=90;set(p,true);w.attrs.preferredDisplayModeId=77;set(p,false);
 check(w.attrs.preferredDisplayModeId==77&&w.attrs.preferredRefreshRate==90,"restore rate ownership independently");
 p=make();w=p.getActivity().getWindow();w.decor.display.modes=new Display.Mode[]{new Display.Mode(3,1200,2652,59.94f),w.decor.display.sixty,w.decor.display.current};
 check((int)set(p,true).get("requestedModeId")==1,"closest supported 60Hz mode");
 writes=w.writes;PluginCall query=new PluginCall(false);p.getState(query);check(w.writes==writes&&query.value.get("reason").equals("query"),"getState read only");
 p=new BossDisplayPlugin();w=p.getActivity().getWindow();set(p,true);check(w.writes==0,"background request not applied");p.handleOnResume();check(w.attrs.preferredDisplayModeId==1,"deferred foreground request");
 query=new PluginCall(false);p.getState(query);check((int)query.value.get("applicationCategory")==0&&(int)query.value.get("gameMode")==1,"game identity read only");
 android.os.Build.VERSION.SDK_INT=29;query=new PluginCall(false);p.getState(query);check(!query.value.containsKey("gameMode"),"pre31 never query GameManager");
 android.os.Build.VERSION.SDK_INT=34;p.getActivity().manager=null;query=new PluginCall(false);p.getState(query);check((int)query.value.get("gameMode")==0,"missing GameManager fallback");
 p.getActivity().manager=new android.app.GameManager();p.getActivity().manager.fail=true;query=new PluginCall(false);p.getState(query);check(query.value.get("gameModeQueryError").equals("SecurityException"),"GameManager exception must not interrupt lifecycle");
 System.out.println("通过：实际Java插件同分辨率选择/不伪称采纳/暂停恢复/销毁/已有偏好/逐字段所有权/缺失回退/只读状态；系统采纳仍需真机");
 } }`,
};
await mkdir(out,{recursive:true});
for(const [name,source] of Object.entries(files)){const path=join(root,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,source);}
const sources=Object.keys(files).map(name=>join(root,name));sources.push(resolve('android/app/src/main/java/com/demoink/inkwave/BossDisplayPlugin.java'));
execFileSync(join(jdk,'bin/javac.exe'),['-encoding','UTF-8','-d',out,...sources],{stdio:'inherit'});
execFileSync(join(jdk,'bin/java.exe'),['-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-Dstderr.encoding=UTF-8','-cp',out,'com.demoink.inkwave.BossDisplayTest'],{stdio:'inherit'});
