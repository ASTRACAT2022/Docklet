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

	// Path: /api/nodes/{id}/containers
	id := r.URL.Path[len("/api/nodes/"):]
	if len(id) > 11 && id[len(id)-11:] == "/containers" {
		nodeID := id[:len(id)-11]

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		resp, err := s.grpcServer.ExecuteCommand(ctx, &pb.ExecuteCommandRequest{
			NodeId:  nodeID,
			Command: "docker_ps",
		})

		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if resp.ExitCode != 0 {
			http.Error(w, resp.Error, http.StatusInternalServerError)
			return
		}

		w.Write(resp.Output) // Already JSON
		return
	}

	http.NotFound(w, r)
}
