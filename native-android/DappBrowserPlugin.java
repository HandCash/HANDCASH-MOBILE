package io.handcash.mobile;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens http(s) in the system browser. This wallet does not host an in-app
 * browser. Pages talk back through {@code peerpay:} links, which the OS
 * delivers to MainActivity.
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
        Intent intent = new Intent(Intent.ACTION_VIEW, parsed);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
