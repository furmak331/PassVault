package com.passvaultify.server.api;

import com.passvaultify.server.support.ApiException;
import com.passvaultify.server.support.Codec;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Input checks. Anything stored is checked against the shapes in spec/openapi.yaml. */
public final class Validate {
  private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
  private static final Pattern ENVELOPE = Pattern.compile("^pvf1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$");
  private static final Pattern FINGERPRINT = Pattern.compile("^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$");
  private static final Pattern UUID = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
  private static final Set<String> DEVICE_KINDS = Set.of("extension", "web", "cli");
  public static final int MIN_ITERATIONS = 100_000;
  public static final int MAX_ITERATIONS = 10_000_000;

  private Validate() {}

  /** Emails are compared trimmed and lowercased. */
  public static String email(String email) {
    if (email == null) throw ApiException.badRequest("An email is required.");
    String normalized = email.trim().toLowerCase(Locale.ROOT);
    if (normalized.length() > 320 || !EMAIL.matcher(normalized).matches()) {
      throw ApiException.badRequest("That isn't a valid email address.");
    }
    return normalized;
  }

  /** The auth key: exactly 32 bytes, base64url. Returned unchanged. */
  public static String authKey(String authKey, String field) {
    byte[] bytes = Codec.unb64(authKey);
    if (bytes == null || bytes.length != 32) {
      throw ApiException.badRequest(field + " must be 32 bytes, base64url without padding.");
    }
    return authKey;
  }

  public static Dto.VaultHeader header(Dto.VaultHeader header) {
    if (header == null) throw ApiException.badRequest("A vault header is required.");
    if (!"pvf1".equals(header.format())) throw ApiException.badRequest("Unsupported vault format.");
    Dto.KdfParams kdf = header.kdf();
    if (kdf == null || !"pbkdf2-sha256".equals(kdf.alg())) {
      throw ApiException.badRequest("Unsupported key derivation settings.");
    }
    if (kdf.iterations() == null || kdf.iterations() < MIN_ITERATIONS || kdf.iterations() > MAX_ITERATIONS) {
      throw ApiException.badRequest("KDF iterations must be between 100,000 and 10,000,000.");
    }
    byte[] salt = Codec.unb64(kdf.salt());
    if (salt == null || salt.length < 16 || salt.length > 64) {
      throw ApiException.badRequest("The KDF salt must be 16 to 64 bytes, base64url.");
    }
    if (!envelope(header.wrappedVaultKey(), 512)) {
      throw ApiException.badRequest("The wrapped vault key isn't a pvf1 envelope.");
    }
    if (header.fingerprint() == null || !FINGERPRINT.matcher(header.fingerprint()).matches()) {
      throw ApiException.badRequest("The vault fingerprint isn't in the expected format.");
    }
    return new Dto.VaultHeader("pvf1", new Dto.KdfParams(kdf.alg(), kdf.iterations(), kdf.salt()),
        header.wrappedVaultKey(), header.fingerprint());
  }

  public static Dto.DeviceInput device(Dto.DeviceInput device) {
    if (device == null) throw ApiException.badRequest("Device details are required.");
    String name = device.name() == null ? "" : device.name().strip();
    if (name.isEmpty() || name.length() > 80) throw ApiException.badRequest("Device name must be 1 to 80 characters.");
    if (!DEVICE_KINDS.contains(device.kind())) throw ApiException.badRequest("Device kind must be extension, web or cli.");
    return new Dto.DeviceInput(name, device.kind());
  }

  public static String uuid(String id, String what) {
    if (id == null || !UUID.matcher(id).matches()) throw ApiException.badRequest(what + " must be a lowercase UUID.");
    return id;
  }

  public static boolean envelope(String value, int maxLength) {
    return value != null && value.length() <= maxLength && ENVELOPE.matcher(value).matches();
  }
}
