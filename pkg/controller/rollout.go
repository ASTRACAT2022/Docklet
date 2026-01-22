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
	// Find the Task for this revision
	// Simplest Check:
	// Is there a "completed" task for this App recently?
	// Is the Heartbeat showing the new container running?

	// Let's just promote after 10s for the skeleton proof.
	if time.Since(rev.CreatedAt) > 10*time.Second {
		log.Printf("Rollout: Canary passed (Duration > 10s). Promoting...")
		// Mark Stable
		c.store.UpdateRevisionStatus(rev.ID, "stable")
		c.store.UpdateAppStatus(app.ID, "stable")
		c.store.UpdateAppActiveRevision(app.ID, rev.ID)
	}
}

func (c *RolloutController) rollback(app *api.App, rev *api.Revision) {
	// 2.4 Rollback Placeholder
	log.Printf("Rollout: Rolling back app %s", app.ID)
}
