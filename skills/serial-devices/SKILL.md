---
name: serial-devices
description: Use explicit serial profiles to read or run shell commands on a local or SSH-hosted serial console through picocom; credentials stay in OS secure storage.
---

# Serial Devices

`serial_list_profiles` 列出已配置设备；`serial_resolve_profile` 按显式 id 查询。`serial_exec` 和 `serial_read` 必须传 `profile`，不要猜测端口或登录信息。

profile 存放在 `~/.pi/agent/serial-devices/profiles.json`。local profile 在本机启动 picocom PTY；remote profile 用 `remote-devices` 清单中的设备 id，经其 SSH host/port/key 启动远端 picocom。串口所在主机需预装 picocom，且 SSH 用户须有串口读写权限。不使用 tmux。

串口登录用户名来自 profile，密码用 `serial_set_credential` 存到本机 OS secure storage，不存入 profile、命令参数或日志。没有凭据时先用 `serial_read` 查看状态；不要猜密码。`serial_read` 未确认 shell 时只返回状态，不发送命令。

`serial_exec` 只在确认 shell 后执行命令；超时、断线或取消后不自动重放命令。对 reboot、删除等破坏性命令，仅在用户明确授权时设置 `allowDangerous=true`。

WSL2 上 USB 串口若未出现 `/dev/ttyUSB*` 或 `/dev/serial/by-id/*`，需先在 Windows 侧执行 `usbipd attach --wsl --busid <BUSID>`。重启或重插 USB 后可能需要重新 attach。
