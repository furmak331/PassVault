package com.passvaultify.server.auth;

import com.passvaultify.server.api.Dto;
import com.passvaultify.server.api.Validate;
import com.passvaultify.server.config.ServerProperties;
import com.passvaultify.server.support.ApiException;
import com.passvaultify.server.support.Codec;
import com.passvaultify.server.support.RateLimiter;
import com.passvaultify.server.support.ServerIdentity;
import com.passvaultify.server.sync.EventBroker;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
public class AuthService {
  private static final String WRONG_CREDENTIALS = "That email and master password don't match an account.";

  private final AccountRepository accounts;
  private final SessionRepository sessions;
  private final AuthKeyHasher hasher;
  private final ServerIdentity identity;
  private final ServerProperties props;
  private final RateLimiter limiter;
  private final EventBroker events;
  private final JsonMapper json;
  private final Clock clock;
  private final TransactionTemplate tx;

  public AuthService(AccountRepository accounts, SessionRepository sessions, AuthKeyHasher hasher,
      ServerIdentity identity, ServerProperties props, RateLimiter limiter, EventBroker events, JsonMapper json,
      Clock clock, TransactionTemplate tx) {
    this.accounts = accounts;
    this.sessions = sessions;
    this.hasher = hasher;
    this.identity = identity;
    this.props = props;
    this.limiter = limiter;
    this.events = events;
    this.json = json;
    this.clock = clock;
    this.tx = tx;
  }

  /** KDF settings for an email. Unknown emails get stable fake ones, so accounts can't be enumerated. */
  public Dto.KdfParams prelogin(String rawEmail, String ip) {
    limiter.consume(RateLimiter.PRELOGIN_PER_IP, ip);
    String email = Validate.email(rawEmail);
    return accounts.findByEmail(email)
        .map(account -> header(account).kdf())
        .orElseGet(() -> new Dto.KdfParams("pbkdf2-sha256", 600_000, Codec.b64(identity.fakeSalt(email))));
  }

  public String createAccount(Dto.CreateAccountRequest request, String ip) {
    if (props.registration() != ServerProperties.Registration.OPEN) {
      throw new ApiException(HttpStatus.FORBIDDEN, "Registration closed", "This server isn't accepting new accounts.");
    }
    limiter.consume(RateLimiter.REGISTER_PER_IP, ip);
    String email = Validate.email(request.email());
    String authKey = Validate.authKey(request.authKey(), "authKey");
    Dto.VaultHeader header = Validate.header(request.header());
    if (accounts.findByEmail(email).isPresent()) throw emailTaken();
    String id = UUID.randomUUID().toString();
    try {
      accounts.insert(id, email, hasher.hash(authKey), json.writeValueAsString(header), clock.millis());
    } catch (DuplicateKeyException raced) {
      throw emailTaken();
    }
    return id;
  }

  private static ApiException emailTaken() {
    return new ApiException(HttpStatus.CONFLICT, "Account exists", "An account with this email already exists.");
  }

  public Dto.LoginResponse login(Dto.LoginRequest request, String ip) {
    limiter.consume(RateLimiter.LOGIN_PER_IP, ip);
    String email = Validate.email(request.email());
    String authKey = Validate.authKey(request.authKey(), "authKey");
    Dto.DeviceInput device = Validate.device(request.device());
    limiter.check(RateLimiter.LOGIN_FAILURES_PER_EMAIL, email);

    AccountRepository.Account account = accounts.findByEmail(email).orElse(null);
    if (account == null) {
      hasher.burn(authKey);
      limiter.record(RateLimiter.LOGIN_FAILURES_PER_EMAIL, email);
      throw ApiException.unauthorized(WRONG_CREDENTIALS);
    }
    if (!hasher.matches(authKey, account.authHash())) {
      limiter.record(RateLimiter.LOGIN_FAILURES_PER_EMAIL, email);
      throw ApiException.unauthorized(WRONG_CREDENTIALS);
    }

    Issued issued = tx.execute(status -> {
      List<SessionRepository.Session> existing = sessions.forAccount(account.id());
      List<String> evicted = existing.size() >= props.maxDevicesPerAccount()
          ? existing.subList(props.maxDevicesPerAccount() - 1, existing.size()).stream()
              .map(SessionRepository.Session::id).toList()
          : List.of();
      evicted.forEach(sessions::delete);
      return new Issued(startSession(account.id(), device), evicted);
    });
    events.endSessions(account.id(), issued.evicted());
    return new Dto.LoginResponse(issued.tokens(), header(account));
  }

  private record Issued(Dto.Tokens tokens, List<String> evicted) {}

  private Dto.Tokens startSession(String accountId, Dto.DeviceInput device) {
    long now = clock.millis();
    String access = "pva_" + Codec.b64(Codec.random(32));
    String refresh = "pvr_" + Codec.b64(Codec.random(32));
    String id = UUID.randomUUID().toString();
    sessions.insert(new SessionRepository.Session(id, accountId, device.name(), device.kind(),
        now + props.accessTokenTtl().toMillis(), now + props.refreshTokenTtl().toMillis(), now, now), Codec.sha256(access));
    sessions.insertRefresh(Codec.sha256(refresh), id);
    return new Dto.Tokens(access, refresh, props.accessTokenTtl().toSeconds());
  }

  private sealed interface Refreshed {
    record Ok(Dto.Tokens tokens) implements Refreshed {}

    record Ended(String accountId, String sessionId, String reason) implements Refreshed {}

