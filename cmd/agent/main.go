package main

import (
	"flag"
	"log"
	"os"

	"github.com/astracat/docklet/internal/agent"
	"github.com/astracat/docklet/pkg/utils"
)

func main() {
	hubAddrPtr := flag.String("hub", "localhost:50051", "Hub address (host:port)")
	flag.Parse()

	hubAddr := *hubAddrPtr
	if envAddr := os.Getenv("DOCKLET_HUB_ADDR"); envAddr != "" {
		hubAddr = envAddr
	}

	// Get persistent identity
	nodeID, err := utils.GetOrGenerateID("agent.id")
	if err != nil {
		log.Fatalf("Failed to get agent ID: %v", err)
	}

	log.Printf("Starting Docklet Agent (ID: %s)... connecting to %s", nodeID, hubAddr)

	// Check for certs locally
	caCert := "certs/ca-cert.pem"
	agentCert := "certs/agent-cert.pem"
	agentKey := "certs/agent-key.pem"

	// Check if files exist
	if _, err := os.Stat(caCert); os.IsNotExist(err) {
		log.Printf("Warning: Certs not found in certs/ directory. Using INSECURE mode.")
		caCert = ""
	}

	a := agent.NewAgent(hubAddr, nodeID, caCert, agentCert, agentKey)
	if err := a.Start(); err != nil {
		log.Printf("Agent crashed: %v. Retrying in 5 seconds...", err)
        // Add a small delay/loop if needed, or let systemd restart it.
        // But for better UX logs:
		os.Exit(1)
	}
}
