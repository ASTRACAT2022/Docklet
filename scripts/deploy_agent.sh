#!/bin/bash
set -e

HUB_ADDR=$1

if [ -z "$HUB_ADDR" ]; then
    echo "Usage: $0 <HUB_IP:PORT>"
    echo "Example: $0 192.168.1.5:50051"
    exit 1
fi

# Detect sudo
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo &> /dev/null; then
        SUDO="sudo"
    fi
fi

# 1. Build if missing
if [ ! -f "bin/agent" ]; then
    echo "🔹 Binary not found. Checking dependencies..."
    chmod +x scripts/setup_vm.sh
    ./scripts/setup_vm.sh
    
    # Ensure Go is in path
    if ! command -v go &> /dev/null; then
        export PATH=$PATH:/usr/local/go/bin
    fi
    
    echo "🔹 Building Agent..."
    go build -o bin/agent ./cmd/agent
fi

# 2. Check Certificates
echo "🔹 Verifying certificates..."
if [ ! -f "certs/agent-cert.pem" ] || [ ! -f "certs/agent-key.pem" ] || [ ! -f "certs/ca-cert.pem" ]; then
    echo "❌ MISSING CERTIFICATES!"
    echo "   You must copy the following files from your Hub machine to '$(pwd)/certs/':"
    echo "     - certs/ca-cert.pem"
    echo "     - certs/agent-cert.pem"
    echo "     - certs/agent-key.pem"
    echo "   (Use SCP or RSYNC to upload them)"
    exit 1
fi

# 3. Create Systemd Service
echo "🔹 Installing Systemd Service..."
SERVICE_FILE="/etc/systemd/system/docklet-agent.service"
WORK_DIR=$(pwd)
USER_NAME=$(whoami)

# Write service file
$SUDO bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=Docklet Agent
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$WORK_DIR
ExecStart=$WORK_DIR/bin/agent --hub $HUB_ADDR
Restart=always
RestartSec=5
Environment=DOCKLET_HUB_ADDR=$HUB_ADDR

[Install]
WantedBy=multi-user.target
EOF

# 4. Start Service
echo "🔹 Starting Agent..."
$SUDO systemctl daemon-reload
$SUDO systemctl enable docklet-agent
$SUDO systemctl restart docklet-agent

echo "✅ Docklet Agent Installed & Running!"
echo "   Hub Address: $HUB_ADDR"
echo "   Status Check: $SUDO systemctl status docklet-agent"
echo "   Logs: $SUDO journalctl -u docklet-agent -f"
