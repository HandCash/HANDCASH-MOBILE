package io.handcash.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayDeque;

/**
 * What Android did to the app while HandCash was off screen. The wallet runs in
 * the WebView renderer, so a stall shows up in JS only as missing log lines.
 * A main-looper tick in the app process compares elapsed real time with uptime:
 * uptime stops when the CPU sleeps (Doze, or a wake lock the system ignored),
 * and keeps running when only this process was frozen.
 */
@CapacitorPlugin(name = "BackgroundHealth")
public class BackgroundHealthPlugin extends Plugin {
    private static final long TICK_MS = 15_000;
    private static final long GAP_REPORT_MS = 20_000;
    private static final int MAX_EVENTS = 64;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayDeque<JSObject> events = new ArrayDeque<>();
    private long lastElapsed = 0;
    private long lastUptime = 0;
    private BroadcastReceiver receiver;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            long elapsed = SystemClock.elapsedRealtime();
            long uptime = SystemClock.uptimeMillis();
            if (lastElapsed > 0) {
                long late = elapsed - lastElapsed - TICK_MS;
                if (late >= GAP_REPORT_MS) {
                    long asleep = Math.max(0, (elapsed - lastElapsed) - (uptime - lastUptime));
                    record("tick-gap", "late=" + late + "ms asleep=" + asleep + "ms");
                }
            }
            lastElapsed = elapsed;
            lastUptime = uptime;
            handler.postDelayed(this, TICK_MS);
        }
    };

    @Override
    public void load() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;
                PowerManager pm = powerManager();
                switch (action) {
                    case Intent.ACTION_SCREEN_OFF:
                        record("screen-off", null);
                        break;
                    case Intent.ACTION_SCREEN_ON:
                        record("screen-on", null);
                        break;
                    case PowerManager.ACTION_POWER_SAVE_MODE_CHANGED:
                        record("power-save", pm != null && pm.isPowerSaveMode() ? "on" : "off");
                        break;
                    case PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED:
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            record("doze", pm != null && pm.isDeviceIdleMode() ? "deep" : "exit");
                        }
                        break;
                    default:
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                            && PowerManager.ACTION_DEVICE_LIGHT_IDLE_MODE_CHANGED.equals(action)) {
                            record("doze", pm != null && pm.isDeviceLightIdleMode() ? "light" : "light-exit");
                        }
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            filter.addAction(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            filter.addAction(PowerManager.ACTION_DEVICE_LIGHT_IDLE_MODE_CHANGED);
        }
        ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
        handler.postDelayed(tick, TICK_MS);
    }

    @Override
    protected void handleOnDestroy() {
        handler.removeCallbacks(tick);
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // Already gone with the context.
            }
            receiver = null;
        }
    }

    /** Events since the last report, plus the power state now. Drains the events. */
    @PluginMethod
    public void report(PluginCall call) {
        JSArray list = new JSArray();
        synchronized (events) {
            for (JSObject event : events) list.put(event);
            events.clear();
        }
        JSObject result = state();
        result.put("events", list);
        call.resolve(result);
    }

    /**
     * Ask once to run unrestricted. Doze ignores the foreground service's wake
     * lock for apps that are not exempt, and OEM battery managers freeze them.
     */
    @PluginMethod
    public void requestUnrestricted(PluginCall call) {
        JSObject result = new JSObject();
        boolean exempt = ignoringBatteryOptimizations();
        result.put("exempt", exempt);
        result.put("asked", false);
        if (exempt || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve(result);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            result.put("asked", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "battery exemption request failed");
        }
    }

    private JSObject state() {
        JSObject out = new JSObject();
        PowerManager pm = powerManager();
        out.put("interactive", pm != null && pm.isInteractive());
        out.put("powerSave", pm != null && pm.isPowerSaveMode());
        out.put("exempt", ignoringBatteryOptimizations());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && pm != null) {
            out.put("doze", pm.isDeviceIdleMode());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            android.app.usage.UsageStatsManager usage =
                (android.app.usage.UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
            if (usage != null) out.put("standbyBucket", usage.getAppStandbyBucket());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            android.app.ActivityManager am =
                (android.app.ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) out.put("backgroundRestricted", am.isBackgroundRestricted());
        }
        return out;
    }

    private boolean ignoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = powerManager();
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private PowerManager powerManager() {
        return (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
    }

    private void record(String what, String detail) {
        JSObject event = new JSObject();
        event.put("at", System.currentTimeMillis());
        event.put("what", what);
        if (detail != null) event.put("detail", detail);
        synchronized (events) {
            if (events.size() >= MAX_EVENTS) events.removeFirst();
            events.addLast(event);
        }
    }
}
