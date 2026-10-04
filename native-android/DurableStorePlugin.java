package io.handcash.mobile;

import android.util.Log;
import android.webkit.JavascriptInterface;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * The wallet core's durable store (`window.handcash.storageGetSync` /
 * `storageSetSync`), kept in app-private files instead of WebView
 * `localStorage`.
 *
 * Chromium caps `localStorage` at about 5MB per origin regardless of free
 * disk, and the core keeps activity, signed cheques, created BEEF, input locks
 * and outboxes there. A wallet with real history filled it and custody writes
 * started failing. This is the same contract Electron's `durableStore.ts`
 * meets on Desktop: synchronous reads served from memory, custody keys
 * committed to disk before success is returned, everything else coalesced.
 *
 * `@JavascriptInterface` calls are synchronous by design — the core's storage
 * API is — and are visible to every frame in the wallet WebView, which is why
 * the page forbids frames (`frame-src 'none'`). dApps run in
 * {@link DappBrowserActivity}, a separate WebView without this interface.
 */
@CapacitorPlugin(name = "DurableStore")
public class DurableStorePlugin extends Plugin {
    private static final String TAG = "DurableStore";
    static final String JS_NAME = "HandcashDurableStore";

    @Override
    public void load() {
        Store store = new Store(new File(getContext().getFilesDir(), "durable"));
        getBridge().getWebView().addJavascriptInterface(new JsInterface(store), JS_NAME);
    }

    /** What the page sees. Thin on purpose: every rule lives in {@link Store}. */
    static final class JsInterface {
        private final Store store;

        JsInterface(Store store) {
            this.store = store;
        }

        @JavascriptInterface
        public String get(String key) {
            return store.get(key);
        }

        @JavascriptInterface
        public boolean set(String key, String value, boolean allowVaultIdentityReplace) {
            return store.set(key, value, allowVaultIdentityReplace);
        }

        @JavascriptInterface
        public boolean remove(String key) {
            return store.remove(key);
        }

        @JavascriptInterface
        public String keys() {
            return new JSONArray(store.keys()).toString();
        }
    }

    static final class Store {
        private static final String VAULT_KEY = "handcash.brc100.vault.v1";
        private static final String VAULT_BACKUP_KEY = "handcash.brc100.vault.backup.v1";
        private static final String VAULT_HISTORY_PREFIX = "handcash.brc100.vault.history.";
        private static final int MAX_VAULT_HISTORY = 10;
        /** Longest plain file name; longer keys are hashed with a sidecar naming them. */
        private static final int MAX_PLAIN_NAME = 200;
        private static final String HASHED_PREFIX = "h-";
        private static final String KEY_SIDECAR = ".key";
        private static final String TMP_SUFFIX = ".tmp";
        /**
         * Recoverable signed bodies, outboxes, input ownership, enrollment and
         * published identity proofs reach disk before the page hears success.
         * Mirrors `requiresCommittedWrite` in Desktop `electron/durableStore.ts`.
         */
        private static final Pattern COMMITTED = Pattern.compile(
            "^(?:handcash\\.brc100\\.vault|handcash\\.wallet\\.(?:signedChequeArchive|pendingMinerOutbox|utxoLocks)"
                + "|handcash\\.brc29\\.pendingOutbox|handcash\\.item\\.pendingOutbox|handcash\\.brc100\\.deviceDek"
                + "|handcash\\.createdBeef|handcash\\.autoPayReservations|handcash\\.toolboxDatabasePointer"
                + "|handcash\\.publicIdentities|handcash\\.issuerIdentities)");
        /** Identity sentinel for a key known to be absent. */
        private static final String ABSENT = new String("");

        private final File dir;
        private final Map<String, String> cache = new ConcurrentHashMap<>();
        private final Map<String, String> pending = new ConcurrentHashMap<>();
        private final Object diskLock = new Object();
        private final ExecutorService writer = Executors.newSingleThreadExecutor();

