package io.handcash.mobile;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opens Android's native share sheet for user-controlled key-slice handoff. */
@CapacitorPlugin(name = "ShareText")
public class ShareTextPlugin extends Plugin {
    @PluginMethod
    public void share(PluginCall call) {
        String title = call.getString("title", "HandCash key slice");
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.reject("text required");
            return;
        }

        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.putExtra(Intent.EXTRA_TEXT, text);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "share failed");
        }
    }
}
