package io.handcash.mobile;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Local BRC-100 HTTP bridge on loopback:3321 (IPv4 + IPv6).
 * Apps probe {@code http://localhost:3321} which often resolves to {@code ::1} on Android.
 * Foreground / heads-up UX for inbound requests is handled in JS ({@code backgroundRuntime.ts}).
 */
@CapacitorPlugin(name = "Brc100LocalBridge")
public class Brc100LocalBridgePlugin extends Plugin {
    private static final String TAG = "Brc100LocalBridge";
    private static final int PORT = 3321;
    private static final long REQUEST_TIMEOUT_MS = 120_000L;
    private static final String DISCOVERY_VERSION_JSON =
            "{\"version\":\"HandCash Mobile 0.1.0\"}";

    private final List<ServerSocket> serverSockets = new ArrayList<>();
    private ExecutorService acceptPool;
    private ExecutorService workerPool;
    private ExecutorService responsePool;
    private ScheduledExecutorService deadlines;
    private final java.util.Set<Socket> clients = ConcurrentHashMap.newKeySet();
    private final Semaphore connections = new Semaphore(64);
    private volatile boolean running = false;
    /** BRC-219: a request waiting on the user is never timed out. */
    private volatile Integer promptRequestId = null;
    private volatile boolean unboundPromptOpen = false;
    private final AtomicInteger requestIds = new AtomicInteger(1);
    private final Map<Integer, Pending> pending = new ConcurrentHashMap<>();
    private static final int MAX_IN_APP_PENDING = 64;
    private final AtomicInteger inAppPending = new AtomicInteger(0);
    private static final String TIMEOUT_JSON =
            "{\"status\":\"error\",\"code\":\"WALLET_BRIDGE_TIMEOUT\",\"description\":\"No renderer reply\"}";
    static final String STOPPED_JSON =
            "{\"status\":\"error\",\"code\":\"WALLET_BRIDGE_STOPPED\",\"description\":\"The HandCash bridge is not running\"}";
    private static final String BUSY_JSON =
            "{\"status\":\"error\",\"code\":\"WALLET_BRIDGE_BUSY\",\"description\":\"Too many requests in flight\"}";

    /** Where one request's answer goes: the loopback socket, or an app tab's channel. */
    interface Reply {
        void send(int status, String body);
        /** Release without an answer. */
        void abandon();
    }

    private static final class Pending {
        final Reply reply;
        volatile ScheduledFuture<?> deadline;

        Pending(Reply reply) {
            this.reply = reply;
        }
    }

    private final class SocketReply implements Reply {
        final Socket socket;
        final String httpVersion;

        SocketReply(Socket socket, String httpVersion) {
            this.socket = socket;
            this.httpVersion = httpVersion;
        }

        @Override
        public void send(int status, String body) {
            try {
                writeResponse(socket, httpVersion, status, body);
            } catch (IOException e) {
                Log.w(TAG, "respond failed", e);
            } finally {
                close(socket);
            }
        }

        @Override
        public void abandon() {
            close(socket);
        }
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
            acceptPool = Executors.newFixedThreadPool(2);
            workerPool = new ThreadPoolExecutor(8, 8, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(32));
            responsePool = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(64));
            deadlines = Executors.newSingleThreadScheduledExecutor();
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
    public void setPromptOpen(PluginCall call) {
        boolean open = Boolean.TRUE.equals(call.getBoolean("open", false));
        promptRequestId = open ? call.getInt("requestId") : null;
        unboundPromptOpen = open && promptRequestId == null;
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
        if (p.deadline != null) p.deadline.cancel(false);
        ExecutorService pool = responsePool;
        try {
            if (pool == null) throw new RejectedExecutionException("bridge stopped");
            pool.execute(() -> p.reply.send(status, body));
        } catch (RejectedExecutionException stopped) { p.reply.abandon(); }
        call.resolve();
    }

    /**
     * An app tab's request from {@link AppBrowserGuestPlugin}. {@code origin} is
     * the frame origin the WebView reported for the message, never a value the
     * page supplied, so the core may honor grants bound to the in-app channel.
     */
    void dispatchInApp(String method, String path, String body, String origin, Reply reply) {
        ScheduledExecutorService timers = deadlines;
        if (!running || timers == null) {
            reply.send(503, STOPPED_JSON);
            return;
        }
        String answer = nativeAnswer(method, path);
        if (answer != null) {
            reply.send(200, answer);
            return;
        }
        if (inAppPending.incrementAndGet() > MAX_IN_APP_PENDING) {
            inAppPending.decrementAndGet();
            reply.send(503, BUSY_JSON);
            return;
        }
        Reply counted = new Reply() {
            private final java.util.concurrent.atomic.AtomicBoolean done = new java.util.concurrent.atomic.AtomicBoolean();

            @Override
            public void send(int status, String responseBody) {
                if (!done.compareAndSet(false, true)) return;
                inAppPending.decrementAndGet();
                reply.send(status, responseBody);
            }

            @Override
            public void abandon() {
                send(503, STOPPED_JSON);
            }
        };
        int requestId = requestIds.getAndIncrement();
        Pending waiting = new Pending(counted);
        pending.put(requestId, waiting);
        try {
            waiting.deadline = timers.schedule(() -> expire(requestId), REQUEST_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (RejectedExecutionException stopped) {
            pending.remove(requestId);
            counted.abandon();
            return;
        }
        JSObject headers = new JSObject();
        headers.put("origin", origin);
        JSObject event = new JSObject();
        event.put("requestId", requestId);
        event.put("method", method);
        event.put("path", path);
        event.put("headers", headers);
        event.put("body", body);
        event.put("channel", "in-app");
        event.put("receivedAtMs", System.currentTimeMillis());
        notifyListeners("brc100Request", event);
    }

    /** Discovery answered natively so it never waits on the WebView JS thread. */
    private static String nativeAnswer(String method, String path) {
        if ("GET".equals(method) && "/health".equals(path)) {
            return "{\"ok\":true,\"service\":\"handcash-brc100\",\"bridge\":\"http\",\"platform\":\"android\"}";
        }
        if ("GET".equals(method) && "/manifest.json".equals(path)) {
            return "{"
                    + "\"short_name\":\"HandCash\","
                    + "\"name\":\"HandCash Mobile\","
                    + "\"display\":\"standalone\","
                    + "\"theme_color\":\"#00d46a\","
                    + "\"background_color\":\"#07140f\","
                    + "\"babbage\":{\"trust\":{\"name\":\"HandCash\",\"note\":\"Official HandCash Mobile — keys stay on your device\"}}"
                    + "}";
        }
        if ("POST".equals(method) && ("/getVersion".equals(path) || "getVersion".equals(path))) {
            return DISCOVERY_VERSION_JSON;
        }
        return null;
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
        if (deadlines != null) { deadlines.shutdownNow(); deadlines = null; }
        if (responsePool != null) { responsePool.shutdownNow(); responsePool = null; }
        promptRequestId = null;
        unboundPromptOpen = false;
        for (Pending p : pending.values()) {
            if (p.deadline != null) p.deadline.cancel(false);
            p.reply.abandon();
        }
        pending.clear();
        for (Socket socket : clients) close(socket);
    }

    @Override
    protected void handleOnDestroy() {
        stopServer();
        super.handleOnDestroy();
    }

    private void acceptLoop(ServerSocket serverSocket) {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket socket = serverSocket.accept();
                socket.setSoTimeout(10_000);
                if (!connections.tryAcquire()) { socket.close(); continue; }
                clients.add(socket);
                try { workerPool.execute(() -> handleClient(socket)); }
                catch (RejectedExecutionException busy) { close(socket); }
            } catch (IOException e) {
                if (running) Log.w(TAG, "accept failed", e);
                break;
            }
        }
    }

    private void handleClient(Socket socket) {
        try {
            BoundedHttpRequest request = BoundedHttpRequest.read(socket.getInputStream());
            String method = request.method;
            String path = request.path;
            String httpVersion = request.httpVersion;
            Map<String, String> headers = request.headers;

            // Permission UX is driven from JS (permissions.ts → focusWindow +
            // handcash:permission-request). Do not foreground or notify on every
            // :3321 call — connected apps poll isAuthenticated/getVersion often.

            if ("OPTIONS".equals(method)) {
                writeResponse(socket, httpVersion, 204, "");
                close(socket);
                return;
            }

            String answer = nativeAnswer(method, path);
            if (answer != null) {
                writeResponse(socket, httpVersion, 200, answer);
                close(socket);
                return;
            }

            int requestId = requestIds.getAndIncrement();
            pending.put(requestId, new Pending(new SocketReply(socket, httpVersion)));

            Pending waiting = pending.get(requestId);
            waiting.deadline = deadlines.schedule(() -> expire(requestId), REQUEST_TIMEOUT_MS, TimeUnit.MILLISECONDS);

            JSObject headersJson = new JSObject();
            for (Map.Entry<String, String> e : headers.entrySet()) {
                headersJson.put(e.getKey(), e.getValue());
            }

            JSObject event = new JSObject();
            event.put("requestId", requestId);
            event.put("method", method);
            event.put("path", path);
            event.put("headers", headersJson);
            event.put("body", request.body);
            // Wall clock, so JS can time the hop into a backgrounded WebView.
            event.put("receivedAtMs", System.currentTimeMillis());
            notifyListeners("brc100Request", event);
        } catch (Exception e) {
            try { writeResponse(socket, "HTTP/1.1", e instanceof BoundedHttpRequest.Invalid ? ((BoundedHttpRequest.Invalid) e).status : 400,
                    "{\"status\":\"error\",\"code\":\"INVALID_HTTP_REQUEST\"}"); }
            catch (IOException ignored) { }
            Log.w(TAG, "handleClient failed", e);
            close(socket);
        }
    }

    private void close(Socket socket) {
        // All admitted sockets consume exactly one permit; close is idempotent.
        synchronized (socket) {
            if (socket.isClosed()) return;
            try { socket.close(); } catch (IOException ignored) { }
            clients.remove(socket);
            connections.release();
        }
    }

    private void expire(int id) {
        Pending waiting = pending.get(id);
        if (waiting == null) return;
        if (unboundPromptOpen || Integer.valueOf(id).equals(promptRequestId)) {
            waiting.deadline = deadlines.schedule(() -> expire(id), 1, TimeUnit.SECONDS);
            return;
        }
        if (!pending.remove(id, waiting)) return;
        ExecutorService pool = responsePool;
        try {
            if (pool == null) throw new RejectedExecutionException("bridge stopped");
            pool.execute(() -> waiting.reply.send(504, TIMEOUT_JSON));
        } catch (RejectedExecutionException stopped) { waiting.reply.abandon(); }
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
