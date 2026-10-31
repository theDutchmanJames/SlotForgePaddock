# Build Linux and macOS installers

These launchers follow SlotForge Timing's normal/quick builder approach. Run them on the operating system you are building for. They do not install the app automatically or change collection data.

## Requirements

- Node.js **22.12 or newer**, including npm.
- The complete project source, including `package-lock.json`, extracted to a writable folder.
- Internet access for the first build and whenever dependencies or packaging tools need downloading.
- On macOS, install Apple's Command Line Tools if requested (`xcode-select --install`).

Download the [current source ZIP](https://github.com/theDutchmanJames/SlotForgePaddock/archive/refs/heads/main.zip), or clone the repository. The original v0.16.3 release tag predates these builders; use the current source until a later release includes them.

Run as your normal user, without `sudo`. A full build runs `npm ci`, syntax checks and automated tests before creating installers. Localhost networking must be allowed for the sharing tests.

## Linux

Open a terminal in the project folder:

```sh
bash build-linux.sh
```

This creates an **AppImage** and a **Debian .deb package** for your machine's architecture (`x64` or `arm64`). To choose explicitly:

```sh
bash build-linux.sh --arch x64
```

Install the `.deb` with your distribution's package manager (Debian, Ubuntu, Mint and related distributions), or make the AppImage executable and run it. AppImage requirements such as FUSE depend on your distribution.

## macOS

From Terminal in the project folder:

```sh
bash build-mac.command
```

This creates a **universal DMG and ZIP**, containing both Intel and Apple Silicon support. Open the DMG and drag **SlotForge Paddock** into Applications. You can also extract the ZIP and move its app into Applications.

For a smaller build targeting one kind of Mac:

```sh
bash build-mac.command --arch arm64
# Intel:
bash build-mac.command --arch x64
```

To launch the builder by double-clicking in Finder, make the command files executable once if needed:

```sh
chmod +x build-mac.command build-mac-quick.command
```

The macOS configuration uses **ad-hoc signing** and does not notarise builds with Apple. This is not a Developer ID distribution signature; macOS may require approval in Privacy & Security before opening a downloaded build. The builders do not disable Gatekeeper or remove quarantine attributes.

## Quick builds and output

After a successful normal build, use `bash build-linux-quick.sh` or `bash build-mac-quick.command`. Quick mode skips syntax checks and tests. It reuses dependencies only when the package files, host platform, architecture and Node major version match the previous build; otherwise it installs from the lockfile again. Packaging tools may still need internet access.

Add `--no-pause` for unattended operation, or `--help` for options. Every command stops on failure. Use a normal build before distributing a changed app.

Files are written to `dist/v<version>/`:

| Platform | Files |
| --- | --- |
| Linux | `SlotForgePaddock-<version>-linux-<arch>.AppImage` and `.deb` |
| macOS | `SlotForgePaddock-<version>-mac-<arch>.dmg` and `.zip` |

Each builder also writes a platform/architecture-specific SHA-256 checksum file. Nothing is uploaded to GitHub automatically. The existing Windows builder remains `npm run dist`.

For direct packaging after dependencies are installed, use `npm run dist:linux -- --x64 --publish never` or `npm run dist:mac -- --universal --publish never`. Direct npm packaging skips the launchers' checks and checksum generation.

## Validation status

The launcher control flow and packaging configuration have been checked on Windows. Actual Linux/macOS packaging, installation and app startup still need validation on those systems; these scripts are builders, not a claim of tested native binaries.
