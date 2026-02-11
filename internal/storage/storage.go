package storage

import (
	"context"
	"time"
)

type Node struct {
	ID         string
	Name       string
	MachineID  string
	Version    string
	RemoteAddr string
	LastSeen   time.Time
}

type NodeRepository interface {
	Init(ctx context.Context) error
	UpsertNode(ctx context.Context, node *Node) error
	ListNodes(ctx context.Context) ([]*Node, error)
	GetNode(ctx context.Context, id string) (*Node, error)
	RenameNode(ctx context.Context, id, name string) error
	DeleteNode(ctx context.Context, id string) error
	Close()
}
