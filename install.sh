#!/bin/bash
set -e

# Usage: 
#   ./install.sh -install node <HUB_IP> [BOOTSTRAP_TOKEN]
#   ./install.sh -install hub [BOOTSTRAP_TOKEN]

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Check args
if [ "$1" != "-install" ]; then
    echo "Usage: $0 -install [node|hub]"
    exit 1
fi

MODE="$2"
if [ "$MODE" != "node" ] && [ "$MODE" != "hub" ]; then
    echo "Usage: $0 -install [node|hub]"
    exit 1
fi

echo -e "${CYAN}🚀 Docklet Auto-Installer v1.8 ($MODE)${NC}"

# Detect sudo
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo &> /dev/null; then
        SUDO="sudo"
    else
        echo -e "${RED}❌ Root or sudo required.${NC}"
        exit 1
    fi
fi

# --- Step 1: Install Common Dependencies ---
echo -e "${GREEN}Step 1: Installing dependencies...${NC}"

if [ "$(uname)" = "Linux" ]; then
    if command -v apt-get &> /dev/null; then
        $SUDO apt-get update
        $SUDO apt-get install -y git make curl jq tar
    elif command -v yum &> /dev/null; then
        $SUDO yum install -y git make curl jq tar
    fi

    # Install Go 1.25+
    NEED_GO=true
    if command -v go &> /dev/null; then
        GO_VER=$(go version | awk '{print $3}' | sed 's/go//')
        # Check if version is old (1.1x - 1.23)
        if [[ "$GO_VER" =~ ^1\.([1-9]|1[0-9]|2[0-3])(\.|$) ]]; then
             echo "⚠️  Go version $GO_VER is too old. Installing 1.25..."
             if command -v apt-get &> /dev/null; then $SUDO apt-get remove -y golang-go golang || true; fi
             if command -v yum &> /dev/null; then $SUDO yum remove -y golang || true; fi
             $SUDO rm -rf /usr/local/go
        else
             NEED_GO=false
             echo "Found Go version: $GO_VER"
        fi
    fi

    if [ "$NEED_GO" = true ]; then
        echo "Installing Go 1.25..."
        if command -v wget &> /dev/null; then
            wget -q https://go.dev/dl/go1.25.6.linux-amd64.tar.gz
        else
            curl -L -o go1.25.6.linux-amd64.tar.gz https://go.dev/dl/go1.25.6.linux-amd64.tar.gz
        fi
        $SUDO rm -rf /usr/local/go && $SUDO tar -C /usr/local -xzf go1.25.6.linux-amd64.tar.gz
        rm go1.25.6.linux-amd64.tar.gz
    fi
    
    export PATH=/usr/local/go/bin:$PATH
fi

# Ensure Go works
if ! command -v go &> /dev/null; then
    echo -e "${RED}❌ Go installation failed.${NC}"
    exit 1
fi

# --- Step 2: Clone Repo ---
echo -e "${GREEN}Step 2: Cloning Docklet...${NC}"
if [ -d "Docklet" ]; then
    cd Docklet
    git pull
else
    git clone https://github.com/ASTRACAT2022/Docklet.git
    cd Docklet
fi

# --- HUB INSTALLATION ---
if [ "$MODE" == "hub" ]; then
    BOOTSTRAP_TOKEN="$3"
    if [ -z "$BOOTSTRAP_TOKEN" ]; then
        # Generate random token if not provided
        BOOTSTRAP_TOKEN=$(openssl rand -hex 16 2>/dev/null || echo "docklet-secret-token-$(date +%s)")
        echo -e "🔑 Generated Bootstrap Token: ${CYAN}$BOOTSTRAP_TOKEN${NC}"
    fi

    # Install Node.js for Dashboard
    echo -e "${GREEN}Installing Node.js (for Dashboard)...${NC}"
    if ! command -v node &> /dev/null; then
        if [ "$(uname)" = "Linux" ]; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
            $SUDO apt-get install -y nodejs
        fi
    fi

    # Build Hub
    echo -e "${GREEN}Building Hub Service...${NC}"
    go build -o bin/hub ./cmd/hub
    
    # Generate Certs
    echo -e "${GREEN}Generating Certificates...${NC}"
    # Try to detect public/private IP
    MY_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "$MY_IP" ]; then
        MY_IP="127.0.0.1"
    fi
    echo "Detected IP: $MY_IP"
    go run cmd/certgen/main.go --ip "127.0.0.1,::1,$MY_IP"

    # Build Dashboard
    echo -e "${GREEN}Building Web Dashboard...${NC}"
    cd web/dashboard
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    npm run build
    cd ../..

    # Create Service User
    if ! id "docklet" &>/dev/null; then
        $SUDO useradd -r -s /bin/false docklet || true
    fi

    # Install Systemd Service
    echo -e "${GREEN}Installing Service...${NC}"
    
    if command -v systemctl &> /dev/null; then
        # Create Config Dir
        $SUDO mkdir -p /etc/docklet
        echo "DOCKLET_BOOTSTRAP_TOKEN=$BOOTSTRAP_TOKEN" | $SUDO tee /etc/docklet/hub.env > /dev/null
        $SUDO chmod 600 /etc/docklet/hub.env
        $SUDO chown docklet:docklet /etc/docklet/hub.env

        # Create Service File
        cat <<EOF | $SUDO tee /etc/systemd/system/docklet-hub.service
