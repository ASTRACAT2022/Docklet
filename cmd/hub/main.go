package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/astracat/docklet/internal/server"
	"github.com/astracat/docklet/internal/storage"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	dbURL = strings.TrimSpace(dbURL)
	aliasPath := resolveAliasBackupPath()

	ctx := context.Background()
	var baseStore storage.NodeRepository

	if dbURL == "" {
		log.Println("DATABASE_URL not set, using in-memory node store with alias backup")
		baseStore = storage.NewMemoryStore()
	} else {
		pgStore, err := storage.NewPostgresStore(ctx, dbURL)
		if err != nil {
			log.Printf("Warning: Failed to connect to database (%v). Falling back to IN-MEMORY storage.", err)
			baseStore = storage.NewMemoryStore()
		} else {
			baseStore = pgStore
		}
	}

	var store storage.NodeRepository
	primary := storage.NewAliasBackupStore(baseStore, aliasPath)
	if err := primary.Init(ctx); err != nil {
		log.Printf("Warning: Failed to init store with alias backup (%v). Falling back to IN-MEMORY.", err)
		memStore := storage.NewMemoryStore()
		fallback := storage.NewAliasBackupStore(memStore, aliasPath)
		if err2 := fallback.Init(ctx); err2 != nil {
			log.Printf("Warning: Failed to init alias backup (%v). Running with plain in-memory storage.", err2)
			if err3 := memStore.Init(ctx); err3 != nil {
				log.Printf("Warning: Failed to init memory store: %v", err3)
			}
			store = memStore
		} else {
			store = fallback
		}
	} else {
		store = primary
	}
	defer store.Close()

	port := ":50051"
	lis, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	// TLS Configuration
	creds, err := loadTLSCreds("certs/ca-cert.pem", "certs/server-cert.pem", "certs/server-key.pem")
	if err != nil {
		log.Printf("Failed to load TLS credentials: %v. Running in INSECURE mode.", err)
		// For demo purposes only
	}

	opts := []grpc.ServerOption{}
	if creds != nil {
		opts = append(opts, grpc.Creds(creds))
		log.Println("Secure mode (mTLS) ENABLED")
	} else {
		log.Println("WARNING: Secure mode DISABLED (Plainbox)")
	}

	s := grpc.NewServer(opts...)

	hubServer := server.NewDockletServer(store)
	hubServer.Register(s)

	// Start HTTP Server
	go func() {
		httpSrv := server.NewHTTPServer(hubServer, "./web/dashboard/dist")
		if err := httpSrv.Start(":1499"); err != nil {
			log.Printf("HTTP Server error: %v", err)
		}
	}()

	log.Printf("Docklet Hub listening on %s", port)
	if err := s.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}

func resolveAliasBackupPath() string {
	custom := strings.TrimSpace(os.Getenv("DOCKLET_ALIASES_FILE"))
	if custom != "" {
		if err := os.MkdirAll(filepath.Dir(custom), 0o700); err == nil {
			return custom
		}
	}

	stateDir := strings.TrimSpace(os.Getenv("DOCKLET_STATE_DIR"))
	if stateDir == "" {
		stateDir = "/etc/docklet"
	}
	if err := os.MkdirAll(stateDir, 0o700); err == nil {
		return filepath.Join(stateDir, "node_aliases.json")
	}

	return filepath.Join(".docklet-data", "node_aliases.json")
}

func loadTLSCreds(caPath, certPath, keyPath string) (credentials.TransportCredentials, error) {
	// Load existing CA
	pemServerCA, err := os.ReadFile(caPath)
	if err != nil {
		return nil, err
	}

	certPool := x509.NewCertPool()
	if !certPool.AppendCertsFromPEM(pemServerCA) {
		return nil, fmt.Errorf("failed to add server CA's certificate")
	}

	// Load server's cert and private key
	serverCert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, err
	}

	// Create creds object
	config := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    certPool,
	}

	return credentials.NewTLS(config), nil
}
