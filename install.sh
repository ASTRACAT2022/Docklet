#!/bin/bash
set -e

# Usage: curl ... | bash -s -- -install node <HUB_IP> [BOOTSTRAP_TOKEN]
# Or: ./install.sh -install node <HUB_IP> [BOOTSTRAP_TOKEN]

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Check args
if [ "$1" != "-install" ] || [ "$2" != "node" ]; then
    echo "Usage: $0 -install node"
    exit 1
fi

echo -e "${CYAN}🚀 Docklet Auto-Installer v1.7${NC}"

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
    
    # If a system Go exists, it might be too old (e.g. 1.19). We want 1.24+.
    if command -v go &> /dev/null; then
        GO_VER=$(go version | awk '{print $3}' | sed 's/go//')
        echo "Found Go version: $GO_VER"
        if [[ "$GO_VER" == 1.1* ]] || [[ "$GO_VER" == 1.20* ]] || [[ "$GO_VER" == 1.21* ]] || [[ "$GO_VER" == 1.22* ]] || [[ "$GO_VER" == 1.23* ]]; then
            echo "⚠️  Go version is too old. Removing distro Go and installing 1.25..."
            if command -v apt-get &> /dev/null; then
                $SUDO apt-get remove -y golang-go golang || true
            elif command -v yum &> /dev/null; then
                $SUDO yum remove -y golang || true
            fi
            $SUDO rm -rf /usr/local/go
        fi
    fi

    # Install Go if missing
    if ! command -v go &> /dev/null || [ ! -d "/usr/local/go" ]; then
        if [ ! -f "/usr/local/go/bin/go" ]; then
            echo "Installing Go 1.25..."
            # Try curl if wget is missing
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
fi

# Prefer /usr/local/go over distro Go
export PATH=/usr/local/go/bin:$PATH

# Ensure Go is available
if ! command -v go &> /dev/null; then
    if ! command -v go &> /dev/null; then
         echo -e "${RED}❌ Go installation failed. Please install Go 1.24+ manually.${NC}"
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
BOOTSTRAP_TOKEN="$4"

# Handle "IP hub 1.1.1.1" case from user request just in case
if [ "$3" == "IP" ] && [ "$4" == "hub" ]; then
    HUB_IP="$5"
    BOOTSTRAP_TOKEN="$6"
fi

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

echo "Fetching certs from $HUB_IP..."
# Fetch JSON
RESPONSE=$(curl -s "http://$HUB_IP:1499/api/bootstrap/certs?token=$BOOTSTRAP_TOKEN")

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
