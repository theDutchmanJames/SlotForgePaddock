# Build Linux and macOS installers

## Download a finished app

The [native release workflow](../.github/workflows/native-release.yml) builds
Linux x64/ARM64 AppImage and Debian packages, plus a universal macOS DMG and ZIP
for Intel and Apple Silicon. Successful builds attach downloads and separate
SHA-256 manifests to the [GitHub release](https://github.com/theDutchmanJames/SlotForgePaddock/releases).
Users do not need Node.js or a development terminal to install those packages.
AppImages may need executable permission; the macOS approval notes below still apply.

Publishing a new release starts the workflow. Maintainers can also open
**Actions → Native Linux and macOS releases → Run workflow**, enter an existing
version tag, and select **Attach verified installers** to backfill its release.
Leave that option off for a build-only run; downloads remain in Actions artifacts
for 14 days. Releases created with another workflow's `GITHUB_TOKEN` do not trigger
release workflows: dispatch this workflow explicitly in that case.

Each native runner installs locked dependencies, runs syntax checks and unit/local-server
tests, builds installers, and verifies their checksums. Upload runs only after all
three builds succeed, using the exact tagged source. Existing assets are never
overwritten; identical assets are accepted on upload retries, while conflicts stop
publication for maintainer review. Windows downloads and their manifest are untouched.

## Build locally

These launchers follow SlotForge Timing's normal/quick builder approach. Run them on the operating system you are building for. They do not install the app automatically or change collection data.

## Requirements

- Node.js **22.12 or newer**, including npm.
- The complete project source, including `package-lock.json`, extracted to a writable folder.
- Internet access for the first build and whenever dependencies or packaging tools need downloading.
- On macOS, install Apple's Command Line Tools if requested (`xcode-select --install`).

Download the [current source ZIP](https://github.com/theDutchmanJames/SlotForgePaddock/archive/refs/heads/main.zip), or clone the repository. Release v0.17.0 and newer include these builders; the original v0.16.3 tag predates them.

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
| Linux x64 | `SlotForgePaddock-<version>-linux-x86_64.AppImage` and `SlotForgePaddock-<version>-linux-amd64.deb` |
| Linux ARM64 | `SlotForgePaddock-<version>-linux-arm64.AppImage` and `.deb` |
| macOS | `SlotForgePaddock-<version>-mac-<arch>.dmg` and `.zip` |

Each builder also writes a platform/architecture-specific SHA-256 checksum file. Local builds do not upload anything; only the separate GitHub workflow publishes downloads. The existing Windows builder remains `npm run dist`.

For direct packaging after dependencies are installed, use `npm run dist:linux -- --x64 --publish never` or `npm run dist:mac -- --universal --publish never`. Direct npm packaging skips the launchers' checks and checksum generation.

## Validation status

Native workflow results are recorded in GitHub Actions. Successful packaging and
automated tests do not replace interactive installation and app-startup testing on
users' Linux distributions and Macs. macOS builds use ad-hoc signing, not Apple
Developer ID signing or notarisation.
