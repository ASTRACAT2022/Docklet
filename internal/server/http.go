package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	pb "github.com/astracat/docklet/api/proto/v1"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type HTTPServer struct {
	grpcServer *DockletServer
	staticPath string
	clustersMu sync.Mutex
	clustersDB string
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
}

type RenameRequest struct {
	Name string `json:"name"`
}

type ExecRequest struct {
	Cmd []string `json:"cmd"`
}

type RestartPolicyRequest struct {
	Policy string `json:"policy"`
}

const (
	// Default credentials if not set via env
	defaultUser = "astracat"
	defaultPass = "astracat"
	validToken  = "simple-token-astracat-123" // In real app, generate UUIDs
)

func NewHTTPServer(grpcServer *DockletServer, staticPath string) *HTTPServer {
	dbPath := "./clusters.json"
	if _, err := os.Stat("/etc/docklet"); err == nil {
		dbPath = "/etc/docklet/clusters.json"
	}

	return &HTTPServer{
		grpcServer: grpcServer,
		staticPath: staticPath,
		clustersDB: dbPath,
	}
}

func (s *HTTPServer) Start(addr string) error {
	mux := http.NewServeMux()

	// Public Routes
	mux.HandleFunc("/api/login", s.handleLogin)
	mux.HandleFunc("/api/bootstrap/certs", s.handleBootstrapCerts)

	// Protected Routes (manually wrapped middleware)
	mux.HandleFunc("/api/nodes", s.authMiddleware(s.handleListNodes))
	mux.HandleFunc("/api/nodes/", s.authMiddleware(s.handleNodeAction))
	mux.HandleFunc("/api/portliner/endpoints", s.authMiddleware(s.handlePortlinerEndpoints))
	mux.HandleFunc("/api/portliner/endpoints/", s.authMiddleware(s.handlePortlinerEndpointAction))
	mux.HandleFunc("/api/portliner/v1/endpoints", s.authMiddleware(s.handlePortlinerEndpoints))
	mux.HandleFunc("/api/portliner/v1/endpoints/", s.authMiddleware(s.handlePortlinerEndpointAction))
	mux.HandleFunc("/api/portainer/endpoints", s.authMiddleware(s.handlePortlinerEndpoints))
	mux.HandleFunc("/api/portainer/endpoints/", s.authMiddleware(s.handlePortlinerEndpointAction))
	mux.HandleFunc("/api/portainer/v1/endpoints", s.authMiddleware(s.handlePortlinerEndpoints))
	mux.HandleFunc("/api/portainer/v1/endpoints/", s.authMiddleware(s.handlePortlinerEndpointAction))
	mux.HandleFunc("/api/clusters/deploy", s.authMiddleware(s.handleClusterDeploy))
	mux.HandleFunc("/api/clusters", s.authMiddleware(s.handleClusters))
	mux.HandleFunc("/api/clusters/", s.authMiddleware(s.handleClusterAction))

	// Static Files
	if s.staticPath != "" {
		fs := http.FileServer(http.Dir(s.staticPath))
		mux.Handle("/", fs)
	}

	// Check for custom SSL certs
	certFile := os.Getenv("DOCKLET_WEB_CERT")
	keyFile := os.Getenv("DOCKLET_WEB_KEY")

	if certFile != "" && keyFile != "" {
		log.Printf("HTTP Server listening on %s (HTTPS)", addr)
		return http.ListenAndServeTLS(addr, certFile, keyFile, mux)
	}

	log.Printf("HTTP Server listening on %s", addr)
	return http.ListenAndServe(addr, mux)
}

type Cluster struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	StackName string   `json:"stack_name"`
	Content   string   `json:"content"`
	Nodes     []string `json:"nodes"`
	CreatedAt int64    `json:"created_at"`
	UpdatedAt int64    `json:"updated_at"`
}

