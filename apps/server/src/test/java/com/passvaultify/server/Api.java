package com.passvaultify.server;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** A small HTTP client for the tests, speaking to the real server over a socket. */
final class Api {
  static final JsonMapper JSON = JsonMapper.builder().build();
  private static final SecureRandom RANDOM = new SecureRandom();

  final String base;
  /** Each test gets its own client address (via X-Forwarded-For), so rate limits don't leak between tests. */
  final String ip;
  final HttpClient http = HttpClient.newHttpClient();

  Api(int port) {
    this.base = "http://localhost:" + port;
    ThreadLocalRandom r = ThreadLocalRandom.current();
    this.ip = "10." + r.nextInt(256) + "." + r.nextInt(256) + "." + r.nextInt(1, 255);
  }

  record Response(int status, JsonNode body, java.net.http.HttpHeaders headers) {
    String text(String field) {
      return body.path(field).asString();
    }
  }

  Response get(String path, String token) {
    return send(request(path, token).GET().build());
  }

  Response post(String path, Object body, String token) {
    return send(request(path, token).POST(json(body)).build());
  }

  Response put(String path, Object body, String token) {
    return send(request(path, token).PUT(json(body)).build());
  }

  Response delete(String path, Object body, String token) {
    return send(request(path, token).method("DELETE", body == null ? HttpRequest.BodyPublishers.noBody() : json(body)).build());
  }

  HttpRequest.Builder request(String path, String token) {
    HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + path))
        .header("Content-Type", "application/json")
        .header("X-Forwarded-For", ip);
    if (token != null) b.header("Authorization", "Bearer " + token);
    return b;
  }

  private static HttpRequest.BodyPublisher json(Object body) {
    return HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body));
  }

  private Response send(HttpRequest request) {
    try {
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      JsonNode body = response.body().isEmpty() ? JSON.nullNode() : JSON.readTree(response.body());
      return new Response(response.statusCode(), body, response.headers());
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  // Test data shaped like what the TypeScript client sends.

  static String key() {
    byte[] bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  static String envelope() {
    byte[] iv = new byte[12];
    byte[] ct = new byte[48];
    RANDOM.nextBytes(iv);
    RANDOM.nextBytes(ct);
    Base64.Encoder e = Base64.getUrlEncoder().withoutPadding();
    return "pvf1." + e.encodeToString(iv) + "." + e.encodeToString(ct);
  }

  static Map<String, Object> header(String fingerprint) {
    byte[] salt = new byte[16];
    RANDOM.nextBytes(salt);
    return Map.of(
        "format", "pvf1",
        "kdf", Map.of("alg", "pbkdf2-sha256", "iterations", 600000,
            "salt", Base64.getUrlEncoder().withoutPadding().encodeToString(salt)),
        "wrappedVaultKey", envelope(),
        "fingerprint", fingerprint);
  }

  static String email() {
    return "user" + Math.abs(RANDOM.nextLong()) + "@example.com";
  }

  static String uuid() {
    return java.util.UUID.randomUUID().toString();
  }

  /** An account with one signed-in device. */
  record Account(String email, String authKey, Map<String, Object> header, String access, String refresh) {}

  Account signUp() {
    String email = email();
    String authKey = key();
    Map<String, Object> header = header("7F3A 91C2 0E5B");
    Response created = post("/v1/accounts", Map.of("email", email, "authKey", authKey, "header", header), null);
    if (created.status() != 201) throw new AssertionError("sign-up failed: " + created);
    Response login = signIn(email, authKey, "Laptop");
    return new Account(email, authKey, header, login.body().path("tokens").path("accessToken").asString(),
        login.body().path("tokens").path("refreshToken").asString());
  }

  Response signIn(String email, String authKey, String deviceName) {
    return post("/v1/auth/login", Map.of("email", email, "authKey", authKey,
        "device", Map.of("name", deviceName, "kind", "extension")), null);
  }
}
