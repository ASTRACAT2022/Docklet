package agent

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"google.golang.org/grpc/credentials"
)

// ... (Agent struct and NewAgent)

func (a *Agent) handleCommand(stream pb.DockletService_RegisterStreamClient, cmd *pb.Command) {
	var output []byte
	var errStr string
	var exitCode int32

	switch cmd.Type {
	case "docker_ps":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else {
			log.Println("Executing ContainerList...")
			containers, err := a.DockerCli.ContainerList(context.Background(), container.ListOptions{All: true})
			if err != nil {
				log.Printf("ContainerList error: %v", err)
				errStr = err.Error()
				exitCode = 1
			} else {
				log.Printf("Found %d containers", len(containers))
				// Marshal to JSON
				val, err := json.Marshal(containers)
				if err != nil {
					log.Printf("JSON Marshal error: %v", err)
					errStr = err.Error()
					exitCode = 1
				} else {
					log.Printf("Marshaled JSON size: %d bytes", len(val))
					output = val
					exitCode = 0
				}
			}
		}

	case "docker_run":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else {
			if len(cmd.Args) < 1 {
				errStr = "image name required"
				exitCode = 1
			} else {
				imageName := cmd.Args[0]

				// 1. Pull Image (Blocking for now, simple)
				reader, err := a.DockerCli.ImagePull(context.Background(), imageName, image.PullOptions{})
				if err != nil {
					errStr = "pull error: " + err.Error()
					exitCode = 1
				} else {
					io.Copy(io.Discard, reader) // Drain body to finish pull
					reader.Close()

					// 2. Create Container
					resp, err := a.DockerCli.ContainerCreate(context.Background(), &container.Config{
						Image: imageName,
					}, nil, nil, nil, "")

					if err != nil {
						errStr = "create error: " + err.Error()
						exitCode = 1
					} else {
						// 3. Start Container
						if err := a.DockerCli.ContainerStart(context.Background(), resp.ID, container.StartOptions{}); err != nil {
							errStr = "start error: " + err.Error()
							exitCode = 1
						} else {
							// Success
							output = []byte(resp.ID)
							exitCode = 0
						}
					}
				}
			}
		}

	default:
		errStr = "unknown command type"
		exitCode = 1
	}

	// Send Result
	err := stream.Send(&pb.StreamPayload{
		Payload: &pb.StreamPayload_Result{
			Result: &pb.CommandResult{
				CommandId: cmd.Id,
				ExitCode:  exitCode,
				Output:    output,
				Error:     errStr,
			},
		},
	})

	if err != nil {
		log.Printf("Failed to send command result: %v", err)
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

	// Load client's cert and private key
	clientCert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, err
	}

	// Create creds object
	config := &tls.Config{
		Certificates: []tls.Certificate{clientCert},
		RootCAs:      certPool,
	}

	return credentials.NewTLS(config), nil
}
