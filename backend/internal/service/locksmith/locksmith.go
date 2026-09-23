// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package locksmith

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"math"

	"github.com/agentrq/agentrq/backend/internal/service/config"
	"github.com/pierrec/xxHash/xxHash32"
	"golang.org/x/crypto/bcrypt"
)

type (
	Params struct {
		Config config.Service
	}
	Service interface {
		Encrypt(ctx context.Context, req *EncryptRequest) (*EncryptResponse, error)
		Decrypt(ctx context.Context, req *DecryptRequest) (*DecryptResponse, error)
		GenerateRandomString64(ctx context.Context) (string, error)
		BcryptHash(ctx context.Context, req *HashRequest) (*HashResponse, error)
		CompareBcryptHashAndPassword(ctx context.Context, req *HashRequest) error
		XXHashInt32Must(payload []byte) int32
	}
	service struct {
		salt          []byte
		encryptionKey []byte
	}
	locksmithConfig struct {
		Salt          string `yaml:"salt"`
		EncryptionKey string `yaml:"encryptionKey"`
	}
	EncryptRequest struct {
		Key       []byte
		Plaintext []byte
	}
	EncryptResponse struct {
		Ciphertext []byte
		Nonce      []byte
	}
	DecryptRequest struct {
		Key        []byte
		Nonce      []byte
		Ciphertext []byte
	}
	DecryptResponse struct {
		Plaintext []byte
	}
	HashRequest struct {
		Payload []byte
		Hash    []byte
	}
	HashRequestWithSalt struct {
		Payload []byte
		Hash    []byte
		Salt    uint64
	}
	HashResponse struct {
		Output []byte
	}
)

const (
	_cfgKey               = "locksmith"
	_goldenRatio32 uint32 = 0x9e3779b1
)

// Seams for the errors the standard library never returns for these inputs.
var (
	randReader       = rand.Reader
	newGCM           = cipher.NewGCM
	generateFromPass = bcrypt.GenerateFromPassword
)

// Configured reports whether an encryption key is set, so a caller that can
// run without locksmith does not fail New for want of one.
func Configured(c config.Service) bool {
	var cfg locksmithConfig
	return c.Populate(_cfgKey, &cfg) == nil && cfg.EncryptionKey != ""
}

func New(p Params) (Service, error) {
	var cfg locksmithConfig
	if err := p.Config.Populate(_cfgKey, &cfg); err != nil {
		return nil, err
	}
	encryptionKey, err := hex.DecodeString(cfg.EncryptionKey)
	if err != nil {
		return nil, err
	}
	if len(encryptionKey) != 32 {
		return nil, errors.New("invalid encryption key size, must be 32")
	}
	return &service{
		salt:          []byte(cfg.Salt),
		encryptionKey: encryptionKey,
	}, nil
}

func (s *service) BcryptHash(ctx context.Context, req *HashRequest) (*HashResponse, error) {
	shaHash := sha256.Sum256(append(req.Payload, s.salt...))
	hash, err := generateFromPass(shaHash[:], bcrypt.MinCost)
	if err != nil {
		return nil, err
	}
	return &HashResponse{
		Output: hash[:],
	}, nil
}

func (s *service) CompareBcryptHashAndPassword(ctx context.Context, req *HashRequest) error {
	shaHash := sha256.Sum256(append(req.Payload, s.salt...))
	err := bcrypt.CompareHashAndPassword(req.Hash, shaHash[:])
	if err != nil {
		return err
	}
	return nil
}

func (s *service) GenerateRandomString64(ctx context.Context) (string, error) {
	b := make([]byte, 64)
	_, err := io.ReadFull(randReader, b)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b)[0:64], nil
}

func (s *service) Encrypt(ctx context.Context, req *EncryptRequest) (*EncryptResponse, error) {
	key := req.Key
	if key == nil {
		key = s.encryptionKey
	}
	plaintext := req.Plaintext
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aesgcm, err := newGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aesgcm.NonceSize())
	if _, err := io.ReadFull(randReader, nonce); err != nil {
		return nil, err
	}
	ciphertext := aesgcm.Seal(nil, nonce, plaintext, nil)
	return &EncryptResponse{
		Ciphertext: ciphertext,
		Nonce:      nonce,
	}, nil
}

func (s *service) Decrypt(ctx context.Context, req *DecryptRequest) (*DecryptResponse, error) {
	key := req.Key
	if key == nil {
		key = s.encryptionKey
	}
	nonce := req.Nonce
	ciphertext := req.Ciphertext
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aesgcm, err := newGCM(block)
	if err != nil {
		return nil, err
	}
	plaintext, err := aesgcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}
	return &DecryptResponse{
		Plaintext: plaintext,
	}, nil
}

func (s *service) XXHashInt32Must(payload []byte) int32 {
	sum := xxHash32.Checksum(payload, _goldenRatio32)
	if sum > math.MaxInt32 {
		return int32(sum - math.MaxInt32)
	}
	return int32(sum)
}
