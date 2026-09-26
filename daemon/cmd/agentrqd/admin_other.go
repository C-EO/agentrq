// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

//go:build !windows

package main

// isWindowsAdmin is always false off Windows, where the uid check is what
// matters.
func isWindowsAdmin() bool { return false }
