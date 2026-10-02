package com.passvaultify.server.config;

import com.passvaultify.server.auth.AuthInterceptor;
import com.passvaultify.server.auth.CallerResolver;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
  /** Largest request body accepted. An item is at most max-item-bytes; this leaves room for JSON. */
  static final long MAX_BODY_BYTES = 1024 * 1024;

  private final AuthInterceptor auth;
  private final CallerResolver caller;

  public WebConfig(AuthInterceptor auth, CallerResolver caller) {
    this.auth = auth;
    this.caller = caller;
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(auth)
        .addPathPatterns("/v1/**")
        .excludePathPatterns("/v1/server", "/v1/auth/prelogin", "/v1/auth/login", "/v1/auth/refresh", "/v1/accounts");
  }

  @Override
  public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
    resolvers.add(caller);
  }

  /**
   * Any origin may call the API: the web vault, the extension, or a page
   * someone hosts themselves. That's safe because nothing rides on cookies;
   * every authenticated request carries its own bearer token.
   */
  @Bean
  FilterRegistrationBean<CorsFilter> cors() {
    CorsConfiguration config = new CorsConfiguration();
    config.addAllowedOrigin("*");
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
    config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
    config.setExposedHeaders(List.of("Retry-After"));
    config.setAllowCredentials(false);
    config.setMaxAge(600L);
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", config);
    FilterRegistrationBean<CorsFilter> bean = new FilterRegistrationBean<>(new CorsFilter(source));
    bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
    return bean;
  }

  /** Response headers for an API that only ever returns JSON, and a cap on request size. */
  @Bean
  FilterRegistrationBean<OncePerRequestFilter> hardening() {
    OncePerRequestFilter filter = new OncePerRequestFilter() {
      @Override
      protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
          throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        if (request.getContentLengthLong() > MAX_BODY_BYTES) {
          response.setStatus(413);
          response.setContentType("application/problem+json");
          response.getWriter().write("{\"title\":\"Request too large\",\"status\":413}");
          return;
        }
        chain.doFilter(request, response);
      }
    };
    FilterRegistrationBean<OncePerRequestFilter> bean = new FilterRegistrationBean<>(filter);
    bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 1);
    return bean;
  }
}
