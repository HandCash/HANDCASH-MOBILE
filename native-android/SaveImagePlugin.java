package io.handcash.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * Save an image into the device gallery (MediaStore Pictures/HandCash).
 */
@CapacitorPlugin(name = "SaveImage")
public class SaveImagePlugin extends Plugin {
    @PluginMethod
    public void saveToGallery(PluginCall call) {
        String filename = call.getString("filename");
        String mime = call.getString("mime", "image/png");
        String base64 = call.getString("base64");
        if (filename == null || filename.isEmpty()) {
            call.reject("filename required");
            return;
        }
        if (base64 == null || base64.isEmpty()) {
            call.reject("base64 required");
            return;
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("invalid base64");
            return;
        }
        if (bytes.length == 0) {
            call.reject("empty image");
            return;
        }

        String safeName = filename.replaceAll("[\\\\/]+", "_").trim();
        if (safeName.isEmpty()) safeName = "handcash-image.png";

        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, safeName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mime != null && !mime.isEmpty() ? mime : "image/png");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(
                MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/HandCash"
            );
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
        }

        Uri collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        Uri item = resolver.insert(collection, values);
        if (item == null) {
            call.reject("gallery insert failed");
            return;
        }

        try (OutputStream out = resolver.openOutputStream(item)) {
            if (out == null) {
                resolver.delete(item, null, null);
                call.reject("could not open gallery stream");
                return;
            }
            out.write(bytes);
            out.flush();
        } catch (Exception e) {
            try {
                resolver.delete(item, null, null);
            } catch (Exception ignored) {
                /* ignore */
            }
            call.reject(e.getMessage() != null ? e.getMessage() : "write failed");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(item, done, null, null);
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("uri", item.toString());
        call.resolve(ret);
    }
}
