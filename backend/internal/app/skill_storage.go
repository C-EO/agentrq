// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package app

import (
	"fmt"
	"strings"

	"github.com/agentrq/agentrq/backend/internal/service/config"
	"github.com/agentrq/agentrq/backend/internal/service/locksmith"
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

var (
	newS3        = s3.New
	newLocksmith = locksmith.New
)

// newSkillStorage returns local unless skills.storage asks for S3. An unknown
// value refuses to start, rather than silently writing skills to disk.
func newSkillStorage(c config.Service, local storage.Service) (storage.Service, error) {
	var cfg SkillsConfig
	if err := c.Populate("skills", &cfg); err != nil {
		return nil, err
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Storage)) {
	case "", skillStorageLocal:
		return local, nil
	case skillStorageS3:
	default:
		return nil, fmt.Errorf("unknown skills storage %q: want %q or %q", cfg.Storage, skillStorageLocal, skillStorageS3)
	}
	var ls locksmith.Service
	if locksmith.Configured(c) {
		var err error
		if ls, err = newLocksmith(locksmith.Params{Config: c}); err != nil {
			return nil, fmt.Errorf("locksmith: %w", err)
		}
	}
	client, err := newS3(s3.Params{Config: c, Locksmith: ls})
	if err != nil {
		return nil, fmt.Errorf("s3: %w", err)
	}
	return storage.NewS3(client, skillS3Namespace), nil
}
