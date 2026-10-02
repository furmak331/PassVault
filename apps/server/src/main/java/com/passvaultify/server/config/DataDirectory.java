package com.passvaultify.server.config;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.context.event.ApplicationEnvironmentPreparedEvent;
import org.springframework.context.ApplicationListener;

/** Creates the SQLite data directory before the database is opened. */
public class DataDirectory implements ApplicationListener<ApplicationEnvironmentPreparedEvent> {
  @Override
  public void onApplicationEvent(ApplicationEnvironmentPreparedEvent event) {
    String dir = event.getEnvironment().getProperty("passvaultify.data-dir");
    if (dir == null) return;
    try {
      Files.createDirectories(Path.of(dir));
    } catch (IOException e) {
      throw new UncheckedIOException("Can't create the data directory " + dir, e);
    }
  }
}
