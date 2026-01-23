package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	pb "github.com/astracat/docklet/api/proto/v1"
	"github.com/spf13/cobra"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

var (
	hubAddr      string
	targetNodeID string
)

var rootCmd = &cobra.Command{
	Use:   "docklet",
	Short: "Docklet CLI",
	Long:  `Docklet CLI for managing the decentralized Docker infrastructure.`,
}

var nodesCmd = &cobra.Command{
	Use:   "nodes",
	Short: "Manage nodes",
}

func getDialOptions() []grpc.DialOption {
	caCert := "certs/ca-cert.pem"
	clientCert := "certs/client-cert.pem"
	clientKey := "certs/client-key.pem"

	if _, err := os.Stat(caCert); os.IsNotExist(err) {
		// Fallback to insecure if no certs
		return []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}
	}

	// Load existing CA
	pemServerCA, err := os.ReadFile(caCert)
	if err != nil {
		fmt.Printf("Initial error reading CA: %v\n", err)
		return []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}
	}

	certPool := x509.NewCertPool()
	if !certPool.AppendCertsFromPEM(pemServerCA) {
		fmt.Println("failed to add CA")
		return []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}
	}

	// Load client's cert and private key
	cert, err := tls.LoadX509KeyPair(clientCert, clientKey)
	if err != nil {
		fmt.Printf("Initial error reading Client KeyPair: %v\n", err)
		return []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}
	}

	config := &tls.Config{
		Certificates: []tls.Certificate{cert},
		RootCAs:      certPool,
	}

	return []grpc.DialOption{grpc.WithTransportCredentials(credentials.NewTLS(config))}
}

var nodesLsCmd = &cobra.Command{
	Use:   "ls",
	Short: "List connected nodes",
	Run: func(cmd *cobra.Command, args []string) {
		opts := getDialOptions()
		conn, err := grpc.NewClient(hubAddr, opts...)
		if err != nil {
			fmt.Printf("Error connecting to hub: %v\n", err)
			os.Exit(1)
		}
		defer conn.Close()

		client := pb.NewDockletServiceClient(conn)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		resp, err := client.ListNodes(ctx, &pb.ListNodesRequest{})
		if err != nil {
			fmt.Printf("Error listing nodes: %v\n", err)
			os.Exit(1)
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, "NODE ID\tMACHINE ID\tVERSION\tADDRESS\tSTATUS")
		for _, node := range resp.Nodes {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", node.NodeId, node.MachineId, node.Version, node.RemoteAddr, node.Status)
		}
		w.Flush()
	},
}

var psCmd = &cobra.Command{
	Use:   "ps",
	Short: "List containers on a node",
	Run: func(cmd *cobra.Command, args []string) {
		if targetNodeID == "" {
			fmt.Println("Error: --node flag is required")
			os.Exit(1)
		}

		opts := getDialOptions()
		conn, err := grpc.NewClient(hubAddr, opts...)
		if err != nil {
			fmt.Printf("Error connecting to hub: %v\n", err)
			os.Exit(1)
		}
		defer conn.Close()

		client := pb.NewDockletServiceClient(conn)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second) // Longer timeout for docker ops
		defer cancel()

		resp, err := client.ExecuteCommand(ctx, &pb.ExecuteCommandRequest{
			NodeId:  targetNodeID,
			Command: "docker_ps",
		})
		if err != nil {
			fmt.Printf("Error executing command: %v\n", err)
			os.Exit(1)
		}

		if resp.ExitCode != 0 {
			fmt.Printf("Command failed (Exit Code %d): %s\n%s\n", resp.ExitCode, resp.Error, string(resp.Output))
			os.Exit(1)
		}

		fmt.Println(string(resp.Output))
	},
}

var runCmd = &cobra.Command{
	Use:   "run [image]",
	Short: "Run a container on a node",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		if targetNodeID == "" {
			fmt.Println("Error: --node flag is required")
			os.Exit(1)
		}

		imageName := args[0]

		opts := getDialOptions()
		conn, err := grpc.NewClient(hubAddr, opts...)
		if err != nil {
			fmt.Printf("Error connecting to hub: %v\n", err)
			os.Exit(1)
		}
		defer conn.Close()

		client := pb.NewDockletServiceClient(conn)
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second) // Long timeout for pull
		defer cancel()

		fmt.Printf("Requesting node %s to pull and run %s...\n", targetNodeID, imageName)

		resp, err := client.ExecuteCommand(ctx, &pb.ExecuteCommandRequest{
			NodeId:  targetNodeID,
			Command: "docker_run",
			Args:    []string{imageName},
		})
		if err != nil {
			fmt.Printf("Error executing command: %v\n", err)
			os.Exit(1)
		}

		if resp.ExitCode != 0 {
			fmt.Printf("Command failed (Exit Code %d): %s\n", resp.ExitCode, resp.Error)
			os.Exit(1)
		}

		containerID := string(resp.Output)
		fmt.Printf("Container started successfully! ID: %s\n", containerID)
	},
}

func init() {
	rootCmd.PersistentFlags().StringVar(&hubAddr, "hub", "localhost:50051", "Docklet Hub address")
	rootCmd.AddCommand(nodesCmd)
	nodesCmd.AddCommand(nodesLsCmd)

	rootCmd.AddCommand(psCmd)
	psCmd.Flags().StringVar(&targetNodeID, "node", "", "Target Node ID")

	rootCmd.AddCommand(runCmd)
	runCmd.Flags().StringVar(&targetNodeID, "node", "", "Target Node ID")
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func main() {
	Execute()
}
