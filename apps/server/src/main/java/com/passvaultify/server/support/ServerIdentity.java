package com.passvaultify.server.support;

import java.time.Clock;
import java.util.Arrays;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * A random secret created on first start and kept in the database. Clients pin
 * the fingerprint derived from it, and it keys the fake KDF settings returned
 * for emails that have no account.
 */
@Component
public class ServerIdentity {
  private final byte[] secret;
  private final String fingerprint;

  public ServerIdentity(JdbcClient jdbc, Clock clock) {
    String stored = read(jdbc);
    if (stored == null) {
      try {
        jdbc.sql("INSERT INTO server_identity (id, secret, created_at) VALUES (1, ?, ?)")
            .params(Codec.b64(Codec.random(32)), clock.millis())
            .update();
      } catch (DuplicateKeyException raced) {
        // Another instance created it first; use theirs.
      }
      stored = read(jdbc);
    }
    this.secret = Codec.unb64(stored);
    this.fingerprint = Codec.fingerprint(Codec.hmac(secret, "passvaultify/v1/server-fingerprint"));
  }

  private static String read(JdbcClient jdbc) {
    return jdbc.sql("SELECT secret FROM server_identity WHERE id = 1")
        .query(String.class)
        .optional()
        .orElse(null);
  }

  public String fingerprint() {
    return fingerprint;
  }

  /** A stable, plausible salt for an email with no account, so prelogin can't enumerate accounts. */
  public byte[] fakeSalt(String email) {
    return Arrays.copyOf(Codec.hmac(secret, "passvaultify/v1/prelogin/" + email), 16);
  }
}
