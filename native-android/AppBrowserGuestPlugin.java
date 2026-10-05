package io.handcash.mobile;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Guests for the wallet's browser panel: the Android stand-in for the Electron
 * webview Desktop draws app tabs with. The panel, its toolbar and its tabs are
 * the shared UI core; this only draws the page where the panel says.
 *
 * Each guest is a plain WebView laid over the panel's content box inside the
 * wallet activity. It carries no JavaScript interface and no injected bridge:
 * the page reaches the wallet over the local BRC-100 bridge on 127.0.0.1, as it
 * does from Chrome, so origin checks and permission prompts stay the bridge's.
 * Guests use their own storage profile where the WebView supports one.
 *
 * The core moves a guest off screen whenever wallet UI covers the panel, and
 * {@link #setPromptOpen} does the same for every guest while a permission
 * prompt is up, so a page can never sit on top of an approval.
 */
@CapacitorPlugin(name = "AppBrowserGuest")
public class AppBrowserGuestPlugin extends Plugin {
    private static final String TAG = "AppBrowserGuest";
    private static final String PROFILE = "handcash-app-browser";
    private static final float OFFSCREEN = -100_000f;

    private final Map<String, Guest> guests = new LinkedHashMap<>();
    private FrameLayout layer;
    private boolean promptOpen = false;
    private OnBackPressedCallback back;

    private static final class Guest {
        final String id;
        final WebView view;
        boolean wantsVisible = false;

        Guest(String id, WebView view) {
            this.id = id;
            this.view = view;
        }
    }

    @PluginMethod
    public void create(PluginCall call) {
        String id = call.getString("id");
        Uri target = loadable(call.getString("url"));
        if (id == null || id.isEmpty()) {
            call.reject("id required");
            return;
        }
        if (target == null) {
            call.reject("Only https pages, or http on this device, can be opened");
            return;
        }
        getBridge().executeOnMainThread(() -> {
            try {
                Guest previous = guests.remove(id);
                if (previous != null) dispose(previous);
                Guest guest = new Guest(id, new WebView(getActivity()));
                configure(guest);
                guests.put(id, guest);
                layer().addView(guest.view, new FrameLayout.LayoutParams(0, 0));
                place(guest, call);
                guest.view.loadUrl(target.toString());
                claimBack();
                call.resolve();
            } catch (Exception e) {
                Log.w(TAG, "create failed", e);
                call.reject("Could not open the in-app browser", e);
            }
        });
    }

    @PluginMethod
    public void setBounds(PluginCall call) {
        String id = call.getString("id");
        getBridge().executeOnMainThread(() -> {
            Guest guest = id == null ? null : guests.get(id);
            if (guest != null) place(guest, call);
            call.resolve();
        });
    }

    @PluginMethod
    public void navigate(PluginCall call) {
        String id = call.getString("id");
        String action = call.getString("action", "");
        getBridge().executeOnMainThread(() -> {
            Guest guest = id == null ? null : guests.get(id);
            if (guest != null) {
                switch (action) {
                    case "back":
                        if (guest.view.canGoBack()) guest.view.goBack();
                        break;
                    case "forward":
                        if (guest.view.canGoForward()) guest.view.goForward();
                        break;
                    case "reload":
                        guest.view.reload();
                        break;
                    default:
                        break;
                }
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void capture(PluginCall call) {
        String id = call.getString("id");
        int width = Math.max(64, Math.min(1080, call.getInt("width", 720)));
        getBridge().executeOnMainThread(() -> {
            JSObject result = new JSObject();
            Guest guest = id == null ? null : guests.get(id);
            try {
                if (guest != null && guest.view.getWidth() > 0 && guest.view.getHeight() > 0) {
                    float scale = Math.min(1f, (float) width / guest.view.getWidth());
                    Bitmap bitmap = Bitmap.createBitmap(
                            Math.max(1, Math.round(guest.view.getWidth() * scale)),
                            Math.max(1, Math.round(guest.view.getHeight() * scale)),
                            Bitmap.Config.ARGB_8888);
                    Canvas canvas = new Canvas(bitmap);
                    canvas.scale(scale, scale);
                    guest.view.draw(canvas);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 72, out);
                    bitmap.recycle();
                    result.put("dataUrl", "data:image/jpeg;base64,"
                            + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                } else {
                    result.put("dataUrl", JSObject.NULL);
                }
            } catch (Exception e) {
                Log.w(TAG, "capture failed", e);
                result.put("dataUrl", JSObject.NULL);
            }
            call.resolve(result);
        });
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        String id = call.getString("id");
        getBridge().executeOnMainThread(() -> {
            Guest guest = id == null ? null : guests.remove(id);
            if (guest != null) dispose(guest);
            refreshBack();
            call.resolve();
        });
    }

    /** Every guest leaves the screen while a permission prompt is open. */
    @PluginMethod
    public void setPromptOpen(PluginCall call) {
        boolean open = Boolean.TRUE.equals(call.getBoolean("open", false));
        getBridge().executeOnMainThread(() -> {
            promptOpen = open;
            for (Guest guest : guests.values()) applyVisibility(guest);
            refreshBack();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        for (Guest guest : new ArrayList<>(guests.values())) dispose(guest);
        guests.clear();
        if (back != null) back.remove();
        super.handleOnDestroy();
    }

    /** One transparent layer above the wallet WebView; touches outside a guest fall through. */
    private FrameLayout layer() {
        if (layer != null && layer.getParent() != null) return layer;
        WebView wallet = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) wallet.getParent();
        layer = new FrameLayout(getActivity());
        layer.setClipChildren(true);
        parent.addView(layer, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return layer;
    }

    /** Bounds arrive in CSS pixels of the wallet viewport. */
    private void place(Guest guest, PluginCall call) {
        float density = getContext().getResources().getDisplayMetrics().density;
        WebView wallet = getBridge().getWebView();
        int[] walletAt = new int[2];
        int[] layerAt = new int[2];
        wallet.getLocationInWindow(walletAt);
        layer().getLocationInWindow(layerAt);
        int width = Math.max(0, Math.round(call.getFloat("width", 0f) * density));
        int height = Math.max(0, Math.round(call.getFloat("height", 0f) * density));
        int left = walletAt[0] - layerAt[0] + Math.round(call.getFloat("x", 0f) * density);
        int top = walletAt[1] - layerAt[1] + Math.round(call.getFloat("y", 0f) * density);

        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) guest.view.getLayoutParams();
        if (params.width != width || params.height != height
                || params.leftMargin != left || params.topMargin != top) {
            params.width = width;
            params.height = height;
            params.leftMargin = left;
            params.topMargin = top;
            guest.view.setLayoutParams(params);
        }
        guest.wantsVisible = Boolean.TRUE.equals(call.getBoolean("visible", false));
        applyVisibility(guest);
        refreshBack();
    }

    /**
     * Hidden guests move off screen rather than going INVISIBLE: Chromium
     * freezes a hidden page, and an app mid-flow must keep running while the
     * wallet asks the user to approve its request.
     */
    private void applyVisibility(Guest guest) {
        boolean show = guest.wantsVisible && !promptOpen;
        guest.view.setTranslationX(show ? 0f : OFFSCREEN);
        if (!show && guest.view.hasFocus()) guest.view.clearFocus();
    }

    private Guest foreground() {
        if (promptOpen) return null;
        for (Guest guest : guests.values()) {
            if (guest.wantsVisible) return guest;
        }
        return null;
    }

    /**
     * Android back steps through the visible tab's history first. Registered
     * last so it runs before the App plugin's handler.
     */
    private void claimBack() {
        if (back != null) back.remove();
        back = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                Guest guest = foreground();
                if (guest != null && guest.view.canGoBack()) guest.view.goBack();
                refreshBack();
            }
        };
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), back);
        refreshBack();
    }

    private void refreshBack() {
        if (back == null) return;
        Guest guest = foreground();
        back.setEnabled(guest != null && guest.view.canGoBack());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configure(Guest guest) {
        WebView view = guest.view;
        CookieManager cookies = CookieManager.getInstance();
        // Must precede anything that can load content into this WebView.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            try {
                cookies = ProfileStore.getInstance().getOrCreateProfile(PROFILE).getCookieManager();
                WebViewCompat.setProfile(view, PROFILE);
            } catch (Exception e) {
                Log.w(TAG, "app browser profile unavailable; sharing the default profile", e);
                cookies = CookieManager.getInstance();
            }
        }
        view.setBackgroundColor(Color.WHITE);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);

        view.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                handOff(Uri.parse(url)));
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, Bitmap favicon) {
                JSObject event = event(guest, "loading");
                event.put("url", url);
                notifyListeners("guestEvent", event);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                JSObject event = history(guest, event(guest, "loaded"));
                event.put("url", url);
                notifyListeners("guestEvent", event);
                refreshBack();
            }

            @Override
            public void doUpdateVisitedHistory(WebView v, String url, boolean isReload) {
                JSObject event = history(guest, event(guest, "navigated"));
                event.put("url", url);
                notifyListeners("guestEvent", event);
                refreshBack();
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                JSObject event = event(guest, "failed");
                event.put("url", request.getUrl().toString());
                CharSequence description = error.getDescription();
                event.put("description", description == null ? "" : description.toString());
                notifyListeners("guestEvent", event);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri target = request.getUrl();
                if (loadable(target.toString()) != null) return false;
                String scheme = target.getScheme() == null ? "" : target.getScheme().toLowerCase(Locale.ROOT);
                // Vendor-neutral BRC schemes this wallet claims: BRC-125 pay
                // requests and BRC-29 receipts go to the OS, which routes them
                // back to the wallet. Anything else the page tries is dropped.
                if (scheme.equals("peerpay") || scheme.equals("brc29")) handOff(target);
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                guests.remove(guest.id);
                return RendererRecovery.onGone(getActivity(), v, detail, "browser");
            }
        });
    }

    private JSObject event(Guest guest, String type) {
        JSObject event = new JSObject();
        event.put("id", guest.id);
        event.put("type", type);
        return event;
    }

    private JSObject history(Guest guest, JSObject event) {
        event.put("canGoBack", guest.view.canGoBack());
        event.put("canGoForward", guest.view.canGoForward());
        return event;
    }

    private void handOff(Uri target) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, target);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
        } catch (Exception e) {
            Log.w(TAG, "hand-off failed for " + target.getScheme(), e);
        }
    }

    private void dispose(Guest guest) {
        WebView view = guest.view;
        if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
        view.stopLoading();
        view.loadUrl("about:blank");
        view.destroy();
    }

    /**
     * Mirrors the core's `decideAppBrowserTarget`: https anywhere, plaintext
     * http on loopback only. The wallet's own origin (https://localhost) is
     * never a page a guest may load.
     */
    static Uri loadable(String url) {
        if (url == null || url.trim().isEmpty()) return null;
        Uri parsed;
        try {
            parsed = Uri.parse(url.trim());
        } catch (Exception e) {
            return null;
        }
        String scheme = parsed.getScheme() == null ? "" : parsed.getScheme().toLowerCase(Locale.ROOT);
        String host = parsed.getHost() == null ? "" : parsed.getHost().toLowerCase(Locale.ROOT);
        if (host.isEmpty()) return null;
        boolean loopback = host.equals("localhost") || host.equals("127.0.0.1")
                || host.equals("::1") || host.equals("[::1]");
        if (scheme.equals("https")) {
            boolean walletOrigin = host.equals("localhost")
                    && (parsed.getPort() == -1 || parsed.getPort() == 443);
            return walletOrigin ? null : parsed;
        }
        if (scheme.equals("http") && loopback) return parsed;
        return null;
    }
}