func (s *HTTPServer) loadClustersLocked() ([]Cluster, error) {
	b, err := os.ReadFile(s.clustersDB)
	if err != nil {
		if os.IsNotExist(err) {
			return []Cluster{}, nil
		}
		return nil, err
	}

	if len(bytesTrimSpace(b)) == 0 {
		return []Cluster{}, nil
	}

	var clusters []Cluster
	if err := json.Unmarshal(b, &clusters); err != nil {
		return nil, err
	}
	return clusters, nil
}

func (s *HTTPServer) saveClustersLocked(clusters []Cluster) error {
	dir := filepath.Dir(s.clustersDB)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}

	b, err := json.MarshalIndent(clusters, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.clustersDB, b, 0600)
}

func bytesTrimSpace(b []byte) []byte {
	i := 0
	j := len(b)
	for i < j && (b[i] == ' ' || b[i] == '\n' || b[i] == '\r' || b[i] == '\t') {
		i++
	}
	for j > i && (b[j-1] == ' ' || b[j-1] == '\n' || b[j-1] == '\r' || b[j-1] == '\t') {
		j--
	}
	return b[i:j]
}

func (s *HTTPServer) handleClusterDeploy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	type ClusterDeployRequest struct {
		Name    string   `json:"name"`
		Content string   `json:"content"`
		Nodes   []string `json:"nodes"`
		ID      string   `json:"id"`
	}

	var req ClusterDeployRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || strings.TrimSpace(req.Content) == "" {
		http.Error(w, "Name and content required", http.StatusBadRequest)
		return
	}
	if len(req.Nodes) == 0 {
		http.Error(w, "nodes required", http.StatusBadRequest)
		return
	}

	type ClusterDeployResult struct {
		NodeID    string `json:"node_id"`
		OK        bool   `json:"ok"`
		ExitCode  int32  `json:"exit_code,omitempty"`
		Error     string `json:"error,omitempty"`
		Output    string `json:"output,omitempty"`
		Timestamp int64  `json:"timestamp"`
	}

	results := make([]ClusterDeployResult, 0, len(req.Nodes))
	now := time.Now().Unix()

	for _, nodeID := range req.Nodes {
		nodeID = strings.TrimSpace(nodeID)
		if nodeID == "" {
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		resp, err := s.grpcServer.ExecuteCommand(ctx, &pb.ExecuteCommandRequest{
			NodeId:  nodeID,
			Command: "stack_up",
			Args:    []string{req.Name, req.Content},
		})
		cancel()

		if err != nil {
			results = append(results, ClusterDeployResult{
				NodeID:    nodeID,
				OK:        false,
				Error:     err.Error(),
				Timestamp: now,
			})
			continue
		}

		ok := resp.ExitCode == 0
		errMsg := ""
		if !ok {
			errMsg = resp.Error
		}

		results = append(results, ClusterDeployResult{
			NodeID:    nodeID,
			OK:        ok,
			ExitCode:  resp.ExitCode,
			Error:     errMsg,
			Output:    string(resp.Output),
			Timestamp: now,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"results": results,
	})

	s.clustersMu.Lock()
	defer s.clustersMu.Unlock()

	clusters, err := s.loadClustersLocked()
	if err != nil {
		return
	}

	clusterID := strings.TrimSpace(req.ID)
	if clusterID == "" {
		for _, c := range clusters {
			if c.StackName == req.Name {
				clusterID = c.ID
				break
			}
		}
	}
	if clusterID == "" {
		clusterID = uuid.New().String()
	}

	updated := false
	for i := range clusters {
		if clusters[i].ID == clusterID {
			if clusters[i].Name == "" {
				clusters[i].Name = req.Name
			}
			clusters[i].StackName = req.Name
			clusters[i].Content = req.Content
			clusters[i].Nodes = req.Nodes
			clusters[i].UpdatedAt = now
			updated = true
			break
		}
	}
	if !updated {
		clusters = append(clusters, Cluster{
			ID:        clusterID,
			Name:      req.Name,
			StackName: req.Name,
			Content:   req.Content,
			Nodes:     req.Nodes,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	_ = s.saveClustersLocked(clusters)
}

func (s *HTTPServer) handleClusters(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.clustersMu.Lock()
	clusters, err := s.loadClustersLocked()
	s.clustersMu.Unlock()
	if err != nil {
		http.Error(w, "Failed to load clusters", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"clusters": clusters,
	})
}

func (s *HTTPServer) handleClusterAction(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/clusters/")
	path = strings.Trim(path, "/")
	if path == "" {
		http.NotFound(w, r)
		return
	}

	parts := strings.Split(path, "/")
	id := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	if r.Method == http.MethodPost && action == "rename" {
		var req RenameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		newName := strings.TrimSpace(req.Name)
		if newName == "" {
			http.Error(w, "Name is required", http.StatusBadRequest)
			return
		}

		s.clustersMu.Lock()
		clusters, err := s.loadClustersLocked()
		if err == nil {
			found := false
			now := time.Now().Unix()
			for i := range clusters {
				if clusters[i].ID == id {
					clusters[i].Name = newName
					clusters[i].UpdatedAt = now
					found = true
					break
				}
			}
			if found {
				_ = s.saveClustersLocked(clusters)
			}
		}
		s.clustersMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true,
		})
		return
	}

	if r.Method == http.MethodDelete && action == "" {
		s.clustersMu.Lock()
		clusters, err := s.loadClustersLocked()
		if err != nil {
			s.clustersMu.Unlock()
			http.Error(w, "Failed to load clusters", http.StatusInternalServerError)
			return
		}

		var target *Cluster
		for i := range clusters {
			if clusters[i].ID == id {
				target = &clusters[i]
				break
			}
		}
		if target == nil {
			s.clustersMu.Unlock()
			http.NotFound(w, r)
			return
		}

		stackName := target.StackName
		nodes := append([]string{}, target.Nodes...)
		s.clustersMu.Unlock()

		type DownResult struct {
			NodeID   string `json:"node_id"`
			OK       bool   `json:"ok"`
			ExitCode int32  `json:"exit_code,omitempty"`
			Error    string `json:"error,omitempty"`
		}
		results := make([]DownResult, 0, len(nodes))
		allOK := true

		for _, nodeID := range nodes {
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			resp, err := s.grpcServer.ExecuteCommand(ctx, &pb.ExecuteCommandRequest{
				NodeId:  nodeID,
				Command: "stack_down",
				Args:    []string{stackName},
			})
			cancel()
			if err != nil {
				allOK = false
				results = append(results, DownResult{NodeID: nodeID, OK: false, Error: err.Error()})
				continue
			}
			ok := resp.ExitCode == 0
			if !ok {
				allOK = false
			}
			errMsg := ""
			if !ok {
				errMsg = resp.Error
			}
			results = append(results, DownResult{NodeID: nodeID, OK: ok, ExitCode: resp.ExitCode, Error: errMsg})
		}

		deleted := false
		if allOK {
			s.clustersMu.Lock()
			clusters2, err := s.loadClustersLocked()
			if err == nil {
				out := make([]Cluster, 0, len(clusters2))
				for _, c := range clusters2 {
					if c.ID != id {
						out = append(out, c)
					}
				}
				_ = s.saveClustersLocked(out)
				deleted = true
			}
			s.clustersMu.Unlock()
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"deleted": deleted,
			"results": results,
		})
		return
	}

	http.NotFound(w, r)
}

func (s *HTTPServer) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Check Env Vars first
	validUser := os.Getenv("DOCKLET_ADMIN_USER")
	if validUser == "" {
		validUser = defaultUser
	}
	validPass := os.Getenv("DOCKLET_ADMIN_PASSWORD")
	if validPass == "" {
		validPass = defaultPass
	}

	if req.Username == validUser && req.Password == validPass {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(LoginResponse{Token: validToken})
		return
	}

	// Delay to prevent timing attacks (basic)
	time.Sleep(100 * time.Millisecond)
	http.Error(w, "Invalid credentials", http.StatusUnauthorized)
}

