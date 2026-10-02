package com.passvaultify.server.support;

import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Fixed-window counters held in memory. Enough for one instance; several
 * instances behind a load balancer would share them through Redis instead.
 */
@Component
public class RateLimiter {
  public record Rule(String name, int limit, Duration window) {}

  public static final Rule PRELOGIN_PER_IP = new Rule("prelogin-ip", 30, Duration.ofMinutes(1));
  public static final Rule REGISTER_PER_IP = new Rule("register-ip", 10, Duration.ofHours(1));
  public static final Rule LOGIN_PER_IP = new Rule("login-ip", 20, Duration.ofMinutes(1));
  public static final Rule LOGIN_FAILURES_PER_EMAIL = new Rule("login-fail-email", 10, Duration.ofMinutes(15));
  public static final Rule REFRESH_PER_IP = new Rule("refresh-ip", 60, Duration.ofMinutes(1));
  public static final Rule AUTH_KEY_FAILURES_PER_ACCOUNT = new Rule("authkey-fail-account", 10, Duration.ofMinutes(15));

  private record Window(long start, int count) {}

  private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
  private final Clock clock;

  public RateLimiter(Clock clock) {
    this.clock = clock;
  }

  /** Counts an attempt, refusing it once the limit is reached. */
  public void consume(Rule rule, String key) {
    long now = clock.millis();
    Window window = windows.compute(rule.name() + ":" + key, (k, w) ->
        w == null || now - w.start() >= rule.window().toMillis() ? new Window(now, 1) : new Window(w.start(), w.count() + 1));
    if (window.count() > rule.limit()) throw tooMany(rule, window, now);
  }

  /** Refuses if the limit was reached, without counting. Pair with {@link #record}. */
  public void check(Rule rule, String key) {
    long now = clock.millis();
    Window window = windows.get(rule.name() + ":" + key);
    if (window != null && now - window.start() < rule.window().toMillis() && window.count() >= rule.limit()) {
      throw tooMany(rule, window, now);
    }
  }

  /** Counts a failure without refusing; the next {@link #check} refuses once over the limit. */
  public void record(Rule rule, String key) {
    long now = clock.millis();
    windows.compute(rule.name() + ":" + key, (k, w) ->
        w == null || now - w.start() >= rule.window().toMillis() ? new Window(now, 1) : new Window(w.start(), w.count() + 1));
  }

  private static ApiException tooMany(Rule rule, Window window, long now) {
    long retryAfter = Math.max(1, (window.start() + rule.window().toMillis() - now + 999) / 1000);
    return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "Too many attempts",
        "Too many attempts. Try again in " + retryAfter + " seconds.", retryAfter);
  }

  @Scheduled(fixedDelay = 300_000)
  void sweep() {
    long now = clock.millis();
    long longest = Duration.ofHours(1).toMillis();
    windows.entrySet().removeIf(e -> now - e.getValue().start() > longest);
  }
}
