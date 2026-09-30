package io.handcash.mobile;

import android.system.Os;
import android.system.OsConstants;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.DataInputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;

/** Private, append-only encrypted history files; independent of WebView data. */
@CapacitorPlugin(name = "Brc39Archive")
public class Brc39ArchivePlugin extends Plugin {
    private static final int MAX_BYTES = 16 * 1024 * 1024;
    private final ThreadPoolExecutor io = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(8));
    private interface Work { void run() throws Exception; }
    private void execute(PluginCall call, Work work) {
        try { io.execute(() -> {
            try { work.run(); } catch (Exception error) { call.reject("Local history archive failed: " + error.getMessage()); }
        }); } catch (RejectedExecutionException busy) { call.reject("Local history archive busy"); }
    }
    private File folder(String identity) throws Exception {
        if (identity == null || !identity.matches("(02|03)[0-9a-fA-F]{64}")) throw new IllegalArgumentException("Invalid wallet identity");
        File dir = new File(new File(getContext().getNoBackupFilesDir(), "brc39-archive"), identity.toLowerCase());
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("Archive directory unavailable");
        return dir;
    }
    private String digest(byte[] bytes) throws Exception {
        StringBuilder out = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) out.append(String.format(java.util.Locale.US, "%02x", b & 255));
        return out.toString();
    }
    private byte[] readBytes(File file) throws Exception {
        long length = file.length();
        if (length < 64 || length > MAX_BYTES) throw new IllegalArgumentException("Invalid archive size");
        byte[] bytes = new byte[(int) length];
        try (DataInputStream in = new DataInputStream(new FileInputStream(file))) {
            in.readFully(bytes);
            if (in.read() != -1) throw new IllegalStateException("Archive changed during read");
        }
        return bytes;
    }
    private void syncDirectory(File dir) throws Exception {
        FileDescriptor fd = Os.open(dir.getAbsolutePath(), OsConstants.O_RDONLY, 0);
        try { Os.fsync(fd); } finally { Os.close(fd); }
    }
    private JSObject metadata(File file, String identity) {
        String id = file.getName().replace(".brc39", "");
        JSObject meta = new JSObject();
        meta.put("id", id); meta.put("identityKey", identity.toLowerCase());
        meta.put("exportedAt", Long.parseLong(id.split("-", 2)[0])); meta.put("bytes", file.length());
        meta.put("sha256", id.split("-", 2)[1]); meta.put("path", file.getAbsolutePath());
        return meta;
    }
    @PluginMethod public void append(PluginCall call) { execute(call, () -> {
        String identity = call.getString("identityKey");
        String encoded = call.getString("bytesBase64", "");
        if (encoded.length() > ((MAX_BYTES + 2) / 3) * 4 + 4) throw new IllegalArgumentException("Backup exceeds 16 MB");
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
        if (bytes.length < 64 || bytes.length > MAX_BYTES) throw new IllegalArgumentException("Invalid backup size");
        File dir = folder(identity);
        String sha = digest(bytes);
        File[] previous = dir.listFiles((parent, name) -> name.matches("[0-9]{13}-" + sha + "\\.brc39"));
        if (previous != null) for (File candidate : previous) {
            boolean valid;
            try { valid = sha.equals(digest(readBytes(candidate))); }
            catch (Exception corrupt) { valid = false; }
            if (valid) {
                JSObject result = new JSObject(); result.put("created", false); result.put("meta", metadata(candidate, identity)); call.resolve(result); return;
            }
        }
        // Publish only a complete, synced snapshot. Temp files are never listed.
        File target = new File(dir, System.currentTimeMillis() + "-" + sha + ".brc39");
        if (target.exists()) throw new IllegalStateException("Archive already exists");
        File pending = File.createTempFile("pending-", ".tmp", dir);
        try {
            try (FileOutputStream out = new FileOutputStream(pending)) { out.write(bytes); out.getFD().sync(); }
            Os.rename(pending.getAbsolutePath(), target.getAbsolutePath());
            syncDirectory(dir);
        } finally { if (pending.exists()) pending.delete(); }
        JSObject result = new JSObject(); result.put("created", true); result.put("meta", metadata(target, identity)); call.resolve(result);
    }); }
    @PluginMethod public void list(PluginCall call) { execute(call, () -> {
        String identity = call.getString("identityKey");
        File[] files = folder(identity).listFiles((parent, name) -> name.matches("[0-9]{13}-[0-9a-f]{64}\\.brc39"));
        if (files == null) files = new File[0];
        Arrays.sort(files, Comparator.comparing(File::getName).reversed());
        JSArray rows = new JSArray();
        for (int i = 0; i < Math.min(files.length, 100); i++) rows.put(metadata(files[i], identity));
        JSObject result = new JSObject(); result.put("snapshots", rows); call.resolve(result);
    }); }
    @PluginMethod public void read(PluginCall call) { execute(call, () -> {
        String identity = call.getString("identityKey"); String id = call.getString("id", "");
        if (!id.matches("[0-9]{13}-[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid archive id");
        File file = new File(folder(identity), id + ".brc39");
        if (file.length() < 64 || file.length() > MAX_BYTES) throw new IllegalArgumentException("Invalid archive size");
        byte[] bytes = readBytes(file);
        if (!digest(bytes).equals(id.split("-", 2)[1])) throw new IllegalStateException("Archive checksum mismatch");
        JSObject result = new JSObject(); result.put("bytesBase64", Base64.encodeToString(bytes, Base64.NO_WRAP)); call.resolve(result);
    }); }
    @Override protected void handleOnDestroy() { io.shutdownNow(); super.handleOnDestroy(); }
}
