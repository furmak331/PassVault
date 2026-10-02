package com.passvaultify.server.sync;

import com.passvaultify.server.api.Dto;
import com.passvaultify.server.api.Validate;
import com.passvaultify.server.auth.AccountRepository;
import com.passvaultify.server.auth.Caller;
import com.passvaultify.server.config.ServerProperties;
import com.passvaultify.server.support.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Every write takes the vault's next revision, and the item records it.
 * "Changes since n" is then a single indexed query, and deletions travel as
 * tombstones that keep their ID and revision.
 */
@Service
public class SyncService {
  private final AccountRepository accounts;
  private final ItemRepository items;
  private final EventBroker events;
  private final ServerProperties props;
  private final Clock clock;
  private final TransactionTemplate tx;

  public SyncService(AccountRepository accounts, ItemRepository items, EventBroker events, ServerProperties props,
      Clock clock, TransactionTemplate tx) {
    this.accounts = accounts;
    this.items = items;
    this.events = events;
    this.props = props;
    this.clock = clock;
    this.tx = tx;
  }

  /**
   * Items written after {@code since}. A {@code since} ahead of the server
   * (the server was restored from an older backup) is answered with a full
   * sync; the client sees a revision lower than its own and knows to reconcile.
   */
  public Dto.Changes changes(Caller caller, Long since) {
    if (since != null && since < 0) throw ApiException.badRequest("since must be 0 or more.");
    // Read the revision first: an item written in between shows up now and again next time, never zero times.
    long revision = accounts.revision(caller.accountId());
    long from = since == null || since > revision ? 0 : since;
    List<Dto.ItemRecord> changed = items.since(caller.accountId(), from).stream().map(SyncService::record).toList();
    return new Dto.Changes(revision, changed);
  }

  /** The outcome of a write: saved, or the newer copy the client didn't have. */
  public sealed interface Written {
    record Saved(Dto.ItemRecord item) implements Written {}

    record Conflict(Dto.ItemRecord current) implements Written {}
  }

  public Written put(Caller caller, String itemId, Dto.ItemWrite write) {
    Validate.uuid(itemId, "itemId");
    if (write == null || write.expectedRevision() == null || write.expectedRevision() < 0 || write.deleted() == null) {
      throw ApiException.badRequest("expectedRevision (0 or more) and deleted are required.");
    }
    boolean deleted = write.deleted();
    if (!deleted && !Validate.envelope(write.data(), props.maxItemBytes())) {
      throw write.data() != null && write.data().length() > props.maxItemBytes()
          ? new ApiException(HttpStatus.CONTENT_TOO_LARGE, "Item too large",
              "An item can be at most " + props.maxItemBytes() + " bytes once encrypted.")
          : ApiException.badRequest("data must be a pvf1 envelope.");
    }
    String data = deleted ? null : write.data();

    Written result = tx.execute(status -> {
      // Taking the revision first locks the vault row, so the check below can't race another write.
      long revision = accounts.nextRevision(caller.accountId());
      ItemRepository.Item existing = items.find(caller.accountId(), itemId).orElse(null);
      if (existing != null && existing.revision() != write.expectedRevision()) {
        status.setRollbackOnly();
        return new Written.Conflict(record(existing));
      }
      if (existing == null && !deleted && items.liveCount(caller.accountId()) >= props.maxItemsPerVault()) {
        status.setRollbackOnly();
        throw new ApiException(HttpStatus.FORBIDDEN, "Vault full",
            "This vault has reached the limit of " + props.maxItemsPerVault() + " items.");
      }
      ItemRepository.Item item = new ItemRepository.Item(itemId, revision, clock.millis(), deleted, data);
      if (existing == null) items.insert(caller.accountId(), item);
      else items.update(caller.accountId(), item);
      return new Written.Saved(record(item));
    });
    if (result instanceof Written.Saved saved) events.publish(caller.accountId(), saved.item().revision());
    return result;
  }

  private static Dto.ItemRecord record(ItemRepository.Item item) {
    return new Dto.ItemRecord(item.id(), item.revision(), Instant.ofEpochMilli(item.updatedAt()).toString(),
        item.deleted(), item.data());
  }
}
