package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/go-git/go-billy/v5"
	"github.com/go-git/go-billy/v5/memfs"
	git "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/storage/memory"
	"gorm.io/datatypes"

	"github.com/lulaide/orca/internal/core"
)

// discoveredSkill 是扫描仓库后发现的一个 skill。
type discoveredSkill struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Content     string            `json:"content"`
	Frontmatter map[string]string `json:"frontmatter"`
	Refs        map[string]string `json:"refs"`
	Scripts     map[string]string `json:"scripts"`
	Path        string            `json:"path"`
	Installed   bool              `json:"installed"`
}

// clone 互斥锁（防止并发 clone）
var cloneMu sync.Mutex

// POST /api/skills/scan-repo
func (d *Deps) handleScanRepo(c *gin.Context) {
	var body struct {
		Repo string `json:"repo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Repo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repo is required"})
		return
	}

	repo := normalizeRepo(body.Repo)
	if repo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid repo format"})
		return
	}

	fs, err := cloneToMemory(repo)
	if err != nil {
		log.Printf("scan-repo: clone %s failed: %v", repo, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "clone 失败: " + err.Error()})
		return
	}

	installed := make(map[string]bool)
	skills, _ := core.ListSkills(d.DB)
	for _, s := range skills {
		if s.Type == "installed" {
			installed[s.Name] = true
		}
	}

	var result []discoveredSkill
	scanMemFS(fs, "/", "/", installed, &result)
	if result == nil {
		result = []discoveredSkill{}
	}

	c.JSON(http.StatusOK, gin.H{
		"repo":   repo,
		"count":  len(result),
		"skills": result,
	})
}

// POST /api/skills/install
func (d *Deps) handleInstallSkills(c *gin.Context) {
	var body struct {
		Repo   string `json:"repo"`
		Skills []struct {
			Name string `json:"name"`
			Path string `json:"path"`
		} `json:"skills"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Repo == "" || len(body.Skills) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repo and skills are required"})
		return
	}

	repo := normalizeRepo(body.Repo)
	fs, err := cloneToMemory(repo)
	if err != nil {
		log.Printf("install: clone %s failed: %v", repo, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "clone 失败: " + err.Error()})
		return
	}

	var installed []string
	var errors []string

	for _, sk := range body.Skills {
		skillPath := "/" + sk.Path
		raw, err := readBillyFile(fs, skillPath+"/SKILL.md")
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: 无法读取 SKILL.md", sk.Name))
			continue
		}

		fm, content := parseFrontmatterFull(string(raw))
		name := sk.Name
		if name == "" {
			name = fm["name"]
		}
		if name == "" {
			name = filepath.Base(sk.Path)
		}

		refs := readBillyDir(fs, skillPath+"/references")
		scripts := readBillyDir(fs, skillPath+"/scripts")

		refsJSON, _ := json.Marshal(refs)
		scriptsJSON, _ := json.Marshal(scripts)
		fmJSON, _ := json.Marshal(fm)

		skill := &core.Skill{
			Name:        name,
			Type:        "installed",
			Source:      fmt.Sprintf("github:%s/%s", repo, sk.Path),
			Description: fm["description"],
			Content:     content,
			References:  datatypes.JSON(refsJSON),
			Scripts:     datatypes.JSON(scriptsJSON),
			Metadata:    fmJSON,
		}

		if err := core.UpsertSkill(d.DB, skill); err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", name, err))
			continue
		}
		installed = append(installed, name)
	}

	c.JSON(http.StatusOK, gin.H{"installed": installed, "errors": errors})
}

