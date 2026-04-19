# 多阶段构建：前端 → 后端 → 最终镜像
# 产出单个二进制，前端静态文件通过 go:embed 嵌入。
#
# 构建：docker build -t orca:latest .
# 运行：docker run -p 8080:8080 -e DB_HOST=... orca:latest

# ---- Stage 1: 前端构建 ----
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: 后端构建 ----
FROM golang:1.24-alpine AS backend
WORKDIR /app/backend
# 先复制 go.mod/go.sum 利用 Docker layer cache
COPY backend/go.mod backend/go.sum ./
RUN go mod download
# 复制后端源码
COPY backend/ ./
# 把前端产物复制到 embed 目录
COPY --from=frontend /app/frontend/dist ./cmd/orca/dist/
# 编译
RUN CGO_ENABLED=0 GOOS=linux go build -o /orca ./cmd/orca

# ---- Stage 3: 最终镜像 ----
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
    # 诊断工具（受限 Bash 白名单里的命令）
    curl bind-tools iputils busybox-extras
COPY --from=backend /orca /usr/local/bin/orca
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["orca"]
