#!/bin/bash
set -e

# Detect sudo
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo &> /dev/null; then
        SUDO="sudo"
    fi
fi

# 1. Build if missing
if [ ! -f "bin/hub" ]; then
    echo "🔹 Binary not found. Checking dependencies..."
    chmod +x scripts/setup_vm.sh
    ./scripts/setup_vm.sh
    
    # Ensure Go is in path
    if ! command -v go &> /dev/null; then
        export PATH=$PATH:/usr/local/go/bin
    fi
    
    echo "🔹 Building Hub..."
    go build -o bin/hub ./cmd/hub
fi

# 2. Check Certificates
echo "🔹 Verifying certificates..."
if [ ! -f "certs/server-cert.pem" ] || [ ! -f "certs/server-key.pem" ] || [ ! -f "certs/ca-cert.pem" ]; then
    echo "❌ MISSING CERTIFICATES!"
    echo "   Run 'go run cmd/certgen/main.go' first."
    exit 1
fi

# 3. Create Systemd Service
echo "🔹 Installing Hub Systemd Service..."
SERVICE_FILE="/etc/systemd/system/docklet-hub.service"
WORK_DIR=$(pwd)
USER_NAME=$(whoami)

# Write service file
$SUDO bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=Docklet Hub Control Plane
After=network.target postgresql.service

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$WORK_DIR
ExecStart=$WORK_DIR/bin/hub
Restart=always
RestartSec=5
# Default DB URL (Change if needed)
Environment=DATABASE_URL=postgres://user:password@localhost:5432/docklet

[Install]
WantedBy=multi-user.target
EOF

# 4. Start Service
echo "🔹 Starting Hub..."
$SUDO systemctl daemon-reload
$SUDO systemctl enable docklet-hub
$SUDO systemctl restart docklet-hub

echo "✅ Docklet Hub Installed & Running!"
echo "   Dashboard: http://<YOUR_IP>:1499"
echo "   Status Check: $SUDO systemctl status docklet-hub"
echo "   Logs: $SUDO journalctl -u docklet-hub -f"

echo ""
echo "⚠️  IMPORTANT: Ensure port 50051 (gRPC) and 1499 (HTTP) are open in your firewall!"
