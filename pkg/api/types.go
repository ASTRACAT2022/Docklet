package api

import "time"

// App represents a deployed application
type App struct {
	ID               string    `json:"id" gorm:"primaryKey"`
	CurrentRevision  string    `json:"current_revision"` // Deprecated in v0.2, use ActiveRevisionID logic
	ActiveRevisionID string    `json:"active_revision_id"`
	Status           string    `json:"status"` // stable, rolling_update, failed
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// Revision represents a specific version of an application
type Revision struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	AppID     string    `json:"app_id" gorm:"index"`
	Image     string    `json:"image"`
	Status    string    `json:"status"` // stable, active, failed, rolling
	IsStable  bool      `json:"is_stable"`
	BackupID  string    `json:"backup_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// Task types
const (
	TaskTypeDeploy    = "deploy"
	TaskTypeStop      = "stop"
	TaskTypeFetchLogs = "fetch_logs" // New
)

// TaskStatus types
const (
	TaskStatusPending   = "pending"
	TaskStatusRunning   = "running"
	TaskStatusCompleted = "completed"
	TaskStatusFailed    = "failed"
)

type ContainerStatus struct {
	ID     string            `json:"id"`
	Image  string            `json:"image"`
	State  string            `json:"state"`
	Names  []string          `json:"names"`
	Labels map[string]string `json:"labels"`
}

type HeartbeatRequest struct {
	NodeID     string            `json:"node_id"`
	Containers []ContainerStatus `json:"containers"`
}

type HeartbeatResponse struct {
	Status string `json:"status"`
}

type Instance struct {
	ID          string    `json:"id" gorm:"primaryKey"` // Combined NodeID + ContainerID
	NodeID      string    `json:"node_id" gorm:"index"`
	AppID       string    `json:"app_id" gorm:"index"`
	ContainerID string    `json:"container_id"`
	Status      string    `json:"status"`
	LastSeen    time.Time `json:"last_seen"`
	CreatedAt   time.Time `json:"created_at"`
}

type AppLog struct {
	AppID     string    `json:"app_id" gorm:"index"`
	Content   string    `json:"content"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Node represents an agent/worker node
type Node struct {
	ID       string    `json:"id" gorm:"primaryKey"`
	Hostname string    `json:"hostname"`
	IP       string    `json:"ip"`
	Status   string    `json:"status"` // online, offline
	LastSeen time.Time `json:"last_seen"`
	Version  string    `json:"version"`
}

type RegisterNodeRequest struct {
	Hostname string `json:"hostname"`
	Version  string `json:"version"`
}

type RegisterNodeResponse struct {
	Token string `json:"token"`
}

// Task represents a unit of work for an agent
type Task struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	Type      string    `json:"type"`   // e.g., "deploy"
	Status    string    `json:"status"` // pending, assigned, running, completed, failed
	NodeID    string    `json:"node_id" gorm:"index"`
	TargetID  string    `json:"target_id"` // e.g., App ID
	Payload   string    `json:"payload"`   // JSON payload, e.g., {"image": "nginx"}
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
