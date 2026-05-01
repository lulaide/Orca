# Changelog

## [0.5.0](https://github.com/lulaide/Orca/compare/v0.4.0...v0.5.0) (2026-05-01)


### Features

* Skill 安装（git clone）+ 预览 + 卸载 + scripts 支持 ([b5cd95e](https://github.com/lulaide/Orca/commit/b5cd95ebb1813160191ed0700efde29ab1ee90ba))
* Skill 注入优化 + Agent 学习能力 + UI 调整 ([b41a0a3](https://github.com/lulaide/Orca/commit/b41a0a37f629ae037855b2e41a29b9805b157807))
* 更新 README，添加 React、Vite 和 Kubernetes 的徽章 ([f6beedd](https://github.com/lulaide/Orca/commit/f6beedd59f786e6bc6965df0dd2345161b0d062e))


### Bug Fixes

* go-git 内存 clone 替代 exec git ([d14e891](https://github.com/lulaide/Orca/commit/d14e891ede6814e2fd00ea5b573cde6d9ab358d6))

## [0.4.0](https://github.com/lulaide/Orca/compare/v0.3.0...v0.4.0) (2026-04-28)


### Features

* **frontend:** 代码块语法高亮 + 复制按钮 ([3b05e8c](https://github.com/lulaide/Orca/commit/3b05e8c720d02cfe867be4af02883f19c980f246))
* Skill 系统替换旧知识库 + Mermaid 渲染 ([3ec7d34](https://github.com/lulaide/Orca/commit/3ec7d347b6a7c3b3b15b1610eb1a1e60a728f791))
* 专业 Dashboard + 飞书机器人交互命令 ([b74fc9c](https://github.com/lulaide/Orca/commit/b74fc9cb92ab8e98db373c4cd1759ef1ee787786))
* 对话用户隔离 + 类型隔离 + Fork 继续对话 ([2555d11](https://github.com/lulaide/Orca/commit/2555d1141ac710e1d1ebc5e6d0004c0e3cbf2799))


### Bug Fixes

* **dashboard:** Top 10 CPU 排序被内存排序覆盖 ([16954c9](https://github.com/lulaide/Orca/commit/16954c99f0754b8e3476969265d48b31539b9d2f))
* **deploy:** cn 版镜像改 latest + postgres 用国内源 ([d5e58fb](https://github.com/lulaide/Orca/commit/d5e58fb663358399e87b4e8b2e180c1984f38f36))
* **fork:** 保留原始消息时间 + 移除 history 裁剪 ([1a564e8](https://github.com/lulaide/Orca/commit/1a564e8577375e3c9e7f6d3ac892a9060cb636e1))
* **frontend:** StatusBadge 加 shrink-0 防止换行 ([e6b3625](https://github.com/lulaide/Orca/commit/e6b36253d05fc9071f9b7b52d5aeaeae1d72f656))

## [0.3.0](https://github.com/lulaide/Orca/compare/v0.2.0...v0.3.0) (2026-04-23)


### Features

* **auth:** OAuth/OIDC SSO 登录 ([0ae9860](https://github.com/lulaide/Orca/commit/0ae9860e002cb1502b3c91bd00f64d88b6e3be11))
* **mcp:** localhost 回调模式 — 支持不允许自定义回调域名的 MCP Server ([95b6df8](https://github.com/lulaide/Orca/commit/95b6df86b82741c073998289113a03d4c83b88f8))
* **mcp:** 自定义请求头 + localhost 回调优化 ([f362d09](https://github.com/lulaide/Orca/commit/f362d097f23d3b96ca95a4db8b01658afe26928e))
* **notify:** 飞书应用机器人通知（larksuite SDK） ([98f414d](https://github.com/lulaide/Orca/commit/98f414d5302ff115cd7fa832670e8fd91303c8ef))
* **triggers:** 新增 AlertManager + Grafana + 通用 Webhook 触发器 ([d9a69ea](https://github.com/lulaide/Orca/commit/d9a69ea50e54f7b0d88279b6a0640e57d0a716c4))
* 站点 URL 配置 — 初始化时设置 + 设置页可修改 ([08459e3](https://github.com/lulaide/Orca/commit/08459e3e61e565899c2e3f407b8a2ef0c63583c7))


### Bug Fixes

* **auth:** 修复 SSO 登录后 API 401 — 模板字符串 fetch 未替换为 authFetch ([74a38d1](https://github.com/lulaide/Orca/commit/74a38d121eb82a86c9fbbc6fd3f2e696d968470b))
* **deploy:** kubernetes-cn 镜像 tag 改为 0.2.0（semver 不带 v 前缀） ([ae3fa7b](https://github.com/lulaide/Orca/commit/ae3fa7b4d57732df49ddf1dc509eb9fec5cf6ddb))
* **deploy:** 默认镜像改为 ghcr.io/lulaide/orca:latest ([5ee258a](https://github.com/lulaide/Orca/commit/5ee258add378b7538d9deef6f908eaae2ce30aad))
* **knowledge:** 扫描完成后自动隐藏日志 + 点击目录可直接查看文档 ([7850e8b](https://github.com/lulaide/Orca/commit/7850e8b77cdfc856fc33359d8035c597a37149c1))
* **mcp:** localhost 回调标记持久化 — 建连时使用一致的 redirect_uri ([ffa79f3](https://github.com/lulaide/Orca/commit/ffa79f3cd93d603c392b827da59a598a281bf2f5))
* **mcp:** OAuth 动态客户端注册 — 解决 Cloudflare Missing client_id ([603fbf9](https://github.com/lulaide/Orca/commit/603fbf9bfa997f2c64aa8df56bf6063029c8dee2))
* 知识库扫描超时改为 30 分钟 + 设置页面加最大迭代轮数配置 ([eb7fe5c](https://github.com/lulaide/Orca/commit/eb7fe5c6964087b0fab486dee80ae37a35fffd90))
* 移除未使用的 getMCPOAuthURL 导入 ([de99821](https://github.com/lulaide/Orca/commit/de99821de0314bf94522f77d040d98df605c5018))

## [0.2.0](https://github.com/lulaide/Orca/compare/v0.1.0...v0.2.0) (2026-04-21)


### Features

* **auth:** 管理员认证 — 首用户即管理员 + JWT 鉴权 ([3057a6e](https://github.com/lulaide/Orca/commit/3057a6e11709e5ad2a8b13cc1048fa232e2a99d5))
* **deploy:** 国内部署版 kustomize overlay（阿里云 ACR 镜像源） ([848b6e5](https://github.com/lulaide/Orca/commit/848b6e5bb60f07ebe7c9d2ca8b807017d0d98d37))
* **knowledge:** Agent 驱动的集群知识库 — DeepWiki 风格文档生成 ([991d155](https://github.com/lulaide/Orca/commit/991d15539776994c9de0c4c8c189c4974bc316d4))
* **knowledge:** 后台扫描 + SSE 重连 — 刷新页面自动恢复进度 ([5bed1cd](https://github.com/lulaide/Orca/commit/5bed1cd9725a4507e7d511cd951c3e3378f7245d))
* **settings:** LLM 测试连接按钮 ([b09a266](https://github.com/lulaide/Orca/commit/b09a266718c4c9b71ac1c2da2d37d22bf7613f9a))
* **ui:** 双栏导航重构 + Dashboard + 排版优化 ([4a93abf](https://github.com/lulaide/Orca/commit/4a93abf77ebce675423818484d1d6df1606432fc))


### Bug Fixes

* **deploy:** 国内版不覆盖 postgres 镜像地址，直接用 Docker Hub ([b249ba2](https://github.com/lulaide/Orca/commit/b249ba24d23ea466487601f4ba2aa253f9a28699))
* **knowledge:** 扫描改为后台执行，浏览器关闭不中断 Agent ([37cab29](https://github.com/lulaide/Orca/commit/37cab298c1c11a2a40172e50475a781511a98c20))
