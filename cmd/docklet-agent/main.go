package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/astracat/docklet/pkg/api"
	"github.com/astracat/docklet/pkg/docker"
)

var ControlPlaneURL = "http://localhost:8080"

func main() {
	if cp := os.Getenv("DOCKLET_CP"); cp != "" {
		ControlPlaneURL = cp
	}

	hostname, _ := os.Hostname()
	log.Printf("Starting Docklet Agent on %s...", hostname)

	// Registration loop
	token := register(hostname)
	log.Printf("Registered successfully. Token: %s", token)

	// Initialize Docker Executor
	exec, err := docker.NewExecutor()
	if err != nil {
		log.Fatalf("Failed to initialize Docker executor: %v", err)
	}

	// Verify Docker connection
	containers, err := exec.ListContainers(context.Background())
	if err != nil {
		log.Printf("Warning: Failed to list containers: %v", err)
	} else {
		log.Printf("Connected to Docker. Running containers: %d", len(containers))
	}

	// Polling loop
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	client := &http.Client{}

	// Heartbeat loop
	go func() {
		hbTicker := time.NewTicker(5 * time.Second)
		defer hbTicker.Stop()
		for range hbTicker.C {
			containers, err := exec.ListContainers(context.Background())
			if err != nil {
				log.Printf("Heartbeat: Failed to list containers: %v", err)
			}

			// Map to API type
			var apiContainers []api.ContainerStatus
			for _, c := range containers {
				apiContainers = append(apiContainers, api.ContainerStatus{
					ID:     c.ID,
					Image:  c.Image,
					State:  c.State,
					Names:  c.Names,
					Labels: c.Labels, // Assuming types.Container has Labels
				})
			}

			sendHeartbeat(client, token, apiContainers)
		}
	}()

	for range ticker.C {
		log.Println("Polling Control Plane...")

		nodeID := ""
		if len(token) > 12 {
			nodeID = token[12:]
		}

		tasks, err := pollTasks(client, nodeID)
		if err != nil {
			log.Printf("Failed to poll tasks: %v", err)
			continue
		}

		for _, task := range tasks {
			log.Printf("Received task: %s (Type: %s, Payload: %s)", task.ID, task.Type, task.Payload)

			if task.Type == "deploy" {
				var payload struct {
					Image string            `json:"image"`
					Ports map[string]string `json:"ports"` // "80/tcp" -> "8080"
					Env   []string          `json:"env"`
				}
				if err := json.Unmarshal([]byte(task.Payload), &payload); err != nil {
					log.Printf("Failed to parse payload: %v", err)
					updateTaskStatus(client, nodeID, task.ID, "failed")
					continue
				}
				updateTaskStatus(client, nodeID, task.ID, "running")

				config := docker.RunConfig{
					Image: payload.Image,
					Ports: payload.Ports,
					Env:   payload.Env,
				}

				_, err := exec.RunContainer(context.Background(), config)
				if err != nil {
					log.Printf("Failed to run container: %v", err)
					updateTaskStatus(client, nodeID, task.ID, "failed")
					continue
				}
				updateTaskStatus(client, nodeID, task.ID, "completed")
			} else if task.Type == "fetch_logs" {
				var payload struct {
					AppID string `json:"app_id"` // Simplified for MVP
				}
				// In real impl, we'd look up container by AppID labels.
				// For now, let's just send back a dummy log or try to find a container.
				_ = json.Unmarshal([]byte(task.Payload), &payload)

				logs := "Logs from Agent (" + hostname + "):\n"
				logs += fmt.Sprintf("Time: %s\n", time.Now().Format(time.RFC3339))
				for _, c := range containers {
					logs += fmt.Sprintf("Running Container: %s (Image: %s)\n", c.Names[0], c.Image)
				}
				logs += "End of logs.\n"

				reportLogs(client, nodeID, task.TargetID, logs)
				updateTaskStatus(client, nodeID, task.ID, "completed")
			}
		}
	}
}

func pollTasks(client *http.Client, nodeID string) ([]api.Task, error) {
	resp, err := client.Get(fmt.Sprintf("%s/api/agents/%s/tasks", ControlPlaneURL, nodeID))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("poll failed with status: %s", resp.Status)
	}

	var tasks []api.Task
	if err := json.NewDecoder(resp.Body).Decode(&tasks); err != nil {
		return nil, err
	}
	return tasks, nil
}

func updateTaskStatus(client *http.Client, nodeID, taskID, status string) {
	reqBody, _ := json.Marshal(map[string]string{
		"task_id": taskID,
		"status":  status,
	})
	http.Post(fmt.Sprintf("%s/api/agents/%s/report", ControlPlaneURL, nodeID), "application/json", bytes.NewBuffer(reqBody))
}

func sendHeartbeat(client *http.Client, token string, containers []api.ContainerStatus) {
	nodeID := ""
	if len(token) > 12 {
		nodeID = token[12:]
	}

	reqBody := api.HeartbeatRequest{
		NodeID:     nodeID,
		Containers: containers,
	}
	jsonData, _ := json.Marshal(reqBody)

	resp, err := http.Post(ControlPlaneURL+"/api/agents/heartbeat", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("Heartbeat failed: %v", err)
		return
	}
	defer resp.Body.Close()
}

func reportLogs(client *http.Client, nodeID, appID, content string) {
	reqBody := api.AppLog{
		AppID:   appID,
		Content: content,
	}
	jsonData, _ := json.Marshal(reqBody)
	http.Post(fmt.Sprintf("%s/api/logs", ControlPlaneURL), "application/json", bytes.NewBuffer(jsonData))
}

func register(hostname string) string {
	reqBody := api.RegisterNodeRequest{
		Hostname: hostname,
		Version:  "v0.1.0",
	}
	jsonData, _ := json.Marshal(reqBody)

	for {
		resp, err := http.Post(ControlPlaneURL+"/api/register", "application/json", bytes.NewBuffer(jsonData))
		if err != nil {
			log.Printf("Failed to connect to Control Plane: %v. Retrying in 5s...", err)
			time.Sleep(5 * time.Second)
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			log.Printf("Registration failed with status: %d. Retrying...", resp.StatusCode)
			time.Sleep(5 * time.Second)
			continue
		}

		var regResp api.RegisterNodeResponse
		if err := json.NewDecoder(resp.Body).Decode(&regResp); err != nil {
			log.Printf("Failed to decode response: %v", err)
			continue
		}

		return regResp.Token
	}
}
