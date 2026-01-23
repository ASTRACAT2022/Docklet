# Docklet

**Docklet** is a secure, decentralized orchestration platform for Docker containers. It enables you to manage thousands of distributed agents from a central hub using a unified CLI and Web Dashboard.

![Status Beta](https://img.shields.io/badge/status-beta-yellow) ![License MIT](https://img.shields.io/badge/license-MIT-blue) ![Go 1.22](https://img.shields.io/badge/go-1.22-cyan)

## 📚 Wiki & Architecture

Docklet connects distributed **Agents** to a central **Hub** over a secure gRPC connection.

```mermaid
graph TD
    CLI[Docklet CLI] -- mTLS --> Hub
    Web[Web Dashboard] -- HTTP --> Hub
    Hub[Docklet Hub] -- mTLS --> Agent1[Agent A]
    Hub -- mTLS --> Agent2[Agent B]
    
    Agent1 -- socket --> Docker1[Docker Engine A]
    Agent2 -- socket --> Docker2[Docker Engine B]
    
    Hub -- TCP --> DB[(PostgreSQL)]
```

### Key Features
*   **Secure by Default**: All traffic is encrypted and authenticated using Mutual TLS (mTLS).
*   **Firewall Friendly**: Agents connect outbound to the Hub; no open ports required on Agents.
*   **Hybrid persistence**: Stores state in PostgreSQL, but falls back to In-Memory if DB is offline.
*   **Web Dashboard**: built-in React/Vite UI for monitoring your fleet.

---

## 🚀 Getting Started

### Prerequisites
*   Go 1.22+
*   Node.js & npm (for Dashboard)
*   Docker (running locally)
*   PostgreSQL (optional)

### 1. Installation

**⚡️ Fast Setup (Fresh Linux VM)**
If you are running on a fresh Debian/Ubuntu server (e.g. root on a VPS), use our setup script to install dependencies (Go, Node.js, Make) and build the project automatically:

```bash
git clone https://github.com/ASTRACAT2022/Docklet.git
cd Docklet
chmod +x scripts/setup_vm.sh
./scripts/setup_vm.sh

# Reload shell configuration
source ~/.bashrc

# Build everything
make all
```

**🔧 Manual Setup (Dev Machine)**
If you already have Go and Node.js installed:
```bash
git clone https://github.com/ASTRACAT2022/Docklet.git
cd Docklet
make build
```

The binaries will be created in the `bin/` directory:
- `bin/hub`
- `bin/agent`
- `bin/cli`

### 2. Security Setup (Certificates)

Docklet uses mTLS. You must generate certificates before running any component. We provide a tool for this:

```bash
go run cmd/certgen/main.go
```
This creates a `certs/` directory containing:
- `ca-cert.pem`: Root CA (Trust anchor)
- `server-*.pem`: Keys for the Hub
- `agent-*.pem`: Keys for Agents
- `client-*.pem`: Keys for the CLI

### 3. Running the Hub

The Hub manages the fleet. It serves the gRPC API on port `:50051` and the Web Dashboard on `:1499`.

**Production Service (Systemd)**
To run the Hub in the background with auto-restart:
```bash
chmod +x scripts/deploy_hub.sh
./scripts/deploy_hub.sh
```

**Manual Dev Run**
```bash
# Just run it (starts in foreground)
./bin/hub
```

### 4. Running an Agent

**Quick Deployment (Systemd)**
We provide a script to install the agent as a systemd service (auto-restart).

1.  **Transfer Certificates**: Copy `certs/` folder from Hub to the Agent machine.
2.  **Run Deploy Script**:
    ```bash
    chmod +x scripts/deploy_agent.sh
    ./scripts/deploy_agent.sh <HUB_IP>:50051
    ```

**Manual Run**
The Agent runs on the machine where you want to run containers.
*Ensure `certs/` are available to the agent.*

```bash
# Connects to localhost hub by default
./bin/agent

# Or specify remote hub address
./bin/agent --hub remote-hub-ip:50051
```

**Option B: Magic Remote Install (Use from Admin Machine)**
If you are on your laptop (Mac/Linux) and want to deploy to a remote server without logging in manually:

```bash
chmod +x scripts/remote_install.sh
./scripts/remote_install.sh
```
*Follow the prompts. It will SSH into the server, upload keys, and start the agent.*

### 5. Using the CLI

Manage your fleet using the CLI tool.

```bash
# List all connected nodes
./bin/cli nodes ls

# Run a container on a specific node
./bin/cli run --node <NODE_ID> nginx:latest

# List containers on a specific node
./bin/cli ps --node <NODE_ID>
```

---

## 🖥️ Web Dashboard

The Hub includes a built-in Web Dashboard. Application source code is in `web/dashboard`.

1.  Make sure you built the project (`make build` compiles the frontend).
2.  Start the Hub.
3.  Open **http://localhost:1499** in your browser.

**Default Credentials:**
*   Username: `astracat`
*   Password: `astracat`


---

## 🛠 Configuration

| Environment Variable | Component | Description | Default |
|----------------------|-----------|-------------|---------|
| `DATABASE_URL`       | Hub       | Postgres Connection String | `postgres://user:password@localhost:5432/docklet` |
| `DOCKLET_HUB_ADDR`   | Agent     | Address of the Hub | `localhost:50051` |

---

## 🔒 Security Details

Docklet enforces **Zero Trust**:
1.  **Hub** requires a client certificate from Agents and CLI.
2.  **Agents** verify the Hub's certificate against the CA.
3.  **CLI** authenticates using its client certificate.

To revoke access, simple revoke the certificate (CRL implementation coming in v1.1).

---

## License

This project is licensed under the MIT License.
