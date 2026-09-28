// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

//go:build unix

package supervisor

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// These need Unix permissions, symlinks a user can make, or a FIFO.

func TestAWorktreeThatGitRefusesSaysWhy(t *testing.T) {
	root := t.TempDir()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	if out, err := runGit(root, "init", "-q"); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	// No commit, so there is no HEAD to check out.
	_, _, err := PrepareForkDir(t.TempDir(), root, forkID)
	if err == nil || !strings.Contains(err.Error(), "git worktree add") {
		t.Fatalf("err = %v, want git's own reason", err)
	}

	// A leftover branch whose folder cannot be made fails the retry too.
	root = gitRepo(t, map[string]string{"a": "1"})
	if out, err := runGit(root, "branch", ForkBranch(forkID)); err != nil {
		t.Fatal(out)
	}
	home := t.TempDir()
	forks := filepath.Join(home, ".agentrq", "forks")
	if err := os.MkdirAll(forks, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(forks, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(forks, 0o700) })
	_, _, err = PrepareForkDir(home, root, forkID)
	if err == nil || !strings.Contains(err.Error(), "git worktree add") {
		t.Fatalf("err = %v, want git's own reason", err)
	}
}

func TestACopyKeepsModesAndSymlinks(t *testing.T) {
	from := t.TempDir()
	writeFile(t, filepath.Join(from, "src", "main.go"), "package main\n")
	writeFile(t, filepath.Join(from, "bin", "run"), "#!/bin/sh\n")
	if err := os.Chmod(filepath.Join(from, "bin", "run"), 0o775); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("src/main.go", filepath.Join(from, "link")); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(filepath.Join(from, "pipe"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(from, "src"), 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(filepath.Join(from, "src"), 0o755) })

	dir, _, err := PrepareForkDir(t.TempDir(), from, forkID)
	if err != nil {
		t.Fatalf("PrepareForkDir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(filepath.Join(dir, "src"), 0o755) })
	if info, err := os.Stat(filepath.Join(dir, "bin", "run")); err != nil || info.Mode().Perm() != 0o775 {
		t.Errorf("file mode = %v (%v), want 0775 whatever the umask", info.Mode(), err)
	}
	if info, err := os.Stat(filepath.Join(dir, "src")); err != nil || info.Mode().Perm() != 0o555 {
		t.Errorf("folder mode = %v (%v), want 0555", info.Mode(), err)
	}
	if link, err := os.Readlink(filepath.Join(dir, "link")); err != nil || link != "src/main.go" {
		t.Errorf("symlink = %q (%v), want it copied as a link", link, err)
	}
	if _, err := os.Lstat(filepath.Join(dir, "pipe")); !errors.Is(err, os.ErrNotExist) {
		t.Error("a FIFO was copied")
	}
}

// A folder named through a symlink is copied, not copied as a link.
func TestAForkFromASymlinkedFolderCopiesItsContent(t *testing.T) {
	real := t.TempDir()
	writeFile(t, filepath.Join(real, "a"), "1")
	from := filepath.Join(t.TempDir(), "via")
	if err := os.Symlink(real, from); err != nil {
		t.Fatal(err)
	}
	dir, _, err := PrepareForkDir(t.TempDir(), from, forkID)
	if err != nil {
		t.Fatalf("PrepareForkDir: %v", err)
	}
	if readFile(t, filepath.Join(dir, "a")) != "1" {
		t.Error("the content behind the symlink was not copied")
	}
}

func TestACopyThatFailsLeavesNothingToReuse(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root is not stopped by a permission bit")
	}
	for _, name := range []string{"secret", "private"} {
		t.Run(name, func(t *testing.T) {
			from := t.TempDir()
			writeFile(t, filepath.Join(from, "secret"), "x")
			writeFile(t, filepath.Join(from, "private", "f"), "x")
			if err := os.Chmod(filepath.Join(from, name), 0); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.Chmod(filepath.Join(from, name), 0o700) })
			home := t.TempDir()
			if _, _, err := PrepareForkDir(home, from, forkID); err == nil {
				t.Fatal("an unreadable " + name + " was copied")
			}
			entries, _ := os.ReadDir(filepath.Join(home, ".agentrq", "forks"))
			if len(entries) != 0 {
				t.Errorf("a failed copy left %d entries behind", len(entries))
			}
		})
	}
}

func TestAForkWithNowhereToGoIsRefused(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root is not stopped by a permission bit")
	}
	home := t.TempDir()
	forks := filepath.Join(home, ".agentrq", "forks")
	if err := os.MkdirAll(forks, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(forks, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(forks, 0o700) })
	if _, _, err := PrepareForkDir(home, t.TempDir(), forkID); err == nil {
		t.Fatal("a copy was made in a folder that cannot be written")
	}

	home = t.TempDir()
	if err := os.Chmod(home, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(home, 0o700) })
	if _, _, err := PrepareForkDir(home, t.TempDir(), forkID); err == nil {
		t.Fatal("a forks folder was made where nothing can be written")
	}
}

func TestAForkThatExistsButCannotBeReadIsRefused(t *testing.T) {
	home := t.TempDir()
	forks := filepath.Join(home, ".agentrq", "forks")
	if err := os.MkdirAll(forks, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(forks, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(forks, 0o700) })
	if _, err := os.ReadDir(forks); err == nil {
		t.Skip("running as a user who can read anything")
	}
	if _, _, err := PrepareForkDir(home, t.TempDir(), forkID); err == nil {
		t.Fatal("a fork folder that cannot be looked at was taken as missing")
	}
}

// The daemon's folder is recognised however its path is spelled. On macOS the
// temp dir is under /var, which is really /private/var, and a string compare
// copied the staging folder into itself until the name was too long.
func TestTheForksFolderIsLeftOutWhenNamedThroughASymlink(t *testing.T) {
	real := t.TempDir()
	via := filepath.Join(t.TempDir(), "via")
	if err := os.Symlink(real, via); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(real, "keep"), "k")
	home := filepath.Join(via, "users", "me")
	dir, _, err := PrepareForkDir(home, via, forkID)
	if err != nil {
		t.Fatalf("PrepareForkDir: %v", err)
	}
	if readFile(t, filepath.Join(dir, "keep")) != "k" {
		t.Error("keep was not copied")
	}
	if _, err := os.Stat(filepath.Join(dir, "users", "me", ".agentrq")); !errors.Is(err, os.ErrNotExist) {
		t.Error("the daemon's own folder was copied into a fork")
	}
}
