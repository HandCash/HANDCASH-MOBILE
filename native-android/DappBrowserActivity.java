package io.handcash.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/**
 * In-app browser for BRC-100 web apps.
 *
 * The wallet WebView stays alive in the task behind this one, so bridge calls
 * from the page keep being answered and a permission prompt can pull the wallet
 * to the front (see permissions.ts → focusWindow → DeviceAuth.bringToFront).
 *
 * Mixed content is allowed on purpose: an https page has to reach the bridge on
 * http://127.0.0.1:3321. That is loopback on this device only.
 */
public class DappBrowserActivity extends Activity {
    public static final String EXTRA_URL = "io.handcash.mobile.DAPP_URL";
    private static final String TAG = "DappBrowser";
    private static final int BAR_HEIGHT_DP = 52;

    private WebView webView;
    private TextView hostLabel;
    private ProgressBar progress;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String url = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_URL);
        if (url == null || url.trim().isEmpty()) {
            finish();
            return;
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);
        root.setFitsSystemWindows(true);

        root.addView(buildBar(), new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(BAR_HEIGHT_DP)));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setBackgroundColor(Color.BLACK);
        root.addView(progress, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        configure(webView);
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
        setHostLabel(url);
        webView.loadUrl(url);
    }

    private View buildBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#0a0a0a"));
        bar.setPadding(dp(8), 0, dp(8), 0);

        Button close = new Button(this);
        close.setText("Close");
        close.setAllCaps(false);
        close.setTextColor(Color.parseColor("#57ff97"));
        close.setBackgroundColor(Color.TRANSPARENT);
        close.setOnClickListener(v -> finish());
        bar.addView(close);

        // Anti-phishing: the page cannot style or hide the origin it is served from.
        hostLabel = new TextView(this);
        hostLabel.setTextColor(Color.parseColor("#fafafa"));
        hostLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        hostLabel.setSingleLine(true);
        hostLabel.setGravity(Gravity.CENTER);
        bar.addView(hostLabel, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button reload = new Button(this);
        reload.setText("Reload");
        reload.setAllCaps(false);
        reload.setTextColor(Color.parseColor("#a1a1aa"));
        reload.setBackgroundColor(Color.TRANSPARENT);
        reload.setOnClickListener(v -> {
            if (webView != null) webView.reload();
        });
        bar.addView(reload);

        return bar;
    }

    private void configure(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // An https page must be allowed to call http://127.0.0.1:3321 (the bridge).
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int newProgress) {
                if (progress == null) return;
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.INVISIBLE : View.VISIBLE);
            }
        });

        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                Uri target = request.getUrl();
                String scheme = target.getScheme() == null ? "" : target.getScheme().toLowerCase();
                if (scheme.equals("https") || scheme.equals("http")) {
                    setHostLabel(target.toString());
                    return false;
                }
                // Hand off only the scheme this wallet claims; anything else
                // (intent:, market:, tel:) is not this browser's business.
                if (scheme.equals("peerpay")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, target));
                    } catch (Exception e) {
                        Log.w(TAG, "peerpay handoff failed", e);
                    }
                }
                return true;
            }

            @Override
            public void doUpdateVisitedHistory(WebView v, String url, boolean isReload) {
                setHostLabel(url);
            }
        });
    }

    private void setHostLabel(String url) {
        if (hostLabel == null) return;
        try {
            Uri parsed = Uri.parse(url);
            String host = parsed.getHost() == null ? url : parsed.getHost();
            boolean secure = "https".equalsIgnoreCase(parsed.getScheme());
            hostLabel.setText(secure ? host : host + " (not secure)");
            hostLabel.setTextColor(Color.parseColor(secure ? "#fafafa" : "#f87171"));
        } catch (Exception e) {
            hostLabel.setText(url);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
