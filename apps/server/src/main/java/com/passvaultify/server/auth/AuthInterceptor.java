package com.passvaultify.server.auth;

import com.passvaultify.server.support.ApiException;
import com.passvaultify.server.support.Codec;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Clock;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Checks the bearer token on every authenticated endpoint. Tokens are opaque
 * and looked up by hash, so signing a device out takes effect immediately.
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {
  static final String CALLER = AuthInterceptor.class.getName() + ".caller";
  private static final long TOUCH_EVERY_MS = 60_000;

  private final SessionRepository sessions;
  private final Clock clock;

  public AuthInterceptor(SessionRepository sessions, Clock clock) {
    this.sessions = sessions;
    this.clock = clock;
  }

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
    if ("OPTIONS".equals(request.getMethod())) return true;
    // An event stream finishing comes back through here as an async dispatch.
    // It was authenticated when it opened, and its session may be gone by now.
    if (request.getDispatcherType() == DispatcherType.ASYNC) return true;
    String header = request.getHeader("Authorization");
    if (header == null || !header.startsWith("Bearer ") || header.length() > 200) {
      throw ApiException.unauthorized("Sign in to continue.");
    }
    long now = clock.millis();
    SessionRepository.Session session = sessions.findByAccessHash(Codec.sha256(header.substring(7)))
        .filter(s -> s.accessExpiresAt() > now)
        .orElseThrow(() -> ApiException.unauthorized("Your session has expired. Refresh it or sign in again."));
    if (now - session.lastSeenAt() > TOUCH_EVERY_MS) sessions.touch(session.id(), now);
    request.setAttribute(CALLER, new Caller(session.accountId(), session.id()));
    return true;
  }
}
