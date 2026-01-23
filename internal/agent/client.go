package agent

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"

	pb "github.com/astracat/docklet/api/proto/v1"
	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/docker/go-connections/nat"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"os/exec"
)

type Agent struct {
	HubAddr   string
	NodeID    string
	DockerCli *client.Client
	CACert    string
	CertFile  string
	KeyFile   string
}

func NewAgent(hubAddr string, nodeID string, caCert, certFile, keyFile string) *Agent {
	// Init Docker Client
	// Force API 1.45 (Daemon requires >= 1.44)
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithVersion("1.45"))
	if err != nil {
		log.Printf("Warning: Failed to create Docker client: %v", err)
	} else {
		log.Printf("Docker Client Initialized. API Version: %s", cli.ClientVersion())
	}

	return &Agent{
		HubAddr:   hubAddr,
		NodeID:    nodeID,
		DockerCli: cli,
		CACert:    caCert,
		CertFile:  certFile,
		KeyFile:   keyFile,
	}
}

func (a *Agent) Start() error {
	var opts []grpc.DialOption

	if a.CACert != "" {
		creds, err := loadTLSCreds(a.CACert, a.CertFile, a.KeyFile)
		if err != nil {
			return fmt.Errorf("failed to load TLS creds: %w", err)
		}
		opts = append(opts, grpc.WithTransportCredentials(creds))
		log.Println("Secure mode (mTLS) ENABLED")
	} else {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
		log.Println("WARNING: Secure mode DISABLED")
	}

	// Connect to Hub
	conn, err := grpc.NewClient(a.HubAddr, opts...)
	if err != nil {
		return err
	}
	defer conn.Close()

	client := pb.NewDockletServiceClient(conn)

	// Establish stream
	stream, err := client.RegisterStream(context.Background())
	if err != nil {
		return err
	}

	// Send Handshake
	err = stream.Send(&pb.StreamPayload{
		Payload: &pb.StreamPayload_Handshake{
			Handshake: &pb.Handshake{
				NodeId:    a.NodeID,
				MachineId: "test-machine-id", // Implement real one later
				Version:   "0.1.0",
			},
		},
	})
	if err != nil {
		log.Printf("Failed to send handshake: %v", err)
		return err
	}

	log.Println("Connected to Hub. Waiting for commands...")

	// Listen loop
	waitc := make(chan struct{})
	go func() {
		for {
			in, err := stream.Recv()
			if err == io.EOF {
				close(waitc)
				return
			}
			if err != nil {
				log.Printf("Failed to receive a note : %v", err)
				close(waitc)
				return
			}

			// Handle incoming messages
			switch payload := in.Payload.(type) {
			case *pb.StreamPayload_Heartbeat:
				log.Printf("Received Heartbeat from Hub: %d", payload.Heartbeat.Timestamp)
			case *pb.StreamPayload_Command:
				cmd := payload.Command
				log.Printf("Received Command: %s (ID: %s)", cmd.Type, cmd.Id)

				// Execute Command
				go a.handleCommand(stream, cmd)

			default:
				log.Printf("Received unknown from Hub")
			}
		}
	}()

	<-waitc
	return nil
}

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

	case "docker_logs":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else {
			if len(cmd.Args) < 1 {
				errStr = "container id required"
				exitCode = 1
			} else {
				containerID := cmd.Args[0]
				out, err := a.DockerCli.ContainerLogs(context.Background(), containerID, container.LogsOptions{ShowStdout: true, ShowStderr: true, Follow: false})
				if err != nil {
					errStr = err.Error()
					exitCode = 1
				} else {
					defer out.Close()
					logs, _ := io.ReadAll(out)
					output = logs
					exitCode = 0
				}
			}
		}

	case "docker_inspect":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else if len(cmd.Args) < 1 {
			errStr = "container id required"
			exitCode = 1
		} else {
			containerID := cmd.Args[0]
			val, err := a.DockerCli.ContainerInspect(context.Background(), containerID)
			if err != nil {
				errStr = err.Error()
				exitCode = 1
			} else {
				b, err := json.Marshal(val)
				if err != nil {
					errStr = err.Error()
					exitCode = 1
				} else {
					output = b
					exitCode = 0
				}
			}
		}

	case "docker_stats":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else if len(cmd.Args) < 1 {
			errStr = "container id required"
			exitCode = 1
		} else {
			containerID := cmd.Args[0]
			stats, err := a.DockerCli.ContainerStatsOneShot(context.Background(), containerID)
			if err != nil {
				errStr = err.Error()
				exitCode = 1
			} else {
				defer stats.Body.Close()
				b, err := io.ReadAll(stats.Body)
				if err != nil {
					errStr = err.Error()
					exitCode = 1
				} else {
					output = b
					exitCode = 0
				}
			}
		}

	case "docker_exec":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else if len(cmd.Args) < 2 {
			errStr = "container id and command required"
			exitCode = 1
		} else {
			containerID := cmd.Args[0]
			command := cmd.Args[1:]

			execIDResp, err := a.DockerCli.ContainerExecCreate(context.Background(), containerID, types.ExecConfig{
				AttachStdout: true,
				AttachStderr: true,
				Tty:          false,
				Cmd:          command,
			})
			if err != nil {
				errStr = err.Error()
				exitCode = 1
			} else {
				attachResp, err := a.DockerCli.ContainerExecAttach(context.Background(), execIDResp.ID, types.ExecStartCheck{
					Tty: false,
				})
				if err != nil {
					errStr = err.Error()
					exitCode = 1
				} else {
					defer attachResp.Close()
					var stdout, stderr bytes.Buffer
					if _, err := stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader); err != nil {
						errStr = err.Error()
						exitCode = 1
					} else {
						if stderr.Len() > 0 {
							output = append(stdout.Bytes(), stderr.Bytes()...)
						} else {
							output = stdout.Bytes()
						}
						exitCode = 0
					}
				}
			}
		}
	case "docker_run":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else {
			if len(cmd.Args) < 1 {
				errStr = "config json required"
				exitCode = 1
			} else {
				// Parse Config
				type RunConfig struct {
					Image string `json:"image"`
					Name  string `json:"name"`
					Ports []struct {
						Host      string `json:"host"`
						Container string `json:"container"`
					} `json:"ports"`
					Env []string `json:"env"`
				}

				var config RunConfig
				if err := json.Unmarshal([]byte(cmd.Args[0]), &config); err != nil {
					// Fallback to old behavior: Args[0] is just image name
					config.Image = cmd.Args[0]
				}

				if config.Image == "" {
					errStr = "image name required"
					exitCode = 1
				} else {
					// 1. Pull Image
					reader, err := a.DockerCli.ImagePull(context.Background(), config.Image, image.PullOptions{})
					if err != nil {
						errStr = "pull error: " + err.Error()
						exitCode = 1
					} else {
						io.Copy(io.Discard, reader)
						reader.Close()

						// Prepare Config
						containerConfig := &container.Config{
							Image: config.Image,
							Env:   config.Env,
						}

						// Prepare Host Config (Ports)
						hostConfig := &container.HostConfig{
							PortBindings: nat.PortMap{},
						}

						for _, p := range config.Ports {
							// Assuming TCP for now.
							// Container port needs to be "80/tcp"
							portKey := nat.Port(p.Container + "/tcp")
							hostConfig.PortBindings[portKey] = []nat.PortBinding{
								{
									HostIP:   "0.0.0.0",
									HostPort: p.Host,
								},
							}
						}

						// 2. Create Container
						resp, err := a.DockerCli.ContainerCreate(context.Background(), containerConfig, hostConfig, nil, nil, config.Name)

						if err != nil {
							errStr = "create error: " + err.Error()
							exitCode = 1
						} else {
							// 3. Start Container
							if err := a.DockerCli.ContainerStart(context.Background(), resp.ID, container.StartOptions{}); err != nil {
								errStr = "start error: " + err.Error()
								exitCode = 1
							} else {
								output = []byte(resp.ID)
								exitCode = 0
							}
						}
					}
				}
			}
		}

	case "stack_up":
		if len(cmd.Args) < 2 {
			errStr = "stack name and content required"
			exitCode = 1
		} else {
			stackName := cmd.Args[0]
			content := cmd.Args[1]
			
			// 1. Write content to file
			dir := fmt.Sprintf("/tmp/docklet_stacks/%s", stackName)
			if err := os.MkdirAll(dir, 0755); err != nil {
				errStr = "failed to create dir: " + err.Error()
				exitCode = 1
			} else {
				filePath := fmt.Sprintf("%s/docker-compose.yml", dir)
				if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
					errStr = "failed to write file: " + err.Error()
					exitCode = 1
				} else {
					// 2. Run docker compose up -d
					c := exec.Command("docker", "compose", "-p", stackName, "-f", filePath, "up", "-d")
					out, err := c.CombinedOutput()
					if err != nil {
						errStr = string(out) + "\n" + err.Error()
						exitCode = 1
					} else {
						output = out
						exitCode = 0
					}
				}
			}
		}

	case "stack_down":
		if len(cmd.Args) < 1 {
			errStr = "stack name required"
			exitCode = 1
		} else {
			stackName := cmd.Args[0]
			dir := fmt.Sprintf("/tmp/docklet_stacks/%s", stackName)
			filePath := fmt.Sprintf("%s/docker-compose.yml", dir)
			
			c := exec.Command("docker", "compose", "-p", stackName, "down")
			if _, err := os.Stat(filePath); err == nil {
				c = exec.Command("docker", "compose", "-p", stackName, "-f", filePath, "down")
			}

			out, err := c.CombinedOutput()
			if err != nil {
				errStr = string(out) + "\n" + err.Error()
				exitCode = 1
			} else {
				output = out
				exitCode = 0
			}
		}
		
	case "stack_ls":
		c := exec.Command("docker", "compose", "ls", "--format", "json")
		out, err := c.CombinedOutput()
		if err != nil {
			errStr = string(out) + "\n" + err.Error()
			exitCode = 1
		} else {
			output = out
			exitCode = 0
		}

	case "docker_start":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else {
			if len(cmd.Args) < 1 {
				errStr = "container id required"
				exitCode = 1
			} else {
				containerID := cmd.Args[0]
				if err := a.DockerCli.ContainerStart(context.Background(), containerID, container.StartOptions{}); err != nil {
					errStr = err.Error()
					exitCode = 1
				} else {
					output = []byte("started")
					exitCode = 0
				}
			}
		}

	case "docker_stop":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else {
			if len(cmd.Args) < 1 {
				errStr = "container id required"
				exitCode = 1
			} else {
				containerID := cmd.Args[0]
				// Use Default timeout (nil = 10s usually)
				if err := a.DockerCli.ContainerStop(context.Background(), containerID, container.StopOptions{}); err != nil {
					errStr = err.Error()
					exitCode = 1
				} else {
					output = []byte("stopped")
					exitCode = 0
				}
			}
		}

	case "docker_rm":
		if a.DockerCli == nil {
			errStr = "docker client not initialized"
			exitCode = 1
		} else {
			if len(cmd.Args) < 1 {
				errStr = "container id required"
				exitCode = 1
			} else {
				containerID := cmd.Args[0]
				// Force remove to ensuring it goes away (like docker rm -f)
				if err := a.DockerCli.ContainerRemove(context.Background(), containerID, container.RemoveOptions{Force: true}); err != nil {
					errStr = err.Error()
					exitCode = 1
				} else {
					output = []byte("removed")
					exitCode = 0
				}
			}
		}
	case "node_rename":
		if len(cmd.Args) < 1 {
			errStr = "name required"
			exitCode = 1
		} else {
			output = []byte(cmd.Args[0])
			exitCode = 0
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
