package io.handcash.mobile;

import android.app.Activity;
import android.os.Build;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

/**
 * Every WebView in this app shares one renderer process. When it dies and no
 * client claims the loss, Android kills the whole app — the wallet, its bridge
 * on :3321 and the in-app browser together. Claim it, record why, and rebuild
 * the activity instead. A renderer that dies again within the window finishes
 * the activity rather than looping.
 */
final class RendererRecovery {
    private static final long LOOP_WINDOW_MS = 15_000;
    private static long lastGoneAt = 0;

    private RendererRecovery() {}

    static boolean onGone(Activity activity, WebView view, RenderProcessGoneDetail detail, String surface) {
        boolean crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null && detail.didCrash();
        int priority = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null
                ? detail.rendererPriorityAtExit()
                : -1;
        long now = SystemClock.elapsedRealtime();
        boolean looping = now - lastGoneAt < LOOP_WINDOW_MS;
        lastGoneAt = now;
        CrashReportPlugin.record(activity, "renderer gone surface=" + surface
                + " crashed=" + crashed
                + " priorityAtExit=" + priority
                + " recovery=" + (looping ? "finish" : "recreate"));
        if (view != null) {
            if (view.getParent() instanceof ViewGroup) {
                ((ViewGroup) view.getParent()).removeView(view);
            }
            view.destroy();
        }
        activity.runOnUiThread(() -> {
            if (looping) activity.finish();
            else activity.recreate();
        });
        return true;
    }
}
