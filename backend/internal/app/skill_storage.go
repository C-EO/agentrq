// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package app

import (
	"fmt"
	"strings"

	"github.com/agentrq/agentrq/backend/internal/service/cleanup"
	"github.com/agentrq/agentrq/backend/internal/service/config"
	"github.com/agentrq/agentrq/backend/internal/service/s3"
	"github.com/agentrq/agentrq/backend/internal/service/storage"
)

const (
	skillStorageLocal = "local"
	skillStorageS3    = "s3"
	// skillS3Namespace is the key prefix skill blobs get in the bucket.
	skillS3Namespace = "skills"
)

// SkillsConfig chooses where skill file content is kept.
type SkillsConfig struct {
	Storage string `yaml:"storage"`
}

var newS3 = s3.New

// defaultStorageDir is where files go when storage.dir is not set.
const defaultStorageDir = "./_storage"

// storageDir is the configured storage.dir, or the default when it is unset.
func storageDir(c cleanup.Config) string {
	if dir := strings.TrimSpace(c.StorageDir); dir != "" {
		return dir
	}
	return defaultStorageDir
}

// newSkillStorage stores skills under localDir unless skills.storage asks for
// S3. An unknown value refuses to start, rather than silently writing skills
// to disk.
func newSkillStorage(c config.Service, localDir string) (storage.Service, error) {
	var cfg SkillsConfig
	if err := c.Populate("skills", &cfg); err != nil {
		return nil, err
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Storage)) {
	case "", skillStorageLocal:
		return storage.NewNested(localDir)
	case skillStorageS3:
	default:
		return nil, fmt.Errorf("unknown skills storage %q: want %q or %q", cfg.Storage, skillStorageLocal, skillStorageS3)
	}
	client, err := newS3(s3.Params{Config: c})
	if err != nil {
		return nil, fmt.Errorf("s3: %w", err)
	}
	return storage.NewS3(client, skillS3Namespace), nil
}
