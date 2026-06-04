# Dokploy 部署说明（benchmark-admin）

把 `benchmark-admin` 部到一台装了 Dokploy 的机器上。**只新增本目录下的文件**，仓库里原有的
`docker-compose.yml`、`edge/`、`scripts/bootstrap-host.sh`、`.github/workflows/deploy.yml`
暂时都不动。等 Dokploy 跑通后再做清理。

## 0. 前置

- 一台干净的 Linux 服务器（≥ 2 vCPU / 4 GB RAM，因为 Dokploy build 时要装整个 pnpm 工作空间 + 编译）。
- `benchmark-admin.jy-video.cn`（或测试用 staging 域名）的 DNS A 记录指向这台机器。
- Neon 数据库连接串、TOS、OpenRouter、`SESSION_SECRET` 等所有 env 都准备好。
- 公网开放 22 / 80 / 443 / 3000（3000 是 Dokploy 控制台，初始化完之后可以收掉）。

## 1. 装 Dokploy

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

装完通过 `http://<server-ip>:3000` 打开控制台，注册第一个 admin 账号。Dokploy 会自动起一份
Traefik，监听宿主机 80 / 443，自动签 Let's Encrypt。所有应用容器接到外部网络
`dokploy-network` 之后由 Traefik 转发。

## 2. 创建应用

控制台里 New → **Compose**：

| 字段 | 值 |
| --- | --- |
| Repository | `Smilexuhc/benchmark-repo` |
| Branch | `main` |
| Compose Path | `benchmark-admin/dokploy/docker-compose.yml` |
| Compose Type | `Docker Compose` |
| Build Context | 由 compose 内 `context: ..` 决定，无需在 UI 改 |

如果是私有仓库，先在 Settings → Git Providers 里授权 GitHub App / PAT。

## 3. 配 Environment

在应用的 **Environment** 面板把下列变量贴进去（用 Dokploy UI，**不要**把 `.env.production`
进仓库）。来源：上层 `../.env.example`。

```env
DATABASE_URL=
SESSION_SECRET=          # 复用现网那把；新生成会失效所有旧 cookie
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://proxy.offerin.cn/openrouter/api/v1
TEXT_MODEL=anthropic/claude-opus-4.7
IMAGE_MODEL=openai/gpt-5.4-image-2
IMAGE_ASPECT_RATIO=3:2
IMAGE_SIZE=2K
TOS_BUCKET=
TOS_REGION=
TOS_ENDPOINT=
TOS_ACCESS_KEY_ID=
TOS_SECRET_ACCESS_KEY=
ADMIN_EMAIL=
ADMIN_PASSWORD=
WEB_URL=https://benchmark-admin.jy-video.cn
```

Dokploy 会在 `up` 时把这些变量注入到每个 service 的 environment，`migrate` 也能拿到
`DATABASE_URL`。

## 4. 配 Domain + TLS

应用的 **Domains** 面板加一条：

| 字段 | 值 |
| --- | --- |
| Host | `benchmark-admin.jy-video.cn` |
| Service Name | `admin-nginx` |
| Port | `80` |
| HTTPS | 开 |
| Certificate | `Let's Encrypt` |

保存后 Dokploy 自动写 Traefik labels、申请证书。首次签证书要等 30–60s。

## 5. 配 Pre-deployment（跑 Drizzle migration）

应用的 **Advanced → Pre-deployment Command**（或 Hooks）里填：

```bash
docker compose -f docker-compose.yml --profile migrate run --rm migrate
```

> Dokploy 在仓库子目录里执行，compose 文件就是当前这个。`--profile migrate` 让
> `migrate` service 只在这一步启动，正常 `up` 不会拉起它。

跑通一次之后，每次新部署都会先 build builder 镜像 → 跑 `pnpm db:migrate` → 通过后再
`up api / admin-nginx`。如果 migration 失败，本次部署不会切流。

## 6. 配 Auto-deploy

应用的 **Deployments → Auto Deploy** 打开，会在 GitHub 加一条 webhook，push 到 `main` 时
Dokploy 自动拉取 + 走第 5 步 + 滚动重启。GitHub 那边对应一条 webhook，状态在
`Settings → Webhooks` 可见。

## 7. 第一次部署 / 验证

```bash
# 控制台 → Deploy 按钮，或者：
curl -X POST https://<dokploy-host>:3000/api/...   # webhook，按 UI 给的复制
```

部署完成后：

```bash
curl -fsS https://benchmark-admin.jy-video.cn/api/trpc/health
# 期望 200，body 是 trpc 标准 envelope
```

Dokploy 的 Logs 面板看每个 service 实时日志；migration 输出在 Deployments 详情页里。

## 8. 后续清理（部署稳定后再做，本次不动）

部到 Dokploy 跑通、和现状对齐之后，可以删：

- `.github/workflows/deploy.yml` —— GHA 的 deploy job 不再需要；如果想保留 typecheck/lint/build 的 CI，把 `deploy` job 单独删掉，build job 留着。
- `benchmark-admin/edge/`（Caddy + 外部 `edge` 网络）—— 改由 Dokploy Traefik 接管。
- `benchmark-admin/scripts/bootstrap-host.sh` —— 主机初始化由 Dokploy installer 接管。
- `benchmark-admin/docker-compose.yml`（顶层那份）—— 如果不再有人手 docker compose up，可以删；不急。

## 9. 已知 trade-off

- **构建在服务器上跑**：内存峰值约 1.5–2 GB，pnpm install 耗时 1–3 分钟，全量 build 再 1–2 分钟。第一次部署提前准备好 swap，或换 4 GB 起步规格。
- **回滚靠 Dokploy 内部镜像历史**：不再有 `cr.volces.com:<sha>` 这种持久 tag。如果回滚到很老的版本，可能需要 git revert + 重新部署。
- **停机更新**：单实例默认 stop-then-start，停服窗口 10–30s。benchmark-admin 还没进生产，目前 OK；正式上线前再加 `deploy.replicas` 或 Traefik 蓝绿。
- **Migration 不可逆**：Drizzle 没有 down 脚本，pre-deploy migrate 失败后流量不切，但已 apply 的部分 SQL 不会回滚。
