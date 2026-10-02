package com.passvaultify.server.sync;

import java.io.IOException;
import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Change notifications over Server-Sent Events, in memory. Events carry a
 * revision number and nothing else: devices fetch the changes themselves.
 *
 * - vault-changed {"revision": n}: another write landed; sync from your last revision.
 * - session-ended: this device was signed out; lock and sign in again.
 */
@Component
public class EventBroker {
  static final long STREAM_TIMEOUT_MS = 30 * 60_000;
  static final int MAX_STREAMS_PER_ACCOUNT = 20;

  private record Stream(String sessionId, SseEmitter emitter) {}

  private final Map<String, Set<Stream>> streams = new ConcurrentHashMap<>();

  public SseEmitter subscribe(String accountId, String sessionId, long revision) {
    SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
    Set<Stream> forAccount = streams.computeIfAbsent(accountId, k -> ConcurrentHashMap.newKeySet());
    if (forAccount.size() >= MAX_STREAMS_PER_ACCOUNT) {
      // Drop the oldest-looking stream rather than refuse: a reconnecting device wins.
      forAccount.stream().findFirst().ifPresent(old -> close(accountId, old));
    }
    Stream stream = new Stream(sessionId, emitter);
    forAccount.add(stream);
    emitter.onCompletion(() -> remove(accountId, stream));
    emitter.onTimeout(() -> close(accountId, stream));
    emitter.onError(e -> remove(accountId, stream));
    // Tell a (re)connecting device where the vault is, so it can catch up.
    send(accountId, stream, SseEmitter.event().name("vault-changed").data(Map.of("revision", revision), MediaType.APPLICATION_JSON));
    return emitter;
  }

  public void publish(String accountId, long revision) {
    for (Stream stream : streams.getOrDefault(accountId, Set.of())) {
      send(accountId, stream, SseEmitter.event().name("vault-changed").data(Map.of("revision", revision), MediaType.APPLICATION_JSON));
    }
  }

  /** Tells signed-out devices, then closes their streams. */
  public void endSessions(String accountId, Collection<String> sessionIds) {
    if (sessionIds.isEmpty()) return;
    for (Stream stream : streams.getOrDefault(accountId, Set.of())) {
      if (!sessionIds.contains(stream.sessionId())) continue;
      send(accountId, stream, SseEmitter.event().name("session-ended").data("{}", MediaType.APPLICATION_JSON));
      close(accountId, stream);
    }
  }

  /** A comment every 25 seconds keeps proxies from closing idle streams. */
  @Scheduled(fixedDelay = 25_000)
  void heartbeat() {
    streams.forEach((accountId, set) -> set.forEach(stream -> send(accountId, stream, SseEmitter.event().comment("keep-alive"))));
  }

  int openStreams() {
    return streams.values().stream().mapToInt(Set::size).sum();
  }

  private void send(String accountId, Stream stream, SseEmitter.SseEventBuilder event) {
    try {
      stream.emitter().send(event);
    } catch (IOException | IllegalStateException gone) {
      remove(accountId, stream);
    }
  }

  private void close(String accountId, Stream stream) {
    remove(accountId, stream);
    try {
      stream.emitter().complete();
    } catch (IllegalStateException alreadyDone) {
      // Completed elsewhere.
    }
  }

  private void remove(String accountId, Stream stream) {
    streams.computeIfPresent(accountId, (k, set) -> {
      set.remove(stream);
      return set.isEmpty() ? null : set;
    });
  }
}
