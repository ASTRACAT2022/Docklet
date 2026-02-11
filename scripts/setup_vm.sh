#!/bin/bash
set -e

# Detect if we need sudo
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo &> /dev/null; then
        SUDO="sudo"
    else
        echo "❌ Error: This script requires root privileges or sudo."
        exit 1
    fi
fi

echo "🔹 Updating system..."
$SUDO apt-get update

echo "🔹 Installing dependencies (curl, git, make, gcc)..."
$SUDO apt-get install -y curl git make gcc wget tar

# Install Go 1.22
if ! command -v go &> /dev/null; then
    echo "🔹 Installing Go 1.22..."
    wget https://go.dev/dl/go1.22.0.linux-amd64.tar.gz
    $SUDO rm -rf /usr/local/go && $SUDO tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz
    rm go1.22.0.linux-amd64.tar.gz
    # Add to path temporarily
    export PATH=$PATH:/usr/local/go/bin
    # Add to profile (check if already exists)
    if ! grep -q "/usr/local/go/bin" ~/.profile; then
        echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.profile
    fi
    if ! grep -q "/usr/local/go/bin" ~/.bashrc; then
        echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
    fi
else
    echo "✅ Go is already installed"
fi

# Install Node.js (for dashboard)
if ! command -v npm &> /dev/null; then
    echo "🔹 Installing Node.js..."
    # Warning: NodeSource script might need sudo/root
    if [ -n "$SUDO" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
    else
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    fi
    $SUDO apt-get install -y nodejs
else
    echo "✅ Node.js is already installed"
fi

echo "✅ Environment setup complete!"
echo "👉 Run 'source ~/.bashrc' or 'source ~/.profile' now."
echo "👉 Then run 'make all'"
