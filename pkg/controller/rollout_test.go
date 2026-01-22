package controller

import (
	"testing"
	"time"

	"github.com/astracat/docklet/pkg/api"
	"github.com/astracat/docklet/pkg/store"
)

func setupStore(t *testing.T) *store.Store {
	// file::memory:?cache=shared is needed for in-memory DB shared across connections if we opened multiple,
	// but here we just use one wrapper.
	s, err := store.NewStore("file::memory:?cache=shared")
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	return s
}

func TestRollout_CanarySuccess(t *testing.T) {
	s := setupStore(t)
	c := NewRolloutController(s)

	// Setup: Node
	node := &api.Node{ID: "node-1", Status: "online"}
	s.CreateNode(node)

	// App
	app := &api.App{
		ID:               "app-1",
		Status:           "rolling_update",
		ActiveRevisionID: "rev-1",
		CreatedAt:        time.Now(),
	}
	s.CreateApp(app)

	// Old stable revision
	rev1 := &api.Revision{
		ID:        "rev-1",
		AppID:     "app-1",
		Image:     "nginx:1.0",
		Status:    "stable",
		CreatedAt: time.Now().Add(-1 * time.Hour),
	}
	s.CreateRevision(rev1)

	// New canary revision - Created 15s ago so it passes time check immediately
	rev2 := &api.Revision{
		ID:        "rev-2",
		AppID:     "app-1",
		Image:     "nginx:1.1",
		Status:    "rolling",
		CreatedAt: time.Now().Add(-15 * time.Second),
	}
	s.CreateRevision(rev2)

	// 1. Tick - Start Canary
	c.Tick()

	// Verify status -> canary
	r2, _ := s.GetRevision("rev-2")
	if r2.Status != "canary" {
		t.Fatalf("Expected revision status 'canary', got '%s'", r2.Status)
	}

	// Verify task created
	tasks, _ := s.GetTasksByApp("app-1")
	if len(tasks) != 1 {
		t.Fatalf("Expected 1 task, got %d", len(tasks))
	}
	task := tasks[0]
	if task.Status != "pending" { // created as pending
		t.Errorf("Expected task pending")
	}

	// 2. Agent completes task
	s.UpdateTaskStatus(task.ID, "completed")

	// 3. Tick - Verify Canary -> Promote
	c.Tick()

	r2, _ = s.GetRevision("rev-2")
	if r2.Status != "stable" {
		t.Fatalf("Expected revision status 'stable', got '%s'", r2.Status)
	}

	a, _ := s.GetApp("app-1")
	if a.Status != "stable" {
		t.Errorf("Expected app status 'stable', got '%s'", a.Status)
	}
	if a.ActiveRevisionID != "rev-2" {
		t.Errorf("Expected active revision 'rev-2', got '%s'", a.ActiveRevisionID)
	}
}

func TestRollout_CanaryFailure(t *testing.T) {
	s := setupStore(t)
	c := NewRolloutController(s)

	s.CreateNode(&api.Node{ID: "node-1", Status: "online"})

	app := &api.App{
		ID:               "app-fail",
		Status:           "rolling_update",
		ActiveRevisionID: "rev-stable",
	}
	s.CreateApp(app)

	s.CreateRevision(&api.Revision{
		ID:     "rev-stable",
		AppID:  "app-fail",
		Image:  "nginx:1.0",
		Status: "stable",
	})

	s.CreateRevision(&api.Revision{
		ID:        "rev-fail",
		AppID:     "app-fail",
		Image:     "nginx:bad",
		Status:    "rolling",
		CreatedAt: time.Now(),
	})

	// 1. Tick - Start Canary
	c.Tick()

	// 2. Agent fails task
	tasks, _ := s.GetTasksByApp("app-fail")
	task := tasks[0]
	s.UpdateTaskStatus(task.ID, "failed")

	// 3. Tick - Verify Canary -> Rollback
	c.Tick()

	rFail, _ := s.GetRevision("rev-fail")
	if rFail.Status != "failed" {
		t.Errorf("Expected failed revision status 'failed', got '%s'", rFail.Status)
	}

	// Check Rollback Task created
	tasks, _ = s.GetTasksByApp("app-fail")
	// Should have: Canary Task (Failed) AND Rollback Task (Pending)
	if len(tasks) != 2 {
		t.Fatalf("Expected 2 tasks, got %d", len(tasks))
	}
	// tasks[0] is latest (Rollback), tasks[1] is Canary
	rollbackTask := tasks[0]
	if rollbackTask.Type != "deploy" {
		t.Errorf("Rollback task type mismatch")
	}
	// Payload should contain old image
	// We can check payload string content

	// App status should be stable
	a, _ := s.GetApp("app-fail")
	if a.Status != "stable" {
		t.Errorf("App status should be stable after rollback trigger")
	}
	// Active revision should still be old one
	if a.ActiveRevisionID != "rev-stable" {
		t.Errorf("Active revision should stay rev-stable")
	}
}
