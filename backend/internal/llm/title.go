package llm

import (
	"context"
	"fmt"
	"strings"

	"github.com/cloudwego/eino/schema"
)

// 标题生成的 system prompt:严格约束输出只包含标题,不带引号/前缀/emoji。
const titleSystemPrompt = `你是一个对话标题摘要器。用户会给你一段刚发生的对话(一条用户提问 + 一条 AI 回复),
你必须用 8-15 个中文字符总结这段对话的主题,作为这次会话的标题。

规则:
- 只输出标题本身,不要引号、不要"标题:"之类的前缀、不要 emoji、不要句号
- 用名词短语或动宾短语,例如"kube-system 状态巡检"、"排查 Pod CrashLoop"、"节点容量核查"
- 如果用户问题本身就很短(<15 字),可以直接复用或微调,不要强行扩写
- 用用户提问的语言(中文优先)`

// SummarizeTitle 基于一段用户提问 + 一段 AI 回复,生成一个简短的对话标题。
// 返回的标题不含引号或额外前缀。未配置 LLM 时返回 ErrNotConfigured。
//
// 这是一个同步调用,建议在独立 goroutine 里执行,避免阻塞 SSE 主流程。
func (m *Manager) SummarizeTitle(ctx context.Context, userMessage, assistantMessage string) (string, error) {
	cm := m.ChatModel()
	if cm == nil {
		return "", ErrNotConfigured
	}

	// 把用户和 AI 的内容各自截断到 2000 字以内,防止 token 爆炸
	u := truncateForTitle(userMessage, 2000)
	a := truncateForTitle(assistantMessage, 2000)

	messages := []*schema.Message{
		schema.SystemMessage(titleSystemPrompt),
		schema.UserMessage(fmt.Sprintf("用户提问:\n%s\n\nAI 回复:\n%s\n\n请给出 8-15 字的中文标题。", u, a)),
	}

	resp, err := cm.Generate(ctx, messages)
	if err != nil {
		return "", fmt.Errorf("summarize title: %w", err)
	}

	title := strings.TrimSpace(resp.Content)
	// 去掉模型偶尔残留的引号/书名号/句号
	title = strings.Trim(title, `"'“”「」《》。. 　`)
	// 取首行,避免偶尔返回多行
	if i := strings.IndexAny(title, "\r\n"); i >= 0 {
		title = strings.TrimSpace(title[:i])
	}
	if title == "" {
		return "", fmt.Errorf("summarize title: empty response")
	}
	return title, nil
}

func truncateForTitle(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "…"
}
