package com.passvaultify.server.auth;

import com.passvaultify.server.support.Codec;
import java.util.concurrent.Semaphore;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Stores Argon2id(authKey). The auth key is already a 256-bit key derived on
 * the client, so this is defense in depth: a stolen database doesn't let
 * anyone sign in as the user. OWASP parameters: 19 MiB, 2 passes, 1 lane.
 */
@Component
public class AuthKeyHasher {
  // Each hash holds 19 MiB; cap how many run at once so a burst of sign-ins
  // can't exhaust a small server's memory.
  private static final Semaphore SLOTS = new Semaphore(Math.max(2, Runtime.getRuntime().availableProcessors()));

  private final Argon2PasswordEncoder encoder = new Argon2PasswordEncoder(16, 32, 1, 19 * 1024, 2);
  private final String dummy = encoder.encode(Codec.b64(Codec.random(32)));

  public String hash(String authKey) {
    return withSlot(() -> encoder.encode(authKey));
  }

  public boolean matches(String authKey, String hash) {
    return withSlot(() -> encoder.matches(authKey, hash));
  }

  /** Spends the same time as a real check, for emails with no account. */
  public void burn(String authKey) {
    withSlot(() -> encoder.matches(authKey, dummy));
  }

  private static <T> T withSlot(java.util.function.Supplier<T> work) {
    SLOTS.acquireUninterruptibly();
    try {
      return work.get();
    } finally {
      SLOTS.release();
    }
  }
}
