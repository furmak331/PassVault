package com.furqan.passpass;

import java.sql.*;
import java.util.ArrayList;
import java.util.List;

public class DatabaseService {
    private static final String DB_URL = "jdbc:sqlite:passpass.db";

    public DatabaseService() {
        try (Connection conn = getConnection(); Statement stmt = conn.createStatement()) {
            // Create users table
            stmt.executeUpdate("CREATE TABLE IF NOT EXISTS users (" +
                    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    "username TEXT UNIQUE NOT NULL," +
                    "hashed_password BLOB NOT NULL," +
                    "salt BLOB NOT NULL)");
            // Create vault_entries table
            stmt.executeUpdate("CREATE TABLE IF NOT EXISTS vault_entries (" +
                    "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    "user_id INTEGER NOT NULL," +
                    "site TEXT NOT NULL," +
                    "site_username TEXT NOT NULL," +
                    "encrypted_password BLOB NOT NULL," +
                    "FOREIGN KEY(user_id) REFERENCES users(id))");
        } catch (SQLException e) {
            throw new RuntimeException("Failed to initialize database", e);
        }
    }

    public Connection getConnection() throws SQLException {
        return DriverManager.getConnection(DB_URL);
    }

    // User methods
    public void addUser(String username, byte[] hashedPassword, byte[] salt) throws SQLException {
        String sql = "INSERT INTO users (username, hashed_password, salt) VALUES (?, ?, ?)";
        try (Connection conn = getConnection(); PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, username);
            ps.setBytes(2, hashedPassword);
            ps.setBytes(3, salt);
            ps.executeUpdate();
        }
    }

    public User getUser(String username) throws SQLException {
        String sql = "SELECT * FROM users WHERE username = ?";
        try (Connection conn = getConnection(); PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, username);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return new User(
                        rs.getString("username"),
                        rs.getBytes("hashed_password"),
                        rs.getBytes("salt")
                    );
                }
            }
        }
        return null;
    }

    // Vault entry methods
    public void addVaultEntry(String username, String site, String siteUsername, byte[] encryptedPassword) throws SQLException {
        String getUserIdSql = "SELECT id FROM users WHERE username = ?";
        String insertSql = "INSERT INTO vault_entries (user_id, site, site_username, encrypted_password) VALUES (?, ?, ?, ?)";
        try (Connection conn = getConnection();
             PreparedStatement getUserIdPs = conn.prepareStatement(getUserIdSql);
             PreparedStatement insertPs = conn.prepareStatement(insertSql)) {
            getUserIdPs.setString(1, username);
            try (ResultSet rs = getUserIdPs.executeQuery()) {
                if (rs.next()) {
                    int userId = rs.getInt("id");
                    insertPs.setInt(1, userId);
                    insertPs.setString(2, site);
                    insertPs.setString(3, siteUsername);
                    insertPs.setBytes(4, encryptedPassword);
                    insertPs.executeUpdate();
                }
            }
        }
    }

    public List<VaultEntry> getVaultEntries(String username) throws SQLException {
        List<VaultEntry> entries = new ArrayList<>();
        String sql = "SELECT ve.site, ve.site_username, ve.encrypted_password FROM vault_entries ve " +
                "JOIN users u ON ve.user_id = u.id WHERE u.username = ?";
        try (Connection conn = getConnection(); PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, username);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    entries.add(new VaultEntry(
                        rs.getString("site"),
                        rs.getString("site_username"),
                        new String(rs.getBytes("encrypted_password"))
                    ));
                }
            }
        }
        return entries;
    }
}
