package com.demoink.inkwave;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

// 原生层只负责沉浸横屏和前台常亮；游戏与输入仍由内置网页管理。
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GameDiagnosticsPlugin.class); // 必须在Bridge构建前注册，启动失败时也能导出日志。
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
        // 仅调试APK、显式ADB参数启用最小图形页，排除游戏场景与预热代码。
        if (BuildConfig.DEBUG && getIntent().getBooleanExtra("inkwave.graphicsProbe", false)) {
            try (java.io.InputStream input = getAssets().open("graphics-probe.html")) {
                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                byte[] bytes = new byte[4096]; int n;
                while ((n = input.read(bytes)) != -1) buffer.write(bytes, 0, n);
                getBridge().getWebView().stopLoading();
                getBridge().getWebView().loadDataWithBaseURL("https://localhost/",
                    new String(buffer.toByteArray(), java.nio.charset.StandardCharsets.UTF_8), "text/html", "UTF-8", null);
            } catch (java.io.IOException error) {
                throw new IllegalStateException("最小图形诊断资源缺失", error);
            }
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
