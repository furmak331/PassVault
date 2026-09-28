package com.furqan.passpass;

import java.util.Scanner;
import javax.crypto.spec.SecretKeySpec;

/**
 * PassPass - A simple password manager CLI application
 */
public class App 
{
    private static Scanner scanner = new Scanner(System.in);
    private static UserService userService = new UserService();
    private static VaultService vaultService = new VaultService();
    
    public static void main( String[] args )
    {
        System.out.println("Welcome to PassPass - Your Password Manager!");
        System.out.println("==========================================");
        
        boolean running = true;
        while (running) {
            showMenu();
            int choice = getUserChoice();
            
            switch (choice) {
                case 1:
                    registerUser();
                    break;
                case 2:
                    loginUser();
                    break;
                case 3:
                    System.out.println("Thank you for using PassPass. Goodbye!");
                    running = false;
                    break;
                default:
                    System.out.println("Invalid option. Please try again.");
            }
            
            if (running) {
                System.out.println("\nPress Enter to continue...");
                scanner.nextLine();
            }
        }
        
        scanner.close();
    }
    
    private static void showMenu() {
        System.out.println("\n==========================================");
        System.out.println("=== PassPass Main Menu ===");
        System.out.println("1. Register");
        System.out.println("2. Login");
        System.out.println("3. Exit");
        System.out.println("==========================================");
        System.out.print("Please choose an option (1-3): ");
    }
    
    private static int getUserChoice() {
        try {
            String input = scanner.nextLine();
            return Integer.parseInt(input.trim());
        } catch (Exception e) {
            System.out.println("Invalid input. Please enter a number.");
            return -1;
        }
    }
    
    private static void registerUser() {
        System.out.println("\n=== User Registration ===");
        System.out.print("Enter username: ");
        String username = scanner.nextLine();
        
        if (userService.userExists(username)) {
            System.out.println("Username already exists! Please choose a different username.");
            return;
        }
        
        System.out.print("Enter password: ");
        String password = scanner.nextLine();
        
        if (!userService.isValidPassword(password)) {
            System.out.println("Password must be at least 6 characters long!");
            return;
        }
        
        try {
            if (userService.registerUser(username, password)) {
                System.out.println("Registration successful! You can now login with your credentials.");
            } else {
                System.out.println("Registration failed. Please try again.");
            }
        } catch (RuntimeException e) {
            System.out.println("Registration failed due to a system error. Please try again.");
        }
    }
    
    private static void loginUser() {
        System.out.println("\n=== User Login ===");
        System.out.print("Enter username: ");
        String username = scanner.nextLine();
        System.out.print("Enter password: ");
        String password = scanner.nextLine();
        if (userService.authenticateUser(username, password)) {
            System.out.println("Login successful! Welcome, " + username + "!");
            showUserMenu(username, password);
        } else {
            System.out.println("Invalid username or password. Please try again.");
        }
    }
    
    private static void showUserMenu(String username, String password) {
        boolean loggedIn = true;
        while (loggedIn) {
            System.out.println("\n=== User Menu for " + username + " ===");
            System.out.println("1. Add Vault Entry");
            System.out.println("2. View Vault Entries");
            System.out.println("3. Logout");
            System.out.print("Please choose an option (1-3): ");
            int choice = getUserChoice();
            switch (choice) {
                case 1:
                    addVaultEntry(username, password);
                    break;
                case 2:
                    viewVaultEntries(username, password);
                    break;
                case 3:
                    System.out.println("Logging out... Returning to main menu.");
                    loggedIn = false;
                    break;
                default:
                    System.out.println("Invalid option. Please try again.");
            }
            if (loggedIn) {
                System.out.println("\nPress Enter to continue...");
                scanner.nextLine();
            }
        }
    }

    private static void addVaultEntry(String username, String password) {
        try {
            System.out.println("\n=== Add Vault Entry ===");
            System.out.print("Site: ");
            String site = scanner.nextLine();
            System.out.print("Site Username: ");
            String siteUsername = scanner.nextLine();
            System.out.print("Site Password: ");
            String sitePassword = scanner.nextLine();
            // Use user's salt for key derivation
            User user = userService.getUser(username);
            if (user == null) {
                System.out.println("User not found. Please login again.");
                return;
            }
            SecretKeySpec key = vaultService.deriveKey(password, user.getSalt());
            String encryptedPassword = vaultService.encrypt(sitePassword, key);
            VaultEntry entry = new VaultEntry(site, siteUsername, encryptedPassword);
            vaultService.addEntry(username, entry);
            System.out.println("Vault entry added successfully!");
        } catch (Exception e) {
            System.out.println("Error adding vault entry: " + e.getMessage());
        }
    }

    private static void viewVaultEntries(String username, String password) {
        try {
            System.out.println("\n=== Your Vault Entries ===");
            User user = userService.getUser(username);
            if (user == null) {
                System.out.println("User not found. Please login again.");
                return;
            }
            SecretKeySpec key = vaultService.deriveKey(password, user.getSalt());
            java.util.List<VaultEntry> entries = vaultService.getEntries(username);
            if (entries.isEmpty()) {
                System.out.println("No entries found.");
                return;
            }
            int i = 1;
            for (VaultEntry entry : entries) {
                String decryptedPassword = vaultService.decrypt(entry.getEncryptedPassword(), key);
                System.out.println(i + ". Site: " + entry.getSite());
                System.out.println("   Username: " + entry.getSiteUsername());
                System.out.println("   Password: " + decryptedPassword);
                i++;
            }
        } catch (Exception e) {
            System.out.println("Error viewing vault entries: " + e.getMessage());
        }
    }
}
