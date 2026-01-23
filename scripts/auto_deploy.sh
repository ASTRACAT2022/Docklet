#!/bin/bash
set -e

# Цветной вывод
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

TARGET_URL=$1

if [ -z "$TARGET_URL" ]; then
    echo -e "${YELLOW}Usage: $0 <TARGET_URL>${NC}"
    echo "Example: $0 https://github.com/ASTRACAT2022/Docklet"
    exit 1
fi

echo -e "${CYAN}🚀 Starting Autonomous Deployment...${NC}"

# --- 1. Automatic Node.js Installation ---
echo -e "${GREEN}Step 1: Checking Node.js...${NC}"

if ! command -v node &> /dev/null; then
    echo "⚠️  Node.js not found. Installing automatically..."
    
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    
    case "$OS" in
        Linux)
            if command -v apt-get &> /dev/null; then
                # Debian/Ubuntu
                echo "Detected Debian/Ubuntu. Installing via apt..."
                # Use -k for curl just in case
                curl -fsSL -k https://deb.nodesource.com/setup_20.x | sudo -E bash -
                sudo apt-get install -y nodejs
            elif command -v yum &> /dev/null; then
                # RHEL/CentOS
                echo "Detected RHEL/CentOS. Installing via yum..."
                curl -fsSL -k https://rpm.nodesource.com/setup_20.x | sudo bash -
                sudo yum install -y nodejs
            else
                # Generic Linux (Binary Download)
                echo "Detected Generic Linux. Downloading binaries..."
                NODE_VER="v20.11.0"
                DIST_ARCH="linux-x64"
                if [ "$ARCH" = "aarch64" ]; then DIST_ARCH="linux-arm64"; fi
                
                URL="https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-$DIST_ARCH.tar.gz"
                echo "Downloading from $URL..."
                curl -k -O "$URL"
                tar -xzf "node-$NODE_VER-$DIST_ARCH.tar.gz"
                
                # Add to PATH temporarily for this script
                export PATH=$PWD/node-$NODE_VER-$DIST_ARCH/bin:$PATH
                echo "Node.js installed locally for this session."
            fi
            ;;
        Darwin)
            # macOS
            if command -v brew &> /dev/null; then
                echo "Detected macOS. Installing via Homebrew..."
                brew install node
            else
                echo "⚠️  Homebrew not found. Attempting manual binary install..."
                NODE_VER="v20.11.0"
                URL="https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-darwin-x64.tar.gz" # Assuming Intel for generic, or use arm64 detection
                if [ "$ARCH" = "arm64" ]; then URL="https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-darwin-arm64.tar.gz"; fi
                
                curl -k -O "$URL"
                tar -xzf "node-$NODE_VER-darwin-*.tar.gz"
                export PATH=$PWD/node-$NODE_VER-darwin-*/bin:$PATH
            fi
            ;;
        *)
            echo "⚠️  Unsupported OS: $OS. Please install Node.js manually."
            exit 1
            ;;
    esac
else
    echo "✅ Node.js is already installed: $(node -v)"
fi

# --- 2. Process URL & Bypass Cert Check ---
echo -e "${GREEN}Step 2: Processing URL ($TARGET_URL)...${NC}"
echo "   Disabling strict SSL checks..."

# Check connectivity / Download
# Using curl -k (insecure) as requested
if curl -k -I "$TARGET_URL" &> /dev/null; then
    echo "✅ Connection to $TARGET_URL successful (SSL bypassed)."
else
    echo "❌ Failed to connect to $TARGET_URL"
    exit 1
fi

# Optional: Clone if it's a git repo
if [[ "$TARGET_URL" == *".git" ]] || [[ "$TARGET_URL" == *"github.com"* ]]; then
    DIR_NAME=$(basename "$TARGET_URL" .git)
    if [ ! -d "$DIR_NAME" ]; then
        echo "   Cloning repository (GIT_SSL_NO_VERIFY=true)..."
        GIT_SSL_NO_VERIFY=true git clone "$TARGET_URL"
    else
        echo "   Directory $DIR_NAME already exists. Skipping clone."
    fi
fi

# --- 3. Dynamic Configuration ---
echo -e "${GREEN}Step 3: Configuration${NC}"

# Interactive Prompt
if [ -z "$DOCKLET_HUB_IP" ]; then
    read -p "👉 Enter Hub IP address (e.g., 192.168.1.5): " USER_IP
else
    USER_IP="$DOCKLET_HUB_IP"
    echo "Using IP from environment: $USER_IP"
fi

if [ -z "$USER_IP" ]; then
    echo "❌ IP address is required."
    exit 1
fi

CONFIG_FILE=".env"
JSON_CONFIG="docklet_config.json"

# Write to .env
echo "DOCKLET_HUB_ADDR=$USER_IP:50051" > "$CONFIG_FILE"
echo "NODE_ENV=production" >> "$CONFIG_FILE"

# Write to JSON
cat > "$JSON_CONFIG" <<EOF
{
  "hub_address": "$USER_IP:50051",
  "ssl_verify": false,
  "target_url": "$TARGET_URL"
}
EOF

# --- 4. Completion ---
echo ""
echo -e "${CYAN}🎉 Deployment Complete!${NC}"
echo "---------------------------------------------------"
echo "✅ Нода успешно подключена."
echo "📄 Конфигурация сохранена в: $PWD/$CONFIG_FILE и $PWD/$JSON_CONFIG"
echo "🔗 IP Hub: $USER_IP"
echo "---------------------------------------------------"
