package com.passvaultify.server;

import com.passvaultify.server.config.DataDirectory;
import java.time.Clock;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class ServerApplication {
  public static void main(String[] args) {
    SpringApplication app = new SpringApplication(ServerApplication.class);
    app.addListeners(new DataDirectory());
    app.run(args);
  }

  @Bean
  Clock clock() {
    return Clock.systemUTC();
  }
}
