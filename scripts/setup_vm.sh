#!/bin/bash
set -e

echo "🔹 Updating system..."
sudo apt-get update

echo "🔹 Installing dependencies (curl, git, make, gcc)..."
sudo apt-get install -y curl git make gcc

# Install Go 1.22
if ! command -v go &> /dev/null; then
    echo "🔹 Installing Go 1.22..."
    wget https://go.dev/dl/go1.22.0.linux-amd64.tar.gz
    sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz
    rm go1.22.0.linux-amd64.tar.gz
    # Add to path temporarily for this script
    export PATH=$PATH:/usr/local/go/bin
    # Add to profile
    echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.profile
    echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
else
    echo "✅ Go is already installed"
fi

# Install Node.js (for dashboard)
if ! command -v npm &> /dev/null; then
    echo "🔹 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "✅ Node.js is already installed"
fi

echo "✅ Environment setup complete!"
echo "👉 Run 'source ~/.bashrc' to update PATH, then 'make all'"
