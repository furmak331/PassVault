package com.passvaultify.server.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("passvaultify")
public record ServerProperties(
    Registration registration,
    Duration accessTokenTtl,
    Duration refreshTokenTtl,
    int maxItemBytes,
    int maxItemsPerVault,
    int maxDevicesPerAccount) {

  public enum Registration {
    OPEN,
    CLOSED;

    public String wireName() {
      return name().toLowerCase();
    }
  }
}
