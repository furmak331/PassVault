package com.furqan.passpass;

import java.util.Arrays;

/**
 * Represents a user in the PassPass system
 */
public class User {
    private String username;
    private byte[] hashedPassword;
    private byte[] salt;
    
    /**
     * Constructor for User
     * @param username The username
     * @param hashedPassword The hashed password
     * @param salt The salt used for hashing
     */
    public User(String username, byte[] hashedPassword, byte[] salt) {
        this.username = username;
        this.hashedPassword = hashedPassword.clone();
        this.salt = salt.clone();
    }
    
    /**
     * Get the username
     * @return username
     */
    public String getUsername() {
        return username;
    }
    
    /**
     * Get the hashed password
     * @return copy of hashed password
     */
    public byte[] getHashedPassword() {
        return hashedPassword.clone();
    }
    
    /**
     * Get the salt
     * @return copy of salt
     */
    public byte[] getSalt() {
        return salt.clone();
    }
    
    /**
     * Set the username
     * @param username The new username
     */
    public void setUsername(String username) {
        this.username = username;
    }
    
    /**
     * Set the hashed password
     * @param hashedPassword The new hashed password
     */
    public void setHashedPassword(byte[] hashedPassword) {
        this.hashedPassword = hashedPassword.clone();
    }
    
    /**
     * Set the salt
     * @param salt The new salt
     */
    public void setSalt(byte[] salt) {
        this.salt = salt.clone();
    }
    
    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        
        User user = (User) obj;
        return username.equals(user.username) &&
               Arrays.equals(hashedPassword, user.hashedPassword) &&
               Arrays.equals(salt, user.salt);
    }
    
    @Override
    public int hashCode() {
        int result = username.hashCode();
        result = 31 * result + Arrays.hashCode(hashedPassword);
        result = 31 * result + Arrays.hashCode(salt);
        return result;
    }
    
    @Override
    public String toString() {
        return "User{username='" + username + "'}";
    }
}
