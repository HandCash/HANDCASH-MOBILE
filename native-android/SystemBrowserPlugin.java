package io.handcash.mobile;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands a link to the OS — the mobile equivalent of Electron's
 * {@code shell.openExternal}.
 *
 * {@code window.open} from the Capacitor WebView is not this. Depending on the
 * WebView's multiple-window settings it either does nothing or renders the page
 * inside a wallet-owned surface, which is why "Open in browser" could still
 * look like a second in-app browser that Desktop does not have. It also cannot
 * download an APK: a WebView with no DownloadListener drops the response.
 *
 * {@link DappBrowserPlugin} stays the opposite choice — the retained in-app
 * browser that carries the CWI bridge. Only that one may load app pages.
 */
@CapacitorPlugin(name = "SystemBrowser")
public class SystemBrowserPlugin extends Plugin {

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
        // Same set Desktop's isSafeExternalUrl allows.
        if (!scheme.equals("https") && !scheme.equals("http") && !scheme.equals("mailto")) {
            call.reject("Only http(s) and mailto links can be opened externally");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, parsed);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (!scheme.equals("mailto")) {
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
        }
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app on this device can open that link", e);
        } catch (Exception e) {
            call.reject("Could not hand the link to the system", e);
        }
    }
}
