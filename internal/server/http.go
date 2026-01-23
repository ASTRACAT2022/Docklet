package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	pb "github.com/astracat/docklet/api/proto/v1"
)

type HTTPServer struct {
	grpcServer *DockletServer
	staticPath string
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
}

const (
	// Hardcoded for MVP as requested
	validUser  = "astracat"
	validPass  = "astracat"
	validToken = "simple-token-astracat-123" // In real app, generate UUIDs
)

func NewHTTPServer(grpcServer *DockletServer, staticPath string) *HTTPServer {
	return &HTTPServer{
		grpcServer: grpcServer,
		staticPath: staticPath,
	}
}

func (s *HTTPServer) Start(addr string) error {
	mux := http.NewServeMux()

	// Public Routes
	mux.HandleFunc("/api/login", s.handleLogin)

	// Protected Routes (manually wrapped middleware)
	mux.HandleFunc("/api/nodes", s.authMiddleware(s.handleListNodes))
	mux.HandleFunc("/api/nodes/", s.authMiddleware(s.handleNodeAction))

	// Static Files
	if s.staticPath != "" {
		fs := http.FileServer(http.Dir(s.staticPath))
		mux.Handle("/", fs)
	}

	log.Printf("HTTP Server listening on %s", addr)
	return http.ListenAndServe(addr, mux)
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

	resp, err := s.grpcServer.ListNodes(context.Background(), &pb.ListNodesRequest{})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *HTTPServer) handleNodeAction(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Path: /api/nodes/{id}/containers...
	path := r.URL.Path[len("/api/nodes/"):]

	// Pattern: {nodeID}/containers
	if len(path) > 11 && path[len(path)-11:] == "/containers" {
		nodeID := path[:len(path)-11]
		s.proxyCommand(w, nodeID, "docker_ps", nil)
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
	if len(path) > 6 && path[len(path)-6:] == "/start" {
		// .../containers/<CID>/start
		// Strip /start
		base := path[:len(path)-6]
		// Strip prefix up to containers/
		// Actually this parsing is getting messy. Let's rely on standard Go ServeMux in HandleFunc if we could,
		// but we are in a sub-handler.

		// Let's split "path"
		// path = NODEID/containers/CONTAINERID/start

		// Find "containers/"
		// ...

		// Let's cheat a little and use a helper
	}

	s.handleContainerActionDynamic(w, r, path)
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
		default:
			http.Error(w, "Unknown action: "+action, http.StatusBadRequest)
		}
		return
	}

	http.NotFound(w, r)
}

func (s *HTTPServer) proxyCommand(w http.ResponseWriter, nodeID, cmd string, args []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second) // Increased timeout for stop
	defer cancel()

	resp, err := s.grpcServer.ExecuteCommand(ctx, &pb.ExecuteCommandRequest{
		NodeId:  nodeID,
		Command: cmd,
		Args:    args,
	})

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if resp.ExitCode != 0 {
		http.Error(w, resp.Error, http.StatusInternalServerError)
		return
	}

	w.Write(resp.Output)
}
