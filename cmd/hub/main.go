package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net"
	"os"

	"github.com/astracat/docklet/internal/server"
	"github.com/astracat/docklet/internal/storage"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		// Fallback for local dev if not set
		// log.Fatal("DATABASE_URL is required")
		log.Println("DATABASE_URL not set, using default 'postgres://user:password@localhost:5432/docklet'")
		dbURL = "postgres://user:password@localhost:5432/docklet"
	}

	ctx := context.Background()
	var store storage.NodeRepository

	pgStore, err := storage.NewPostgresStore(ctx, dbURL)
	if err != nil {
		log.Printf("Warning: Failed to connect to database (%v). Falling back to IN-MEMORY storage.", err)
		store = storage.NewMemoryStore()
	} else {
		store = pgStore
		if err := store.Init(ctx); err != nil {
			log.Printf("Warning: Failed to init DB schema (%v). Falling back to IN-MEMORY storage.", err)
			store = storage.NewMemoryStore()
		}
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
