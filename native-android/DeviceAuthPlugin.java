package io.handcash.mobile;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.Base64;
import android.util.Log;
import android.view.WindowManager;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Device unlock factor: seals a vault DEK with an Android Keystore AES key.
 *
 * Prefer StrongBox when available, else TEE. Authentication allows strong
 * biometrics and (API 30+) the device PIN/pattern/password — a separate factor
 * from any in-app HandCash password.
 */
@CapacitorPlugin(name = "DeviceAuth")
public class DeviceAuthPlugin extends Plugin {
    private static final String TAG = "DeviceAuth";
    private static final String PREFS = "handcash_device_auth";
    private static final String PREF_CIPHER = "cipher_b64";
    private static final String PREF_IV = "iv_b64";
    private static final String PREF_STRONGBOX = "strongbox";
    private static final String KEY_ALIAS = "handcash_device_unlock_v3";
    private static final String KEY_ALIAS_V2 = "handcash_device_unlock_v2";
    private static final String KEY_ALIAS_LEGACY = "handcash_device_unlock_v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        boolean available = canAuthenticate();
        boolean enrolled = available && hasStoredSecret();
        boolean strongBox = prefs().getBoolean(PREF_STRONGBOX, false);
        if (enrolled && !strongBox) {
            strongBox = probeStrongBox();
        }
        ret.put("available", available);
        ret.put("enrolled", enrolled);
        ret.put("strongBox", strongBox);
        ret.put("label", strongBox ? "Fingerprint / device lock" : "Device unlock");
        call.resolve(ret);
    }

    @PluginMethod
    public void enroll(PluginCall call) {
        // Accept either "secret" (DEK, preferred) or legacy "password".
        String secret = call.getString("secret");
        if (secret == null || secret.isEmpty()) {
            secret = call.getString("password");
        }
        if (secret == null || secret.isEmpty()) {
            call.reject("Unlock material required");
            return;
        }
        if (!canAuthenticate()) {
            call.reject("Device unlock is not available on this device");
            return;
        }
        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        final String toSeal = secret;
        activity.runOnUiThread(() -> promptAndEnroll(call, toSeal));
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String reason = call.getString("reason", "Unlock HandCash");
        if (!canAuthenticate()) {
            call.reject("Device unlock is not available");
            return;
        }
        if (!hasStoredSecret()) {
            call.reject("Device unlock is not enabled");
            return;
        }
        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> promptAndUnlock(call, reason));
    }

    @PluginMethod
    public void clear(PluginCall call) {
        clearStored();
        call.resolve(new JSObject());
    }

    /**
     * Bring the wallet to the foreground when a BRC-100 permission prompt is waiting.
     * Prefer AppTask.moveToFront (reliable when backgrounded); fall back to launch intent.
     */
    @PluginMethod
    public void bringToFront(PluginCall call) {
        final Activity activity = getActivity();
        final Context context = getContext();
        if (activity == null && context == null) {
            call.reject("No activity");
            return;
        }
        Runnable work = () -> {
            try {
                Context ctx = activity != null ? activity : context;
                ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null) {
                    java.util.List<ActivityManager.AppTask> tasks = am.getAppTasks();
                    if (tasks != null && !tasks.isEmpty()) {
                        tasks.get(0).moveToFront();
                    }
                }

                Activity act = activity != null ? activity : getActivity();
                if (act != null) {
                    try {
                        act.getWindow().addFlags(
                            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                        );
                    } catch (Exception ignored) {
                        // Window may be unavailable while stopped.
                    }
                    Intent launch = act.getPackageManager()
                        .getLaunchIntentForPackage(act.getPackageName());
                    if (launch != null) {
                        launch.addFlags(
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                                | Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
                        );
                        act.startActivity(launch);
                    } else {
                        Intent intent = new Intent(act, act.getClass());
                        intent.addFlags(
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                                | Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
                        );
                        act.startActivity(intent);
                    }
                } else if (ctx != null) {
                    Intent launch = ctx.getPackageManager()
                        .getLaunchIntentForPackage(ctx.getPackageName());
                    if (launch != null) {
                        launch.addFlags(
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                                | Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
                        );
                        ctx.startActivity(launch);
                    }
                }
                call.resolve(new JSObject());
            } catch (Exception e) {
                Log.w(TAG, "bringToFront failed", e);
                call.reject(e.getMessage() != null ? e.getMessage() : "bringToFront failed");
            }
        };
        if (activity != null) {
            activity.runOnUiThread(work);
        } else {
            new Handler(Looper.getMainLooper()).post(work);
        }
    }

    private int allowedAuthenticators() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return BiometricManager.Authenticators.BIOMETRIC_STRONG
                    | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        }
        return BiometricManager.Authenticators.BIOMETRIC_STRONG;
    }

    private boolean canAuthenticate() {
        try {
            BiometricManager mgr = BiometricManager.from(getContext());
            int result = mgr.canAuthenticate(allowedAuthenticators());
            return result == BiometricManager.BIOMETRIC_SUCCESS;
        } catch (Exception e) {
            Log.w(TAG, "canAuthenticate failed", e);
            return false;
        }
    }

    private boolean hasStoredSecret() {
        SharedPreferences prefs = prefs();
        return prefs.contains(PREF_CIPHER) && prefs.contains(PREF_IV);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void clearStored() {
        prefs().edit().remove(PREF_CIPHER).remove(PREF_IV).remove(PREF_STRONGBOX).apply();
        deleteAlias(KEY_ALIAS);
        deleteAlias(KEY_ALIAS_V2);
        deleteAlias(KEY_ALIAS_LEGACY);
    }

    private void deleteAlias(String alias) {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
        } catch (Exception e) {
            Log.w(TAG, "clear keystore failed for " + alias, e);
        }
    }

    private SecretKey getOrCreateKey(boolean createIfMissing) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return (SecretKey) ks.getKey(KEY_ALIAS, null);
        }
        // Readable until the user re-enrolls onto the v3 alias.
        if (ks.containsAlias(KEY_ALIAS_V2)) {
            return (SecretKey) ks.getKey(KEY_ALIAS_V2, null);
        }
        if (ks.containsAlias(KEY_ALIAS_LEGACY)) {
            return (SecretKey) ks.getKey(KEY_ALIAS_LEGACY, null);
        }
        if (!createIfMissing) {
            throw new IllegalStateException("No device unlock key enrolled");
        }
        return createKeyPreferStrongBox();
    }

    private SecretKey createKeyPreferStrongBox() throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                SecretKey key = generateAesKey(true);
                prefs().edit().putBoolean(PREF_STRONGBOX, true).apply();
                Log.i(TAG, "Device unlock key created in StrongBox");
                return key;
            } catch (StrongBoxUnavailableException e) {
                Log.i(TAG, "StrongBox unavailable — falling back to TEE", e);
            } catch (Exception e) {
                Log.i(TAG, "StrongBox request failed — falling back to TEE: " + e.getMessage());
            }
        }
        SecretKey key = generateAesKey(false);
        prefs().edit().putBoolean(PREF_STRONGBOX, false).apply();
        Log.i(TAG, "Device unlock key created in TEE");
        return key;
    }

    private SecretKey generateAesKey(boolean strongBox) throws Exception {
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec.Builder builder =
                new KeyGenParameterSpec.Builder(
                                KEY_ALIAS,
                                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setUserAuthenticationRequired(true)
                        .setInvalidatedByBiometricEnrollment(false);
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(true);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(
                    0,
                    KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
        }
        kg.init(builder.build());
        return kg.generateKey();
    }

    private boolean probeStrongBox() {
        try {
            SecretKey key = getOrCreateKey(false);
            SecretKeyFactory factory =
                    SecretKeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore");
            KeyInfo info = (KeyInfo) factory.getKeySpec(key, KeyInfo.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                return info.getSecurityLevel() == KeyProperties.SECURITY_LEVEL_STRONGBOX;
            }
            return info.isInsideSecureHardware();
        } catch (Exception e) {
            return prefs().getBoolean(PREF_STRONGBOX, false);
        }
    }

    private BiometricPrompt.PromptInfo buildPrompt(String title, String subtitle) {
        BiometricPrompt.PromptInfo.Builder builder =
                new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setAllowedAuthenticators(allowedAuthenticators());
        // Negative button is incompatible with DEVICE_CREDENTIAL.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            builder.setNegativeButtonText("Cancel");
        }
        return builder.build();
    }

    private void promptAndEnroll(PluginCall call, String secret) {
        try {
            clearStored();
            SecretKey key = getOrCreateKey(true);
            boolean strongBox = prefs().getBoolean(PREF_STRONGBOX, false);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);
            Executor executor = ContextCompat.getMainExecutor(getContext());
            BiometricPrompt prompt =
                    new BiometricPrompt(
                            getActivity(),
                            executor,
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationSucceeded(
                                        @NonNull BiometricPrompt.AuthenticationResult result) {
                                    try {
                                        Cipher c = result.getCryptoObject().getCipher();
                                        byte[] iv = c.getIV();
                                        byte[] encrypted =
                                                c.doFinal(
                                                        secret.getBytes(
                                                                java.nio.charset.StandardCharsets.UTF_8));
                                        prefs()
                                                .edit()
                                                .putString(
                                                        PREF_CIPHER,
                                                        Base64.encodeToString(encrypted, Base64.NO_WRAP))
                                                .putString(
                                                        PREF_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                                                .putBoolean(PREF_STRONGBOX, strongBox)
                                                .apply();
                                        JSObject ret = new JSObject();
                                        ret.put("ok", true);
                                        ret.put("strongBox", strongBox);
                                        call.resolve(ret);
                                    } catch (Exception e) {
                                        Log.w(TAG, "enroll encrypt failed", e);
                                        call.reject(e.getMessage());
                                    }
                                }

                                @Override
                                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                                    call.reject(cancelledOr(errorCode, errString.toString()));
                                }

                                @Override
                                public void onAuthenticationFailed() {
                                    // keep prompt open for retries
                                }
                            });
            String subtitle =
                    strongBox
                            ? "Seal unlock with this device's secure element"
                            : "Confirm with fingerprint or device lock";
            prompt.authenticate(
                    buildPrompt("Enable device unlock", subtitle),
                    new BiometricPrompt.CryptoObject(cipher));
        } catch (Exception e) {
            Log.w(TAG, "enroll failed", e);
            call.reject(e.getMessage());
        }
    }

    private void promptAndUnlock(PluginCall call, String reason) {
        try {
            SharedPreferences prefs = prefs();
            byte[] iv = Base64.decode(prefs.getString(PREF_IV, ""), Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(prefs.getString(PREF_CIPHER, ""), Base64.NO_WRAP);
            SecretKey key = getOrCreateKey(false);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            Executor executor = ContextCompat.getMainExecutor(getContext());
            BiometricPrompt prompt =
                    new BiometricPrompt(
                            getActivity(),
                            executor,
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationSucceeded(
                                        @NonNull BiometricPrompt.AuthenticationResult result) {
                                    try {
                                        Cipher c = result.getCryptoObject().getCipher();
                                        byte[] plain = c.doFinal(encrypted);
                                        String secret =
                                                new String(plain, java.nio.charset.StandardCharsets.UTF_8);
                                        JSObject ret = new JSObject();
                                        ret.put("ok", true);
                                        ret.put("secret", secret);
                                        // Legacy field for older JS callers.
                                        ret.put("password", secret);
                                        call.resolve(ret);
                                    } catch (Exception e) {
                                        Log.w(TAG, "unlock decrypt failed", e);
                                        call.reject(e.getMessage());
                                    }
                                }

                                @Override
                                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                                    call.reject(cancelledOr(errorCode, errString.toString()));
                                }

                                @Override
                                public void onAuthenticationFailed() {
                                    // keep prompt open
                                }
                            });
            prompt.authenticate(
                    buildPrompt("Unlock HandCash", reason),
                    new BiometricPrompt.CryptoObject(cipher));
        } catch (Exception e) {
            Log.w(TAG, "unlock failed", e);
            call.reject(e.getMessage());
        }
    }

    private static String cancelledOr(int code, String message) {
        if (code == BiometricPrompt.ERROR_USER_CANCELED
                || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                || code == BiometricPrompt.ERROR_CANCELED) {
            return "cancelled";
        }
        return message;
    }
}
