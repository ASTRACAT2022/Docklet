#!/bin/bash
set -e

# Usage: curl ... | bash -s -- -install node <HUB_IP>
# Or: ./install.sh -install node <HUB_IP>

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Check args
if [ "$1" != "-install" ] || [ "$2" != "node" ]; then
    echo "Usage: $0 -install node"
    exit 1
fi

echo -e "${CYAN}🚀 Docklet Auto-Installer v1.3${NC}"

# 1. Install Dependencies
echo -e "${GREEN}Step 1: Installing dependencies (Go, git, make)...${NC}"

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

if [ "$(uname)" = "Linux" ]; then
    if command -v apt-get &> /dev/null; then
        $SUDO apt-get update && $SUDO apt-get install -y git make curl jq tar
    elif command -v yum &> /dev/null; then
        $SUDO yum install -y git make curl jq tar
    fi
    
    # Check for outdated system Go (often 1.19 or older on Debian)
    if command -v go &> /dev/null; then
        GO_VER=$(go version | awk '{print $3}' | sed 's/go//')
        # Simple check: if starts with 1.1, 1.0, etc, it's old. We need 1.22+
        # Let's just forcefully install 1.22 if we are root/sudo
        echo "Found Go version: $GO_VER"
        # If version is less than 1.22 (naive string check for 1.1* or 1.20/1.21)
        if [[ "$GO_VER" == 1.1* ]] || [[ "$GO_VER" == 1.20* ]] || [[ "$GO_VER" == 1.21* ]]; then
             echo "⚠️  Go version is too old. Removing system go and installing 1.22..."
             $SUDO apt-get remove -y golang-go || true
             $SUDO rm -rf /usr/local/go
        fi
    fi

    # Install Go if missing
    if ! command -v go &> /dev/null || [ ! -d "/usr/local/go" ]; then
        if [ ! -f "/usr/local/go/bin/go" ]; then
            echo "Installing Go 1.22..."
            # Try curl if wget is missing
            if command -v wget &> /dev/null; then
                wget -q https://go.dev/dl/go1.22.0.linux-amd64.tar.gz
            else
                curl -L -o go1.22.0.linux-amd64.tar.gz https://go.dev/dl/go1.22.0.linux-amd64.tar.gz
            fi
            
            $SUDO rm -rf /usr/local/go && $SUDO tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz
            rm go1.22.0.linux-amd64.tar.gz
        fi
        export PATH=$PATH:/usr/local/go/bin
    fi
fi

# Ensure Go is available
if ! command -v go &> /dev/null; then
    # Try adding to path again just in case
    export PATH=$PATH:/usr/local/go/bin
    if ! command -v go &> /dev/null; then
         echo -e "${RED}❌ Go installation failed. Please install Go 1.22 manually.${NC}"
         exit 1
    fi
fi

# 2. Clone Repo
echo -e "${GREEN}Step 2: Cloning Docklet...${NC}"
if [ -d "Docklet" ]; then
    cd Docklet
    git pull
else
    git clone https://github.com/ASTRACAT2022/Docklet.git
    cd Docklet
fi

# 3. Build Agent
echo -e "${GREEN}Step 3: Building Agent...${NC}"
go build -o bin/agent ./cmd/agent

# 4. Bootstrap Certs
echo -e "${GREEN}Step 4: Bootstrapping...${NC}"

HUB_IP="$3"

# Handle "IP hub 1.1.1.1" case from user request just in case
if [ "$3" == "IP" ] && [ "$4" == "hub" ]; then
    HUB_IP="$5"
fi

if [ -z "$HUB_IP" ]; then
    read -p "👉 Enter Hub IP (e.g. 192.168.1.5): " HUB_IP
fi

if [ -z "$HUB_IP" ]; then
    echo -e "${RED}❌ IP address is required.${NC}"
    exit 1
fi

echo "Fetching certs from $HUB_IP..."
# Fetch JSON
RESPONSE=$(curl -s "http://$HUB_IP:1499/api/bootstrap/certs?token=bootstrap-token-123")

# Check if jq installed
if ! command -v jq &> /dev/null; then
    echo "jq not found. Trying to install..."
    if [ "$(uname)" = "Linux" ]; then
        if command -v apt-get &> /dev/null; then
            $SUDO apt-get install -y jq
        elif command -v yum &> /dev/null; then
            $SUDO yum install -y jq
        fi
    fi
fi

mkdir -p certs
echo "$RESPONSE" | jq -r .ca_cert > certs/ca-cert.pem
echo "$RESPONSE" | jq -r .agent_cert > certs/agent-cert.pem
echo "$RESPONSE" | jq -r .agent_key > certs/agent-key.pem

if [ ! -s certs/agent-key.pem ]; then
    echo -e "${RED}❌ Failed to fetch certs. Check Hub IP and ensure Hub is running.${NC}"
    exit 1
fi

echo "✅ Certs installed."

# 5. Run
echo -e "${GREEN}Step 5: Starting Agent...${NC}"
# Run in background or foreground? User said "everything is ready node connected"
# Let's run it in background using nohup or just start it
echo "Starting agent connected to $HUB_IP:50051..."
nohup ./bin/agent --hub "$HUB_IP:50051" > agent.log 2>&1 &

echo -e "${CYAN}✅ Node connected! Logs: tail -f agent.log${NC}"
