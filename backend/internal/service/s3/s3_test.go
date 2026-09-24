// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

package s3

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"

	configmocks "github.com/agentrq/agentrq/backend/internal/service/mocks/config"
	mocks "github.com/agentrq/agentrq/backend/internal/service/mocks/s3"
	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
)

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("read error") }

func TestS3(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockS3 := mocks.NewMockS3API(ctrl)
	mockPresign := mocks.NewMockS3PresignAPI(ctrl)
	mockConfig := configmocks.NewMockService(ctrl)
	s := &service{
		client:          mockS3,
		presigner:       mockPresign,
		bucket:          "test-bucket",
		publicBucketURL: "https://public.cdn.com",
	}

	t.Run("GetPublicURL", func(t *testing.T) {
		t.Run("With-PublicBucketURL", func(t *testing.T) {
			url, err := s.GetPublicURL(context.Background(), "ns", "key")
			assert.NoError(t, err)
			assert.Equal(t, "https://public.cdn.com/ns/key", url)
		})

		t.Run("With-Presigning", func(t *testing.T) {
			sNoPublic := &service{
				client:          mockS3,
				presigner:       mockPresign,
				bucket:          "test-bucket",
				publicBucketURL: "",
			}
			mockPresign.EXPECT().PresignGetObject(gomock.Any(), gomock.Any(), gomock.Any()).Return(&v4.PresignedHTTPRequest{
				URL: "https://presigned.url",
			}, nil)

			url, err := sNoPublic.GetPublicURL(context.Background(), "ns", "key")
			assert.NoError(t, err)
			assert.Equal(t, "https://presigned.url", url)
		})

		t.Run("Presigning-Error", func(t *testing.T) {
			sNoPublic := &service{
				client:          mockS3,
				presigner:       mockPresign,
				bucket:          "test-bucket",
				publicBucketURL: "",
			}
			mockPresign.EXPECT().PresignGetObject(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, errors.New("presign error"))

			_, err := sNoPublic.GetPublicURL(context.Background(), "ns", "key")
			assert.Error(t, err)
		})
	})

	t.Run("CreateNamespace", func(t *testing.T) {
		mockS3.EXPECT().CreateBucket(gomock.Any(), gomock.Any()).Return(&awss3.CreateBucketOutput{}, nil)
		err := s.CreateNamespace(context.Background(), "ns")
		assert.NoError(t, err)

		mockS3.EXPECT().CreateBucket(gomock.Any(), gomock.Any()).Return(nil, errors.New("s3 error"))
		err = s.CreateNamespace(context.Background(), "ns")
		assert.Error(t, err)
	})

	t.Run("Put", func(t *testing.T) {
		mockS3.EXPECT().PutObject(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, in *awss3.PutObjectInput, _ ...func(*awss3.Options)) (*awss3.PutObjectOutput, error) {
			assert.Equal(t, "ns/key", *in.Key)
			assert.Equal(t, types.ObjectCannedACLPublicRead, in.ACL)
			return &awss3.PutObjectOutput{ETag: aws.String("etag-123")}, nil
		})
		etag, err := s.Put(context.Background(), "ns", "key", []byte("data"), "text/plain")
		assert.NoError(t, err)
		assert.Equal(t, "etag-123", etag)

		// nil ETag case
		mockS3.EXPECT().PutObject(gomock.Any(), gomock.Any()).Return(&awss3.PutObjectOutput{
			ETag: nil,
		}, nil)
		etag, err = s.Put(context.Background(), "ns", "key", []byte("data"), "text/plain")
		assert.NoError(t, err)
		assert.Equal(t, "", etag)

		mockS3.EXPECT().PutObject(gomock.Any(), gomock.Any()).Return(nil, errors.New("s3 error"))
		_, err = s.Put(context.Background(), "ns", "key", []byte("data"), "text/plain")
		assert.Error(t, err)
	})

	t.Run("PutPrivate", func(t *testing.T) {
		mockS3.EXPECT().PutObject(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, in *awss3.PutObjectInput, _ ...func(*awss3.Options)) (*awss3.PutObjectOutput, error) {
			assert.Equal(t, "ns/key", *in.Key)
			// A private object carries no ACL, so the bucket's own policy applies.
			assert.Empty(t, in.ACL)
			return &awss3.PutObjectOutput{ETag: aws.String("etag-456")}, nil
		})
		etag, err := s.PutPrivate(context.Background(), "ns", "key", []byte("data"), "text/plain")
		assert.NoError(t, err)
		assert.Equal(t, "etag-456", etag)

		// nil ETag case
		mockS3.EXPECT().PutObject(gomock.Any(), gomock.Any()).Return(&awss3.PutObjectOutput{
			ETag: nil,
		}, nil)
		etag, err = s.PutPrivate(context.Background(), "ns", "key", []byte("data"), "text/plain")
		assert.NoError(t, err)
		assert.Equal(t, "", etag)

		mockS3.EXPECT().PutObject(gomock.Any(), gomock.Any()).Return(nil, errors.New("s3 error"))
		_, err = s.PutPrivate(context.Background(), "ns", "key", []byte("data"), "text/plain")
		assert.Error(t, err)
	})

	t.Run("Get", func(t *testing.T) {
		mockS3.EXPECT().GetObject(gomock.Any(), gomock.Any()).Return(&awss3.GetObjectOutput{
			Body: io.NopCloser(bytes.NewReader([]byte("test-data"))),
		}, nil)
		data, err := s.Get(context.Background(), "ns", "key")
		assert.NoError(t, err)
		assert.Equal(t, []byte("test-data"), data)

		mockS3.EXPECT().GetObject(gomock.Any(), gomock.Any()).Return(nil, errors.New("s3 error"))
		_, err = s.Get(context.Background(), "ns", "key")
		assert.Error(t, err)

		// A body that fails part way is an error, not a short file.
		mockS3.EXPECT().GetObject(gomock.Any(), gomock.Any()).Return(&awss3.GetObjectOutput{
			Body: io.NopCloser(failingReader{}),
		}, nil)
		_, err = s.Get(context.Background(), "ns", "key")
		assert.Error(t, err)
	})

	t.Run("Delete", func(t *testing.T) {
		mockS3.EXPECT().DeleteObject(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, in *awss3.DeleteObjectInput, _ ...func(*awss3.Options)) (*awss3.DeleteObjectOutput, error) {
			assert.Equal(t, "test-bucket", *in.Bucket)
			assert.Equal(t, "ns/key", *in.Key)
			return &awss3.DeleteObjectOutput{}, nil
		})
		assert.NoError(t, s.Delete(context.Background(), "ns", "key"))

		mockS3.EXPECT().DeleteObject(gomock.Any(), gomock.Any()).Return(nil, errors.New("s3 error"))
		assert.Error(t, s.Delete(context.Background(), "ns", "key"))
	})

	t.Run("New", func(t *testing.T) {
		mockConfig.EXPECT().Populate("s3", gomock.Any()).Return(nil)
		svc, err := New(Params{Config: mockConfig})
		assert.NoError(t, err)
		assert.NotNil(t, svc)

		mockConfig.EXPECT().Populate("s3", gomock.Any()).Return(errors.New("config error"))
		_, err = New(Params{Config: mockConfig})
		assert.Error(t, err)

		// AWS Config error
		mockConfig.EXPECT().Populate("s3", gomock.Any()).Return(nil)
		oldLoader := loadAWSConfig
		loadAWSConfig = func(ctx context.Context, optFns ...func(*awsconfig.LoadOptions) error) (aws.Config, error) {
			return aws.Config{}, errors.New("aws config error")
		}
		defer func() { loadAWSConfig = oldLoader }()

		_, err = New(Params{Config: mockConfig})
		assert.Error(t, err)
	})

	t.Run("NewCredentialsProvider", func(t *testing.T) {
		fn := newCredentialsProvider("ak", "sk")
		creds, err := fn(context.Background())
		assert.NoError(t, err)
		assert.Equal(t, "ak", creds.AccessKeyID)
		assert.Equal(t, "sk", creds.SecretAccessKey)
	})
}
