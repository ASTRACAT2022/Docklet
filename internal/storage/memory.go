package storage

import (
	"context"
	"strings"
	"sync"
)

type MemoryStore struct {
	nodes sync.Map // map[string]*Node
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{}
}

func (s *MemoryStore) Init(ctx context.Context) error { return nil }
func (s *MemoryStore) Close()                         {}

func (s *MemoryStore) UpsertNode(ctx context.Context, node *Node) error {
	s.nodes.Store(node.ID, node)
	return nil
}

func (s *MemoryStore) ListNodes(ctx context.Context) ([]*Node, error) {
	var nodes []*Node
	s.nodes.Range(func(key, value interface{}) bool {
		nodes = append(nodes, value.(*Node))
		return true
	})
	return nodes, nil
}

func (s *MemoryStore) GetNode(ctx context.Context, id string) (*Node, error) {
	if val, ok := s.nodes.Load(id); ok {
		return val.(*Node), nil
	}
	return nil, nil // Not found
}

func (s *MemoryStore) RenameNode(ctx context.Context, id, name string) error {
	name = strings.TrimSpace(name)
	if val, ok := s.nodes.Load(id); ok {
		node := val.(*Node)
		node.Name = name
		s.nodes.Store(id, node)
	}
	return nil
}

func (s *MemoryStore) DeleteNode(ctx context.Context, id string) error {
	s.nodes.Delete(id)
	return nil
}
