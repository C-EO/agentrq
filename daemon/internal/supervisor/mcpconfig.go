// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package supervisor

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// MCPConfigName is the file claude-code reads from its working directory.
const MCPConfigName = ".mcp.json"

// MCPServer is one entry in that file.
type MCPServer struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

// MCPEntry is a server to write, named.
//
// A slice of these rather than one name and one URL because the "supervisor"
// workspace gets a second entry — the account-wide server — alongside its own,
// and the two have to land in one file: writing them in two passes would mean
// a folder that briefly has only half of what the agent is about to read.
type MCPEntry struct {
	Name string
	URL  string
}

// MCPConfig is the file's shape.
type MCPConfig struct {
	Servers map[string]MCPServer `json:"mcpServers"`
}

// Errors from writing the agent's MCP configuration.
var (
	ErrNoMCPURL      = errors.New("supervisor: no MCP URL given")
	ErrInsecureMCP   = errors.New("supervisor: refusing to write a plaintext MCP URL")
	ErrForeignConfig = errors.New("supervisor: .mcp.json already exists and is not ours to replace")
)

// WriteMCPConfig puts the MCP endpoints the agent is to have where it will
// find them. It returns the path and the names it left alone.
//
// Usually one entry, the workspace's own. A "supervisor" workspace also gets
// the account-wide server, and the backend decides that by sending its URL.
//
// The whole credential lives inside the workspace URL as a query parameter,
// which shapes everything here:
//
//   - The file is 0600. On a machine with other users, a default-permission
//     file hands the workspace token to all of them.
//   - The URL is never logged, never put in an argv, and never returned in an
//     error. A token in a command line is visible in `ps` to every user on the
//     box, which would undo the file permission entirely.
//   - **An entry that is already there is never rewritten**, whatever it
//     points at, and its name comes back in `kept` so the daemon can say so.
//     A person's own .mcp.json is theirs, and a folder that already names
//     these servers has been set up by somebody who meant it.
//
// The cost of that rule, and it is worth knowing before changing it back: a
// relaunch into a folder that already has an entry reuses the token that entry
// carries rather than the one this launch minted. A workspace token is good
// for a year, so in practice the old one keeps working — but a workspace whose
// entry was written against a different deployment stays pointed there, and
// the way to move it is to delete the entry.
func WriteMCPConfig(dir string, entries ...MCPEntry) (path string, kept []string, err error) {
	if len(entries) == 0 {
		return "", nil, ErrNoMCPURL
	}

	path = filepath.Join(dir, MCPConfigName)
	cfg, _, err := readMCPConfig(path)
	if err != nil {
		return "", nil, err
	}

	var added int
	for _, e := range entries {
		if strings.TrimSpace(e.URL) == "" {
			return "", nil, ErrNoMCPURL
		}
		u, parseErr := url.Parse(e.URL)
		if parseErr != nil {
			// Deliberately not including the URL: it holds the token.
			return "", nil, fmt.Errorf("supervisor: MCP URL is not usable")
		}
		if u.Scheme != "https" && !isLoopbackHost(u.Hostname()) {
			// The token is in the query string, so plain HTTP puts it on the
			// wire in clear. Loopback has no wire to be on.
			return "", nil, fmt.Errorf("%w: %s is not https", ErrInsecureMCP, u.Hostname())
		}
		if checkErr := checkParam("serverName", e.Name); checkErr != nil {
			return "", nil, checkErr
		}
		if existing, ok := cfg.Servers[e.Name]; ok && existing.URL != "" {
			kept = append(kept, e.Name)
			continue
		}
		cfg.Servers[e.Name] = MCPServer{Type: "http", URL: e.URL}
		added++
	}

	// Nothing to add means nothing to write: rewriting a file to the bytes it
	// already holds still changes its timestamp, and on a folder somebody is
	// watching with a file watcher that is a change they have to explain.
	if added == 0 {
		return path, kept, nil
	}

	body, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return "", nil, fmt.Errorf("supervisor: encode %s: %w", MCPConfigName, err)
	}
	body = append(body, '\n')

	if err := writePrivate(dir, path, ".mcp-*.json", body); err != nil {
		return "", nil, err
	}
	return path, kept, nil
}

// writePrivate replaces a file with content only its owner can read.
//
// Written through a temp file in the same directory and renamed, so an
// interrupted write leaves the previous file intact rather than a truncated
// one the agent cannot parse. Created 0600 before anything is written to it,
// because both files this is used for are read by an agent on a machine that
// may have other people on it.
func writePrivate(dir, path, pattern string, body []byte) error {
	tmp, err := os.CreateTemp(dir, pattern)
	if err != nil {
		return fmt.Errorf("supervisor: create temp config: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()

	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("supervisor: chmod temp config: %w", err)
	}
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("supervisor: write temp config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("supervisor: close temp config: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("supervisor: replace %s: %w", path, err)
	}
	// Rename preserves the temp file's mode, but an existing file replaced by
	// rename keeps the new inode — so this is belt and braces for the case
	// where the umask or the platform surprises us.
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("supervisor: chmod %s: %w", path, err)
	}
	return nil
}

// HasMCPConfig reports whether a folder already has a usable entry for a
// server.
//
// Asked when a session is being restored after an update. The note that
// survives a restart deliberately carries no MCP URL — the credential is
// inside it, and writing that to disk to survive a restart would turn a
// short-lived token into a file — so a restored agent reads the config that
// was already in its folder before the update, written when it was first
// launched.
func HasMCPConfig(dir, serverName string) bool {
	cfg, existed, err := readMCPConfig(filepath.Join(dir, MCPConfigName))
	if err != nil || !existed {
		return false
	}
	entry, ok := cfg.Servers[serverName]
	return ok && entry.URL != ""
}

// readMCPConfig loads an existing config, or an empty one.
//
// A file that exists but cannot be parsed is an error rather than something to
// overwrite: it is somebody's configuration and it is not ours to discard
// because we could not read it.
func readMCPConfig(path string) (MCPConfig, bool, error) {
	cfg := MCPConfig{Servers: map[string]MCPServer{}}

	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return cfg, false, nil
	}
	if err != nil {
		return cfg, false, fmt.Errorf("supervisor: read %s: %w", path, err)
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, true, fmt.Errorf("%w: %s is not valid JSON", ErrForeignConfig, path)
	}
	if cfg.Servers == nil {
		cfg.Servers = map[string]MCPServer{}
	}
	return cfg, true, nil
}

func isLoopbackHost(host string) bool {
	switch strings.ToLower(host) {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return strings.HasPrefix(host, "127.")
}