func (s *HTTPServer) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "Bearer "+validToken {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *HTTPServer) handleListNodes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	dbNodes, err := s.grpcServer.listNodesWithCleanup(context.Background())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type NodeResponse struct {
		NodeID     string `json:"node_id"`
		Name       string `json:"name,omitempty"`
		MachineID  string `json:"machine_id"`
		Version    string `json:"version"`
		Status     string `json:"status"`
		RemoteAddr string `json:"remote_addr"`
		LastSeen   int64  `json:"last_seen"`
	}

	nodes := make([]NodeResponse, 0, len(dbNodes))
	for _, n := range dbNodes {
		nodeStatus := "disconnected"
		if s.grpcServer.nodeConnected(n.ID) {
			nodeStatus = "connected"
		}
		nodes = append(nodes, NodeResponse{
			NodeID:     n.ID,
			Name:       n.Name,
			MachineID:  n.MachineID,
			Version:    n.Version,
			Status:     nodeStatus,
			RemoteAddr: n.RemoteAddr,
			LastSeen:   n.LastSeen.Unix(),
		})
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"nodes": nodes})
}

func (s *HTTPServer) handleNodeAction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Path: /api/nodes/{id}/containers...
	path := r.URL.Path[len("/api/nodes/"):]

	if strings.HasSuffix(path, "/rename") {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		nodeID := strings.TrimSuffix(path, "/rename")
		if nodeID == "" {
			http.Error(w, "Invalid node id", http.StatusBadRequest)
			return
		}

		var req RenameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" {
			http.Error(w, "Name is required", http.StatusBadRequest)
			return
		}

		if err := s.grpcServer.RenameNode(r.Context(), nodeID, name); err != nil {
			if st, ok := status.FromError(err); ok {
				switch st.Code() {
				case codes.NotFound:
					http.Error(w, st.Message(), http.StatusNotFound)
				case codes.InvalidArgument:
					http.Error(w, st.Message(), http.StatusBadRequest)
				default:
					http.Error(w, st.Message(), http.StatusInternalServerError)
				}
			} else {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		return
	}

	// Pattern: {nodeID}/stacks
	if len(path) > 7 && path[len(path)-7:] == "/stacks" {
		nodeID := path[:len(path)-7]

		if r.Method == http.MethodGet {
			s.proxyCommand(w, nodeID, "stack_ls", nil)
			return
		}

		if r.Method == http.MethodPost {
			// Create/Update stack
			type StackRequest struct {
				Name    string `json:"name"`
				Content string `json:"content"`
			}
			var req StackRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}
			if req.Name == "" || req.Content == "" {
				http.Error(w, "Name and content required", http.StatusBadRequest)
				return
			}
			s.proxyCommand(w, nodeID, "stack_up", []string{req.Name, req.Content})
			return
		}
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Pattern: {nodeID}/stacks/{stackName}
	// Detect /stacks/
	const stacksMarker = "/stacks/"
	stacksIdx := -1
	for i := 0; i < len(path)-len(stacksMarker); i++ {
		if path[i:i+len(stacksMarker)] == stacksMarker {
			stacksIdx = i
			break
		}
	}

	if stacksIdx != -1 {
		nodeID := path[:stacksIdx]
		rest := path[stacksIdx+len(stacksMarker):]

		// rest = stackName or stackName/action?
		// Assume DELETE for down
		if r.Method == http.MethodDelete {
			s.proxyCommand(w, nodeID, "stack_down", []string{rest})
			return
		}
	}

	// Pattern: {nodeID}/containers
	if len(path) > 11 && path[len(path)-11:] == "/containers" {
		nodeID := path[:len(path)-11]

		if r.Method == http.MethodGet {
			s.proxyCommand(w, nodeID, "docker_ps", nil)
			return
		}

		if r.Method == http.MethodPost {
			// Read body as raw JSON to pass it through
			// But we want to validate it or just pass it?
			// Let's read it into a map/struct to validate minimal fields, then marshal back or just pass raw bytes.
			// The agent expects a JSON string in Args[0].

			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}

			// Validate Image
			if img, ok := body["image"].(string); !ok || img == "" {
				http.Error(w, "Image is required", http.StatusBadRequest)
				return
			}

			// Marshal back to string
			jsonBytes, err := json.Marshal(body)
			if err != nil {
				http.Error(w, "JSON error", http.StatusInternalServerError)
				return
			}

			// Call docker_run with JSON string as first arg
			s.proxyCommand(w, nodeID, "docker_run", []string{string(jsonBytes)})
			return
		}

		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Pattern: {nodeID}/containers/{containerID}/{action}
	// Simplified parsing for MVP
	// expected: <nodeID>/containers/<containerID>/<action>
	// We can use a regex or naive splitting. Naive splitting for dependency-free speed.

	// Check for "containers" segment
	// /api/nodes/NODE_ID/containers/CONTAINER_ID/start

	// Let's assume URL structure is strict: /api/nodes/<NodeID>/containers/<ContainerID>/<Action>
	// We already stripped /api/nodes/

	// Split by slash
	// Start finding "containers"
	// For now, let's just match exact suffixes for the user's specific request

	// Action: Start
	// Action: Start
	if len(path) > 6 && path[len(path)-6:] == "/start" {
		// .../containers/<CID>/start
		// Strip /start
	}

	s.handleContainerActionDynamic(w, r, path)
}

