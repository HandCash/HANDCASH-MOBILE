package io.handcash.mobile;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.NoRouteToHostException;
import java.net.PortUnreachableException;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Draft BRC-246 IPv6 session socket. The WebView signs every handshake; this
 * process only binds, frames, and fails fast — same contract as Desktop
 * {@code electron/directSessionServer.ts}.
 */
@CapacitorPlugin(name = "DirectSession")
public class DirectSessionPlugin extends Plugin {
    private static final String TAG = "DirectSession";
    private static final int RACE_MS = 300;
    private static final int MAX_FRAME = 256 * 1024;
    private static final int HELLO_MS = 2_000;

    private final Map<String, LiveSocket> sockets = new ConcurrentHashMap<>();
    private final Map<String, CountDownLatch> pendingAcks = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger(1);
    private final ExecutorService pool = Executors.newCachedThreadPool();

    private ServerSocket server;
    private String listenHost;
    private int listenPort;
    private volatile boolean accepting;

    private static final class LiveSocket {
        final String id;
        final Socket socket;
        final DataInputStream in;
        final OutputStream out;
        volatile String peer = "";
        volatile boolean handshake;

        LiveSocket(String id, Socket socket) throws IOException {
            this.id = id;
            this.socket = socket;
            this.in = new DataInputStream(socket.getInputStream());
            this.out = socket.getOutputStream();
        }
    }

