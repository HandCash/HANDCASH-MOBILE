package io.handcash.mobile;

import android.os.Build;
import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        CrashReportPlugin.install(this);
        registerPlugin(Brc100LocalBridgePlugin.class);
        registerPlugin(Brc39ArchivePlugin.class);
        registerPlugin(CrashReportPlugin.class);
        registerPlugin(AppBrowserGuestPlugin.class);
        registerPlugin(DeviceAuthPlugin.class);
        registerPlugin(DurableStorePlugin.class);
        registerPlugin(DirectSessionPlugin.class);
        registerPlugin(SaveImagePlugin.class);
        registerPlugin(ShareTextPlugin.class);
        registerPlugin(SystemBrowserPlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    return RendererRecovery.onGone(MainActivity.this, webView, detail, "wallet");
                }
            });
        }
        keepRendererAwake();
    }

    @Override
    public void onStart() {
        super.onStart();
        keepRendererAwake();
        // WebView force-dark re-tints a light sheet when the OS is in dark mode.
        // Appearance is owned by handcash.appearance, not Android's algorithm.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.getSettings().setForceDark(WebSettings.FORCE_DARK_OFF);
            }
        }
    }

    /**
     * The wallet (BRC-100 replies, inbox ingest, activity notifications) runs in
     * this WebView's renderer. By default Android waives renderer priority once
     * the view is off screen and the cached-app freezer suspends it, so a request
     * accepted on :3321 waits until HandCash is reopened. Keep it at the app's
     * own importance, which the foreground service holds while unlocked.
     */
    private void keepRendererAwake() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }
}