type portlinerEndpoint struct {
	ID     string `json:"Id"`
	Name   string `json:"Name"`
	URL    string `json:"URL"`
	Type   int    `json:"Type"`
	Status int    `json:"Status"`
	TLS    bool   `json:"TLS"`
}

func (s *HTTPServer) handlePortlinerEndpoints(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	dbNodes, err := s.grpcServer.listNodesWithCleanup(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	sort.Slice(dbNodes, func(i, j int) bool { return dbNodes[i].ID < dbNodes[j].ID })
	endpoints := make([]portlinerEndpoint, 0, len(dbNodes))
	for _, n := range dbNodes {
		name := strings.TrimSpace(n.Name)
		if name == "" {
			name = n.ID
		}
		statusVal := 0
		if s.grpcServer.nodeConnected(n.ID) {
			statusVal = 1
		}
		endpoints = append(endpoints, portlinerEndpoint{
			ID:     n.ID,
			Name:   name,
			URL:    n.RemoteAddr,
			Type:   1,
			Status: statusVal,
			TLS:    true,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(endpoints)
}

func (s *HTTPServer) handlePortlinerEndpointAction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	rest := ""
	prefixes := []string{
		"/api/portliner/endpoints/",
		"/api/portliner/v1/endpoints/",
		"/api/portainer/endpoints/",
		"/api/portainer/v1/endpoints/",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(r.URL.Path, prefix) {
			rest = strings.TrimPrefix(r.URL.Path, prefix)
			break
		}
	}
	if strings.TrimSpace(rest) == "" {
		http.NotFound(w, r)
		return
	}

	parts := strings.SplitN(rest, "/", 2)
	endpointID := strings.TrimSpace(parts[0])
	tail := ""
	if len(parts) == 2 {
		tail = strings.Trim(parts[1], "/")
	}

	nodeID, err := s.resolvePortlinerNodeID(r.Context(), endpointID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	if tail == "" {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		node, err := s.grpcServer.Repo.GetNode(r.Context(), nodeID)
		if err != nil || node == nil {
			http.Error(w, "endpoint not found", http.StatusNotFound)
			return
		}
		name := strings.TrimSpace(node.Name)
		if name == "" {
			name = node.ID
		}
		statusVal := 0
		if s.grpcServer.nodeConnected(node.ID) {
			statusVal = 1
		}
		_ = json.NewEncoder(w).Encode(portlinerEndpoint{
			ID:     node.ID,
			Name:   name,
			URL:    node.RemoteAddr,
			Type:   1,
			Status: statusVal,
			TLS:    true,
		})
		return
	}

	if strings.HasPrefix(tail, "docker/") {
		tail = strings.TrimPrefix(tail, "docker/")
	}

	// Portainer-like container endpoints:
	// GET    /endpoints/{id}/docker/containers/json
	// GET    /endpoints/{id}/docker/containers/{cid}/json
	// GET    /endpoints/{id}/docker/containers/{cid}/logs
	// POST   /endpoints/{id}/docker/containers/{cid}/start
	// POST   /endpoints/{id}/docker/containers/{cid}/stop
	// POST   /endpoints/{id}/docker/containers/{cid}/restart
	// DELETE /endpoints/{id}/docker/containers/{cid}
	// POST   /endpoints/{id}/docker/containers/create
	if tail == "containers/json" && r.Method == http.MethodGet {
		resp, err := s.executeNodeCommand(r.Context(), nodeID, "docker_ps", nil, 20*time.Second)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if json.Valid(resp.Output) {
			w.Write(resp.Output)
			return
		}
		_ = json.NewEncoder(w).Encode([]interface{}{})
		return
	}

	if tail == "containers/create" && r.Method == http.MethodPost {
		s.handlePortlinerContainerCreate(w, r, nodeID)
		return
	}

	if !strings.HasPrefix(tail, "containers/") {
		http.NotFound(w, r)
		return
	}

	sub := strings.TrimPrefix(tail, "containers/")
	p := strings.Split(sub, "/")
	if len(p) == 0 || strings.TrimSpace(p[0]) == "" {
		http.NotFound(w, r)
		return
	}
	containerID := p[0]
	action := ""
	if len(p) > 1 {
		action = p[1]
	}

	switch r.Method {
	case http.MethodDelete:
		if action != "" {
			http.Error(w, "Invalid container path", http.StatusBadRequest)
			return
		}
		if _, err := s.executeNodeCommand(r.Context(), nodeID, "docker_rm", []string{containerID}, 20*time.Second); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		return
	case http.MethodGet:
		switch action {
		case "json":
			resp, err := s.executeNodeCommand(r.Context(), nodeID, "docker_inspect", []string{containerID}, 20*time.Second)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if json.Valid(resp.Output) {
				w.Write(resp.Output)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"output": string(resp.Output)})
			return
		case "logs":
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			resp, err := s.executeNodeCommand(r.Context(), nodeID, "docker_logs", []string{containerID}, 20*time.Second)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_, _ = w.Write(resp.Output)
			return
		}
	case http.MethodPost:
		switch action {
		case "start":
			if _, err := s.executeNodeCommand(r.Context(), nodeID, "docker_start", []string{containerID}, 20*time.Second); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
			return
		case "stop":
			if _, err := s.executeNodeCommand(r.Context(), nodeID, "docker_stop", []string{containerID}, 25*time.Second); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
			return
		case "restart":
			if _, err := s.executeNodeCommand(r.Context(), nodeID, "docker_stop", []string{containerID}, 25*time.Second); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if _, err := s.executeNodeCommand(r.Context(), nodeID, "docker_start", []string{containerID}, 20*time.Second); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
			return
		case "update":
			type updateContainerRequest struct {
				RestartPolicy struct {
					Name string `json:"Name"`
				} `json:"RestartPolicy"`
			}
			var req updateContainerRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}
			policy := strings.TrimSpace(req.RestartPolicy.Name)
			if policy == "" {
				http.Error(w, "RestartPolicy.Name is required", http.StatusBadRequest)
				return
			}
			if _, err := s.executeNodeCommand(r.Context(), nodeID, "docker_update_restart", []string{containerID, policy}, 20*time.Second); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"Warnings": ""})
			return
		}
	}

	http.NotFound(w, r)
}

