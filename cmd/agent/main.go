package main

import (
	"log"
	"os"

	"github.com/astracat/docklet/internal/agent"
	"github.com/astracat/docklet/pkg/utils"
)

func main() {
	hubAddr := "localhost:50051"
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
		log.Fatalf("Agent crashed: %v", err)
	}
}
