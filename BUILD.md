# Build Instructions

This project is a fork of cockpit-podman adapted for Docker. Due to some compatibility issues with the original build system, follow these instructions for a successful build:

## Prerequisites

- Node.js and npm
- make
- Linux environment (WSL on Windows works)
- sudo access for installation

## Building and Installing

### Method 1: Simple Build (Recommended)

```bash
# Install dependencies
npm install

# Build the project
make

# Install (requires sudo)
sudo make install
```

### Method 2: If you encounter issues with the git-based node_modules system

The project originally used a complex git-based node_modules management system. If you encounter errors related to `node-modules-fix.sh` or package.json mismatches:

1. Remove any existing node_modules:
   ```bash
   rm -rf node_modules
   ```

2. Install dependencies normally:
   ```bash
   npm install
   ```

3. Build and install:
   ```bash
   make install  # or sudo make install
   ```

## Common Issues and Solutions

### SCSS Compilation Errors

If you see errors related to undefined SCSS variables or mixins, the SCSS files have been updated to use compatible PatternFly imports. The main changes were:

- Updated `@use` syntax to `@import` for older SCSS compatibility
- Fixed PatternFly variable names (e.g., `$pf--global--breakpoint--md` → hardcoded `768px`)
- Updated mixin names (e.g., `pf-line-clamp` → `pf-v5-line-clamp`)

### Windows Line Ending Issues

If building on Windows with WSL, you may encounter line ending issues. Fix with:

```bash
dos2unix *.sh *.js
find src -name "*.js" -o -name "*.jsx" -o -name "*.scss" | xargs dos2unix
```

### Permission Issues During Installation

The installation tries to write to `/usr/local/share/cockpit/docker`. Either:

- Run with `sudo make install`
- Or change the prefix: `make install PREFIX=$HOME/.local`

## Development Mode

For development without system installation:

```bash
# Build 
make

# Install to user directory (no sudo needed)
make devel-install

# Access via Cockpit at localhost:9090
```

## Notes

- This fork converts the project from Podman to Docker
- Some SCSS compilation issues have been fixed by updating to compatible PatternFly syntax
- The build system has been simplified to use standard npm instead of the complex git submodule system