[Unit]
Description=Docklet Orchestration Hub
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$(pwd)
EnvironmentFile=/etc/docklet/hub.env
ExecStart=$(pwd)/bin/hub
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

        $SUDO systemctl daemon-reload
        $SUDO systemctl enable docklet-hub
        $SUDO systemctl restart docklet-hub
        
        echo -e "${CYAN}✅ Docklet Hub installed & running!${NC}"
        echo -e "Logs: sudo journalctl -u docklet-hub -f"
    else
        echo -e "${CYAN}Systemd not found. Starting in background...${NC}"
        export DOCKLET_BOOTSTRAP_TOKEN=$BOOTSTRAP_TOKEN
        pkill -f "bin/hub" || true
        nohup ./bin/hub > hub.log 2>&1 &
        echo -e "${CYAN}✅ Docklet Hub started (PID $!)!${NC}"
        echo -e "Logs: tail -f hub.log"
    fi

    echo -e "Dashboard: http://<YOUR_IP>:1499"
    echo -e "Bootstrap Token: $BOOTSTRAP_TOKEN"

# --- NODE INSTALLATION ---
elif [ "$MODE" == "node" ]; then
    HUB_IP="$3"
    BOOTSTRAP_TOKEN="$4"

    if [ -z "$HUB_IP" ]; then
        read -p "👉 Enter Hub IP (e.g. 192.168.1.5): " HUB_IP
    fi
    if [ -z "$BOOTSTRAP_TOKEN" ]; then
         BOOTSTRAP_TOKEN="${DOCKLET_BOOTSTRAP_TOKEN:-bootstrap-token-123}"
    fi
    
    if [ -z "$HUB_IP" ]; then
        echo -e "${RED}❌ IP address is required.${NC}"
        exit 1
    fi

    echo -e "${GREEN}Building Agent...${NC}"
    go build -o bin/agent ./cmd/agent

    echo -e "${GREEN}Bootstrapping Certs from $HUB_IP...${NC}"
    RESPONSE=$(curl -s "http://$HUB_IP:1499/api/bootstrap/certs?token=$BOOTSTRAP_TOKEN")
    
    mkdir -p certs
    echo "$RESPONSE" | jq -r .ca_cert > certs/ca-cert.pem
    echo "$RESPONSE" | jq -r .agent_cert > certs/agent-cert.pem
    echo "$RESPONSE" | jq -r .agent_key > certs/agent-key.pem

    if [ ! -s certs/agent-key.pem ]; then
        echo -e "${RED}❌ Failed to fetch certs. Check Hub IP and Token.${NC}"
        exit 1
    fi

    # Install Systemd Service for Agent
    echo -e "${GREEN}Installing Agent Service...${NC}"
    
    if command -v systemctl &> /dev/null; then
        cat <<EOF | $SUDO tee /etc/systemd/system/docklet-agent.service
[Unit]
Description=Docklet Node Agent
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/bin/agent --hub "$HUB_IP:50051"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

        $SUDO systemctl daemon-reload
        $SUDO systemctl enable docklet-agent
        $SUDO systemctl restart docklet-agent

        echo -e "${CYAN}✅ Docklet Agent installed & running!${NC}"
        echo -e "Logs: sudo journalctl -u docklet-agent -f"
    else
        echo -e "${CYAN}Systemd not found. Starting in background...${NC}"
        pkill -f "bin/agent" || true
        nohup ./bin/agent --hub "$HUB_IP:50051" > agent.log 2>&1 &
        echo -e "${CYAN}✅ Docklet Agent started (PID $!)!${NC}"
        echo -e "Logs: tail -f agent.log"
    fi
fi
