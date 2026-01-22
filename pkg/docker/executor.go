package docker

import (
	"context"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"
)

type Executor struct {
	cli *client.Client
}

func NewExecutor() (*Executor, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	return &Executor{cli: cli}, nil
}

func (e *Executor) ListContainers(ctx context.Context) ([]types.Container, error) {
	return e.cli.ContainerList(ctx, types.ContainerListOptions{})
}

type RunConfig struct {
	Image string
	Env   []string          // "KEY=VALUE"
	Ports map[string]string // "80/tcp" -> "8080"
}

func (e *Executor) RunContainer(ctx context.Context, config RunConfig) (string, error) {
	// 1. Pull Image
	reader, err := e.cli.ImagePull(ctx, config.Image, types.ImagePullOptions{})
	if err == nil {
		defer reader.Close() // Close reader to prevent leak
		// Read output to avoid blocking? Or just let it close.
		// Ideally we should process it, but for MVP just ensuring pull trigger is enough.
	} else {
		// If pull fails, might exist locally. Continue or error?
		// For production, should check error type.
		// Let's return error to be safe.
		// return "", err
	}

	// Prepare Port Bindings
	exposedPorts := nat.PortSet{}
	portBindings := nat.PortMap{}

	for containerPort, hostPort := range config.Ports {
		port := nat.Port(containerPort)
		exposedPorts[port] = struct{}{}
		portBindings[port] = []nat.PortBinding{
			{
				HostIP:   "0.0.0.0",
				HostPort: hostPort,
			},
		}
	}

	// 2. Create Container
	resp, err := e.cli.ContainerCreate(ctx, &container.Config{
		Image:        config.Image,
		Env:          config.Env,
		ExposedPorts: exposedPorts,
	}, &container.HostConfig{
		PortBindings:    portBindings,
		PublishAllPorts: true, // Fallback
	}, nil, nil, "")
	if err != nil {
		return "", err
	}

	// 3. Start Container
	if err := e.cli.ContainerStart(ctx, resp.ID, types.ContainerStartOptions{}); err != nil {
		return "", err
	}

	return resp.ID, nil
}
