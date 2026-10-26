package com.demoink.inkwave;

import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// 仅调整本游戏窗口的刷新偏好，不写手机全局设置，不改显示分辨率或Canvas清晰度。
@CapacitorPlugin(name = "BossDisplay")
public class BossDisplayPlugin extends Plugin {
    private boolean requested, owned, foreground;
    private float savedRefreshRate;

    private JSObject apply(boolean active) {
        Window window = getActivity().getWindow();
        WindowManager.LayoutParams params = window.getAttributes();
        Display display = window.getDecorView().getDisplay();
        String reason = "restored";
        if (!active) {
            // 仅还原自己改过的字段；外部若已换值，不覆盖别人的窗口策略。
            if (owned && Math.abs(params.preferredRefreshRate - 60f) < 0.01f) {
                params.preferredRefreshRate = savedRefreshRate;
                window.setAttributes(params);
            }
            owned = false;
        } else if (!owned) {
            boolean supported = false;
            if (display != null) for (Display.Mode mode : display.getSupportedModes()) {
                if (Math.abs(mode.getRefreshRate() - 60f) < 0.5f
                        && mode.getPhysicalWidth() == display.getMode().getPhysicalWidth()
                        && mode.getPhysicalHeight() == display.getMode().getPhysicalHeight()) supported = true;
            }
            // 指定模式ID会覆盖preferredRefreshRate；不撤销既有模式/分辨率偏好。
            if (!supported) reason = "no-same-resolution-60hz";
            else if (params.preferredDisplayModeId != 0) reason = "existing-display-mode-preference";
            else {
                savedRefreshRate = params.preferredRefreshRate;
                params.preferredRefreshRate = 60f;
                window.setAttributes(params); owned = true; reason = "requested-60hz";
            }
        } else reason = "already-requested";
        return state(reason);
    }

    private JSObject state(String reason) {
        Window window = getActivity().getWindow();
        Display display = window.getDecorView().getDisplay();
        JSObject result = new JSObject();
        result.put("requested", requested); result.put("owned", owned); result.put("foreground", foreground); result.put("reason", reason);
        result.put("preferredRefreshRate", window.getAttributes().preferredRefreshRate);
        result.put("savedRefreshRate", savedRefreshRate);
        result.put("observedRefreshRate", display == null ? 0 : display.getRefreshRate());
        // 系统可忽略偏好，observed只是调用当时的值，不能作为已切换/提帧证明。
        return result;
    }

    // 只读状态供真机检查，不能把窗口请求回执误当成屏幕实际刷新率。
    @PluginMethod
    public void getState(PluginCall call) { getActivity().runOnUiThread(() -> call.resolve(state("query"))); }

    @PluginMethod
    public void setBossActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        getActivity().runOnUiThread(() -> {
            if (getActivity().isFinishing()) { call.reject("窗口正在退出"); return; }
            requested = active;
            call.resolve(apply(active && foreground));
        });
    }

    @Override
    protected void handleOnPause() { foreground = false; apply(false); }

    @Override
    protected void handleOnResume() { foreground = true; if (requested) apply(true); }

    @Override
    protected void handleOnDestroy() { foreground = false; requested = false; apply(false); }
}