// DELETE /api/skills/uninstall/:name
func (d *Deps) handleUninstallSkill(c *gin.Context) {
	name := c.Param("name")
	skill, err := core.GetSkill(d.DB, name)
	if err != nil || skill == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "skill not found"})
		return
	}
	if skill.Type != "installed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "只能卸载已安装的技能"})
		return
	}
	if err := core.DeleteSkill(d.DB, name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ---- git clone ----

func cloneToMemory(repo string) (billy.Filesystem, error) {
	cloneMu.Lock()
	defer cloneMu.Unlock()

	url := fmt.Sprintf("https://github.com/%s.git", repo)
	fs := memfs.New()
	_, err := git.Clone(memory.NewStorage(), fs, &git.CloneOptions{
		URL:   url,
		Depth: 1,
	})
	if err != nil {
		return nil, fmt.Errorf("clone %s: %w", repo, err)
	}
	return fs, nil
}

// ---- 内存文件系统扫描 ----

func scanMemFS(fs billy.Filesystem, baseDir, dir string, installed map[string]bool, result *[]discoveredSkill) {
	entries, err := fs.ReadDir(dir)
	if err != nil {
		return
	}

	hasSkillMD := false
	for _, e := range entries {
		if !e.IsDir() && e.Name() == "SKILL.md" {
			hasSkillMD = true
			break
		}
	}

	if hasSkillMD && dir != baseDir {
		raw, err := readBillyFile(fs, filepath.Join(dir, "SKILL.md"))
		if err == nil {
			fm, content := parseFrontmatterFull(string(raw))
			name := fm["name"]
			if name == "" {
				name = filepath.Base(dir)
			}
			desc := fm["description"]
			if strings.Contains(desc, "Replace with") {
				return
			}

			relPath, _ := filepath.Rel(baseDir, dir)
			relPath = filepath.ToSlash(relPath)

			refs := readBillyDir(fs, filepath.Join(dir, "references"))
			scripts := readBillyDir(fs, filepath.Join(dir, "scripts"))

			*result = append(*result, discoveredSkill{
				Name:        name,
				Description: desc,
				Content:     content,
				Frontmatter: fm,
				Refs:        refs,
				Scripts:     scripts,
				Path:        relPath,
				Installed:   installed[name],
			})
		}
		return
	}

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		n := e.Name()
		if strings.HasPrefix(n, ".") || n == "node_modules" || n == "spec" || n == "__pycache__" {
			continue
		}
		scanMemFS(fs, baseDir, filepath.Join(dir, n), installed, result)
	}
}

// readBillyFile 从 billy 内存文件系统读取文件
func readBillyFile(fs billy.Filesystem, path string) ([]byte, error) {
	f, err := fs.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

// readBillyDir 读取 billy 内存文件系统中目录下所有文件
func readBillyDir(fs billy.Filesystem, dir string) map[string]string {
	files := make(map[string]string)
	entries, err := fs.ReadDir(dir)
	if err != nil {
		return files
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		content, err := readBillyFile(fs, filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		files[e.Name()] = string(content)
	}
	return files
}

// ---- 解析 ----

func normalizeRepo(input string) string {
	input = strings.TrimSpace(input)
	input = strings.TrimSuffix(input, ".git")
	if strings.Contains(input, "github.com") {
		parts := strings.Split(input, "github.com/")
		if len(parts) == 2 {
			input = strings.TrimPrefix(parts[1], "/")
		}
	}
	input = strings.TrimPrefix(input, "https://")
	input = strings.TrimPrefix(input, "http://")
	parts := strings.Split(input, "/")
	if len(parts) >= 2 {
		return parts[0] + "/" + parts[1]
	}
	return ""
}

// parseFrontmatterFull 解析 SKILL.md，返回完整 frontmatter map + body
func parseFrontmatterFull(raw string) (map[string]string, string) {
	raw = strings.TrimSpace(raw)
	fm := make(map[string]string)

	if !strings.HasPrefix(raw, "---") {
		return fm, raw
	}
	end := strings.Index(raw[3:], "---")
	if end < 0 {
		return fm, raw
	}
	frontmatter := raw[3 : 3+end]
	content := strings.TrimSpace(raw[3+end+3:])

	for _, line := range strings.Split(frontmatter, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.Index(line, ":")
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		val = strings.Trim(val, "\"'")
		if key != "" && val != "" {
			fm[key] = val
		}
	}

	return fm, content
}
