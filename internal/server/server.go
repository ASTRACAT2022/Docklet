package server

import (
	"context"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	pb "github.com/astracat/docklet/api/proto/v1"
	"github.com/astracat/docklet/internal/storage"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

type AgentSession struct {
	Stream      pb.DockletService_RegisterStreamServer
	NodeID      string
	SessionID   string
	MachineID   string
	Version     string
	ConnectedAt time.Time
	RemoteAddr  string
}

type DockletServer struct {
	pb.UnimplementedDockletServiceServer

	// Registry of connected agents
	// Key: NodeID, Value: *AgentSession
	agents sync.Map

	// Persistence
	Repo storage.NodeRepository

	// Pension commands waiting for result
	// Key: CommandID, Value: chan *pb.CommandResult
	pendingCommands sync.Map
}

func NewDockletServer(repo storage.NodeRepository) *DockletServer {
	return &DockletServer{
		Repo: repo,
	}
}

func (s *DockletServer) ListNodes(ctx context.Context, req *pb.ListNodesRequest) (*pb.ListNodesResponse, error) {
	resp := &pb.ListNodesResponse{
		Nodes: []*pb.NodeInfo{},
	}

	// 1. Get all nodes from DB
	dbNodes, err := s.Repo.ListNodes(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to fetch nodes from db: %v", err)
	}

	for _, n := range dbNodes {
		status := "disconnected"
		// Check if currently connected in memory
		if _, ok := s.agents.Load(n.ID); ok {
			status = "connected"
		}

		resp.Nodes = append(resp.Nodes, &pb.NodeInfo{
			NodeId:     n.ID,
			MachineId:  n.MachineID,
			Version:    n.Version,
			Status:     status,
			RemoteAddr: n.RemoteAddr,
		})
	}

	// Also add any that might be in memory but not in DB yet (edge case)
	// Actually Upsert should handle this, so skipping for now.

	return resp, nil
}

func (s *DockletServer) ExecuteCommand(ctx context.Context, req *pb.ExecuteCommandRequest) (*pb.ExecuteCommandResponse, error) {
	// 1. Find Node
	val, ok := s.agents.Load(req.NodeId)
	if !ok {
		return nil, status.Errorf(codes.NotFound, "node %s not connected", req.NodeId)
	}
	session := val.(*AgentSession)

	// 2. Prepare Command
	cmdID := fmt.Sprintf("cmd-%d", time.Now().UnixNano()) // TODO: Better UUID

	// 3. Register pending channel
	resultChan := make(chan *pb.CommandResult, 1)
	s.pendingCommands.Store(cmdID, resultChan)
	defer s.pendingCommands.Delete(cmdID)

	// 4. Send Command to Agent
	err := session.Stream.Send(&pb.StreamPayload{
		Payload: &pb.StreamPayload_Command{
			Command: &pb.Command{
				Id:   cmdID,
				Type: req.Command,
				Args: req.Args,
			},
		},
	})

	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to send command to agent: %v", err)
	}

	// 5. Wait for Result
	select {
	case res := <-resultChan:
		return &pb.ExecuteCommandResponse{
			Output:   res.Output,
			Error:    res.Error,
			ExitCode: res.ExitCode,
		}, nil
	case <-ctx.Done():
		return nil, status.Errorf(codes.DeadlineExceeded, "command timed out")
	case <-time.After(10 * time.Second): // Hard timeout backup
		return nil, status.Errorf(codes.DeadlineExceeded, "hub command timed out")
	}
}

func (s *DockletServer) RegisterStream(stream pb.DockletService_RegisterStreamServer) error {
	// Get peer info (IP address)
	remoteAddr := "unknown"
	if p, ok := peer.FromContext(stream.Context()); ok {
		remoteAddr = p.Addr.String()
	}
	log.Println("New connection from:", remoteAddr)

	// We expect the first message to be a Handshake
	in, err := stream.Recv()
	if err != nil {
		return err
	}

	handshakePayload, ok := in.Payload.(*pb.StreamPayload_Handshake)
	if !ok {
		return fmt.Errorf("expected handshake as first message, got %T", in.Payload)
	}

	handshake := handshakePayload.Handshake
	nodeID := handshake.NodeId

	// Register sesssion
	session := &AgentSession{
		Stream:      stream,
		NodeID:      nodeID,
		SessionID:   uuid.NewString(),
		MachineID:   handshake.MachineId,
		Version:     handshake.Version,
		ConnectedAt: time.Now(),
		RemoteAddr:  remoteAddr,
	}

	s.agents.Store(nodeID, session)

	// Persist to DB
	err = s.Repo.UpsertNode(stream.Context(), &storage.Node{
		ID:         nodeID,
		MachineID:  handshake.MachineId,
		Version:    handshake.Version,
		RemoteAddr: remoteAddr,
		LastSeen:   time.Now(),
	})
	if err != nil {
		log.Printf("Failed to persist node %s: %v", nodeID, err)
		// Proceed anyway, don't block connection on DB error?
	}

	log.Printf("Agent registered: %s (%s)", nodeID, remoteAddr)

	defer func() {
		if cur, ok := s.agents.Load(nodeID); ok {
			if cur.(*AgentSession) == session {
				s.agents.Delete(nodeID)
				log.Printf("Agent disconnected: %s", nodeID)
				return
			}
		}
		log.Printf("Agent stream ended: %s", nodeID)
	}()

	// Send Ack/Heartbeat immediately to confirm connection
	err = stream.Send(&pb.StreamPayload{
		Payload: &pb.StreamPayload_Heartbeat{
			Heartbeat: &pb.Heartbeat{
				Timestamp: time.Now().Unix(),
			},
		},
	})
	if err != nil {
		return err
	}

	for {
		in, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			log.Printf("Stream error for %s: %v", nodeID, err)
			return err
		}

		// Handle different message types
		switch payload := in.Payload.(type) {
		case *pb.StreamPayload_Result:
			// Route result to waiting goroutine
			cmdID := payload.Result.CommandId
			log.Printf("[%s] Command result: %s", nodeID, cmdID)

			if ch, ok := s.pendingCommands.Load(cmdID); ok {
				// Non-blocking send roughly
				select {
				case ch.(chan *pb.CommandResult) <- payload.Result:
				default:
					log.Printf("Warning: result channel blocked/closed for %s", cmdID)
				}
			} else {
				log.Printf("Warning: received result for unknown/expired command %s", cmdID)
			}

		case *pb.StreamPayload_Heartbeat:
			// log.Printf("[%s] Heartbeat", nodeID)
			// Keep-alive logic can go here

		default:
			log.Printf("[%s] Unknown payload type: %T", nodeID, payload)
		}
	}
}

func (s *DockletServer) Register(grpcServer *grpc.Server) {
	pb.RegisterDockletServiceServer(grpcServer, s)
}
