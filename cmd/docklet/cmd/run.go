package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/spf13/cobra"
)

func init() {
	rootCmd.AddCommand(runCmd)
}

var runCmd = &cobra.Command{
	Use:   "run [image]",
	Short: "Run a new application",
	Args:  cobra.ExactArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		image := args[0]
		fmt.Printf("Deploying %s...\n", image)

		reqBody, _ := json.Marshal(map[string]string{
			"image": image,
		})

		resp, err := http.Post(controlPlaneURL+"/api/deploy", "application/json", bytes.NewBuffer(reqBody))
		if err != nil {
			fmt.Printf("Error connecting to Control Plane: %v\n", err)
			os.Exit(1)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusCreated {
			fmt.Printf("Error: Control Plane returned %s\n", resp.Status)
			os.Exit(1)
		}

		var result map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&result)
		fmt.Printf("App deployed successfully. ID: %s\n", result["id"])
	},
}
