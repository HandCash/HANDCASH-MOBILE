package io.handcash.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
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
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Biometric-gated unlock: vault password sealed with an Android Keystore AES key.
 *
 * Prefers StrongBox (hardware secure element) when the device exposes one;
 * falls back to TEE. The sealing key never leaves secure hardware when available.
 */
@CapacitorPlugin(name = "DeviceAuth")
public class DeviceAuthPlugin extends Plugin {
    private static final String TAG = "DeviceAuth";
    private static final String PREFS = "handcash_device_auth";
    private static final String PREF_CIPHER = "cipher_b64";
    private static final String PREF_IV = "iv_b64";
    private static final String PREF_STRONGBOX = "strongbox";
    private static final String KEY_ALIAS = "handcash_device_unlock_v2";
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
        ret.put("label", strongBox ? "Hardware key" : "Biometrics");
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

    /**
     * Bring the wallet to the foreground when a BRC-100 permission prompt is waiting.
     * Safe no-op when already resumed.
     */
    @PluginMethod
    public void bringToFront(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(activity, activity.getClass());
                intent.addFlags(
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_NEW_TASK
                );
                activity.startActivity(intent);
                activity.setIntent(intent);
                call.resolve(new JSObject());
            } catch (Exception e) {
                Log.w(TAG, "bringToFront failed", e);
                call.reject(e.getMessage() != null ? e.getMessage() : "bringToFront failed");
            }
        });
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
        prefs().edit().remove(PREF_CIPHER).remove(PREF_IV).remove(PREF_STRONGBOX).apply();
        deleteAlias(KEY_ALIAS);
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

    /**
     * Create (or load) the unlock key. New keys prefer StrongBox; legacy v1
     * aliases are still readable until the user re-enrolls.
     */
    private SecretKey getOrCreateKey(boolean createIfMissing) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return (SecretKey) ks.getKey(KEY_ALIAS, null);
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
        // Prefer StrongBox (hardware SE) when the device supports it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                SecretKey key = generateAesKey(true);
                prefs().edit().putBoolean(PREF_STRONGBOX, true).apply();
                Log.i(TAG, "Device unlock key created in StrongBox");
                return key;
            } catch (StrongBoxUnavailableException e) {
                Log.i(TAG, "StrongBox unavailable — falling back to TEE", e);
            } catch (Exception e) {
                // Some OEM keystores throw generic exceptions when StrongBox is missing.
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
                    0, KeyProperties.AUTH_BIOMETRIC_STRONG);
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

    private void promptAndEnroll(PluginCall call, String password) {
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
                                                c.doFinal(password.getBytes(StandardCharsets.UTF_8));
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
                            : "Confirm to save unlock for HandCash";
            BiometricPrompt.PromptInfo info =
                    new BiometricPrompt.PromptInfo.Builder()
                            .setTitle("Enable biometric unlock")
                            .setSubtitle(subtitle)
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