func (s *HTTPServer) handlePortlinerContainerCreate(w http.ResponseWriter, r *http.Request, nodeID string) {
	type hostPortBinding struct {
		HostPort string `json:"HostPort"`
	}
	type createRequest struct {
		Image      string   `json:"Image"`
		Name       string   `json:"Name"`
		Env        []string `json:"Env"`
		HostConfig struct {
			PortBindings  map[string][]hostPortBinding `json:"PortBindings"`
			RestartPolicy struct {
				Name string `json:"Name"`
			} `json:"RestartPolicy"`
		} `json:"HostConfig"`
	}

	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	image := strings.TrimSpace(req.Image)
	if image == "" {
		http.Error(w, "Image is required", http.StatusBadRequest)
		return
	}

	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		name = strings.TrimSpace(req.Name)
	}

	ports := make([]map[string]string, 0)
	for containerPortWithProto, hostBindings := range req.HostConfig.PortBindings {
		containerPort := strings.TrimSpace(strings.Split(containerPortWithProto, "/")[0])
		for _, hb := range hostBindings {
			hostPort := strings.TrimSpace(hb.HostPort)
			if hostPort == "" || containerPort == "" {
				continue
			}
			ports = append(ports, map[string]string{
				"host":      hostPort,
				"container": containerPort,
			})
		}
	}

	payload := map[string]interface{}{
		"image": image,
		"name":  name,
		"env":   req.Env,
		"ports": ports,
	}
	restartPolicy := strings.TrimSpace(req.HostConfig.RestartPolicy.Name)
	if restartPolicy != "" {
		payload["restart_policy"] = restartPolicy
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, "Failed to encode payload", http.StatusInternalServerError)
		return
	}

	resp, err := s.executeNodeCommand(r.Context(), nodeID, "docker_run", []string{string(jsonPayload)}, 40*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type createResponse struct {
		ID       string   `json:"Id"`
		Warnings []string `json:"Warnings"`
	}
	_ = json.NewEncoder(w).Encode(createResponse{
		ID:       strings.TrimSpace(string(resp.Output)),
		Warnings: []string{},
	})
}

