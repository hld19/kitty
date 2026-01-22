//go:build windows

package downloader

import "os/exec"

func configureCmd(cmd *exec.Cmd) {
}

func killProcessTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}
