package cmd

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"text/tabwriter"

	"github.com/astracat/docklet/pkg/api"
	"github.com/spf13/cobra"
)

var controlPlaneURL string

func init() {
	rootCmd.PersistentFlags().StringVar(&controlPlaneURL, "url", "http://localhost:8080", "Control Plane URL")
	rootCmd.AddCommand(psCmd)
}

var psCmd = &cobra.Command{
	Use:   "ps",
	Short: "List deployed applications",
	Run: func(cmd *cobra.Command, args []string) {
		resp, err := http.Get(controlPlaneURL + "/api/state/apps")
		if err != nil {
			fmt.Printf("Error connecting to Control Plane: %v\n", err)
			os.Exit(1)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			fmt.Printf("Error: Control Plane returned %s\n", resp.Status)
			os.Exit(1)
		}

		var apps []api.App
		if err := json.NewDecoder(resp.Body).Decode(&apps); err != nil {
			fmt.Printf("Error decoding response: %v\n", err)
			os.Exit(1)
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "ID\tREVISION\tSTATUS\tUPDATED")
		for _, app := range apps {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", app.ID, app.CurrentRevision, app.Status, app.UpdatedAt.Format("2006-01-02 15:04:05"))
		}
		w.Flush()
	},
}
