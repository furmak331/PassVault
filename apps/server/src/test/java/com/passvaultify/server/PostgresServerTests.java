package com.passvaultify.server;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.test.context.ActiveProfiles;

/**
 * The cloud setup, against a real PostgreSQL. Runs when DATABASE_URL points
 * at an empty test database (CI starts one; see .github/workflows/ci.yml).
 */
@ActiveProfiles("postgres")
@EnabledIfEnvironmentVariable(named = "DATABASE_URL", matches = "jdbc:postgresql:.*")
class PostgresServerTests extends ServerTests {}