func (s *HTTPServer) resolvePortlinerNodeID(ctx context.Context, endpointID string) (string, error) {
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "" {
		return "", fmt.Errorf("endpoint id is required")
	}

	nodes, err := s.grpcServer.listNodesWithCleanup(ctx)
	if err != nil {
		return "", err
	}
	for _, n := range nodes {
		if n.ID == endpointID {
			return n.ID, nil
		}
	}

	if idx, err := strconv.Atoi(endpointID); err == nil {
		sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
		if idx >= 1 && idx <= len(nodes) {
			return nodes[idx-1].ID, nil
		}
	}

	return "", fmt.Errorf("endpoint %s not found", endpointID)
}

func (s *HTTPServer) handleContainerActionDynamic(w http.ResponseWriter, r *http.Request, path string) {
	// path is everything after /api/nodes/
	// Format: NODEID/containers/CONTAINERID/ACTION

	// 1. Find "/containers/"
	// iterate
	const marker = "/containers/"
	idx := -1
	for i := 0; i < len(path)-len(marker); i++ {
		if path[i:i+len(marker)] == marker {
			idx = i
			break
		}
	}

	if idx == -1 {
		http.NotFound(w, r)
		return
	}

	nodeID := path[:idx]
	rest := path[idx+len(marker):] // CONTAINERID/ACTION or just CONTAINERID

	// 2. Parse ContainerID and Action
	var containerID, action string

	// Split rest by slash
	slashIdx := -1
	for i := 0; i < len(rest); i++ {
		if rest[i] == '/' {
			slashIdx = i
			break
		}
	}

	if slashIdx == -1 {
		// No slash, e.g. CONTAINERID (DELETE case)
		containerID = rest
		action = ""
	} else {
		containerID = rest[:slashIdx]
		action = rest[slashIdx+1:]
	}

	if r.Method == http.MethodDelete {
		if action != "" {
			http.Error(w, "Invalid path for DELETE", http.StatusBadRequest)
			return
		}
		s.proxyCommand(w, nodeID, "docker_rm", []string{containerID})
		return
	}

	if r.Method == http.MethodPost {
		switch action {
		case "start":
			s.proxyCommand(w, nodeID, "docker_start", []string{containerID})
		case "stop":
			s.proxyCommand(w, nodeID, "docker_stop", []string{containerID})
		case "restart-policy":
			var req RestartPolicyRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}
			policy := strings.TrimSpace(req.Policy)
			if policy == "" {
				http.Error(w, "policy is required", http.StatusBadRequest)
				return
			}
			s.proxyCommand(w, nodeID, "docker_update_restart", []string{containerID, policy})
		case "exec":
			var req ExecRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}
			if len(req.Cmd) == 0 {
				http.Error(w, "cmd is required", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			args := append([]string{containerID}, req.Cmd...)
			s.proxyCommand(w, nodeID, "docker_exec", args)
		default:
			http.Error(w, "Unknown action: "+action, http.StatusBadRequest)
		}
		return
	}

	if r.Method == http.MethodGet {
		if action == "logs" {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			s.proxyCommand(w, nodeID, "docker_logs", []string{containerID})
			return
		}
		if action == "inspect" {
			w.Header().Set("Content-Type", "application/json")
			s.proxyCommand(w, nodeID, "docker_inspect", []string{containerID})
			return
		}
		if action == "stats" {
			w.Header().Set("Content-Type", "application/json")
			s.proxyCommand(w, nodeID, "docker_stats", []string{containerID})
			return
		}
	}

	http.NotFound(w, r)
}

