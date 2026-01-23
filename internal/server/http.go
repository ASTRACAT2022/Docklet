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

func NewHTTPServer(grpcServer *DockletServer, staticPath string) *HTTPServer {
	return &HTTPServer{
		grpcServer: grpcServer,
		staticPath: staticPath,
	}
}

func (s *HTTPServer) Start(addr string) error {
	mux := http.NewServeMux()

	// API Routes
	mux.HandleFunc("/api/nodes", s.handleListNodes)
	mux.HandleFunc("/api/nodes/", s.handleNodeAction)

	// Static Files
	if s.staticPath != "" {
		fs := http.FileServer(http.Dir(s.staticPath))
		mux.Handle("/", fs)
	}

	log.Printf("HTTP Server listening on %s", addr)
	return http.ListenAndServe(addr, mux)
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