        Store(File dir) {
            this.dir = dir;
            if (!dir.isDirectory() && !dir.mkdirs()) Log.e(TAG, "could not create " + dir);
        }

        String get(String key) {
            if (key == null || key.isEmpty()) return null;
            String held = cache.get(key);
            if (held != null) return held == ABSENT ? null : held;
            String read = readFile(key);
            cache.put(key, read == null ? ABSENT : read);
            return read;
        }

        synchronized boolean set(String key, String value, boolean allowVaultIdentityReplace) {
            if (key == null || key.isEmpty() || value == null) return false;
            if (value.isEmpty()) return remove(key);
            if (VAULT_KEY.equals(key)) {
                String previous = get(key);
                if (previous != null && !previous.equals(value)) {
                    if (!vaultReplaceAllowed(previous, value, allowVaultIdentityReplace)) return false;
                    if (!archiveVault(previous)) return false;
                }
            }
            return put(key, value);
        }

        synchronized boolean remove(String key) {
            if (key == null || key.isEmpty()) return false;
            if (VAULT_KEY.equals(key)) {
                String previous = get(key);
                if (previous != null && !archiveVault(previous)) return false;
            }
            synchronized (diskLock) {
                pending.remove(key);
                File file = fileFor(key);
                boolean ok = !file.exists() || file.delete();
                File sidecar = new File(dir, file.getName() + KEY_SIDECAR);
                if (sidecar.exists() && !sidecar.delete()) ok = false;
                if (ok) cache.put(key, ABSENT);
                return ok;
            }
        }

        synchronized List<String> keys() {
            Set<String> out = new HashSet<>();
            File[] files = dir.listFiles();
            if (files != null) {
                for (File file : files) {
                    String name = file.getName();
                    if (name.endsWith(TMP_SUFFIX) || name.endsWith(KEY_SIDECAR)) continue;
                    String key = keyOf(name);
                    if (key != null) out.add(key);
                }
            }
            for (Map.Entry<String, String> entry : cache.entrySet()) {
                if (entry.getValue() == ABSENT) out.remove(entry.getKey());
                else out.add(entry.getKey());
            }
            List<String> sorted = new ArrayList<>(out);
            Collections.sort(sorted);
            return sorted;
        }

        private boolean put(String key, String value) {
            if (COMMITTED.matcher(key).find()) {
                synchronized (diskLock) {
                    pending.remove(key);
                    if (!writeFile(key, value)) return false;
                }
                cache.put(key, value);
                return true;
            }
            cache.put(key, value);
            // Coalesce: a burst of activity writes lands as the last value only.
            if (pending.put(key, value) == null) writer.execute(() -> flush(key));
            return true;
        }

        private void flush(String key) {
            synchronized (diskLock) {
                String value = pending.remove(key);
                if (value == null) return;
                if (!writeFile(key, value)) Log.e(TAG, "background write failed for " + key);
            }
        }

        private boolean vaultReplaceAllowed(String previous, String next, boolean allow) {
            try {
                String before = new JSONObject(previous).optString("identityKey", "");
                String after = new JSONObject(next).optString("identityKey", "");
                if (before.isEmpty() || after.isEmpty() || before.equals(after)) return true;
                if (!allow) {
                    Log.e(TAG, "blocked vault identity overwrite " + before.substring(0, Math.min(12, before.length()))
                        + " → " + after.substring(0, Math.min(12, after.length())));
                    return false;
                }
                Log.w(TAG, "allowing vault identity replace (recovery)");
                return true;
            } catch (Exception e) {
                Log.w(TAG, "vault guard parse failed — refusing write", e);
                return false;
            }
        }

