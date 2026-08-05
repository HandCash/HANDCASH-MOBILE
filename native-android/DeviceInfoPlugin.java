package io.handcash.mobile;

import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Device profile for privacy-focused Android (GrapheneOS) UX in the WebView shell.
 */
@CapacitorPlugin(name = "DeviceInfo")
public class DeviceInfoPlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("grapheneOs", isGrapheneOs());
        ret.put("playServicesInstalled", isPackageInstalled("com.google.android.gms"));
        ret.put("androidSdk", Build.VERSION.SDK_INT);
        ret.put("manufacturer", Build.MANUFACTURER != null ? Build.MANUFACTURER : "");
        ret.put("model", Build.MODEL != null ? Build.MODEL : "");
        ret.put("sideloadUpdates", true);
        call.resolve(ret);
    }

    private boolean isGrapheneOs() {
        if (isPackageInstalled("app.grapheneos.gmscompat")) return true;
        if (isPackageInstalled("app.grapheneos.gmscompat.config")) return true;

        String display = Build.DISPLAY != null ? Build.DISPLAY.toLowerCase() : "";
        String fingerprint = Build.FINGERPRINT != null ? Build.FINGERPRINT.toLowerCase() : "";
        if (display.contains("graphene") || fingerprint.contains("graphene")) return true;

        String flavor = getSystemProperty("ro.build.flavor");
        if (flavor != null && flavor.toLowerCase().contains("graphene")) return true;

        String product = Build.PRODUCT != null ? Build.PRODUCT.toLowerCase() : "";
        return product.contains("graphene");
    }

    private boolean isPackageInstalled(String packageName) {
        try {
            getContext().getPackageManager().getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private static String getSystemProperty(String key) {
        try {
            Class<?> c = Class.forName("android.os.SystemProperties");
            return (String) c.getMethod("get", String.class).invoke(null, key);
        } catch (Exception e) {
            return null;
        }
    }
}
