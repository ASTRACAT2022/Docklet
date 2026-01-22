package controller

import (
	"fmt"
	"log"
	"time"

	"github.com/astracat/docklet/pkg/api"
	"github.com/astracat/docklet/pkg/store"
	"github.com/google/uuid"
)

type RolloutController struct {
	store *store.Store
}

func NewRolloutController(s *store.Store) *RolloutController {
	return &RolloutController{store: s}
}

func (c *RolloutController) Start() {
	ticker := time.NewTicker(2 * time.Second)
	go func() {
		for range ticker.C {
			c.Tick()
		}
	}()
}

func (c *RolloutController) Tick() {
	apps, err := c.store.GetAppsByStatus("rolling_update")
	if err != nil {
		log.Printf("RolloutController: Failed to get apps: %v", err)
		return
	}

	for _, app := range apps {
		c.advance(&app)
	}
}

func (c *RolloutController) advance(app *api.App) {
	// 1. Get Latest Revision
	rev, err := c.store.GetLatestRevision(app.ID)
	if err != nil {
		log.Printf("Rollout: Failed to get revision for app %s: %v", app.ID, err)
		return
	}

	log.Printf("Processing App %s (Rev: %s, Status: %s)", app.ID, rev.ID, rev.Status)

	switch rev.Status {
	case "rolling": // Initial state created by API
		c.startCanary(app, rev)
	case "canary":
		c.verifyCanary(app, rev)
	case "stable":
		// Already done, should not be here strictly, but good to handle clean up
		c.store.UpdateAppStatus(app.ID, "stable")
	case "failed":
		c.rollback(app, rev)
	}
}

func (c *RolloutController) startCanary(app *api.App, rev *api.Revision) {
	// 2.2 Select 1 canary node
	node, err := c.store.GetFirstNode()
	if err != nil || node == nil {
		log.Printf("Rollout: No nodes available for canary")
		return
	}

	log.Printf("Rollout: Selected Canary Node %s", node.ID)

	// Create Deploy Task
	task := &api.Task{
		ID:        uuid.New().String(),
		Type:      "deploy",
		Status:    "pending",
		NodeID:    node.ID,
		TargetID:  app.ID,
		Payload:   fmt.Sprintf(`{"image": "%s"}`, rev.Image),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := c.store.CreateTask(task); err != nil {
		log.Printf("Rollout: Failed to create task: %v", err)
		return
	}

	// Update Revision Status -> Canary
	c.store.UpdateRevisionStatus(rev.ID, "canary")
	log.Printf("Rollout: Revision %s -> Canary (Task %s)", rev.ID, task.ID)
}

func (c *RolloutController) verifyCanary(app *api.App, rev *api.Revision) {
	// 2.3 Verify
	tasks, err := c.store.GetTasksByApp(app.ID)
	if err != nil || len(tasks) == 0 {
		return
	}
	task := tasks[0] // Latest task (Canary)

	// Check Failure
	if task.Status == api.TaskStatusFailed {
		log.Printf("Rollout: Canary Task Failed. Triggering Rollback.")
		c.store.UpdateRevisionStatus(rev.ID, "failed")
		c.rollback(app, rev)
		return
	}

	// Check Timeout
	if time.Since(task.CreatedAt) > 60*time.Second && task.Status != api.TaskStatusCompleted {
		log.Printf("Rollout: Task Timed Out. Triggering Rollback.")
		c.store.UpdateRevisionStatus(rev.ID, "failed")
		c.rollback(app, rev)
		return
	}

	// Success Path
	// Ideally check Heartbeat here, but for now trust "completed" task + time
	if task.Status == api.TaskStatusCompleted {
		if time.Since(rev.CreatedAt) > 10*time.Second {
			log.Printf("Rollout: Canary passed. Promoting...")
			c.store.UpdateRevisionStatus(rev.ID, "stable")
			c.store.UpdateAppStatus(app.ID, "stable")
			c.store.UpdateAppActiveRevision(app.ID, rev.ID)
		}
	}
}

func (c *RolloutController) rollback(app *api.App, rev *api.Revision) {
	log.Printf("Rollout: Rolling back app %s", app.ID)

	if app.ActiveRevisionID == "" || app.ActiveRevisionID == rev.ID {
		c.store.UpdateAppStatus(app.ID, "stable")
		return
	}

	prevRev, err := c.store.GetRevision(app.ActiveRevisionID)
	if err != nil {
		log.Printf("Rollout: Failed to get previous revision: %v", err)
		c.store.UpdateAppStatus(app.ID, "stable")
		return
	}

	log.Printf("Rollout: Reverting to revision %s (Image: %s)", prevRev.ID, prevRev.Image)

	node, _ := c.store.GetFirstNode()
	if node != nil {
		task := &api.Task{
			ID:        uuid.New().String(),
			Type:      api.TaskTypeDeploy,
			Status:    api.TaskStatusPending,
			NodeID:    node.ID,
			TargetID:  app.ID,
			Payload:   fmt.Sprintf(`{"image": "%s"}`, prevRev.Image),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		if err := c.store.CreateTask(task); err != nil {
			log.Printf("Rollout: Failed to create rollback task: %v", err)
		}
	}

	c.store.UpdateAppStatus(app.ID, "stable")
}
