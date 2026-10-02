package com.passvaultify.server.api;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Request and response bodies, mirroring the schemas in spec/openapi.yaml. */
public final class Dto {
  private Dto() {}

  public record KdfParams(String alg, Integer iterations, String salt) {}

  public record VaultHeader(String format, KdfParams kdf, String wrappedVaultKey, String fingerprint) {}

  public record DeviceInput(String name, String kind) {}

  public record Tokens(String accessToken, String refreshToken, long expiresIn) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record ItemRecord(String id, long revision, String updatedAt, boolean deleted, String data) {}

  public record ItemWrite(Long expectedRevision, Boolean deleted, String data) {}

  public record Device(String id, String name, String kind, String lastSeenAt, boolean current) {}

  public record ServerInfo(String version, String fingerprint, String registration) {}

  public record Health(String status) {}

  public record PreloginRequest(String email) {}

  public record PreloginResponse(KdfParams kdf) {}

  public record CreateAccountRequest(String email, String authKey, VaultHeader header) {}

  public record CreateAccountResponse(String accountId) {}

  public record LoginRequest(String email, String authKey, DeviceInput device) {}

  public record LoginResponse(Tokens tokens, VaultHeader header) {}

  public record RefreshRequest(String refreshToken) {}

  public record HeaderUpdateRequest(String currentAuthKey, String newAuthKey, VaultHeader header) {}

  public record DeleteAccountRequest(String authKey) {}

  public record Changes(long revision, java.util.List<ItemRecord> items) {}

  public record Conflict(ItemRecord current) {}
}