func (s *HTTPServer) proxyCommand(w http.ResponseWriter, nodeID, cmd string, args []string) {
	resp, err := s.executeNodeCommand(context.Background(), nodeID, cmd, args, 15*time.Second)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Write(resp.Output)
}

func (s *HTTPServer) executeNodeCommand(ctx context.Context, nodeID, cmd string, args []string, timeout time.Duration) (*pb.ExecuteCommandResponse, error) {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	resp, err := s.grpcServer.ExecuteCommand(cctx, &pb.ExecuteCommandRequest{
		NodeId:  nodeID,
		Command: cmd,
		Args:    args,
	})
	if err != nil {
		return nil, err
	}
	if resp.ExitCode != 0 {
		msg := strings.TrimSpace(resp.Error)
		if msg == "" {
			msg = fmt.Sprintf("command %s failed", cmd)
		}
		return nil, errors.New(msg)
	}
	return resp, nil
}

func (s *HTTPServer) handleBootstrapCerts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	bootstrapToken := strings.TrimSpace(os.Getenv("DOCKLET_BOOTSTRAP_TOKEN"))
	if bootstrapToken == "" {
		bootstrapToken = "bootstrap-token-123"
	}

	if r.URL.Query().Get("token") != bootstrapToken {
		http.Error(w, "Invalid bootstrap token", http.StatusUnauthorized)
		return
	}

	// Create a zip or just return JSON with file contents?
	// For simplicity, let's return a JSON with 3 files.
	type CertsResponse struct {
		CACert    string `json:"ca_cert"`
		AgentCert string `json:"agent_cert"`
		AgentKey  string `json:"agent_key"`
	}

	w.Header().Set("Content-Type", "application/json")

	// Read files
	// Assuming certs are in ./certs relative to CWD
	ca, err := readFile("certs/ca-cert.pem")
	if err != nil {
		http.Error(w, "CA missing", http.StatusInternalServerError)
		return
	}
	cert, err := readFile("certs/agent-cert.pem")
	if err != nil {
		http.Error(w, "Agent cert missing", http.StatusInternalServerError)
		return
	}
	key, err := readFile("certs/agent-key.pem")
	if err != nil {
		http.Error(w, "Agent key missing", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(CertsResponse{
		CACert:    string(ca),
		AgentCert: string(cert),
		AgentKey:  string(key),
	})
}

func readFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}
