# PassVault

A command-line password manager written in Java.

- Master passwords are stored as salted PBKDF2-HMAC-SHA256 hashes.
- Saved site passwords are encrypted with AES-256, using a key derived from
  the master password.
- Everything is stored in a local SQLite database.

## Build and run from source

Requires Java 11+ and Maven.

```bash
cd passpass
mvn package
java -jar target/passvault.jar
```

### Where the data is stored

| How it runs                 | Database location                       |
|-----------------------------|-----------------------------------------|
| `PASSVAULT_DB` is set       | that path                               |
| installed as a snap         | `~/snap/passvault/common/passpass.db`   |
| otherwise                   | `passpass.db` in the current directory  |

## Snap package

The snap is described in [`snap/snapcraft.yaml`](snap/snapcraft.yaml). It
bundles its own Java runtime, so users don't need Java installed.

### Build and test locally

```bash
sudo snap install snapcraft --classic
sudo snap install lxd && sudo lxd init --auto   # snapcraft builds inside an LXD container

snapcraft                                       # run from the repo root -> passvault_1.0_amd64.snap
sudo snap install --dangerous ./passvault_1.0_amd64.snap
passvault
```
