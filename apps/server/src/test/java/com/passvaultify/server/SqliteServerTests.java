package com.passvaultify.server;

import java.nio.file.Path;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** The self-hosting setup: one SQLite file. */
@ActiveProfiles("sqlite")
class SqliteServerTests extends ServerTests {
  @TempDir static Path dir;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("passvaultify.data-dir", () -> dir.toString());
  }
}
