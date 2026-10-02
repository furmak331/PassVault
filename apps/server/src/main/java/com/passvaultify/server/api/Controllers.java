package com.passvaultify.server.api;

import com.passvaultify.server.auth.AccountRepository;
import com.passvaultify.server.auth.AuthService;
import com.passvaultify.server.auth.Caller;
import com.passvaultify.server.config.ServerProperties;
import com.passvaultify.server.support.ServerIdentity;
import com.passvaultify.server.sync.EventBroker;
import com.passvaultify.server.sync.SyncService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** The HTTP surface, path for path as in spec/openapi.yaml. */
@RestController
public class Controllers {
  private final AuthService auth;
  private final SyncService sync;
  private final EventBroker events;
  private final AccountRepository accounts;
  private final ServerIdentity identity;
  private final ServerProperties props;
  private final String version;

  public Controllers(AuthService auth, SyncService sync, EventBroker events, AccountRepository accounts,
      ServerIdentity identity, ServerProperties props, ObjectProvider<BuildProperties> build) {
    this.auth = auth;
    this.sync = sync;
    this.events = events;
    this.accounts = accounts;
    this.identity = identity;
    this.props = props;
    BuildProperties info = build.getIfAvailable();
    this.version = info == null ? "dev" : info.getVersion();
  }

  // Server

  @GetMapping("/health")
  Dto.Health health() {
    return new Dto.Health("ok");
  }

  @GetMapping("/v1/server")
  Dto.ServerInfo server() {
    return new Dto.ServerInfo(version, identity.fingerprint(), props.registration().wireName());
  }

  // Auth

  @PostMapping("/v1/auth/prelogin")
  Dto.PreloginResponse prelogin(@RequestBody Dto.PreloginRequest body, HttpServletRequest request) {
    return new Dto.PreloginResponse(auth.prelogin(body.email(), request.getRemoteAddr()));
  }

  @PostMapping("/v1/accounts")
  @ResponseStatus(HttpStatus.CREATED)
  Dto.CreateAccountResponse createAccount(@RequestBody Dto.CreateAccountRequest body, HttpServletRequest request) {
    return new Dto.CreateAccountResponse(auth.createAccount(body, request.getRemoteAddr()));
  }

  @DeleteMapping("/v1/accounts/me")
  ResponseEntity<Void> deleteAccount(Caller caller, @RequestBody Dto.DeleteAccountRequest body) {
    auth.deleteAccount(caller, body.authKey());
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/v1/auth/login")
  Dto.LoginResponse login(@RequestBody Dto.LoginRequest body, HttpServletRequest request) {
    return auth.login(body, request.getRemoteAddr());
  }

  @PostMapping("/v1/auth/refresh")
  Dto.Tokens refresh(@RequestBody Dto.RefreshRequest body, HttpServletRequest request) {
    return auth.refresh(body.refreshToken(), request.getRemoteAddr());
  }

  @PostMapping("/v1/auth/logout")
  ResponseEntity<Void> logout(Caller caller) {
    auth.logout(caller);
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/v1/vault/header")
  ResponseEntity<Void> updateHeader(Caller caller, @RequestBody Dto.HeaderUpdateRequest body) {
    auth.updateHeader(caller, body);
    return ResponseEntity.noContent().build();
  }

  // Sync

  @GetMapping("/v1/sync")
  Dto.Changes changes(Caller caller, @RequestParam(required = false) Long since) {
    return sync.changes(caller, since);
  }

  @PutMapping("/v1/items/{itemId}")
  ResponseEntity<Object> putItem(Caller caller, @PathVariable String itemId, @RequestBody Dto.ItemWrite body) {
    return switch (sync.put(caller, itemId, body)) {
      case SyncService.Written.Saved saved -> ResponseEntity.ok(saved.item());
      case SyncService.Written.Conflict conflict ->
          ResponseEntity.status(HttpStatus.CONFLICT).body(new Dto.Conflict(conflict.current()));
    };
  }

  @GetMapping(path = "/v1/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  SseEmitter events(Caller caller) {
    return events.subscribe(caller.accountId(), caller.sessionId(), accounts.revision(caller.accountId()));
  }

  // Devices

  @GetMapping("/v1/devices")
  List<Dto.Device> devices(Caller caller) {
    return auth.devices(caller);
  }

  @DeleteMapping("/v1/devices/{deviceId}")
  ResponseEntity<Void> signOutDevice(Caller caller, @PathVariable String deviceId) {
    auth.signOutDevice(caller, deviceId);
    return ResponseEntity.noContent().build();
  }
}
