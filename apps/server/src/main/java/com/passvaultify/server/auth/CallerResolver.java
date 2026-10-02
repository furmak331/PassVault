package com.passvaultify.server.auth;

import org.springframework.core.MethodParameter;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/** Lets controller methods take a {@link Caller} parameter. */
@Component
public class CallerResolver implements HandlerMethodArgumentResolver {
  @Override
  public boolean supportsParameter(MethodParameter parameter) {
    return parameter.getParameterType() == Caller.class;
  }

  @Override
  public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mav, NativeWebRequest request,
      WebDataBinderFactory binders) {
    Object caller = request.getAttribute(AuthInterceptor.CALLER, RequestAttributes.SCOPE_REQUEST);
    if (caller == null) throw new IllegalStateException("Caller requested on an unauthenticated endpoint");
    return caller;
  }
}
