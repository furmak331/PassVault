package com.passvaultify.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;

/**
 * The whole API over real HTTP. Runs once per database: see the subclasses.
 * Every check here is something a client or an attacker could observe.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
abstract class ServerTests {
  @LocalServerPort int port;
  Api api;

  @BeforeEach
  void client() {
    api = new Api(port);
  }

  // Server

  @Test
  void healthAndIdentity() {
    assertThat(api.get("/health", null).text("status")).isEqualTo("ok");
    Api.Response info = api.get("/v1/server", null);
    assertThat(info.text("fingerprint")).matches("[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}");
    assertThat(info.text("registration")).isEqualTo("open");
    // The fingerprint is stable across requests.
    assertThat(api.get("/v1/server", null).text("fingerprint")).isEqualTo(info.text("fingerprint"));
  }

  @Test
  void apiResponsesCarryHardeningHeaders() {
    Api.Response r = api.get("/health", null);
    assertThat(r.headers().firstValue("X-Content-Type-Options")).hasValue("nosniff");
    assertThat(r.headers().firstValue("Cache-Control")).hasValue("no-store");
  }

  @Test
  void corsAllowsAnyOriginWithoutCredentials() throws Exception {
    HttpResponse<String> preflight = api.http.send(api.request("/v1/sync", null)
        .method("OPTIONS", HttpRequest.BodyPublishers.noBody())
        .header("Origin", "chrome-extension://abcdefghijklmnopabcdefghijklmnop")
        .header("Access-Control-Request-Method", "GET")
        .header("Access-Control-Request-Headers", "authorization")
        .build(), HttpResponse.BodyHandlers.ofString());
    assertThat(preflight.statusCode()).isEqualTo(200);
    assertThat(preflight.headers().firstValue("Access-Control-Allow-Origin")).hasValue("*");
    assertThat(preflight.headers().firstValue("Access-Control-Allow-Credentials")).isEmpty();
  }

  // Accounts and sign-in

  @Test
  void preloginReturnsTheRealSettingsOrStableFakeOnes() {
    Api.Account account = api.signUp();
    @SuppressWarnings("unchecked")
    Map<String, Object> kdf = (Map<String, Object>) account.header().get("kdf");
    JsonNode real = api.post("/v1/auth/prelogin", Map.of("email", account.email().toUpperCase()), null).body().path("kdf");
    assertThat(real.path("salt").asString()).isEqualTo(kdf.get("salt"));

    String nobody = Api.email();
    JsonNode fake1 = api.post("/v1/auth/prelogin", Map.of("email", nobody), null).body().path("kdf");
    JsonNode fake2 = api.post("/v1/auth/prelogin", Map.of("email", nobody), null).body().path("kdf");
    assertThat(fake1.path("alg").asString()).isEqualTo("pbkdf2-sha256");
    assertThat(fake1.path("iterations").asInt()).isEqualTo(600000);
    assertThat(fake1.path("salt").asString()).hasSize(22).isEqualTo(fake2.path("salt").asString());
    assertThat(api.post("/v1/auth/prelogin", Map.of("email", Api.email()), null).body().path("kdf").path("salt").asString())
        .isNotEqualTo(fake1.path("salt").asString());
  }

  @Test
  void signUpValidatesEverythingItStores() {
    String email = Api.email();
    Map<String, Object> good = Map.of("email", email, "authKey", Api.key(), "header", Api.header("7F3A 91C2 0E5B"));
    List<Map<String, Object>> bad = List.of(
        Map.of("email", "not-an-email", "authKey", Api.key(), "header", Api.header("7F3A 91C2 0E5B")),
        Map.of("email", email, "authKey", "c2hvcnQ", "header", Api.header("7F3A 91C2 0E5B")),
        Map.of("email", email, "authKey", Api.key(), "header", Api.header("not a fingerprint")),
        Map.of("email", email, "authKey", Api.key(), "header", Map.of("format", "pvf2")));
    for (Map<String, Object> body : bad) {
      Api.Response r = api.post("/v1/accounts", body, null);
      assertThat(r.status()).as(body.toString()).isEqualTo(400);
      assertThat(r.headers().firstValue("Content-Type")).hasValueSatisfying(t -> assertThat(t).contains("problem+json"));
    }
    assertThat(api.post("/v1/accounts", good, null).status()).isEqualTo(201);
    assertThat(api.post("/v1/accounts", Map.of("email", email.toUpperCase(), "authKey", Api.key(),
        "header", Api.header("7F3A 91C2 0E5B")), null).status()).isEqualTo(409);
  }

  @Test
  void signInChecksTheAuthKeyAndReturnsTheHeader() {
    Api.Account account = api.signUp();
    assertThat(api.signIn(account.email(), Api.key(), "Phone").status()).isEqualTo(401);
    assertThat(api.signIn(Api.email(), Api.key(), "Phone").status()).isEqualTo(401);
    Api.Response ok = api.signIn(account.email(), account.authKey(), "Phone");
    assertThat(ok.status()).isEqualTo(200);
    assertThat(ok.body().path("header").path("fingerprint").asString()).isEqualTo("7F3A 91C2 0E5B");
    assertThat(ok.body().path("tokens").path("accessToken").asString()).startsWith("pva_");
    assertThat(ok.body().path("tokens").path("expiresIn").asInt()).isEqualTo(900);
  }

  @Test
  void repeatedWrongPasswordsAreSlowedDown() {
    Api.Account account = api.signUp();
    for (int i = 0; i < 10; i++) {
      // Spread over addresses, so it's the per-email limit that trips.
      Api other = new Api(port);
      assertThat(other.signIn(account.email(), Api.key(), "Laptop").status()).isEqualTo(401);
    }
    Api.Response limited = new Api(port).signIn(account.email(), account.authKey(), "Laptop");
    assertThat(limited.status()).isEqualTo(429);
    assertThat(limited.headers().firstValue("Retry-After")).isPresent();
  }

  @Test
  void requestsWithoutAValidTokenAreRefused() {
    assertThat(api.get("/v1/sync", null).status()).isEqualTo(401);
    assertThat(api.get("/v1/sync", "pva_nonsense").status()).isEqualTo(401);
    assertThat(api.get("/v1/devices", null).headers().firstValue("WWW-Authenticate")).hasValue("Bearer");
  }

  @Test
  void refreshTokensRotateAndAReusedOneEndsTheSession() {
    Api.Account account = api.signUp();
    Api.Response first = api.post("/v1/auth/refresh", Map.of("refreshToken", account.refresh()), null);
    assertThat(first.status()).isEqualTo(200);
    String access = first.text("accessToken");
    assertThat(api.get("/v1/sync", access).status()).isEqualTo(200);
    // The old access token stops working once rotated.
    assertThat(api.get("/v1/sync", account.access()).status()).isEqualTo(401);

    // Someone replays the first refresh token: the whole session ends.
    assertThat(api.post("/v1/auth/refresh", Map.of("refreshToken", account.refresh()), null).status()).isEqualTo(401);
    assertThat(api.get("/v1/sync", access).status()).isEqualTo(401);
    assertThat(api.post("/v1/auth/refresh", Map.of("refreshToken", first.text("refreshToken")), null).status()).isEqualTo(401);
  }

  @Test
  void logoutEndsOnlyThisDevice() {
    Api.Account account = api.signUp();
    String phone = api.signIn(account.email(), account.authKey(), "Phone").body().path("tokens").path("accessToken").asString();
    assertThat(api.post("/v1/auth/logout", Map.of(), account.access()).status()).isEqualTo(204);
    assertThat(api.get("/v1/sync", account.access()).status()).isEqualTo(401);
    assertThat(api.get("/v1/sync", phone).status()).isEqualTo(200);
  }

  @Test
  void devicesCanBeListedAndSignedOutRemotely() {
    Api.Account account = api.signUp();
    String phone = api.signIn(account.email(), account.authKey(), "Phone").body().path("tokens").path("accessToken").asString();
    JsonNode devices = api.get("/v1/devices", account.access()).body();
    assertThat(devices).hasSize(2);
    JsonNode phoneDevice = Stream.of(devices.get(0), devices.get(1)).filter(d -> d.path("name").asString().equals("Phone")).findFirst().orElseThrow();
    assertThat(phoneDevice.path("current").asBoolean()).isFalse();

    assertThat(api.delete("/v1/devices/" + phoneDevice.path("id").asString(), null, account.access()).status()).isEqualTo(204);
    assertThat(api.get("/v1/sync", phone).status()).isEqualTo(401);
    assertThat(api.get("/v1/devices", account.access()).body()).hasSize(1);

    // Another account's device can't be touched.
    Api.Account stranger = api.signUp();
    String mine = api.get("/v1/devices", account.access()).body().get(0).path("id").asString();
    assertThat(api.delete("/v1/devices/" + mine, null, stranger.access()).status()).isEqualTo(404);
  }

  @Test
  void changingTheMasterPasswordSignsOutOtherDevices() {
    Api.Account account = api.signUp();
    String phone = api.signIn(account.email(), account.authKey(), "Phone").body().path("tokens").path("accessToken").asString();
    String newKey = Api.key();
    Map<String, Object> newHeader = Api.header("7F3A 91C2 0E5B");

    assertThat(api.put("/v1/vault/header", Map.of("currentAuthKey", Api.key(), "newAuthKey", newKey, "header", newHeader),
        account.access()).status()).isEqualTo(403);
    assertThat(api.put("/v1/vault/header", Map.of("currentAuthKey", account.authKey(), "newAuthKey", newKey,
        "header", Api.header("0000 0000 0000")), account.access()).status()).isEqualTo(400);
    assertThat(api.put("/v1/vault/header", Map.of("currentAuthKey", account.authKey(), "newAuthKey", newKey, "header", newHeader),
        account.access()).status()).isEqualTo(204);

    assertThat(api.get("/v1/sync", account.access()).status()).isEqualTo(200);
    assertThat(api.get("/v1/sync", phone).status()).isEqualTo(401);
    assertThat(api.signIn(account.email(), account.authKey(), "Phone").status()).isEqualTo(401);
    assertThat(api.signIn(account.email(), newKey, "Phone").body().path("header").path("wrappedVaultKey").asString())
        .isEqualTo(newHeader.get("wrappedVaultKey"));
  }

  @Test
  void deletingTheAccountRemovesEverything() {
    Api.Account account = api.signUp();
    api.put("/v1/items/" + Api.uuid(), Map.of("expectedRevision", 0, "deleted", false, "data", Api.envelope()), account.access());
    assertThat(api.delete("/v1/accounts/me", Map.of("authKey", Api.key()), account.access()).status()).isEqualTo(403);
    assertThat(api.delete("/v1/accounts/me", Map.of("authKey", account.authKey()), account.access()).status()).isEqualTo(204);
    assertThat(api.get("/v1/sync", account.access()).status()).isEqualTo(401);
    assertThat(api.signIn(account.email(), account.authKey(), "Laptop").status()).isEqualTo(401);
    // The email can be used again.
    assertThat(api.post("/v1/accounts", Map.of("email", account.email(), "authKey", Api.key(),
        "header", Api.header("7F3A 91C2 0E5B")), null).status()).isEqualTo(201);
  }

  // Sync

  @Test
  void itemsSyncByRevisionIncludingDeletions() {
    Api.Account account = api.signUp();
    String a = Api.uuid();
    String b = Api.uuid();
    String dataA = Api.envelope();
    JsonNode savedA = api.put("/v1/items/" + a, Map.of("expectedRevision", 0, "deleted", false, "data", dataA), account.access()).body();
    assertThat(savedA.path("revision").asLong()).isEqualTo(1);
    assertThat(savedA.path("data").asString()).isEqualTo(dataA);
    api.put("/v1/items/" + b, Map.of("expectedRevision", 0, "deleted", false, "data", Api.envelope()), account.access());

    JsonNode all = api.get("/v1/sync", account.access()).body();
    assertThat(all.path("revision").asLong()).isEqualTo(2);
    assertThat(all.path("items")).hasSize(2);

    // Delete a: a tombstone with no data, at the next revision.
    JsonNode tombstone = api.put("/v1/items/" + a, Map.of("expectedRevision", 1, "deleted", true), account.access()).body();
    assertThat(tombstone.path("deleted").asBoolean()).isTrue();
    assertThat(tombstone.has("data")).isFalse();

    JsonNode since2 = api.get("/v1/sync?since=2", account.access()).body();
    assertThat(since2.path("revision").asLong()).isEqualTo(3);
    assertThat(since2.path("items")).hasSize(1);
    assertThat(since2.path("items").get(0).path("id").asString()).isEqualTo(a);
    assertThat(api.get("/v1/sync?since=3", account.access()).body().path("items")).isEmpty();
    // A client ahead of the server (restored from backup) gets everything again.
    assertThat(api.get("/v1/sync?since=99", account.access()).body().path("items")).hasSize(2);
  }

  @Test
  void staleWritesConflictAndReturnTheCurrentCopy() {
    Api.Account account = api.signUp();
    String id = Api.uuid();
    api.put("/v1/items/" + id, Map.of("expectedRevision", 0, "deleted", false, "data", Api.envelope()), account.access());
    String newer = Api.envelope();
    api.put("/v1/items/" + id, Map.of("expectedRevision", 1, "deleted", false, "data", newer), account.access());

    Api.Response stale = api.put("/v1/items/" + id, Map.of("expectedRevision", 1, "deleted", false, "data", Api.envelope()), account.access());
    assertThat(stale.status()).isEqualTo(409);
    assertThat(stale.body().path("current").path("revision").asLong()).isEqualTo(2);
    assertThat(stale.body().path("current").path("data").asString()).isEqualTo(newer);
    // A refused write doesn't move the vault's revision.
    assertThat(api.get("/v1/sync", account.access()).body().path("revision").asLong()).isEqualTo(2);
  }

  @Test
  void concurrentWritesToOneItemNeverBothWin() throws Exception {
    Api.Account account = api.signUp();
    String id = Api.uuid();
    api.put("/v1/items/" + id, Map.of("expectedRevision", 0, "deleted", false, "data", Api.envelope()), account.access());
    List<CompletableFuture<Integer>> writes = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      writes.add(CompletableFuture.supplyAsync(() -> api.put("/v1/items/" + id,
          Map.of("expectedRevision", 1, "deleted", false, "data", Api.envelope()), account.access()).status()));
    }
    List<Integer> statuses = writes.stream().map(CompletableFuture::join).toList();
    assertThat(statuses.stream().filter(s -> s == 200).count()).isEqualTo(1);
    assertThat(statuses.stream().filter(s -> s == 409).count()).isEqualTo(7);
  }

  @Test
  void itemsAreCheckedAndKeptPerAccount() {
    Api.Account owner = api.signUp();
    Api.Account other = api.signUp();
    String id = Api.uuid();
    assertThat(api.put("/v1/items/NOT-A-UUID", Map.of("expectedRevision", 0, "deleted", false, "data", Api.envelope()),
        owner.access()).status()).isEqualTo(400);
    assertThat(api.put("/v1/items/" + id, Map.of("expectedRevision", 0, "deleted", false, "data", "plaintext!"),
        owner.access()).status()).isEqualTo(400);
    assertThat(api.put("/v1/items/" + id, Map.of("expectedRevision", 0, "deleted", false,
        "data", "pvf1.AAAA." + "A".repeat(300_000)), owner.access()).status()).isIn(413);
    api.put("/v1/items/" + id, Map.of("expectedRevision", 0, "deleted", false, "data", Api.envelope()), owner.access());
    // The same item ID in another account is a different item.
    assertThat(api.get("/v1/sync", other.access()).body().path("items")).isEmpty();
    assertThat(api.put("/v1/items/" + id, Map.of("expectedRevision", 0, "deleted", false, "data", Api.envelope()),
        other.access()).status()).isEqualTo(200);
  }

  @Test
  void devicesHearAboutChangesAndSignOuts() throws Exception {
    Api.Account account = api.signUp();
    String phone = api.signIn(account.email(), account.authKey(), "Phone").body().path("tokens").path("accessToken").asString();
    List<String> lines = new CopyOnWriteArrayList<>();
    CompletableFuture<HttpResponse<Stream<String>>> stream = api.http.sendAsync(
        api.request("/v1/events", phone).header("Accept", "text/event-stream").GET().build(),
        HttpResponse.BodyHandlers.ofLines());
    CompletableFuture.runAsync(() -> stream.join().body().forEach(lines::add));

    waitFor(() -> lines.contains("event:vault-changed"));
    assertThat(lines).contains("data:{\"revision\":0}");

    api.put("/v1/items/" + Api.uuid(), Map.of("expectedRevision", 0, "deleted", false, "data", Api.envelope()), account.access());
    waitFor(() -> lines.contains("data:{\"revision\":1}"));

    String phoneId = Stream.of(api.get("/v1/devices", account.access()).body().get(0), api.get("/v1/devices", account.access()).body().get(1))
        .filter(d -> d.path("name").asString().equals("Phone")).findFirst().orElseThrow().path("id").asString();
    api.delete("/v1/devices/" + phoneId, null, account.access());
    waitFor(() -> lines.contains("event:session-ended"));
    assertThat(lines).noneMatch(l -> l.contains("pvf1."));
  }

  private static void waitFor(java.util.function.BooleanSupplier condition) throws InterruptedException {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (!condition.getAsBoolean()) {
      if (System.nanoTime() > deadline) throw new AssertionError("timed out");
      Thread.sleep(25);
    }
  }
}
