package com.furqan.passpass;

/**
 * Represents a single vault entry (site, username, encrypted password)
 */
public class VaultEntry {
    private String site;
    private String siteUsername;
    private String encryptedPassword;

    public VaultEntry(String site, String siteUsername, String encryptedPassword) {
        this.site = site;
        this.siteUsername = siteUsername;
        this.encryptedPassword = encryptedPassword;
    }

    public String getSite() {
        return site;
    }

    public String getSiteUsername() {
        return siteUsername;
    }

    public String getEncryptedPassword() {
        return encryptedPassword;
    }
}
