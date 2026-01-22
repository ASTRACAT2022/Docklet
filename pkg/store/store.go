package store

import (
	"time"

	"github.com/astracat/docklet/pkg/api"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type Store struct {
	db *gorm.DB
}

func NewStore(dbPath string) (*Store, error) {
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	// Auto Migrate the schema
	if err := db.AutoMigrate(&api.App{}, &api.Revision{}, &api.Node{}, &api.Task{}, &api.Instance{}, &api.AppLog{}); err != nil {
		return nil, err
	}

	return &Store{db: db}, nil
}

func (s *Store) CreateNode(node *api.Node) error {
	return s.db.Create(node).Error
}

func (s *Store) GetNode(id string) (*api.Node, error) {
	var node api.Node
	if err := s.db.First(&node, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &node, nil
}

func (s *Store) ListApps() ([]api.App, error) {
	var apps []api.App
	if err := s.db.Find(&apps).Error; err != nil {
		return nil, err
	}
	return apps, nil
}

func (s *Store) CreateApp(app *api.App) error {
	return s.db.Create(app).Error
}

func (s *Store) GetAppsByStatus(status string) ([]api.App, error) {
	var apps []api.App
	if err := s.db.Where("status = ?", status).Find(&apps).Error; err != nil {
		return nil, err
	}
	return apps, nil
}

func (s *Store) CreateTask(task *api.Task) error {
	return s.db.Create(task).Error
}

func (s *Store) GetPendingTasks(nodeID string) ([]api.Task, error) {
	var tasks []api.Task
	if err := s.db.Where("node_id = ? AND status = ?", nodeID, "pending").Find(&tasks).Error; err != nil {
		return nil, err
	}
	return tasks, nil
}

func (s *Store) UpdateTaskStatus(id string, status string) error {
	return s.db.Model(&api.Task{}).Where("id = ?", id).Update("status", status).Error
}

func (s *Store) GetFirstNode() (*api.Node, error) {
	var node api.Node
	if err := s.db.First(&node).Error; err != nil {
		return nil, err
	}
	return &node, nil
}

func (s *Store) UpdateNodeLastSeen(id string) error {
	return s.db.Model(&api.Node{}).Where("id = ?", id).Update("last_seen", time.Now()).Error
}

func (s *Store) ListNodes() ([]api.Node, error) {
	var nodes []api.Node
	if err := s.db.Find(&nodes).Error; err != nil {
		return nil, err
	}
	return nodes, nil
}

func (s *Store) GetApp(id string) (*api.App, error) {
	var app api.App
	if err := s.db.First(&app, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &app, nil
}

func (s *Store) CreateRevision(rev *api.Revision) error {
	return s.db.Create(rev).Error
}

func (s *Store) UpdateAppStatus(id, status string) error {
	return s.db.Model(&api.App{}).Where("id = ?", id).Update("status", status).Error
}

func (s *Store) UpdateAppActiveRevision(appID, revisionID string) error {
	return s.db.Model(&api.App{}).Where("id = ?", appID).Update("active_revision_id", revisionID).Error
}

func (s *Store) GetLatestRevision(appID string) (*api.Revision, error) {
	var rev api.Revision
	if err := s.db.Where("app_id = ?", appID).Order("created_at desc").First(&rev).Error; err != nil {
		return nil, err
	}
	return &rev, nil
}

func (s *Store) UpdateRevisionStatus(id, status string) error {
	return s.db.Model(&api.Revision{}).Where("id = ?", id).Update("status", status).Error
}

func (s *Store) UpsertInstance(instance *api.Instance) error {
	// Basic Upsert
	var existing api.Instance
	err := s.db.Where("id = ?", instance.ID).First(&existing).Error
	if err == nil {
		// Update
		instance.CreatedAt = existing.CreatedAt // preserve
		return s.db.Save(instance).Error
	}
	return s.db.Create(instance).Error
}

func (s *Store) SaveLog(log *api.AppLog) error {
	return s.db.Create(log).Error // TODO: Maybe limit log entries or overwrite?
}

func (s *Store) GetLatestLog(appID string) (*api.AppLog, error) {
	var log api.AppLog
	err := s.db.Where("app_id = ?", appID).Order("updated_at desc").First(&log).Error
	if err != nil {
		return nil, err
	}
	return &log, nil
}

func (s *Store) GetInstancesByApp(appID string) ([]api.Instance, error) {
	var instances []api.Instance
	if err := s.db.Where("app_id = ?", appID).Find(&instances).Error; err != nil {
		return nil, err
	}
	return instances, nil
}
