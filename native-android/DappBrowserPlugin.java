package io.handcash.mobile;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens a web app in {@link DappBrowserActivity} — an in-app WebView, not the
 * system browser.
 *
 * Why in-app: the page must reach the BRC-100 bridge on loopback:3321, which
 * Chrome blocks from an https page. Why a separate Activity rather than an
 * iframe in the wallet WebView: the page stays a top-level browsing context, so
 * its own cookies are first-party, and the wallet WebView keeps running behind
 * it to answer bridge requests and raise permission prompts.
 */
@CapacitorPlugin(name = "DappBrowser")
public class DappBrowserPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url required");
            return;
        }
        Uri parsed;
        try {
            parsed = Uri.parse(url.trim());
        } catch (Exception e) {
            call.reject("url could not be parsed");
            return;
        }
        String scheme = parsed.getScheme() == null ? "" : parsed.getScheme().toLowerCase();
        // The renderer already decided (decideAppBrowserTarget); refuse again here
        // so no other caller can hand this Activity a file:// or javascript: URL.
        if (!scheme.equals("https") && !scheme.equals("http")) {
            call.reject("Only http(s) pages can be opened");
            return;
        }
        Intent intent = new Intent(getContext(), DappBrowserActivity.class);
        intent.putExtra(DappBrowserActivity.EXTRA_URL, parsed.toString());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
