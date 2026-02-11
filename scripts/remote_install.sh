#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}🚀 Docklet Remote Agent Installer${NC}"
echo "This script will deploy an Agent to a remote server via SSH."
echo ""

# 1. Gather Inputs
read -p "Remote User (e.g. root): " REMOTE_USER
read -p "Remote Host IP: " REMOTE_HOST
read -p "Hub Address (e.g. 1.2.3.4:50051): " HUB_ADDR

if [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_HOST" ] || [ -z "$HUB_ADDR" ]; then
    echo "❌ Error: All fields are required."
    exit 1
fi

TARGET="$REMOTE_USER@$REMOTE_HOST"

# 2. Check Local Certs
if [ ! -d "certs" ]; then
    echo "❌ Error: 'certs/' directory not found locally."
    echo "   Run 'go run cmd/certgen/main.go' first."
    exit 1
fi

echo ""
echo -e "${GREEN}Step 1/4: Install prerequisites on remote server...${NC}"
ssh -t $TARGET "command -v git >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y git)"

echo ""
echo -e "${GREEN}Step 2/4: Clone Docklet repo...${NC}"
# Check if dir exists, if not clone, else pull
ssh $TARGET "if [ ! -d 'Docklet' ]; then git clone https://github.com/ASTRACAT2022/Docklet.git; else cd Docklet && git pull; fi"

echo ""
echo -e "${GREEN}Step 3/4: Upload Certificates...${NC}"
# Create certs dir remotely
ssh $TARGET "mkdir -p Docklet/certs"
# Upload files
scp certs/ca-cert.pem certs/agent-cert.pem certs/agent-key.pem $TARGET:~/Docklet/certs/

echo ""
echo -e "${GREEN}Step 4/4: Deploy Agent...${NC}"
ssh -t $TARGET "cd Docklet && chmod +x scripts/deploy_agent.sh && sudo ./scripts/deploy_agent.sh $HUB_ADDR"

echo ""
echo -e "${CYAN}✅ Remote Installation Complete!${NC}"
echo "Agent should be running on $REMOTE_HOST connected to $HUB_ADDR"
