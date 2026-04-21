# Changelog

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
