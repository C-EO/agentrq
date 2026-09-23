// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package locksmith

import (
	"context"
	"crypto/cipher"
	"errors"
	"math"
	"strings"
	"testing"

	configmocks "github.com/agentrq/agentrq/backend/internal/service/mocks/config"
	"github.com/golang/mock/gomock"
	"github.com/pierrec/xxHash/xxHash32"
	"github.com/stretchr/testify/assert"
)

const testKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

// withConfig answers a locksmith Populate with cfg.
func withConfig(m *configmocks.MockService, cfg locksmithConfig, err error) {
	m.EXPECT().Populate("locksmith", gomock.Any()).DoAndReturn(func(_ string, out any) error {
		*out.(*locksmithConfig) = cfg
		return err
	})
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("no entropy") }

func newTestService(t *testing.T) Service {
	t.Helper()
	ctrl := gomock.NewController(t)
	cfg := configmocks.NewMockService(ctrl)
	withConfig(cfg, locksmithConfig{Salt: "pepper", EncryptionKey: testKey}, nil)
	s, err := New(Params{Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNew(t *testing.T) {
	ctrl := gomock.NewController(t)
	cfg := configmocks.NewMockService(ctrl)

	withConfig(cfg, locksmithConfig{}, errors.New("config error"))
	_, err := New(Params{Config: cfg})
	assert.EqualError(t, err, "config error")

	withConfig(cfg, locksmithConfig{EncryptionKey: "not-hex"}, nil)
	_, err = New(Params{Config: cfg})
	assert.Error(t, err)

	withConfig(cfg, locksmithConfig{EncryptionKey: "0011"}, nil)
	_, err = New(Params{Config: cfg})
	assert.EqualError(t, err, "invalid encryption key size, must be 32")

	withConfig(cfg, locksmithConfig{EncryptionKey: testKey}, nil)
	s, err := New(Params{Config: cfg})
	assert.NoError(t, err)
	assert.NotNil(t, s)
}

func TestConfigured(t *testing.T) {
	ctrl := gomock.NewController(t)
	cfg := configmocks.NewMockService(ctrl)

	withConfig(cfg, locksmithConfig{EncryptionKey: testKey}, nil)
	assert.True(t, Configured(cfg))

	withConfig(cfg, locksmithConfig{}, nil)
	assert.False(t, Configured(cfg))

	withConfig(cfg, locksmithConfig{EncryptionKey: testKey}, errors.New("config error"))
	assert.False(t, Configured(cfg))
}

func TestEncryptDecrypt(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()

	enc, err := s.Encrypt(ctx, &EncryptRequest{Plaintext: []byte("secret")})
	assert.NoError(t, err)
	assert.NotEqual(t, []byte("secret"), enc.Ciphertext)

	dec, err := s.Decrypt(ctx, &DecryptRequest{Nonce: enc.Nonce, Ciphertext: enc.Ciphertext})
	assert.NoError(t, err)
	assert.Equal(t, []byte("secret"), dec.Plaintext)

	// An explicit key round-trips too, and the default key cannot open it.
	key := []byte(strings.Repeat("k", 16))
	enc, err = s.Encrypt(ctx, &EncryptRequest{Key: key, Plaintext: []byte("other")})
	assert.NoError(t, err)
	dec, err = s.Decrypt(ctx, &DecryptRequest{Key: key, Nonce: enc.Nonce, Ciphertext: enc.Ciphertext})
	assert.NoError(t, err)
	assert.Equal(t, []byte("other"), dec.Plaintext)
	_, err = s.Decrypt(ctx, &DecryptRequest{Nonce: enc.Nonce, Ciphertext: enc.Ciphertext})
	assert.Error(t, err)

	_, err = s.Encrypt(ctx, &EncryptRequest{Key: []byte("short"), Plaintext: []byte("x")})
	assert.Error(t, err)
	_, err = s.Decrypt(ctx, &DecryptRequest{Key: []byte("short")})
	assert.Error(t, err)
}

func TestRandomFailures(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	old := randReader
	randReader = failingReader{}
	defer func() { randReader = old }()

	_, err := s.Encrypt(ctx, &EncryptRequest{Plaintext: []byte("x")})
	assert.Error(t, err)
	_, err = s.GenerateRandomString64(ctx)
	assert.Error(t, err)
}

func TestLibraryFailures(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	oldGCM, oldGen := newGCM, generateFromPass
	defer func() { newGCM, generateFromPass = oldGCM, oldGen }()
	newGCM = func(cipher.Block) (cipher.AEAD, error) { return nil, errors.New("gcm") }
	generateFromPass = func([]byte, int) ([]byte, error) { return nil, errors.New("bcrypt") }

	_, err := s.Encrypt(ctx, &EncryptRequest{Plaintext: []byte("x")})
	assert.EqualError(t, err, "gcm")
	_, err = s.Decrypt(ctx, &DecryptRequest{})
	assert.EqualError(t, err, "gcm")
	_, err = s.BcryptHash(ctx, &HashRequest{Payload: []byte("x")})
	assert.EqualError(t, err, "bcrypt")
}

func TestGenerateRandomString64(t *testing.T) {
	s := newTestService(t)
	a, err := s.GenerateRandomString64(context.Background())
	assert.NoError(t, err)
	assert.Len(t, a, 64)
	b, _ := s.GenerateRandomString64(context.Background())
	assert.NotEqual(t, a, b)
}

func TestBcrypt(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()

	h, err := s.BcryptHash(ctx, &HashRequest{Payload: []byte("password")})
	assert.NoError(t, err)
	assert.NoError(t, s.CompareBcryptHashAndPassword(ctx, &HashRequest{Payload: []byte("password"), Hash: h.Output}))
	assert.Error(t, s.CompareBcryptHashAndPassword(ctx, &HashRequest{Payload: []byte("wrong"), Hash: h.Output}))
}

func TestXXHashInt32Must(t *testing.T) {
	s := newTestService(t)
	assert.Equal(t, s.XXHashInt32Must([]byte("a")), s.XXHashInt32Must([]byte("a")))
	// Search for inputs on both sides of MaxInt32, so both branches run.
	var low, high bool
	for i := 0; i < 1000 && !(low && high); i++ {
		v := s.(*service)
		p := []byte{byte(i), byte(i >> 8)}
		sum := v.XXHashInt32Must(p)
		assert.GreaterOrEqual(t, sum, int32(0))
		assert.LessOrEqual(t, sum, int32(math.MaxInt32))
		if xxHash32.Checksum(p, _goldenRatio32) > math.MaxInt32 {
			high = true
		} else {
			low = true
		}
	}
	assert.True(t, low && high)
}
