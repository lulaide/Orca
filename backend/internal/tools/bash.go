package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"

	"github.com/cloudwego/eino/schema"
)

// RegisterBashTool 注册受限 Bash 工具（仅 Chat Agent 使用）。
func RegisterBashTool(reg *Registry) {
	reg.Register(runCommandInfo(), handleRunCommand)
}

func runCommandInfo() *schema.ToolInfo {
	return &schema.ToolInfo{
		Name: "run_command",
		Desc: `执行 shell 命令。所有命令都需要用户确认后才执行。
内置 K8s 工具无法满足需求时才使用此工具。
耗时操作务必设置合适的 timeout 参数。`,
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"command": {
				Type:     schema.String,
				Desc:     "要执行的命令",
				Required: true,
			},
			"timeout": {
				Type:     schema.Integer,
				Desc:     "超时秒数（默认 30，最大 120）。耗时操作需设置合适的超时",
				Required: false,
			},
		}),
	}
}

func handleRunCommand(ctx context.Context, args string) (string, error) {
	var p struct {
		Command string `json:"command"`
		Timeout int    `json:"timeout"`
	}
	if err := json.Unmarshal([]byte(args), &p); err != nil {
		return "", err
	}

	if p.Command == "" {
		return "ERROR: command is required", nil
	}

	// 超时限制
	timeout := p.Timeout
	if timeout <= 0 {
		timeout = 30
	}
	if timeout > 120 {
		timeout = 120
	}

	// 请求审批（所有命令都需要用户确认）
	desc := fmt.Sprintf("执行命令: %s（超时 %ds）", p.Command, timeout)
	approved, err := RequestApproval(ctx, "run_command", args, desc, "low")
	if err != nil {
		return "操作取消: " + err.Error(), nil
	}
	if !approved {
		return "操作被用户拒绝", nil
	}

	// 执行
	cmdCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, "sh", "-c", p.Command)
	output, err := cmd.CombinedOutput()

	// 截断到 10KB
	result := string(output)
	if len(result) > 10240 {
		result = result[:10240] + "\n... (输出已截断至 10KB)"
	}

	if err != nil {
		if cmdCtx.Err() == context.DeadlineExceeded {
			return fmt.Sprintf("ERROR: 命令执行超时 (%ds)\n%s", timeout, result), nil
		}
		return fmt.Sprintf("ERROR: %s\n%s", err.Error(), result), nil
	}

	return result, nil
}


