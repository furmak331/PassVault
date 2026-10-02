package com.passvaultify.server.auth;

/** The signed-in device making a request. The session ID is also its device ID. */
public record Caller(String accountId, String sessionId) {}
