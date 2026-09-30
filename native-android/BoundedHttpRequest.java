package io.handcash.mobile;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Loopback HTTP framing counts bytes before decoding JSON. No Android dependencies. */
final class BoundedHttpRequest {
    static final int MAX_BODY = 8 * 1024 * 1024;
    static final int MAX_HEADERS = 16 * 1024;
    final String method, path, httpVersion, body;
    final Map<String, String> headers;
    static final class Invalid extends IOException {
        final int status;
        Invalid(int status, String message) { super(message); this.status = status; }
    }
    private BoundedHttpRequest(String method, String path, String version, Map<String, String> headers, String body) {
        this.method = method; this.path = path; this.httpVersion = version; this.headers = headers; this.body = body;
    }
    static BoundedHttpRequest read(InputStream in) throws IOException {
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        int matched = 0;
        byte[] end = {13, 10, 13, 10};
        while (matched != 4) {
            int b = in.read();
            if (b < 0) throw new EOFException("Incomplete HTTP headers");
            if (b > 127 || b == 0) throw new Invalid(400, "Invalid HTTP header encoding");
            header.write(b);
            if (header.size() > MAX_HEADERS) throw new Invalid(431, "HTTP headers too large");
            matched = b == end[matched] ? matched + 1 : (b == 13 ? 1 : 0);
        }
        String[] lines = header.toString(StandardCharsets.US_ASCII.name()).split("\r\n");
        String[] parts = lines[0].split(" ", -1);
        if (parts.length != 3 || !parts[0].matches("[A-Z]+") || !parts[1].startsWith("/") ||
            !("HTTP/1.1".equals(parts[2]) || "HTTP/1.0".equals(parts[2]))) throw new Invalid(400, "Invalid HTTP request line");
        if (lines.length > 65) throw new Invalid(431, "Too many headers");
        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon <= 0 || lines[i].length() > 8192) throw new Invalid(400, "Invalid header");
            String key = lines[i].substring(0, colon).toLowerCase(Locale.US);
            if (!key.matches("[a-z0-9!#$%&'*+.^_`|~-]+") || headers.containsKey(key)) throw new Invalid(400, "Ambiguous header");
            headers.put(key, lines[i].substring(colon + 1).trim());
        }
        if (headers.containsKey("transfer-encoding")) throw new Invalid(400, "Transfer encoding unsupported");
        String length = headers.getOrDefault("content-length", "0");
        if (!length.matches("[0-9]{1,10}")) throw new Invalid(400, "Invalid Content-Length");
        long size = Long.parseLong(length);
        if (size > MAX_BODY) throw new Invalid(413, "HTTP body too large");
        byte[] bytes = new byte[(int) size];
        int read = 0;
        while (read < bytes.length) {
            int count = in.read(bytes, read, bytes.length - read);
            if (count < 0) throw new EOFException("Incomplete HTTP body");
            read += count;
        }
        String body;
        try { body = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString(); }
        catch (CharacterCodingException e) { throw new Invalid(400, "Invalid UTF-8 body"); }
        String path = parts[1].split("\\?", 2)[0];
        return new BoundedHttpRequest(parts[0], path, parts[2], headers, body);
    }
}
