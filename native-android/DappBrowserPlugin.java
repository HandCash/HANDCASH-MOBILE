package io.handcash.mobile;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens a BRC-100 web app in {@link DappBrowserActivity} — the wallet's own
 * in-app browser.
 *
 * This used to fire {@code ACTION_VIEW} at the system browser, which left the
 * finished Activity unreachable and made "Open in-app" indistinguishable from
 * "Open in browser". The Activity is what carries the CWI bridge to the local
 * JSON API on :3321, so handing the page to Chrome also dropped the wallet
 * connection the in-app choice exists to provide.
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
        if (!scheme.equals("https") && !scheme.equals("http")) {
            call.reject("Only http(s) pages can be opened");
            return;
        }
        try {
            Intent intent = new Intent(getContext(), DappBrowserActivity.class);
            intent.putExtra(DappBrowserActivity.EXTRA_URL, parsed.toString());
            // One retained browser surface. Reopening the same app raises its
            // existing WebView instead of creating a blank replacement.
            intent.addFlags(
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP
                            | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the in-app browser", e);
        }
    }
}
