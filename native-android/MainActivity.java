package io.handcash.mobile;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Brc100LocalBridgePlugin.class);
        registerPlugin(DappBrowserPlugin.class);
        registerPlugin(DeviceAuthPlugin.class);
        registerPlugin(SaveImagePlugin.class);
        registerPlugin(ShareTextPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        // WebView force-dark re-tints a light sheet when the OS is in dark mode.
        // Appearance is owned by handcash.appearance, not Android's algorithm.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.getSettings().setForceDark(WebSettings.FORCE_DARK_OFF);
            }
        }
    }
}
