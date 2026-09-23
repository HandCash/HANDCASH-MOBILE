package io.handcash.mobile;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.SharedPreferences;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * In-app browser for BRC-100 web apps.
 *
 * The wallet WebView stays alive in the task behind this one, so bridge calls
 * from the page keep being answered and a permission prompt can pull the wallet
 * to the front (see permissions.ts → focusWindow → DeviceAuth.bringToFront).
 *
 * Mixed content is allowed so an https page can still reach loopback :3321.
 * WalletClient('auto') also probes the React Native WebView substrate
 * ({@code window.ReactNativeWebView.postMessage} with CWI envelopes). Chrome
 * never has that object; this Activity injects it and proxies CWI to the same
 * local JSON API. PeerPay links stay the only public URL scheme this wallet
 * claims — they are handed to the OS, not rewritten.
 */
public class DappBrowserActivity extends Activity {
    public static final String EXTRA_URL = "io.handcash.mobile.DAPP_URL";
    private static final String TAG = "DappBrowser";
    private static final String PREFS = "handcash_dapp_browser";
    private static final String PREF_URL = "current_url";
    private static final int BAR_HEIGHT_DP = 52;
    private static final String BRIDGE = "http://127.0.0.1:3321";
    private static final String INJECT =
            "(function(){"
                    + "if(window.ReactNativeWebView&&window.ReactNativeWebView.__handcash)return;"
                    + "window.ReactNativeWebView={"
                    + "__handcash:true,"
                    + "postMessage:function(msg){"
                    + "if(window.HandCashRnWallet&&window.HandCashRnWallet.postMessage){"
                    + "window.HandCashRnWallet.postMessage(String(msg));"
                    + "}"
                    + "}"
                    + "};"
                    + "})();";

