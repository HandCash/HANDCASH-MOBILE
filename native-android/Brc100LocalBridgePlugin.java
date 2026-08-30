package io.handcash.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.WindowManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Local BRC-100 HTTP bridge on loopback:3321 (IPv4 + IPv6).
 * Apps probe {@code http://localhost:3321} which often resolves to {@code ::1} on Android.
 */
@CapacitorPlugin(name = "Brc100LocalBridge")
public class Brc100LocalBridgePlugin extends Plugin {
    private static final String TAG = "Brc100LocalBridge";
    private static final int PORT = 3321;
    private static final long REQUEST_TIMEOUT_MS = 120_000L;
    private static final String DISCOVERY_VERSION_JSON =
            "{\"version\":\"HandCash Mobile 0.1.0\"}";
    private static final String WALLET_REQUEST_CHANNEL = "handcash_wallet_request";
    private static final int WALLET_REQUEST_NOTIF_ID = 3321;
    private static final int MINT_COLOR = 0xFFC8FFE0;

    private final List<ServerSocket> serverSockets = new ArrayList<>();
    private ExecutorService acceptPool;
    private ExecutorService workerPool;
    private volatile boolean running = false;
    private final AtomicInteger requestIds = new AtomicInteger(1);
    private final Map<Integer, Pending> pending = new ConcurrentHashMap<>();

    private static final class Pending {
        final Socket socket;
        final String httpVersion;

        Pending(Socket socket, String httpVersion) {
            this.socket = socket;
            this.httpVersion = httpVersion;
        }
    }

    @Override
    public void load() {
        super.load();
        new Handler(Looper.getMainLooper()).post(this::ensureWalletRequestChannel);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (running) {
            JSObject ret = new JSObject();
            ret.put("httpUrl", "http://127.0.0.1:" + PORT);
            ret.put("alreadyRunning", true);
            call.resolve(ret);
            return;
        }
        try {
            acceptPool = Executors.newCachedThreadPool();
            workerPool = Executors.newCachedThreadPool();
            // Bind both families — SDK uses localhost (often ::1); migrate uses 127.0.0.1.
            bindLoopback("127.0.0.1");
            try {
                bindLoopback("::1");
            } catch (IOException e) {
                Log.w(TAG, "IPv6 ::1 bind skipped: " + e.getMessage());
            }
            if (serverSockets.isEmpty()) {
                throw new IOException("No loopback address available for port " + PORT);
            }
            running = true;
            for (ServerSocket ss : serverSockets) {
                final ServerSocket listen = ss;
                acceptPool.execute(() -> acceptLoop(listen));
            }
            JSObject ret = new JSObject();
            ret.put("httpUrl", "http://127.0.0.1:" + PORT);
            ret.put("alreadyRunning", false);
            call.resolve(ret);
            Log.i(TAG, "BRC-100 bridge listening on 127.0.0.1 and ::1 port " + PORT);
        } catch (IOException e) {
            stopServer();
            call.reject("Could not bind BRC-100 bridge: " + e.getMessage(), e);
        }
    }

    private void bindLoopback(String host) throws IOException {
        ServerSocket ss = new ServerSocket(PORT, 50, InetAddress.getByName(host));
        serverSockets.add(ss);
        Log.i(TAG, "Bound http://" + host + ":" + PORT);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopServer();
        call.resolve();
    }

    @PluginMethod
    public void respond(PluginCall call) {
        Integer requestId = call.getInt("requestId");
        Integer status = call.getInt("status");
        String body = call.getString("body", "");
        if (requestId == null || status == null) {
            call.reject("requestId and status required");
            return;
        }
        Pending p = pending.remove(requestId);
        if (p == null) {
            call.resolve();
            return;
        }
        workerPool.execute(() -> {
            try {
                writeResponse(p.socket, p.httpVersion, status, body);
            } catch (IOException e) {
                Log.w(TAG, "respond failed", e);
            } finally {
                try {
                    p.socket.close();
                } catch (IOException ignored) {
                }
            }
        });
        call.resolve();
    }

    private void stopServer() {
        running = false;
        for (ServerSocket ss : serverSockets) {
            try {
                ss.close();
            } catch (IOException ignored) {
            }
        }
        serverSockets.clear();
        if (acceptPool != null) {
            acceptPool.shutdownNow();
            acceptPool = null;
        }
        if (workerPool != null) {
            workerPool.shutdownNow();
            workerPool = null;
        }
        for (Pending p : pending.values()) {
            try {
                p.socket.close();
            } catch (IOException ignored) {
            }
        }
        pending.clear();
    }

    @Override
    protected void handleOnDestroy() {
        stopServer();
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        try {
            Context ctx = getContext();
            if (ctx == null) return;
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(WALLET_REQUEST_NOTIF_ID);
        } catch (Exception ignored) {
        }
    }

    private void acceptLoop(ServerSocket serverSocket) {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket socket = serverSocket.accept();
                workerPool.execute(() -> handleClient(socket));
            } catch (IOException e) {
                if (running) Log.w(TAG, "accept failed", e);
                break;
            }
        }
    }

    private void handleClient(Socket socket) {
        try {
            BufferedReader reader =
                    new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) {
                socket.close();
                return;
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                socket.close();
                return;
            }
            String method = parts[0].toUpperCase(Locale.US);
            String pathQuery = parts[1];
            String httpVersion = parts.length >= 3 ? parts[2] : "HTTP/1.1";
            String path = pathQuery.contains("?") ? pathQuery.substring(0, pathQuery.indexOf('?')) : pathQuery;

            Map<String, String> headers = new HashMap<>();
            String line;
            int contentLength = 0;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0) {
                    String key = line.substring(0, idx).trim().toLowerCase(Locale.US);
                    String value = line.substring(idx + 1).trim();
                    headers.put(key, value);
                    if ("content-length".equals(key)) {
                        try {
                            contentLength = Integer.parseInt(value);
                        } catch (NumberFormatException ignored) {
                        }
                    }
                }
            }

            StringBuilder bodyBuilder = new StringBuilder();
            if (contentLength > 0) {
                char[] buf = new char[contentLength];
                int read = 0;
                while (read < contentLength) {
                    int n = reader.read(buf, read, contentLength - read);
                    if (n < 0) break;
                    read += n;
                }
                bodyBuilder.append(buf, 0, read);
            }

            bringWalletToFront();

            if ("OPTIONS".equals(method)) {
                writeResponse(socket, httpVersion, 204, "");
                socket.close();
                return;
            }

            if ("GET".equals(method) && "/health".equals(path)) {
                writeResponse(
                        socket,
                        httpVersion,
                        200,
                        "{\"ok\":true,\"service\":\"handcash-brc100\",\"bridge\":\"http\",\"platform\":\"android\"}");
                socket.close();
                return;
            }

            if ("GET".equals(method) && "/manifest.json".equals(path)) {
                String manifest =
                        "{"
                                + "\"short_name\":\"HandCash\","
                                + "\"name\":\"HandCash Mobile\","
                                + "\"display\":\"standalone\","
                                + "\"theme_color\":\"#00d46a\","
                                + "\"background_color\":\"#07140f\","
                                + "\"babbage\":{\"trust\":{\"name\":\"HandCash\",\"note\":\"Official HandCash Mobile — keys stay on your device\"}}"
                                + "}";
                writeResponse(socket, httpVersion, 200, manifest);
                socket.close();
                return;
            }

            // SDK discovery posts /getVersion — answer natively so detection
            // does not depend on the WebView JS thread being ready.
            if ("POST".equals(method) && ("/getVersion".equals(path) || "getVersion".equals(path))) {
                writeResponse(socket, httpVersion, 200, DISCOVERY_VERSION_JSON);
                socket.close();
                return;
            }

            int requestId = requestIds.getAndIncrement();
            pending.put(requestId, new Pending(socket, httpVersion));

            final int timeoutId = requestId;
            workerPool.execute(() -> {
                try {
                    Thread.sleep(REQUEST_TIMEOUT_MS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
                Pending timedOut = pending.remove(timeoutId);
                if (timedOut == null) return;
                try {
                    writeResponse(
                            timedOut.socket,
                            timedOut.httpVersion,
                            504,
                            "{\"status\":\"error\",\"code\":\"WALLET_BRIDGE_TIMEOUT\",\"description\":\"No renderer reply\"}");
                } catch (IOException ignored) {
                } finally {
                    try {
                        timedOut.socket.close();
                    } catch (IOException ignored) {
                    }
                }
            });

            JSObject headersJson = new JSObject();
            for (Map.Entry<String, String> e : headers.entrySet()) {
                headersJson.put(e.getKey(), e.getValue());
            }

            JSObject event = new JSObject();
            event.put("requestId", requestId);
            event.put("method", method);
            event.put("path", path);
            event.put("headers", headersJson);
            event.put("body", bodyBuilder.toString());
            notifyListeners("brc100Request", event);
        } catch (Exception e) {
            Log.w(TAG, "handleClient failed", e);
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    /**
     * Foreground the wallet on every inbound :3321 request.
     * Android 10+ blocks background startActivity; prefer the active Activity,
     * then fall back to the app context, and always surface a heads-up notification.
     */
    private void bringWalletToFront() {
        new Handler(Looper.getMainLooper()).post(() -> {
            Context app = resolveAppContext();
            if (app == null) return;

            tryMoveTaskToFront(app);
            tryStartWalletActivity(app);
            postWalletRequestHeadsUp(app);
        });
    }

    private Context resolveAppContext() {
        try {
            Context ctx = getContext();
            if (ctx == null) {
                Activity activity = getActivity();
                ctx = activity;
            }
            return ctx != null ? ctx.getApplicationContext() : null;
        } catch (Exception e) {
            Log.w(TAG, "resolveAppContext failed", e);
            return null;
        }
    }

    private void tryMoveTaskToFront(Context app) {
        try {
            ActivityManager am = (ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return;
            List<ActivityManager.AppTask> tasks = am.getAppTasks();
            if (tasks != null && !tasks.isEmpty()) {
                tasks.get(0).moveToFront();
            }
        } catch (Exception e) {
            Log.w(TAG, "moveTaskToFront failed", e);
        }
    }

    private void tryStartWalletActivity(Context app) {
        Intent launch = walletLaunchIntent(app);
        Activity activity = null;
        try {
            activity = getActivity();
        } catch (Exception ignored) {
        }

        if (activity != null) {
            try {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } catch (Exception ignored) {
            }
            try {
                activity.startActivity(launch);
                return;
            } catch (Exception e) {
                Log.w(TAG, "activity startActivity failed", e);
            }
        }

        try {
            app.startActivity(launch);
        } catch (Exception e) {
            Log.w(TAG, "app startActivity blocked (expected on Android 10+ when backgrounded)", e);
        }
    }

    private Intent walletLaunchIntent(Context app) {
        Intent launch = app.getPackageManager().getLaunchIntentForPackage(app.getPackageName());
        if (launch == null) {
            launch = new Intent(app, MainActivity.class);
            launch.setAction(Intent.ACTION_MAIN);
            launch.addCategory(Intent.CATEGORY_LAUNCHER);
        }
        launch.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return launch;
    }

    private void ensureWalletRequestChannel() {
        Context ctx;
        try {
            ctx = getContext();
        } catch (Exception e) {
            return;
        }
        if (ctx == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel channel =
                        new NotificationChannel(
                                WALLET_REQUEST_CHANNEL,
                                "Wallet requests",
                                NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Heads-up when a browser app asks the wallet");
                channel.setShowBadge(true);
                channel.enableLights(true);
                channel.setLightColor(MINT_COLOR);
                channel.enableVibration(true);
                try {
                    channel.setBypassDnd(true);
                } catch (Exception ignored) {
                }
                nm.createNotificationChannel(channel);
            }
        }
        maybeRequestNotificationPermission();
    }

    private void maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        Activity act;
        try {
            act = getActivity();
        } catch (Exception e) {
            return;
        }
        if (act == null) return;
        if (ContextCompat.checkSelfPermission(act, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            act.requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, WALLET_REQUEST_NOTIF_ID);
        } catch (Exception e) {
            Log.w(TAG, "POST_NOTIFICATIONS request failed", e);
        }
    }

    private void postWalletRequestHeadsUp(Context app) {
        try {
            Intent launch = walletLaunchIntent(app);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                piFlags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent content =
                    PendingIntent.getActivity(app, WALLET_REQUEST_NOTIF_ID, launch, piFlags);

            NotificationCompat.Builder builder =
                    new NotificationCompat.Builder(app, WALLET_REQUEST_CHANNEL)
                            .setSmallIcon(R.drawable.ic_stat_handcash)
                            .setContentTitle("HandCash")
                            .setContentText("Wallet request")
                            .setPriority(NotificationCompat.PRIORITY_HIGH)
                            .setCategory(NotificationCompat.CATEGORY_CALL)
                            .setColor(MINT_COLOR)
                            .setAutoCancel(true)
                            .setContentIntent(content)
                            .setFullScreenIntent(content, true)
                            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                            .setDefaults(NotificationCompat.DEFAULT_ALL);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder.setColorized(true);
            }

            NotificationManager nm =
                    (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            nm.notify(WALLET_REQUEST_NOTIF_ID, builder.build());
        } catch (Exception e) {
            Log.w(TAG, "wallet request heads-up failed", e);
        }
    }

    private void writeResponse(Socket socket, String httpVersion, int status, String body)
            throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason =
                status == 204
                        ? "No Content"
                        : status == 200
                                ? "OK"
                                : status == 503 ? "Service Unavailable" : "Error";
        StringBuilder sb = new StringBuilder();
        sb.append(httpVersion).append(' ').append(status).append(' ').append(reason).append("\r\n");
        // Match Desktop electron/httpServer.ts CORS (SDK sends Accept + Content-Type).
        sb.append("Access-Control-Allow-Origin: *\r\n");
        sb.append("Access-Control-Allow-Headers: *\r\n");
        sb.append("Access-Control-Allow-Methods: *\r\n");
        sb.append("Access-Control-Expose-Headers: *\r\n");
        sb.append("Access-Control-Allow-Private-Network: true\r\n");
        sb.append("Content-Type: application/json; charset=utf-8\r\n");
        sb.append("Content-Length: ").append(bytes.length).append("\r\n");
        sb.append("Connection: close\r\n\r\n");
        OutputStream out = socket.getOutputStream();
        out.write(sb.toString().getBytes(StandardCharsets.US_ASCII));
        if (bytes.length > 0) out.write(bytes);
        out.flush();
    }
}
