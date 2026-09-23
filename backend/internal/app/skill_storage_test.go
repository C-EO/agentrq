// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package app

import (
	"errors"
	"strings"
	"testing"

	"github.com/agentrq/agentrq/backend/internal/service/locksmith"
	"github.com/agentrq/agentrq/backend/internal/service/s3"
	"github.com/agentrq/agentrq/backend/internal/service/storage"
	"gopkg.in/yaml.v3"
)

// yamlConfig answers Populate from a yaml document, the way the real config
// service does, so the test exercises the keys base.yaml actually uses.
type yamlConfig struct {
	sections map[string]any
}

func newYAMLConfig(t *testing.T, doc string) *yamlConfig {
	t.Helper()
	c := &yamlConfig{}
	if err := yaml.Unmarshal([]byte(doc), &c.sections); err != nil {
		t.Fatal(err)
	}
	return c
}

func (c *yamlConfig) Populate(key string, out any) error {
	v, ok := c.sections[key]
	if !ok {
		return nil
	}
	b, _ := yaml.Marshal(v)
	return yaml.Unmarshal(b, out)
}
func (c *yamlConfig) Env() string          { return "test" }
func (c *yamlConfig) App() string          { return "AgentRQ" }
func (c *yamlConfig) AppShortName() string { return "agentrq" }
func (c *yamlConfig) Version() string      { return "v0" }

type fakeS3 struct{ s3.Service }

func TestNewSkillStorage(t *testing.T) {
	local, err := storage.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

	t.Run("DefaultsToLocal", func(t *testing.T) {
		for _, doc := range []string{"{}", "skills: {storage: local}", "skills: {storage: ' LOCAL '}"} {
			got, err := newSkillStorage(newYAMLConfig(t, doc), local)
			if err != nil || got != local {
				t.Errorf("%s: got %v, %v", doc, got, err)
			}
		}
	})

	t.Run("UnknownRefusesToStart", func(t *testing.T) {
		_, err := newSkillStorage(newYAMLConfig(t, "skills: {storage: gcs}"), local)
		if err == nil || !strings.Contains(err.Error(), `"gcs"`) {
			t.Errorf("got %v", err)
		}
	})

	t.Run("BadConfig", func(t *testing.T) {
		if _, err := newSkillStorage(newYAMLConfig(t, "skills: [1]"), local); err == nil {
			t.Error("want error")
		}
	})

	t.Run("S3", func(t *testing.T) {
		c := newYAMLConfig(t, "skills: {storage: s3}\ns3: {endpoint: 'http://127.0.0.1:9', region: us-east-1, bucket: b}")
		got, err := newSkillStorage(c, local)
		if err != nil || got == local || got == nil {
			t.Fatalf("got %v, %v", got, err)
		}
	})

	t.Run("S3PassesLocksmithOnlyWhenKeyed", func(t *testing.T) {
		old := newS3
		defer func() { newS3 = old }()
		var seen []locksmith.Service
		newS3 = func(p s3.Params) (s3.Service, error) {
			seen = append(seen, p.Locksmith)
			return fakeS3{}, nil
		}
		if _, err := newSkillStorage(newYAMLConfig(t, "skills: {storage: s3}"), local); err != nil {
			t.Fatal(err)
		}
		if _, err := newSkillStorage(newYAMLConfig(t, "skills: {storage: s3}\nlocksmith: {encryptionKey: "+key+"}"), local); err != nil {
			t.Fatal(err)
		}
		if len(seen) != 2 || seen[0] != nil || seen[1] == nil {
			t.Errorf("locksmith handed to s3: %v", seen)
		}
	})

	t.Run("S3Errors", func(t *testing.T) {
		_, err := newSkillStorage(newYAMLConfig(t, "skills: {storage: s3}\nlocksmith: {encryptionKey: abcd}"), local)
		if err == nil || !strings.HasPrefix(err.Error(), "locksmith:") {
			t.Errorf("bad key: %v", err)
		}

		old := newS3
		defer func() { newS3 = old }()
		newS3 = func(s3.Params) (s3.Service, error) { return nil, errors.New("no creds") }
		_, err = newSkillStorage(newYAMLConfig(t, "skills: {storage: s3}"), local)
		if err == nil || err.Error() != "s3: no creds" {
			t.Errorf("s3 failure: %v", err)
		}
	})
}
