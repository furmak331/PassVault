package com.passvaultify.server.auth;

import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class AccountRepository {
  public record Account(String id, String email, String authHash, String headerJson, long revision) {}

  private final JdbcClient jdbc;

  public AccountRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  private static Account map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
    return new Account(rs.getString("id"), rs.getString("email"), rs.getString("auth_hash"),
        rs.getString("header_json"), rs.getLong("revision"));
  }

  public Optional<Account> findByEmail(String email) {
    return jdbc.sql("SELECT id, email, auth_hash, header_json, revision FROM accounts WHERE email = ?")
        .param(email).query(AccountRepository::map).optional();
  }

  public Optional<Account> find(String id) {
    return jdbc.sql("SELECT id, email, auth_hash, header_json, revision FROM accounts WHERE id = ?")
        .param(id).query(AccountRepository::map).optional();
  }

  public void insert(String id, String email, String authHash, String headerJson, long now) {
    jdbc.sql("INSERT INTO accounts (id, email, auth_hash, header_json, revision, created_at) VALUES (?, ?, ?, ?, 0, ?)")
        .params(id, email, authHash, headerJson, now).update();
  }

  public void updateAuth(String id, String authHash, String headerJson) {
    jdbc.sql("UPDATE accounts SET auth_hash = ?, header_json = ? WHERE id = ?").params(authHash, headerJson, id).update();
  }

  public long revision(String id) {
    return jdbc.sql("SELECT revision FROM accounts WHERE id = ?").param(id).query(Long.class).single();
  }

  /**
   * Takes the next vault revision. In PostgreSQL the UPDATE also locks the
   * account row until the transaction ends, so writes to one vault are
   * serialized; SQLite serializes all writes anyway.
   */
  public long nextRevision(String id) {
    jdbc.sql("UPDATE accounts SET revision = revision + 1 WHERE id = ?").param(id).update();
    return revision(id);
  }

  /** Removes the account with its devices and items. */
  public void delete(String id) {
    jdbc.sql("DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM sessions WHERE account_id = ?)").param(id).update();
    jdbc.sql("DELETE FROM sessions WHERE account_id = ?").param(id).update();
    jdbc.sql("DELETE FROM items WHERE account_id = ?").param(id).update();
    jdbc.sql("DELETE FROM accounts WHERE id = ?").param(id).update();
  }
}
