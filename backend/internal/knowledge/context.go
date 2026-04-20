package knowledge

import (
	"gorm.io/gorm"
)

// BuildServiceContext 从知识库读取概述页面，注入 system prompt。
// 只注入概述和顶级页面的标题列表，避免上下文过长。
func BuildServiceContext(db *gorm.DB) string {
	// 尝试读 overview 页面
	overview, err := GetPage(db, "overview")
	if err != nil || overview.Content == "" {
		return ""
	}

	return "\n\n## 集群知识库概述\n\n" + overview.Content + "\n"
}
