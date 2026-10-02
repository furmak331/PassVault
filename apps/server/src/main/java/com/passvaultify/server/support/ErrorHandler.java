package com.passvaultify.server.support;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/** Every error is application/problem+json; nothing internal leaks into a response. */
@RestControllerAdvice
public class ErrorHandler extends ResponseEntityExceptionHandler {
  private static final Logger log = LoggerFactory.getLogger(ErrorHandler.class);

  @ExceptionHandler(ApiException.class)
  ResponseEntity<ProblemDetail> api(ApiException e) {
    return problem(e.status(), e.title(), e.getMessage(), e.retryAfterSeconds());
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<ProblemDetail> unexpected(Exception e) {
    log.error("Unhandled error", e);
    return problem(HttpStatus.INTERNAL_SERVER_ERROR, "Server error", "Something went wrong on the server.", null);
  }

  public static ResponseEntity<ProblemDetail> problem(
      HttpStatus status, String title, String detail, Long retryAfterSeconds) {
    ProblemDetail body = ProblemDetail.forStatusAndDetail(status, detail);
    body.setTitle(title);
    ResponseEntity.BodyBuilder response =
        ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON);
    if (retryAfterSeconds != null) response.header(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfterSeconds));
    if (status == HttpStatus.UNAUTHORIZED) response.header(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
    return response.body(body);
  }
}
