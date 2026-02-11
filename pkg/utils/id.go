package utils

import (
	"os"
	"strings"

	"github.com/google/uuid"
)

// GetOrGenerateID reads an ID from the specified file path.
// If the file does not exist, it generates a new UUID, saves it to the file, and returns it.
func GetOrGenerateID(filePath string) (string, error) {
	// 1. Try to read existing ID
	content, err := os.ReadFile(filePath)
	if err == nil {
		id := strings.TrimSpace(string(content))
		if id != "" {
			return id, nil
		}
	}

	// 2. Generate new ID if read failed logic
	newID := uuid.New().String()

	// 3. Save to file
	err = os.WriteFile(filePath, []byte(newID), 0600)
	if err != nil {
		return "", err
	}

	return newID, nil
}
