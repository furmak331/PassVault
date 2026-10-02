package com.passvaultify.server.support;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Encoding and hashing helpers. The server never encrypts or decrypts vault data. */
public final class Codec {
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
  private static final Base64.Decoder UNB64 = Base64.getUrlDecoder();

  private Codec() {}

  public static byte[] random(int bytes) {
    byte[] out = new byte[bytes];
    RANDOM.nextBytes(out);
    return out;
  }

  public static String b64(byte[] bytes) {
    return B64.encodeToString(bytes);
  }

  /** Decodes base64url without padding, or returns null if it isn't. */
  public static byte[] unb64(String text) {
    if (text == null || !text.matches("[A-Za-z0-9_-]*")) return null;
    try {
      return UNB64.decode(text);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  /** SHA-256 as lowercase hex: how session tokens are stored. */
  public static String sha256(String text) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  public static byte[] hmac(byte[] key, String message) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  /** The first 6 bytes as "7F3A 91C2 0E5B", the same shape as a vault fingerprint. */
  public static String fingerprint(byte[] bytes) {
    String hex = HexFormat.of().withUpperCase().formatHex(bytes, 0, 6);
    return hex.substring(0, 4) + " " + hex.substring(4, 8) + " " + hex.substring(8, 12);
  }
}