    record Unknown() implements Refreshed {}
  }

  /**
   * Swaps a refresh token for a new pair. Each refresh token works once:
   * presenting a used one means two parties hold it, so the session ends.
   */
  public Dto.Tokens refresh(String token, String ip) {
    limiter.consume(RateLimiter.REFRESH_PER_IP, ip);
    if (token == null || token.length() > 200) throw ApiException.unauthorized("That refresh token isn't valid.");
    String hash = Codec.sha256(token);
    Refreshed result = tx.execute(status -> {
      SessionRepository.RefreshToken stored = sessions.findRefresh(hash).orElse(null);
      if (stored == null) return new Refreshed.Unknown();
      SessionRepository.Session session = sessions.find(stored.sessionId()).orElse(null);
      if (session == null) return new Refreshed.Unknown();
      if (stored.used() || !sessions.markUsed(hash)) {
        sessions.delete(session.id());
        return new Refreshed.Ended(session.accountId(), session.id(),
            "This sign-in was ended because its refresh token was used twice. Sign in again.");
      }
      long now = clock.millis();
      if (session.refreshExpiresAt() <= now) {
        sessions.delete(session.id());
        return new Refreshed.Ended(session.accountId(), session.id(), "This sign-in has expired. Sign in again.");
      }
      String access = "pva_" + Codec.b64(Codec.random(32));
      String refresh = "pvr_" + Codec.b64(Codec.random(32));
      sessions.rotate(session.id(), Codec.sha256(access), now + props.accessTokenTtl().toMillis(),
          now + props.refreshTokenTtl().toMillis(), now);
      sessions.pruneUsedRefresh(session.id(), hash);
      sessions.insertRefresh(Codec.sha256(refresh), session.id());
      return new Refreshed.Ok(new Dto.Tokens(access, refresh, props.accessTokenTtl().toSeconds()));
    });
    return switch (result) {
      case Refreshed.Ok ok -> ok.tokens();
      case Refreshed.Ended ended -> {
        events.endSessions(ended.accountId(), List.of(ended.sessionId()));
        throw ApiException.unauthorized(ended.reason());
      }
      case Refreshed.Unknown unknown -> throw ApiException.unauthorized("That refresh token isn't valid. Sign in again.");
    };
  }

  public void logout(Caller caller) {
    sessions.delete(caller.sessionId());
    events.endSessions(caller.accountId(), List.of(caller.sessionId()));
  }

  /** After a master password change: new auth key and re-wrapped vault key. Other devices are signed out. */
  public void updateHeader(Caller caller, Dto.HeaderUpdateRequest request) {
    AccountRepository.Account account = verifiedAccount(caller, request.currentAuthKey(), "currentAuthKey");
    String newAuthKey = Validate.authKey(request.newAuthKey(), "newAuthKey");
    Dto.VaultHeader header = Validate.header(request.header());
    if (!header.fingerprint().equals(header(account).fingerprint())) {
      throw ApiException.badRequest("The new header belongs to a different vault: its fingerprint changed.");
    }
    String newHash = hasher.hash(newAuthKey);
    List<String> others = tx.execute(status -> {
      accounts.updateAuth(account.id(), newHash, json.writeValueAsString(header));
      List<String> ids = sessions.forAccount(account.id()).stream()
          .map(SessionRepository.Session::id).filter(id -> !id.equals(caller.sessionId())).toList();
      ids.forEach(sessions::delete);
      return ids;
    });
    events.endSessions(account.id(), others);
  }

  public void deleteAccount(Caller caller, String authKey) {
    AccountRepository.Account account = verifiedAccount(caller, authKey, "authKey");
    List<String> all = sessions.forAccount(account.id()).stream().map(SessionRepository.Session::id).toList();
    tx.executeWithoutResult(status -> accounts.delete(account.id()));
    events.endSessions(account.id(), all);
  }

  private AccountRepository.Account verifiedAccount(Caller caller, String authKey, String field) {
    Validate.authKey(authKey, field);
    limiter.check(RateLimiter.AUTH_KEY_FAILURES_PER_ACCOUNT, caller.accountId());
    AccountRepository.Account account = accounts.find(caller.accountId())
        .orElseThrow(() -> ApiException.unauthorized("This account no longer exists."));
    if (!hasher.matches(authKey, account.authHash())) {
      limiter.record(RateLimiter.AUTH_KEY_FAILURES_PER_ACCOUNT, caller.accountId());
      throw new ApiException(HttpStatus.FORBIDDEN, "Wrong master password", "The current master password is wrong.");
    }
    return account;
  }

  public List<Dto.Device> devices(Caller caller) {
    return sessions.forAccount(caller.accountId()).stream()
        .map(s -> new Dto.Device(s.id(), s.deviceName(), s.deviceKind(), Instant.ofEpochMilli(s.lastSeenAt()).toString(),
            s.id().equals(caller.sessionId())))
        .toList();
  }

  public void signOutDevice(Caller caller, String deviceId) {
    Validate.uuid(deviceId, "deviceId");
    SessionRepository.Session session = sessions.find(deviceId)
        .filter(s -> s.accountId().equals(caller.accountId()))
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "No such device", "That device isn't signed in."));
    sessions.delete(session.id());
    events.endSessions(caller.accountId(), List.of(session.id()));
  }

  public Dto.VaultHeader header(AccountRepository.Account account) {
    return json.readValue(account.headerJson(), Dto.VaultHeader.class);
  }
}
