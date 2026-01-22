package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/astracat/docklet/pkg/api"
	"github.com/astracat/docklet/pkg/controller"
	"github.com/astracat/docklet/pkg/store"
	"github.com/google/uuid"
)

type Server struct {
	store *store.Store
}

func main() {
	log.Println("Starting Docklet Control Plane...")

	db, err := store.NewStore("docklet.db")
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Initialize Rollout Controller
	rolloutCtrl := controller.NewRolloutController(db)
	rolloutCtrl.Start()

	server := &Server{store: db}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", server.healthHandler)
	mux.HandleFunc("GET /api/version", server.versionHandler)

	// Auth / Nodes
	mux.HandleFunc("POST /api/register", server.registerHandler)
	mux.HandleFunc("POST /api/agents/heartbeat", server.heartbeatHandler)

	// Apps
	mux.HandleFunc("GET /api/apps", server.listAppsHandler)
	mux.HandleFunc("POST /api/deploy", server.deployHandler)
	mux.HandleFunc("POST /api/apps/{id}/update", server.updateAppHandler)
	mux.HandleFunc("DELETE /api/apps/{id}", server.deleteAppHandler)
	mux.HandleFunc("GET /api/backup", server.backupHandler)

	// Logs
	mux.HandleFunc("GET /api/apps/{id}/logs", server.getLogsHandler)
	mux.HandleFunc("POST /api/apps/{id}/logs/request", server.requestLogsHandler)
	mux.HandleFunc("POST /api/logs", server.reportLogsHandler)

	// Tasks
	mux.HandleFunc("GET /api/agents/{node_id}/tasks", server.getTasksHandler)
	mux.HandleFunc("POST /api/agents/{node_id}/report", server.reportTaskHandler)

	// State (for UI/CLI)
	mux.HandleFunc("GET /api/state/nodes", server.listNodesHandler)
	mux.HandleFunc("GET /api/state/apps", server.listAppsHandler) // Alias

	log.Println("Listening on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) versionHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"version": "v0.1.0"})
}

func (s *Server) registerHandler(w http.ResponseWriter, r *http.Request) {
	var req api.RegisterNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Create a new node entry
	node := &api.Node{
		ID:       uuid.New().String(),
		Hostname: req.Hostname,
		Version:  req.Version,
		Status:   "online",
		LastSeen: time.Now(),
	}

	if err := s.store.CreateNode(node); err != nil {
		log.Printf("Failed to create node: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	resp := api.RegisterNodeResponse{
		Token: "dummy-token-" + node.ID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) heartbeatHandler(w http.ResponseWriter, r *http.Request) {
	var req api.HeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	s.store.UpdateNodeLastSeen(req.NodeID)

	// Process Containers -> Instances
	for _, c := range req.Containers {
		// Assuming for MVP we treat all containers as unknown app unless we match image or label
		// Ideally we match by label 'docklet.app.id'
		var appID string
		// appID = c.Labels["docklet.app.id"]
		// If empty, maybe try to match any running App by image?
		// For now, let's just create an instance record without AppID if unknown.
		appID = "unknown"

		inst := &api.Instance{
			ID:          req.NodeID + "-" + c.ID, // Simple composite key
			NodeID:      req.NodeID,
			AppID:       appID,
			ContainerID: c.ID,
			Status:      c.State,
			LastSeen:    time.Now(),
		}
		s.store.UpsertInstance(inst)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(api.HeartbeatResponse{Status: "ok"})
}

func (s *Server) listAppsHandler(w http.ResponseWriter, r *http.Request) {
	apps, err := s.store.ListApps()
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(apps)
}

func (s *Server) deployHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Image         string            `json:"image"`
		Ports         map[string]string `json:"ports"`
		Env           []string          `json:"env"`
		RestartPolicy string            `json:"restart_policy"`
		Replicas      int               `json:"replicas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Replicas < 1 {
		req.Replicas = 1
	}

	appID := uuid.New().String()
	app := &api.App{
		ID:              appID,
		CurrentRevision: "v1",
		Status:          "deploying",
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}

	if err := s.store.CreateApp(app); err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Scheduler: Round Robin
	nodes, _ := s.store.ListNodes()

	// Logic: Filter online nodes
	activeNodes := []api.Node{}
	for _, n := range nodes {
		if n.Status == "online" {
			activeNodes = append(activeNodes, n)
		}
	}

	if len(activeNodes) == 0 {
		// Fallback for dev if no online activeNodes, try all nodes
		if len(nodes) > 0 {
			activeNodes = nodes
		}
	}

	payloadMap := map[string]interface{}{
		"image":          req.Image,
		"ports":          req.Ports,
		"env":            req.Env,
		"restart_policy": req.RestartPolicy,
		"app_id":         app.ID,
	}
	payloadBytes, _ := json.Marshal(payloadMap)

	// Create Tasks for Replicas
	for i := 0; i < req.Replicas; i++ {
		nodeID := ""
		if len(activeNodes) > 0 {
			nodeID = activeNodes[i%len(activeNodes)].ID
		}

		task := &api.Task{
			ID:        uuid.New().String(),
			Type:      "deploy",
			Status:    "pending",
			NodeID:    nodeID,
			TargetID:  app.ID,
			Payload:   string(payloadBytes),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		s.store.CreateTask(task)
	}

	// Update Status
	s.store.UpdateAppStatus(app.ID, fmt.Sprintf("scaling (%d)", req.Replicas))

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(app)
}

func (s *Server) backupHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	nodes, _ := s.store.ListNodes()
	apps, _ := s.store.ListApps()

	backup := map[string]interface{}{
		"timestamp":      time.Now(),
		"nodes":          nodes,
		"apps":           apps,
		"system_version": "0.3.0",
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=docklet-backup.json")
	json.NewEncoder(w).Encode(backup)
}

func (s *Server) deleteAppHandler(w http.ResponseWriter, r *http.Request) {
	appID := r.PathValue("id")

	// 1. Get Instances to stop them
	instances, err := s.store.GetInstancesByApp(appID)
	if err == nil {
		for _, inst := range instances {
			// Send Stop Task
			payload := fmt.Sprintf(`{"container_id": "%s"}`, inst.ContainerID)
			task := &api.Task{
				ID:        uuid.New().String(),
				Type:      "stop",
				Status:    "pending",
				NodeID:    inst.NodeID,
				TargetID:  inst.ContainerID,
				Payload:   payload,
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			s.store.CreateTask(task)
		}
	}

	// 2. Delete from DB (simulated, or we should add DeleteApp to store.
	// For now, let's just mark status as "deleted" or generic success response).
	// Ideally s.store.DeleteApp(appID).
	// We'll update status to 'terminating' for now.
	s.store.UpdateAppStatus(appID, "terminated")

	w.WriteHeader(http.StatusOK)
}

func (s *Server) updateAppHandler(w http.ResponseWriter, r *http.Request) {
	appID := r.PathValue("id")
	if appID == "" {
		http.Error(w, "app id required", http.StatusBadRequest)
		return
	}

	var req struct {
		Image string `json:"image"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 1. Get App
	app, err := s.store.GetApp(appID)
	if err != nil {
		http.Error(w, "App not found", http.StatusNotFound)
		return
	}

	// 2. Validate Status (simple check for now)
	if app.Status == "rolling_update" {
		http.Error(w, "Update already in progress", http.StatusConflict)
		return
	}

	// 3. Create Revision
	rev := &api.Revision{
		ID:        uuid.New().String(),
		AppID:     app.ID,
		Image:     req.Image,
		Status:    "rolling",
		IsStable:  false,
		CreatedAt: time.Now(),
	}

	if err := s.store.CreateRevision(rev); err != nil {
		log.Printf("Failed to create revision: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// 4. Update App Status
	s.store.UpdateAppStatus(app.ID, "rolling_update")

	// 5. Trigger Rollout (Done by Controller Tick)
	log.Printf("🔥 Created Revision %s for App %s. Rollout Controller will pick up.", rev.ID, app.ID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(rev)
}

func (s *Server) getTasksHandler(w http.ResponseWriter, r *http.Request) {
	nodeID := r.PathValue("node_id")
	if nodeID == "" {
		http.Error(w, "node id required", http.StatusBadRequest)
		return
	}

	tasks, err := s.store.GetPendingTasks(nodeID)
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tasks)
}

func (s *Server) reportTaskHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TaskID string `json:"task_id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := s.store.UpdateTaskStatus(req.TaskID, req.Status); err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Server) listNodesHandler(w http.ResponseWriter, r *http.Request) {
	nodes, err := s.store.ListNodes()
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nodes)
}

// --- LOGS ACTIONS ---

func (s *Server) requestLogsHandler(w http.ResponseWriter, r *http.Request) {
	appID := r.PathValue("id")

	// Create Task for the first available node (simplified)
	node, _ := s.store.GetFirstNode()
	if node == nil {
		http.Error(w, "No nodes", http.StatusServiceUnavailable)
		return
	}

	task := &api.Task{
		ID:        uuid.New().String(),
		Type:      "fetch_logs",
		Status:    "pending",
		NodeID:    node.ID,
		TargetID:  appID,
		Payload:   fmt.Sprintf(`{"app_id": "%s"}`, appID),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	s.store.CreateTask(task)
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) reportLogsHandler(w http.ResponseWriter, r *http.Request) {
	var logEntry api.AppLog
	if err := json.NewDecoder(r.Body).Decode(&logEntry); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	logEntry.UpdatedAt = time.Now()
	s.store.SaveLog(&logEntry)
	w.WriteHeader(http.StatusOK)
}

func (s *Server) getLogsHandler(w http.ResponseWriter, r *http.Request) {
	appID := r.PathValue("id")
	logs, err := s.store.GetLatestLog(appID)
	if err != nil {
		// Log not found? return empty
		json.NewEncoder(w).Encode(map[string]string{"content": "No logs available yet."})
		return
	}
	json.NewEncoder(w).Encode(logs)
}
