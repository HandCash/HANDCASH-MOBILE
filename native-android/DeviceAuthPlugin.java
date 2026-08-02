package io.handcash.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;

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

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Biometric-gated unlock: password sealed with an Android Keystore key that
 * requires user authentication (fingerprint / face / device credential).
 */
@CapacitorPlugin(name = "DeviceAuth")
public class DeviceAuthPlugin extends Plugin {
    private static final String TAG = "DeviceAuth";
    private static final String PREFS = "handcash_device_auth";
    private static final String PREF_CIPHER = "cipher_b64";
    private static final String PREF_IV = "iv_b64";
    private static final String KEY_ALIAS = "handcash_device_unlock_v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        boolean available = canAuthenticate();
        boolean enrolled = available && hasStoredSecret();
        ret.put("available", available);
        ret.put("enrolled", enrolled);
        ret.put("label", "Biometrics");
        call.resolve(ret);
    }

    @PluginMethod
    public void enroll(PluginCall call) {
        String password = call.getString("password");
        if (password == null || password.isEmpty()) {
            call.reject("Password required");
            return;
        }
        if (!canAuthenticate()) {
            call.reject("Biometrics are not available on this device");
            return;
        }
        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> promptAndEnroll(call, password));
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String reason = call.getString("reason", "Unlock HandCash");
        if (!canAuthenticate()) {
            call.reject("Biometrics are not available");
            return;
        }
        if (!hasStoredSecret()) {
            call.reject("Biometrics are not enabled");
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

    private boolean canAuthenticate() {
        try {
            BiometricManager mgr = BiometricManager.from(getContext());
            // Strong biometrics required — CryptoObject path is incompatible with device PIN alone.
            int result = mgr.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
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
        prefs().edit().remove(PREF_CIPHER).remove(PREF_IV).apply();
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS);
        } catch (Exception e) {
            Log.w(TAG, "clear keystore failed", e);
        }
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return (SecretKey) ks.getKey(KEY_ALIAS, null);
        }
        KeyGenerator kg = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        android.security.keystore.KeyGenParameterSpec spec =
                new android.security.keystore.KeyGenParameterSpec.Builder(
                                KEY_ALIAS,
                                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT
                                        | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(
                                android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setUserAuthenticationRequired(true)
                        .setInvalidatedByBiometricEnrollment(false)
                        .build();
        kg.init(spec);
        return kg.generateKey();
    }

    private void promptAndEnroll(PluginCall call, String password) {
        try {
            clearStored();
            SecretKey key = getOrCreateKey();
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
                                                c.doFinal(password.getBytes(StandardCharsets.UTF_8));
                                        prefs()
                                                .edit()
                                                .putString(
                                                        PREF_CIPHER,
                                                        Base64.encodeToString(encrypted, Base64.NO_WRAP))
                                                .putString(
                                                        PREF_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                                                .apply();
                                        JSObject ret = new JSObject();
                                        ret.put("ok", true);
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
            // CryptoObject cannot be combined with DEVICE_CREDENTIAL on many API levels.
            BiometricPrompt.PromptInfo info =
                    new BiometricPrompt.PromptInfo.Builder()
                            .setTitle("Enable biometric unlock")
                            .setSubtitle("Confirm to save unlock for HandCash")
                            .setNegativeButtonText("Cancel")
                            .setAllowedAuthenticators(
                                    BiometricManager.Authenticators.BIOMETRIC_STRONG)
                            .build();
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
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
            SecretKey key = getOrCreateKey();
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
                                        JSObject ret = new JSObject();
                                        ret.put("ok", true);
                                        ret.put("password", new String(plain, StandardCharsets.UTF_8));
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
            BiometricPrompt.PromptInfo info =
                    new BiometricPrompt.PromptInfo.Builder()
                            .setTitle("Unlock HandCash")
                            .setSubtitle(reason)
                            .setNegativeButtonText("Use password")
                            .setAllowedAuthenticators(
                                    BiometricManager.Authenticators.BIOMETRIC_STRONG)
                            .build();
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
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
