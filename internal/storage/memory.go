package storage

import (
	"context"
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
