package com.demoink.inkwave;

import android.app.GameManager;
import android.os.Build;
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
    private int savedModeId, requestedModeId;

    private JSObject apply(boolean active) {
        Window window = getActivity().getWindow();
        WindowManager.LayoutParams params = window.getAttributes();
        Display display = window.getDecorView().getDisplay();
        String reason = "restored";
        if (!active) {
            // 仅还原自己改过的字段；外部若已换值，不覆盖别人的窗口策略。
            boolean changed = false;
            if (owned && Math.abs(params.preferredRefreshRate - 60f) < 0.01f) {
                params.preferredRefreshRate = savedRefreshRate;
                changed = true;
            }
            if (owned && params.preferredDisplayModeId == requestedModeId) {
                params.preferredDisplayModeId = savedModeId;
                changed = true;
            }
            if (changed) window.setAttributes(params);
            owned = false; requestedModeId = 0;
        } else if (!owned) {
            Display.Mode selected = null;
            if (display != null) for (Display.Mode mode : display.getSupportedModes()) {
                if (Math.abs(mode.getRefreshRate() - 60f) < 0.5f
                        && mode.getPhysicalWidth() == display.getMode().getPhysicalWidth()
                        && mode.getPhysicalHeight() == display.getMode().getPhysicalHeight()
                        && (selected == null || Math.abs(mode.getRefreshRate() - 60f) < Math.abs(selected.getRefreshRate() - 60f))) selected = mode;
            }
            // 实测单独preferredRefreshRate未被采纳；只请求同物理分辨率的60Hz模式。
            // 仍是本窗口偏好，系统可以忽略；不撤销其他模块原有的模式ID。
            if (selected == null) reason = "no-same-resolution-60hz";
            else if (params.preferredDisplayModeId != 0) reason = "existing-display-mode-preference";
            else {
                savedRefreshRate = params.preferredRefreshRate;
                savedModeId = params.preferredDisplayModeId;
                requestedModeId = selected.getModeId();
                params.preferredRefreshRate = 60f;
                params.preferredDisplayModeId = requestedModeId;
                window.setAttributes(params); owned = true; reason = "requested-same-resolution-60hz-mode";
            }
        } else reason = "already-requested";
        return state(reason);
    }

    private JSObject state(String reason) {
        Window window = getActivity().getWindow();
        Display display = window.getDecorView().getDisplay();
        JSObject result = new JSObject();
        // 只读分类与模式，供Boss真机对照；不切换系统游戏模式或修改电源/热策略。
        result.put("applicationCategory", getContext().getApplicationInfo().category);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                GameManager manager = getContext().getSystemService(GameManager.class);
                result.put("gameMode", manager == null ? 0 : manager.getGameMode());
            } catch (RuntimeException error) {
                result.put("gameModeQueryError", error.getClass().getSimpleName());
            }
        }
        result.put("requested", requested); result.put("owned", owned); result.put("foreground", foreground); result.put("reason", reason);
        result.put("preferredRefreshRate", window.getAttributes().preferredRefreshRate);
        result.put("savedRefreshRate", savedRefreshRate);
        result.put("preferredDisplayModeId", window.getAttributes().preferredDisplayModeId);
        result.put("savedModeId", savedModeId); result.put("requestedModeId", requestedModeId);
        result.put("observedRefreshRate", display == null ? 0 : display.getRefreshRate());
        result.put("observedModeId", display == null ? 0 : display.getMode().getModeId());
        result.put("observedWidth", display == null ? 0 : display.getMode().getPhysicalWidth());
        result.put("observedHeight", display == null ? 0 : display.getMode().getPhysicalHeight());
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
