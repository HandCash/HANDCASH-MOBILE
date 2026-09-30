package io.handcash.mobile;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Native deaths never reach the WebView's log ring: an uncaught Java exception
 * or a lost renderer ends the process before JS can write a line. Each one is
 * appended to a file here and handed to the log on the next launch.
 */
@CapacitorPlugin(name = "CrashReport")
public class CrashReportPlugin extends Plugin {
    private static final String FILE = "native-crash.log";
    private static final int MAX_BYTES = 16 * 1024;
    private static volatile boolean installed = false;

    static synchronized void install(Context context) {
        if (installed) return;
        installed = true;
        final Context app = context.getApplicationContext();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter trace = new StringWriter();
                error.printStackTrace(new PrintWriter(trace));
                record(app, "uncaught thread=" + thread.getName() + "\n" + trace);
            } catch (Throwable ignored) {
                // The original handler still has to run.
            }
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    static synchronized void record(Context context, String entry) {
        File file = new File(context.getApplicationContext().getFilesDir(), FILE);
        if (file.length() > MAX_BYTES) return;
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        String line = iso.format(new Date()) + " " + entry.trim() + "\n";
        try (FileOutputStream out = new FileOutputStream(file, true)) {
            out.write(line.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            // Nothing left to report to.
        }
    }

    @PluginMethod
    public void takeReport(PluginCall call) {
        File file = new File(getContext().getFilesDir(), FILE);
        JSObject result = new JSObject();
        if (!file.exists()) {
            result.put("report", "");
            call.resolve(result);
            return;
        }
        try {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (FileInputStream in = new FileInputStream(file)) {
                byte[] chunk = new byte[4096];
                int n;
                while ((n = in.read(chunk)) >= 0) buf.write(chunk, 0, n);
            }
            String report = buf.toString(StandardCharsets.UTF_8.name());
            file.delete();
            result.put("report", report);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("crash report unreadable: " + e.getMessage());
        }
    }
}
