package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
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

type RenameRequest struct {
	Name string `json:"name"`
}

type ExecRequest struct {
	Cmd []string `json:"cmd"`
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
	mux.HandleFunc("/api/bootstrap/certs", s.handleBootstrapCerts)

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

		s.proxyCommand(w, nodeID, "node_rename", []string{name})
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