    @PluginMethod
    public void listen(PluginCall call) {
        pool.execute(() -> {
            try {
                JSObject already = currentEndpoint();
                if (already != null) {
                    call.resolve(already);
                    return;
                }
                String host = firstGlobalIpv6();
                if (host == null) {
                    call.resolve(new JSObject());
                    return;
                }
                InetAddress addr = InetAddress.getByName(host);
                ServerSocket bound = new ServerSocket();
                bound.setReuseAddress(true);
                bound.bind(new InetSocketAddress(addr, 0));
                int port = bound.getLocalPort();
                server = bound;
                listenHost = host;
                listenPort = port;
                accepting = true;
                pool.execute(this::acceptLoop);
                if (!proveLocalAccept(host, port)) {
                    stopListen();
                    Log.i(TAG, "local IPv6 accept failed; not advertising");
                    call.resolve(new JSObject());
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("host", host);
                ret.put("port", port);
                Log.i(TAG, "listening on [" + host + "]:" + port);
                call.resolve(ret);
            } catch (Exception e) {
                stopListen();
                Log.w(TAG, "listen failed: " + e.getMessage());
                call.resolve(new JSObject());
            }
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host", "");
        Integer port = call.getInt("port");
        Integer timeoutMs = call.getInt("timeoutMs");
        String hello = call.getString("hello", "");
        if (host == null || host.isEmpty() || port == null || hello.isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("immediate", true);
            call.resolve(ret);
            return;
        }
        if (!isGlobalUnicastIpv6(host)) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("immediate", true);
            call.resolve(ret);
            return;
        }
        int budget = timeoutMs == null ? RACE_MS : Math.min(Math.max(timeoutMs, 50), 1_000);
        pool.execute(() -> {
            Socket socket = new Socket();
            try {
                socket.connect(new InetSocketAddress(InetAddress.getByName(host), port), budget);
                socket.setTcpNoDelay(true);
                socket.setSoTimeout(budget);
                LiveSocket live = new LiveSocket("s" + seq.getAndIncrement(), socket);
                writeFrame(live, hello);
                String welcome = readFrame(live);
                live.handshake = true;
                live.peer = speakerOfHello(hello);
                live.socket.setSoTimeout(0);
                sockets.put(live.id, live);
                pool.execute(() -> readLoop(live));
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("remoteHello", welcome);
                ret.put("socketId", live.id);
                call.resolve(ret);
            } catch (Exception e) {
                try {
                    socket.close();
                } catch (IOException ignored) {
                    /* closed */
                }
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("immediate", immediateFail(e));
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void send(PluginCall call) {
        String socketId = call.getString("socketId", "");
        String body = call.getString("body", "");
        Integer timeoutMs = call.getInt("timeoutMs");
        LiveSocket live = sockets.get(socketId);
        if (live == null || !live.handshake || body.isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        String id;
        try {
            id = new JSONObject(body).optString("id", "");
        } catch (Exception e) {
            id = "";
        }
        if (id.isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        int budget = timeoutMs == null ? RACE_MS : timeoutMs;
        String ackKey = live.id + ":" + id;
        CountDownLatch latch = new CountDownLatch(1);
        pendingAcks.put(ackKey, latch);
        pool.execute(() -> {
            boolean ok = false;
            try {
                writeFrame(live, body);
                ok = latch.await(budget, TimeUnit.MILLISECONDS);
            } catch (Exception e) {
                ok = false;
            }
            pendingAcks.remove(ackKey);
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        dropSocket(call.getString("socketId", ""));
        call.resolve();
    }

    @PluginMethod
    public void accept(PluginCall call) {
        String socketId = call.getString("socketId", "");
        String welcome = call.getString("welcome", "");
        LiveSocket live = sockets.get(socketId);
        if (live == null) {
            call.resolve();
            return;
        }
        live.handshake = true;
        try {
            writeFrame(live, welcome);
        } catch (IOException e) {
            dropSocket(socketId);
        }
        call.resolve();
    }

    @PluginMethod
    public void reject(PluginCall call) {
        dropSocket(call.getString("socketId", ""));
        call.resolve();
    }

    private JSObject currentEndpoint() {
        if (server == null || server.isClosed() || listenHost == null) return null;
        JSObject ret = new JSObject();
        ret.put("host", listenHost);
        ret.put("port", listenPort);
        return ret;
    }

    private void acceptLoop() {
        while (accepting && server != null && !server.isClosed()) {
            try {
                Socket incoming = server.accept();
                incoming.setTcpNoDelay(true);
                pool.execute(() -> acceptInbound(incoming));
            } catch (IOException e) {
                if (accepting) Log.w(TAG, "accept failed: " + e.getMessage());
                break;
            }
        }
    }

    private void acceptInbound(Socket socket) {
        String id = "s" + seq.getAndIncrement();
        try {
            LiveSocket live = new LiveSocket(id, socket);
            sockets.put(id, live);
            socket.setSoTimeout(HELLO_MS);
            String hello = readFrame(live);
            JSONObject parsed = new JSONObject(hello);
            live.peer = parsed.optString("speaker", "").trim().toLowerCase(Locale.US);
            socket.setSoTimeout(0);
            JSObject event = new JSObject();
            event.put("socketId", id);
            event.put("hello", hello);
            notifyListeners("hello", event);
            pool.execute(() -> readLoop(live));
        } catch (Exception e) {
            dropSocket(id);
            try {
                socket.close();
            } catch (IOException ignored) {
                /* closed */
            }
        }
    }

    private void readLoop(LiveSocket live) {
        try {
            while (!live.socket.isClosed()) {
                String json = readFrame(live);
                onLiveFrame(live, json);
            }
        } catch (Exception e) {
            dropSocket(live.id);
        }
    }

    private void onLiveFrame(LiveSocket live, String json) {
        JSONObject parsed;
        try {
            parsed = new JSONObject(json);
        } catch (Exception e) {
            dropSocket(live.id);
            return;
        }
        String type = parsed.optString("t", "");
        String id = parsed.optString("id", "");
        if ("ack".equals(type) && !id.isEmpty()) {
            CountDownLatch latch = pendingAcks.remove(live.id + ":" + id);
            if (latch != null) latch.countDown();
            return;
        }
        if ("msg".equals(type) && parsed.has("body") && !id.isEmpty()) {
            JSObject event = new JSObject();
            event.put("socketId", live.id);
            event.put("sender", live.peer);
            event.put("body", parsed.optString("body", ""));
            notifyListeners("message", event);
            try {
                JSONObject ack = new JSONObject();
                ack.put("t", "ack");
                ack.put("id", id);
                writeFrame(live, ack.toString());
            } catch (Exception e) {
                dropSocket(live.id);
            }
        }
    }

    private synchronized void writeFrame(LiveSocket live, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        if (body.length > MAX_FRAME) throw new IOException("session frame too large");
        ByteBuffer buf = ByteBuffer.allocate(4 + body.length);
        buf.order(ByteOrder.BIG_ENDIAN);
        buf.putInt(body.length);
        buf.put(body);
        live.out.write(buf.array());
        live.out.flush();
    }

    private static String readFrame(LiveSocket live) throws IOException {
        int len = live.in.readInt();
        if (len <= 0 || len > MAX_FRAME) throw new IOException("session frame rejected");
        byte[] body = new byte[len];
        live.in.readFully(body);
        return new String(body, StandardCharsets.UTF_8);
    }

    private void dropSocket(String id) {
        if (id == null || id.isEmpty()) return;
        LiveSocket live = sockets.remove(id);
        if (live == null) return;
        try {
            live.socket.close();
        } catch (IOException ignored) {
            /* closed */
        }
        JSObject event = new JSObject();
        event.put("socketId", id);
        notifyListeners("closed", event);
    }

    private void stopListen() {
        accepting = false;
        ServerSocket bound = server;
        server = null;
        listenHost = null;
        listenPort = 0;
        if (bound != null) {
            try {
                bound.close();
            } catch (IOException ignored) {
                /* closed */
            }
        }
    }

    private static boolean proveLocalAccept(String host, int port) {
        try (Socket probe = new Socket()) {
            probe.connect(new InetSocketAddress(InetAddress.getByName(host), port), 500);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private static String speakerOfHello(String hello) {
        try {
            JSONObject parsed = new JSONObject(hello);
            JSONObject offer = parsed.optJSONObject("offer");
            if (offer == null) return "";
            return offer.optString("identityKey", "").trim().toLowerCase(Locale.US);
        } catch (Exception e) {
            return "";
        }
    }

    private static boolean immediateFail(Exception e) {
        if (e instanceof ConnectException
                || e instanceof NoRouteToHostException
                || e instanceof PortUnreachableException
                || e instanceof UnknownHostException) {
            return true;
        }
        if (e instanceof SocketTimeoutException) return false;
        String msg = e.getMessage() == null ? "" : e.getMessage().toLowerCase(Locale.US);
        return msg.contains("refused")
                || msg.contains("unreachable")
                || msg.contains("no route")
                || msg.contains("reset")
                || msg.contains("enotfound")
                || msg.contains("eaddrnotavail");
    }

    static String firstGlobalIpv6() {
        try {
            for (NetworkInterface nic : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nic.isUp() || nic.isLoopback()) continue;
                for (InetAddress addr : Collections.list(nic.getInetAddresses())) {
                    if (!(addr instanceof Inet6Address)) continue;
                    if (addr.isLoopbackAddress() || addr.isMulticastAddress()) continue;
                    String host = stripZone(addr.getHostAddress());
                    if (isGlobalUnicastIpv6(host)) return host;
                }
            }
        } catch (SocketException e) {
            Log.w(TAG, "interface scan failed: " + e.getMessage());
        }
        return null;
    }

    static boolean isGlobalUnicastIpv6(String address) {
        String bare = stripZone(address);
        if (!bare.contains(":") || "::".equals(bare) || "::1".equals(bare)) return false;
        if (bare.startsWith("::ffff:")) return false;
        String head = bare.split(":", 2)[0];
        if (!head.matches("(?i)[0-9a-f]{1,4}")) return false;
        int first = Integer.parseInt(head, 16);
        if (first >= 0xfe80 && first <= 0xfebf) return false;
        if (first >= 0xfc00 && first <= 0xfdff) return false;
        if (first >= 0xff00) return false;
        return first >= 0x2000 && first <= 0x3fff;
    }

    private static String stripZone(String address) {
        if (address == null) return "";
        int pct = address.indexOf('%');
        String bare = (pct >= 0 ? address.substring(0, pct) : address).trim().toLowerCase(Locale.US);
        if (bare.startsWith("[") && bare.endsWith("]")) {
            return bare.substring(1, bare.length() - 1);
        }
        return bare;
    }
}
