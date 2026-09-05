package service

import (
	"os"
	"strconv"
	"strings"
)

// dbPoolSize allows capacity tuning without rebuilding the backend. Values are
// intentionally conservative; raise them only together with MySQL max_connections.
func dbPoolSize(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" { return fallback }
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 || v > 200 { return fallback }
	return v
}
