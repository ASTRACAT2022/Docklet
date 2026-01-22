# Docklet 🐳

**Docklet** is a lightweight, distributed container orchestrator written in Go. It enables you to manage a cluster of worker nodes, deploy applications with replicas, and monitor them via a modern, real-time Web UI.

![Docklet Dashboard](./web/public/window.svg) <!-- Placeholder for actual screenshot -->

## 🚀 Features

-   **Cluster Management**: Manage multiple worker nodes (Agents) from a single Control Plane.
-   **Replica Scheduling**: Deploy multiple replicas of an application (Round-Robin scheduling).
-   **Self-Healing**: Automatic container restart policies using Docker's native mechanisms (`unless-stopped`).
-   **Zero-Downtime Updates**: Supports Rolling Updates (Canary-style) for service upgrades.
-   **Real-time Logs**: Stream logs directly from remote containers to the dashboard.
-   **Full lifecycle**: Deploy, Update, Stop, and Delete applications.
-   **Backup & Recovery**: Export full cluster state (Nodes + Apps) to JSON.
-   **YAML Support**: Deploy complex configurations via simplified Docker Compose-like manifests.

## 🏗 Architecture

Docklet follows a standard Control Plane / Agent architecture:

1.  **Control Plane (`docklet-cp`)**:
    -   REST API server.
    -   State store (SQLite via GORM).
    -   Scheduler (Round-Robin).
    -   Rollout Controller (manages scaling and updates).
2.  **Agent (`docklet-agent`)**:
    -   Runs on every worker node.
    -   Connects to local Docker Daemon.
    -   Registers with Control Plane.
    -   Polls for Tasks (Deploy, Stop, Fetch Logs).
    -   Sends Heartbeats and Status updates.
3.  **Web UI (`web/`)**:
    -   Next.js 15 (React) application.
    -   TailwindCSS + Shadcn/UI for a premium dark-mode aesthetic.
    -   Polls API for real-time state.

## 🛠 Prerequisites

-   **Go**: 1.22+
-   **Node.js**: 20+
-   **Docker**: Running on all worker nodes.

## 📦 Installation & Running

### 1. Start the Control Plane

```bash
# Build and Run
go build -o docklet-cp ./cmd/docklet-cp
./docklet-cp
```
*Listens on `:8080`. Creates `docklet.db` (SQLite).*

### 2. Start the Agent (Worker Node)

On the same machine (for dev) or a remote machine:
```bash
# Point to Control Plane URL
export CP_URL="http://localhost:8080" 

# Build and Run
go build -o docklet-agent ./cmd/docklet-agent
./docklet-agent
```
*The agent will register itself and appear in the UI as "Online".*

### 3. Start the Web UI

```bash
cd web
npm install
npm run dev
```
*Open [http://localhost:3000](http://localhost:3000).*

## 📖 Usage Guide

### Deploying an App
1.  Click **+ Deploy App**.
2.  **Image**: Enter a public Docker image (e.g., `nginx:latest` or `python:3.9-slim`).
3.  **Replicas**: Choose how many copies to run (e.g., `3`).
4.  **Auto-Restart**: Check to enable self-healing (`restart: unless-stopped`).
5.  Click **Deploy Cluster**.
    *   *Docklet will schedule containers across available nodes.*

### Updating an App
1.  Click **Update** on an active application.
2.  Enter the new image tag (e.g., `nginx:alpine`).
3.  Docklet performs a **Rolling Update**:
    *   Creates a new "Rolling" Revision.
    *   Agent pulls new image.
    *   Switches traffic (conceptually) or replaces container.

### YAML Deployment (Advanced)
Use the "Deploy YAML" button on a Node or the main button to use a manifest:
```yaml
version: "3"
services:
  app:
    image: redis:alpine
    restart: always
    ports:
      - "6379:6379"
    environment:
      - PASSWORD=secret
```

### Backups
Click the **↓ Backup** button in the header to download `docklet-backup.json`. This contains the complete state of your infrastructure.

## 🤝 Contributing

Pull requests are welcome! Please ensure you run tests before submitting.

```bash
go test ./...
```

## 📄 License

MIT
