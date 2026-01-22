package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "docklet",
	Short: "Docklet is a Docker-first orchestrator",
	Long:  `A lightweight, Docker-native orchestrator for SMB and Edge environments.`,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