    private WebView webView;
    private TextView hostLabel;
    private ProgressBar progress;
    private volatile String pageOriginator = "";
    private volatile boolean browserInForeground = false;
    private final ExecutorService cwiPool = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Match Desktop's narrow, vertical app surface. Dapps commonly switch
        // to a materially different layout when Android rotates this Activity.
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);

        String url = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_URL);
        if (url == null || url.trim().isEmpty()) {
            url = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_URL, null);
            if (url == null || url.trim().isEmpty()) {
                finish();
                return;
            }
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
        openOrResume(url);
    }

    private View buildBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#0a0a0a"));
        bar.setPadding(dp(8), 0, dp(8), 0);

        Button wallet = new Button(this);
        wallet.setText("Wallet");
        wallet.setAllCaps(false);
        wallet.setTextColor(Color.parseColor("#57ff97"));
        wallet.setBackgroundColor(Color.TRANSPARENT);
        // Park, do not destroy. The page, cookies, DOM and navigation history
        // remain live behind the wallet and are restored on the next launch.
        wallet.setOnClickListener(v -> bringWalletForward());
        bar.addView(wallet);

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
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);

        view.addJavascriptInterface(new RnWalletHost(), "HandCashRnWallet");

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
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap favicon) {
                setHostLabel(url);
                v.evaluateJavascript(INJECT, null);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript(INJECT, null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                Uri target = request.getUrl();
                String scheme = target.getScheme() == null ? "" : target.getScheme().toLowerCase();
                if (scheme.equals("https") || scheme.equals("http")) {
                    setHostLabel(target.toString());
                    return false;
                }
                // Vendor-neutral PeerPay is the only public scheme this wallet claims.
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
        if (url != null && !url.trim().isEmpty()) {
            getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_URL, url)
                    .apply();
        }
        try {
            Uri parsed = Uri.parse(url);
            String host = parsed.getHost() == null ? url : parsed.getHost();
            boolean secure = "https".equalsIgnoreCase(parsed.getScheme());
            hostLabel.setText(secure ? host : host + " (not secure)");
            hostLabel.setTextColor(Color.parseColor(secure ? "#fafafa" : "#f87171"));
            if (host != null && parsed.getHost() != null) {
                pageOriginator = parsed.getHost();
            }
        } catch (Exception e) {
            hostLabel.setText(url);
        }
    }

    /**
     * Reopening the same origin resumes the live page. A different connected
     * app deliberately replaces the one mobile browser surface.
     */
    private void openOrResume(String requestedUrl) {
        if (webView == null || requestedUrl == null || requestedUrl.trim().isEmpty()) return;
        String liveUrl = webView.getUrl();
        if (liveUrl != null && sameOrigin(liveUrl, requestedUrl)) {
            setHostLabel(liveUrl);
            return;
        }
        setHostLabel(requestedUrl);
        webView.loadUrl(requestedUrl);
    }

    private boolean sameOrigin(String left, String right) {
        try {
            Uri a = Uri.parse(left);
            Uri b = Uri.parse(right);
            int aPort = a.getPort() >= 0 ? a.getPort() : ("https".equalsIgnoreCase(a.getScheme()) ? 443 : 80);
            int bPort = b.getPort() >= 0 ? b.getPort() : ("https".equalsIgnoreCase(b.getScheme()) ? 443 : 80);
            return String.valueOf(a.getScheme()).equalsIgnoreCase(String.valueOf(b.getScheme()))
                    && String.valueOf(a.getHost()).equalsIgnoreCase(String.valueOf(b.getHost()))
                    && aPort == bPort;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void bringWalletForward() {
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch == null) return;
            launch.addFlags(
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP
                            | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(launch);
        } catch (Exception e) {
            Log.w(TAG, "bring wallet forward failed", e);
        }
    }

    /**
     * A permission request raises MainActivity over this retained browser.
     * Once the blocked CWI call resolves, put this exact WebView back on top.
     */
    private void bringBrowserForward() {
        try {
            Intent browser = new Intent(this, DappBrowserActivity.class);
            browser.addFlags(
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(browser);
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        } catch (Exception e) {
            Log.w(TAG, "bring browser forward failed", e);
        }
    }

    private void deliverCwi(String payload, boolean resumeBrowser) {
        WebView view = webView;
        if (view == null) return;
        final String js = "window.postMessage(" + JSONObject.quote(payload) + ", '*');";
        main.post(() -> {
            WebView live = webView;
            if (live != null) live.evaluateJavascript(js, null);
            if (resumeBrowser && !browserInForeground) bringBrowserForward();
        });
    }

    /**
     * SDK ReactNativeWebView substrate: CWI envelopes in, JSON-API on :3321 out.
     * Originator is the page host, never a value the page gets to name.
     */
    private class RnWalletHost {
        @JavascriptInterface
        public void postMessage(String message) {
            cwiPool.execute(() -> handleCwi(message));
        }
    }

    private void handleCwi(String message) {
        String id = "";
        String call = "";
        boolean resumeBrowser = false;
        try {
            JSONObject envelope = new JSONObject(message);
            if (!"CWI".equals(envelope.optString("type"))) return;
            if (!envelope.optBoolean("isInvocation", false)) return;
            id = envelope.optString("id", "");
            call = envelope.optString("call", "");
            if (id.isEmpty() || !call.matches("[A-Za-z][A-Za-z0-9]*")) {
                return;
            }
            JSONObject args = envelope.optJSONObject("args");
            String body = args == null ? "{}" : args.toString();
            // permissions.ts raises MainActivity only when this request really
            // needs a decision. Remember whether it started in the browser so
            // the resolved request can return to the same live page.
            resumeBrowser = browserInForeground && !"getVersion".equals(call);
            if (resumeBrowser) main.post(this::bringWalletForward);
            String originator = pageOriginator;
            HttpURLConnection conn = (HttpURLConnection) new URL(BRIDGE + "/" + call).openConnection();
            conn.setConnectTimeout(4_000);
            conn.setReadTimeout(120_000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            if (originator != null && !originator.isEmpty()) {
                conn.setRequestProperty("originator", originator);
            }
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            conn.setRequestProperty("Content-Length", Integer.toString(bytes.length));
            try (OutputStream out = conn.getOutputStream()) {
                out.write(bytes);
            }
            int status = conn.getResponseCode();
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) stream = conn.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = stream.read(chunk)) >= 0) buf.write(chunk, 0, n);
            stream.close();
            conn.disconnect();
            String raw = buf.toString(StandardCharsets.UTF_8.name());
            JSONObject reply = new JSONObject();
            reply.put("type", "CWI");
            reply.put("id", id);
            reply.put("isInvocation", false);
            if (status >= 400) {
                reply.put("status", "error");
                JSONObject err = new JSONObject();
                try {
                    err = new JSONObject(raw);
                } catch (Exception ignored) {
                    // body was not JSON
                }
                reply.put("code", err.optString("code", "WALLET_REQUEST_FAILED"));
                reply.put("description", err.optString("description", raw));
            } else {
                reply.put("status", "success");
                try {
                    reply.put("result", new JSONObject(raw));
                } catch (Exception e) {
                    reply.put("result", raw);
                }
            }
            deliverCwi(reply.toString(), resumeBrowser);
        } catch (Exception e) {
            Log.w(TAG, "CWI proxy failed", e);
            if (id.isEmpty()) return;
            try {
                JSONObject reply = new JSONObject();
                reply.put("type", "CWI");
                reply.put("id", id);
                reply.put("isInvocation", false);
                reply.put("status", "error");
                reply.put("code", "WALLET_BRIDGE_ERROR");
                reply.put("description", e.getMessage() == null ? "CWI proxy failed" : e.getMessage());
                deliverCwi(reply.toString(), resumeBrowser);
            } catch (Exception ignored) {
                // drop
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = intent == null ? null : intent.getStringExtra(EXTRA_URL);
        if (url != null && !url.trim().isEmpty()) openOrResume(url);
    }

    @Override
    protected void onResume() {
        super.onResume();
        browserInForeground = true;
    }

    @Override
    protected void onPause() {
        browserInForeground = false;
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        bringWalletForward();
    }

    @Override
    protected void onDestroy() {
        cwiPool.shutdownNow();
        if (webView != null) {
            webView.removeJavascriptInterface("HandCashRnWallet");
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
