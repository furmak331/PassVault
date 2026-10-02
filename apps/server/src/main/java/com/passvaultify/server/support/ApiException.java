package com.passvaultify.server.support;

import org.springframework.http.HttpStatus;

/** An error the client should see, rendered as RFC 9457 problem details. */
public class ApiException extends RuntimeException {
  private final HttpStatus status;
  private final String title;
  private final Long retryAfterSeconds;

  public ApiException(HttpStatus status, String title, String detail) {
    this(status, title, detail, null);
  }

  public ApiException(HttpStatus status, String title, String detail, Long retryAfterSeconds) {
    super(detail);
    this.status = status;
    this.title = title;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  public static ApiException badRequest(String detail) {
    return new ApiException(HttpStatus.BAD_REQUEST, "Invalid request", detail);
  }

  public static ApiException unauthorized(String detail) {
    return new ApiException(HttpStatus.UNAUTHORIZED, "Not signed in", detail);
  }

  public HttpStatus status() {
    return status;
  }

  public String title() {
    return title;
  }

  public Long retryAfterSeconds() {
    return retryAfterSeconds;
  }
}
