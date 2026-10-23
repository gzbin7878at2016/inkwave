package com.demoink.inkwave;

import android.content.ContentValues;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONObject;

// 只导出用户主动请求的本地诊断：Android10+通过MediaStore写“下载”，无需存储权限。
@CapacitorPlugin(name = "GameDiagnostics")
public class GameDiagnosticsPlugin extends Plugin {
    @PluginMethod
    public void uploadReport(PluginCall call) {
        String text = call.getString("text");
        String endpoint = getContext().getString(R.string.log_upload_url);
        if (endpoint.isEmpty()) { call.reject("此APK未配置电脑日志接收地址"); return; }
        if (text == null || text.isEmpty()) { call.reject("日志为空"); return; }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 4 * 1024 * 1024) { call.reject("日志超过4MiB"); return; }
        // 网络和磁盘等待不占用UI线程；不开重试，避免重复上传。
        bridge.execute(() -> {
            HttpURLConnection connection = null;
            try {
                JSONObject report = new JSONObject(text);
                if (!"inkwave-android-diagnostics-v1".equals(report.optString("format"))) throw new IllegalArgumentException("日志格式无效");
                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(15000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream stream = connection.getOutputStream()) { stream.write(bytes); }
                int status = connection.getResponseCode();
                if (status != 201) throw new IllegalStateException("电脑返回HTTP " + status);
                byte[] response;
                try (java.io.InputStream stream = connection.getInputStream(); java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream()) {
                    byte[] chunk = new byte[1024]; int count;
                    while (buffer.size() <= 8192 && (count = stream.read(chunk)) != -1) buffer.write(chunk, 0, count);
                    response = buffer.toByteArray();
                }
                if (response.length > 8192) throw new IllegalStateException("电脑响应过大");
                JSONObject saved = new JSONObject(new String(response, StandardCharsets.UTF_8));
                String filename = saved.optString("filename");
                if (!saved.optBoolean("ok") || !filename.matches("INKWAVE-logs-[\\w-]+\\.json")) throw new IllegalStateException("电脑未确认保存");
                JSObject result = new JSObject(); result.put("ok", true); result.put("filename", filename);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("无法上传到电脑：" + error.getMessage());
            } finally { if (connection != null) connection.disconnect(); }
        });
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject info = new JSObject();
        info.put("manufacturer", Build.MANUFACTURER);
        info.put("brand", Build.BRAND);
        info.put("model", Build.MODEL);
        info.put("androidVersion", Build.VERSION.RELEASE);
        info.put("sdk", Build.VERSION.SDK_INT);
        PackageInfo webview = WebView.getCurrentWebViewPackage();
        if (webview != null) {
            info.put("webViewPackage", webview.packageName);
            info.put("webViewVersion", webview.versionName);
        }
        call.resolve(info);
    }

    @PluginMethod
    public void saveReport(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) { call.reject("日志为空"); return; }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 4 * 1024 * 1024) { call.reject("日志超过4MiB，请使用复制报告"); return; }
        Uri uri = null;
        try {
            // 验证输入为JSON对象；文件名由原生生成，网页不能指定写入其他目录。
            new JSONObject(text);
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.ROOT).format(new Date());
            String filename = "INKWAVE-logs-" + stamp + ".json";
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/INKWAVE/");
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("无法创建下载文件");
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri)) {
                if (stream == null) throw new IllegalStateException("无法打开下载文件");
                stream.write(bytes);
            }
            values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0);
            getContext().getContentResolver().update(uri, values, null, null);
            JSObject result = new JSObject();
            result.put("filename", filename);
            result.put("uri", uri.toString());
            result.put("directory", "Download/INKWAVE");
            call.resolve(result);
        } catch (Exception error) {
            if (uri != null) {
                try { getContext().getContentResolver().delete(uri, null, null); } catch (Exception ignored) { /* 删除未完成导出 */ }
            }
            call.reject("保存诊断日志失败：" + error.getMessage());
        }
    }
}
