package com.passvaultify.server.sync;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Encrypted items. The server stores the pvf1 envelope as it arrived and never opens it. */
@Repository
public class ItemRepository {
  public record Item(String id, long revision, long updatedAt, boolean deleted, String data) {}

  private final JdbcClient jdbc;

  public ItemRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  private static Item map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
    return new Item(rs.getString("id"), rs.getLong("revision"), rs.getLong("updated_at"), rs.getBoolean("deleted"),
        rs.getString("data"));
  }

  public Optional<Item> find(String accountId, String id) {
    return jdbc.sql("SELECT id, revision, updated_at, deleted, data FROM items WHERE account_id = ? AND id = ?")
        .params(accountId, id).query(ItemRepository::map).optional();
  }

  public List<Item> since(String accountId, long revision) {
    return jdbc.sql("SELECT id, revision, updated_at, deleted, data FROM items WHERE account_id = ? AND revision > ? ORDER BY revision")
        .params(accountId, revision).query(ItemRepository::map).list();
  }

  public long liveCount(String accountId) {
    return jdbc.sql("SELECT COUNT(*) FROM items WHERE account_id = ? AND deleted = ?")
        .params(accountId, false).query(Long.class).single();
  }

  public void insert(String accountId, Item item) {
    jdbc.sql("INSERT INTO items (account_id, id, revision, updated_at, deleted, data) VALUES (?, ?, ?, ?, ?, ?)")
        .params(accountId, item.id(), item.revision(), item.updatedAt(), item.deleted(), item.data()).update();
  }

  public void update(String accountId, Item item) {
    jdbc.sql("UPDATE items SET revision = ?, updated_at = ?, deleted = ?, data = ? WHERE account_id = ? AND id = ?")
        .params(item.revision(), item.updatedAt(), item.deleted(), item.data(), accountId, item.id()).update();
  }
}
