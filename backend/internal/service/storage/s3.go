// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package storage

import (
	"context"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/agentrq/agentrq/backend/internal/service/s3"
)

// _s3Timeout bounds each call, since the Service interface carries no context.
const _s3Timeout = 30 * time.Second

type s3Service struct {
	client    s3.Service
	namespace string
}

// NewS3 stores blobs as private objects under namespace in an S3 bucket.
// An id may be a slash-separated path, as with NewNested.
func NewS3(client s3.Service, namespace string) Service {
	return &s3Service{client: client, namespace: namespace}
}

func (s *s3Service) Save(id string, dataBase64 string) error {
	data, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		return fmt.Errorf("decode base64: %w", err)
	}
	if err := validKey(id); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), _s3Timeout)
	defer cancel()
	_, err = s.client.PutPrivate(ctx, s.namespace, id, data, "application/octet-stream")
	return err
}

func (s *s3Service) Load(id string) (string, error) {
	data, err := s.LoadRaw(id)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

func (s *s3Service) LoadRaw(id string) ([]byte, error) {
	if err := validKey(id); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), _s3Timeout)
	defer cancel()
	return s.client.Get(ctx, s.namespace, id)
}

func (s *s3Service) Delete(id string) error {
	if err := validKey(id); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), _s3Timeout)
	defer cancel()
	return s.client.Delete(ctx, s.namespace, id)
}