        /** Keep the replaced vault, as Desktop does: a backup plus the last ten. */
        private boolean archiveVault(String previous) {
            if (!put(VAULT_BACKUP_KEY, previous)) return false;
            if (!put(VAULT_HISTORY_PREFIX + System.currentTimeMillis(), previous)) return false;
            List<String> history = new ArrayList<>();
            for (String key : keys()) if (key.startsWith(VAULT_HISTORY_PREFIX)) history.add(key);
            Collections.sort(history);
            while (history.size() > MAX_VAULT_HISTORY) remove(history.remove(0));
            return true;
        }

        private File fileFor(String key) {
            String plain = encode(key);
            if (plain.length() <= MAX_PLAIN_NAME) return new File(dir, plain);
            return new File(dir, HASHED_PREFIX + sha256Hex(key));
        }

        private String keyOf(String name) {
            if (name.startsWith(HASHED_PREFIX)) {
                byte[] raw = readBytes(new File(dir, name + KEY_SIDECAR));
                return raw == null ? null : new String(raw, StandardCharsets.UTF_8);
            }
            return decode(name);
        }

        private String readFile(String key) {
            byte[] raw = readBytes(fileFor(key));
            return raw == null ? null : new String(raw, StandardCharsets.UTF_8);
        }

        private boolean writeFile(String key, String value) {
            File file = fileFor(key);
            if (file.getName().startsWith(HASHED_PREFIX)) {
                File sidecar = new File(dir, file.getName() + KEY_SIDECAR);
                if (!sidecar.exists() && !replace(sidecar, key.getBytes(StandardCharsets.UTF_8))) return false;
            }
            return replace(file, value.getBytes(StandardCharsets.UTF_8));
        }

        /** Write a sibling, fsync it, then rename over the target. */
        private boolean replace(File target, byte[] bytes) {
            File tmp = new File(dir, target.getName() + TMP_SUFFIX);
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(bytes);
                out.getFD().sync();
            } catch (IOException e) {
                Log.e(TAG, "write failed " + target.getName(), e);
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                return false;
            }
            if (!tmp.renameTo(target)) {
                Log.e(TAG, "rename failed " + target.getName());
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                return false;
            }
            return true;
        }

        private static byte[] readBytes(File file) {
            if (!file.isFile()) return null;
            try (FileInputStream in = new FileInputStream(file)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.max(32, file.length()));
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return out.toByteArray();
            } catch (IOException e) {
                Log.e(TAG, "read failed " + file.getName(), e);
                return null;
            }
        }

        /** File-name safe and reversible: `[A-Za-z0-9._-]` as is, every other UTF-8 byte as `%XX`. */
        static String encode(String key) {
            StringBuilder out = new StringBuilder(key.length() + 16);
            for (byte b : key.getBytes(StandardCharsets.UTF_8)) {
                int c = b & 0xff;
                boolean plain = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || c == '.' || c == '_' || c == '-';
                if (plain) out.append((char) c);
                else out.append('%').append(Character.toUpperCase(Character.forDigit(c >> 4, 16)))
                    .append(Character.toUpperCase(Character.forDigit(c & 0xf, 16)));
            }
            // A leading dot would hide the file and `h-` names belong to hashed keys.
            String name = out.toString();
            if (name.startsWith(".") || name.startsWith(HASHED_PREFIX)) {
                name = String.format("%%%02X", (int) name.charAt(0)) + name.substring(1);
            }
            return name;
        }

        static String decode(String name) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(name.length());
            for (int i = 0; i < name.length(); i++) {
                char c = name.charAt(i);
                if (c != '%') {
                    out.write(c);
                    continue;
                }
                if (i + 2 >= name.length()) return null;
                int hi = Character.digit(name.charAt(i + 1), 16);
                int lo = Character.digit(name.charAt(i + 2), 16);
                if (hi < 0 || lo < 0) return null;
                out.write((hi << 4) | lo);
                i += 2;
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }

        private static String sha256Hex(String key) {
            try {
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
                StringBuilder out = new StringBuilder(64);
                for (byte b : digest) out.append(String.format("%02x", b & 0xff));
                return out.toString();
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
    }
}
