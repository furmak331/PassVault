package com.passvaultify.server.auth;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Signed-in devices and their refresh tokens. Tokens are stored only as SHA-256 hashes. */
@Repository
public class SessionRepository {
  public record Session(String id, String accountId, String deviceName, String deviceKind, long accessExpiresAt,
      long refreshExpiresAt, long createdAt, long lastSeenAt) {}

  public record RefreshToken(String sessionId, boolean used) {}

  private static final String COLUMNS =
      "id, account_id, device_name, device_kind, access_expires_at, refresh_expires_at, created_at, last_seen_at";

  private final JdbcClient jdbc;

  public SessionRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  private static Session map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
    return new Session(rs.getString("id"), rs.getString("account_id"), rs.getString("device_name"),
        rs.getString("device_kind"), rs.getLong("access_expires_at"), rs.getLong("refresh_expires_at"),
        rs.getLong("created_at"), rs.getLong("last_seen_at"));
  }

  public Optional<Session> findByAccessHash(String accessHash) {
    return jdbc.sql("SELECT " + COLUMNS + " FROM sessions WHERE access_hash = ?")
        .param(accessHash).query(SessionRepository::map).optional();
  }

  public Optional<Session> find(String id) {
    return jdbc.sql("SELECT " + COLUMNS + " FROM sessions WHERE id = ?").param(id).query(SessionRepository::map).optional();
  }

  public List<Session> forAccount(String accountId) {
    return jdbc.sql("SELECT " + COLUMNS + " FROM sessions WHERE account_id = ? ORDER BY last_seen_at DESC")
        .param(accountId).query(SessionRepository::map).list();
  }

  public void insert(Session s, String accessHash) {
    jdbc.sql("INSERT INTO sessions (" + COLUMNS + ", access_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .params(s.id(), s.accountId(), s.deviceName(), s.deviceKind(), s.accessExpiresAt(), s.refreshExpiresAt(),
            s.createdAt(), s.lastSeenAt(), accessHash)
        .update();
  }

  public void rotate(String id, String accessHash, long accessExpiresAt, long refreshExpiresAt, long now) {
    jdbc.sql("UPDATE sessions SET access_hash = ?, access_expires_at = ?, refresh_expires_at = ?, last_seen_at = ? WHERE id = ?")
        .params(accessHash, accessExpiresAt, refreshExpiresAt, now, id)
        .update();
  }

  public void touch(String id, long now) {
    jdbc.sql("UPDATE sessions SET last_seen_at = ? WHERE id = ?").params(now, id).update();
  }

  public void delete(String id) {
    jdbc.sql("DELETE FROM refresh_tokens WHERE session_id = ?").param(id).update();
    jdbc.sql("DELETE FROM sessions WHERE id = ?").param(id).update();
  }

  public void insertRefresh(String tokenHash, String sessionId) {
    jdbc.sql("INSERT INTO refresh_tokens (token_hash, session_id, used) VALUES (?, ?, ?)")
        .params(tokenHash, sessionId, false).update();
  }

  public Optional<RefreshToken> findRefresh(String tokenHash) {
    return jdbc.sql("SELECT session_id, used FROM refresh_tokens WHERE token_hash = ?")
        .param(tokenHash)
        .query((rs, row) -> new RefreshToken(rs.getString("session_id"), rs.getBoolean("used")))
        .optional();
  }

  /**
   * Keeps only the token just used (to catch its reuse) and the live one;
   * older used tokens are dropped so the table doesn't grow with every refresh.
   */
  public void pruneUsedRefresh(String sessionId, String keepHash) {
    jdbc.sql("DELETE FROM refresh_tokens WHERE session_id = ? AND used = ? AND token_hash <> ?")
        .params(sessionId, true, keepHash).update();
  }

  /** Marks a refresh token used. False if it already was (two requests raced with one token). */
  public boolean markUsed(String tokenHash) {
    return jdbc.sql("UPDATE refresh_tokens SET used = ? WHERE token_hash = ? AND used = ?")
        .params(true, tokenHash, false).update() == 1;
  }
}
