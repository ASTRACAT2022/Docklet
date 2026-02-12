package storage

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type AliasBackupStore struct {
	base      NodeRepository
	aliasPath string

	mu      sync.RWMutex
	aliases map[string]string
}

type aliasBackupPayload struct {
	Aliases map[string]string `json:"aliases"`
}

func NewAliasBackupStore(base NodeRepository, aliasPath string) *AliasBackupStore {
	return &AliasBackupStore{
		base:      base,
		aliasPath: aliasPath,
		aliases:   make(map[string]string),
	}
}

func (s *AliasBackupStore) Init(ctx context.Context) error {
	if err := s.base.Init(ctx); err != nil {
		return err
	}
	if err := s.loadAliases(); err != nil {
		return err
	}
	return s.restoreAliases(ctx)
}

func (s *AliasBackupStore) Close() {
	s.base.Close()
}

func (s *AliasBackupStore) UpsertNode(ctx context.Context, node *Node) error {
	if err := s.base.UpsertNode(ctx, node); err != nil {
		return err
	}

	// If agent reconnect upsert came without name, restore alias.
	if strings.TrimSpace(node.Name) == "" {
		alias := s.getAlias(node.ID)
		if alias != "" {
			_ = s.base.RenameNode(ctx, node.ID, alias)
		}
	}
	return nil
}

func (s *AliasBackupStore) ListNodes(ctx context.Context) ([]*Node, error) {
	nodes, err := s.base.ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*Node, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, s.withAlias(n))
	}
	return out, nil
}

func (s *AliasBackupStore) GetNode(ctx context.Context, id string) (*Node, error) {
	node, err := s.base.GetNode(ctx, id)
	if err != nil || node == nil {
		return node, err
	}
	return s.withAlias(node), nil
}

func (s *AliasBackupStore) RenameNode(ctx context.Context, id, name string) error {
	trimmed := strings.TrimSpace(name)
	if err := s.base.RenameNode(ctx, id, trimmed); err != nil {
		return err
	}
	if trimmed == "" {
		s.deleteAlias(id)
	} else {
		s.setAlias(id, trimmed)
	}
	return s.saveAliases()
}

func (s *AliasBackupStore) DeleteNode(ctx context.Context, id string) error {
	// Keep alias in backup even if stale node cleanup removes row.
	return s.base.DeleteNode(ctx, id)
}

func (s *AliasBackupStore) restoreAliases(ctx context.Context) error {
	nodes, err := s.base.ListNodes(ctx)
	if err != nil {
		return err
	}
	for _, n := range nodes {
		if strings.TrimSpace(n.Name) != "" {
			continue
		}
		alias := s.getAlias(n.ID)
		if alias == "" {
			continue
		}
		_ = s.base.RenameNode(ctx, n.ID, alias)
	}
	return nil
}

func (s *AliasBackupStore) withAlias(node *Node) *Node {
	if node == nil {
		return nil
	}
	copied := *node
	if strings.TrimSpace(copied.Name) == "" {
		if alias := s.getAlias(copied.ID); alias != "" {
			copied.Name = alias
		}
	}
	return &copied
}

func (s *AliasBackupStore) getAlias(id string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return strings.TrimSpace(s.aliases[id])
}

func (s *AliasBackupStore) setAlias(id, alias string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.aliases[id] = alias
}

func (s *AliasBackupStore) deleteAlias(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.aliases, id)
}

func (s *AliasBackupStore) loadAliases() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.aliases = make(map[string]string)
	b, err := os.ReadFile(s.aliasPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if len(b) == 0 {
		return nil
	}

	var payload aliasBackupPayload
	if err := json.Unmarshal(b, &payload); err == nil && payload.Aliases != nil {
		s.aliases = payload.Aliases
		return nil
	}

	// Legacy fallback: allow plain map format.
	var legacy map[string]string
	if err := json.Unmarshal(b, &legacy); err == nil {
		s.aliases = legacy
	}
	return nil
}

func (s *AliasBackupStore) saveAliases() error {
	s.mu.RLock()
	payload := aliasBackupPayload{
		Aliases: make(map[string]string, len(s.aliases)),
	}
	for k, v := range s.aliases {
		if strings.TrimSpace(v) == "" {
			continue
		}
		payload.Aliases[k] = v
	}
	s.mu.RUnlock()

	if err := os.MkdirAll(filepath.Dir(s.aliasPath), 0o700); err != nil {
		return err
	}

	if prev, err := os.ReadFile(s.aliasPath); err == nil {
		_ = os.WriteFile(s.aliasPath+".bak", prev, 0o600)
	}

	b, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.aliasPath + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.aliasPath)
}
