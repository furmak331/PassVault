package com.furqan.passpass;

import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.util.*;
import java.util.Base64;

/**
 * Service for managing vault entries and encryption
 */
public class VaultService {
    private static final String AES = "AES/CBC/PKCS5Padding";
    private static final int KEY_SIZE = 256;
    private static final int ITERATIONS = 65536;
    private static final int IV_SIZE = 16;
    private final DatabaseService dbService;

    public VaultService() {
        this.dbService = new DatabaseService();
    }

    // Derive AES key from password and salt
    public SecretKeySpec deriveKey(String password, byte[] salt) throws Exception {
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        KeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, KEY_SIZE);
        byte[] keyBytes = factory.generateSecret(spec).getEncoded();
        return new SecretKeySpec(keyBytes, "AES");
    }

    // Encrypt a password
    public String encrypt(String plainText, SecretKeySpec key) throws Exception {
        Cipher cipher = Cipher.getInstance(AES);
        byte[] iv = new byte[IV_SIZE];
        new SecureRandom().nextBytes(iv);
        cipher.init(Cipher.ENCRYPT_MODE, key, new IvParameterSpec(iv));
        byte[] encrypted = cipher.doFinal(plainText.getBytes());
        byte[] combined = new byte[IV_SIZE + encrypted.length];
        System.arraycopy(iv, 0, combined, 0, IV_SIZE);
        System.arraycopy(encrypted, 0, combined, IV_SIZE, encrypted.length);
        return Base64.getEncoder().encodeToString(combined);
    }

    // Decrypt a password
    public String decrypt(String cipherText, SecretKeySpec key) throws Exception {
        byte[] combined = Base64.getDecoder().decode(cipherText);
        byte[] iv = Arrays.copyOfRange(combined, 0, IV_SIZE);
        byte[] encrypted = Arrays.copyOfRange(combined, IV_SIZE, combined.length);
        Cipher cipher = Cipher.getInstance(AES);
        cipher.init(Cipher.DECRYPT_MODE, key, new IvParameterSpec(iv));
        byte[] decrypted = cipher.doFinal(encrypted);
        return new String(decrypted);
    }

    // Add a vault entry for a user (persistent)
    public void addEntry(String username, VaultEntry entry) {
        try {
            dbService.addVaultEntry(
                username,
                entry.getSite(),
                entry.getSiteUsername(),
                entry.getEncryptedPassword().getBytes()
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to add vault entry", e);
        }
    }

    // Get all vault entries for a user (persistent)
    public List<VaultEntry> getEntries(String username) {
        try {
            return dbService.getVaultEntries(username);
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }
}
