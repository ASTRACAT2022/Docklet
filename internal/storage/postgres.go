package storage

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct {
	db *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, connString string) (*PostgresStore, error) {
	config, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("unable to parse connection string: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	// Test connection
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &PostgresStore{db: pool}, nil
}

func (s *PostgresStore) Close() {
	s.db.Close()
}

func (s *PostgresStore) Init(ctx context.Context) error {
	query := `
    CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        machine_id TEXT,
        version TEXT,
        remote_addr TEXT,
        last_seen TIMESTAMP
    );
    `
	_, err := s.db.Exec(ctx, query)
	return err
}

func (s *PostgresStore) UpsertNode(ctx context.Context, node *Node) error {
	query := `
    INSERT INTO nodes (id, machine_id, version, remote_addr, last_seen)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET
        machine_id = EXCLUDED.machine_id,
        version = EXCLUDED.version,
        remote_addr = EXCLUDED.remote_addr,
        last_seen = EXCLUDED.last_seen;
    `
	_, err := s.db.Exec(ctx, query, node.ID, node.MachineID, node.Version, node.RemoteAddr, node.LastSeen)
	return err
}

func (s *PostgresStore) ListNodes(ctx context.Context) ([]*Node, error) {
	query := `SELECT id, machine_id, version, remote_addr, last_seen FROM nodes`
	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []*Node
	for rows.Next() {
		var n Node
		err := rows.Scan(&n.ID, &n.MachineID, &n.Version, &n.RemoteAddr, &n.LastSeen)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, &n)
	}
	return nodes, rows.Err()
}

func (s *PostgresStore) GetNode(ctx context.Context, id string) (*Node, error) {
	query := `SELECT id, machine_id, version, remote_addr, last_seen FROM nodes WHERE id = $1`
	var n Node
	err := s.db.QueryRow(ctx, query, id).Scan(&n.ID, &n.MachineID, &n.Version, &n.RemoteAddr, &n.LastSeen)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &n, nil
}
