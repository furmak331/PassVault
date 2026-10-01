package com.furqan.passpass;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Handles persistence of users and vault entries to JSON files.
 */
public class StorageService {
    private static final String USERS_FILE = "users.json";
    private static final String VAULT_FILE = "vault.json";
    private final ObjectMapper objectMapper = new ObjectMapper();

    public Map<String, User> loadUsers() {
        try {
            File file = new File(USERS_FILE);
            if (!file.exists()) return new HashMap<>();
            return objectMapper.readValue(file, new TypeReference<Map<String, User>>() {});
        } catch (IOException e) {
            return new HashMap<>();
        }
    }

    public void saveUsers(Map<String, User> users) {
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(new File(USERS_FILE), users);
        } catch (IOException e) {
            // Handle error
        }
    }

    public Map<String, List<String>> loadVault() {
        try {
            File file = new File(VAULT_FILE);
            if (!file.exists()) return new HashMap<>();
            return objectMapper.readValue(file, new TypeReference<Map<String, List<String>>>() {});
        } catch (IOException e) {
            return new HashMap<>();
        }
    }

    public void saveVault(Map<String, List<String>> vault) {
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(new File(VAULT_FILE), vault);
        } catch (IOException e) {
            // Handle error
        }
    }
}
