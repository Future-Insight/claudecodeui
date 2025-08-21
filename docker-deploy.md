# Claude Code UI Docker 部署指南

## 概述

本指南详细说明如何使用 Docker 部署 Claude Code UI，特别关注本地磁盘挂载和代码目录映射配置。

## 核心特性

- ✅ **本地磁盘挂载**: 代码修改持久保存到宿主机
- ✅ **Claude CLI 集成**: 完全支持 Claude 配置和会话
- ✅ **多目录映射**: 工作区、配置、模板分离管理
- ✅ **权限管理**: 读写权限精确控制
- ✅ **Nginx 反向代理**: 可选的生产级代理配置

## 快速开始

### 1. 准备环境

```bash
# 创建必要的目录
mkdir -p ~/workspace
mkdir -p ~/.claude
mkdir -p ./templates

# 确保 Docker 和 Docker Compose 已安装
docker --version
docker-compose --version
```

### 2. 配置环境变量

复制环境配置文件：
```bash
cp .env.docker .env
```

编辑 `.env` 文件，配置你的本地路径：
```bash
# 核心目录配置
CLAUDE_CONFIG_DIR=/home/user/.claude      # Claude CLI 配置
WORKSPACE_DIR=/home/user/workspace        # 代码工作区
CURSOR_DIR=/home/user/.cursor            # Cursor CLI 配置
SSH_DIR=/home/user/.ssh                  # SSH 密钥
GIT_CONFIG=/home/user/.gitconfig         # Git 配置
```

### 3. 基本部署

最简单的方式启动应用：

```bash
# 克隆项目
git clone <项目地址>
cd claudecodeui

# 构建并启动
docker-compose up -d
```

访问：`http://localhost:3001`

### 4. 带 Nginx 反向代理部署

```bash
# 启动带 Nginx 的完整部署
docker-compose --profile nginx up -d
```

访问：`http://localhost` (通过 Nginx)

## 配置选项

### 环境变量配置

创建 `.env` 文件来自定义配置：

```bash
# 服务端口
PORT=3001

# API 密钥（可选，增强安全性）
API_KEY=your-secure-api-key

# 日志级别
LOG_LEVEL=info
```

### 数据持久化

应用数据会自动保存到 Docker volume `claude_data` 中，包括：
- 用户认证数据
- 项目配置
- 会话历史

## 目录映射详解

### 核心目录结构

```
容器内路径                宿主机路径                   权限    用途
/app/data/claude     →    ~/.claude                  RW     Claude CLI 配置和会话
/app/.claude.json    →    ~/.claude.json             RW     Claude CLI 主配置文件
/app/workspace       →    ~/workspace               RW     代码工作区
/app/.gitconfig      →    ~/.gitconfig              RO     Git 全局配置(可选)
```

### 关键目录说明

#### 1. `/app/workspace` - 代码工作区 ⭐⭐⭐⭐⭐
- **用途**: 所有代码项目的根目录
- **权限**: 读写 (RW)
- **说明**: Claude 修改的所有代码都会保存到这里

```bash
~/workspace/
├── project1/
│   ├── src/
│   └── package.json
├── project2/
│   ├── components/
│   └── README.md
└── my-new-app/
    ├── frontend/
    └── backend/
```

#### 2. `/app/data/claude` - Claude 配置目录 ⭐⭐⭐⭐
- **用途**: Claude CLI 的项目配置和会话历史
- **权限**: 读写 (RW)
- **说明**: 保存 Claude 的项目数据、对话历史

#### 3. `/app/.claude.json` - Claude 主配置文件 ⭐⭐⭐⭐
- **用途**: Claude CLI 的全局配置
- **权限**: 读写 (RW)
- **说明**: 保存 Claude 的 API 密钥、模型设置等

### 挂载本地 Claude 数据

项目会自动挂载本地的 Claude 配置：

```yaml
# docker-compose.yml 中已配置的挂载
volumes:
  # Claude CLI 配置目录挂载 (读写权限，用于保存配置和会话)
  - ${CLAUDE_CONFIG_DIR:-~/.claude}:/app/data/claude
  
  # Claude CLI 主配置文件挂载
  - ${CLAUDE_JSON:-~/.claude.json}:/app/.claude.json
  
  # 代码工作区挂载 (读写权限，用于代码修改和项目管理)  
  - ${WORKSPACE_DIR:-~/workspace}:/app/workspace
```

## 部署模式

### 1. 开发模式

```bash
# 使用开发配置
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### 2. 生产模式（推荐）

```bash
# 生产环境部署
docker-compose up -d

# 查看日志
docker-compose logs -f claude-code-ui
```

### 3. 扩展部署

```bash
# 启动多个实例（负载均衡）
docker-compose up -d --scale claude-code-ui=3
```

## 网络配置

### 端口映射

- **3001**: 应用主端口（docker-compose 默认）
- **80**: Nginx HTTP 端口（使用 nginx profile）
- **443**: Nginx HTTPS 端口（需要配置 SSL）

### SSL/HTTPS 配置

1. 准备 SSL 证书：
```bash
mkdir ssl
# 将证书文件放入 ssl/ 目录
# - cert.pem (证书文件)
# - key.pem (私钥文件)
```

2. 取消注释 `nginx.conf` 中的 HTTPS 服务器配置

3. 重启服务：
```bash
docker-compose --profile nginx restart
```

## 监控和维护

### 健康检查

应用内置健康检查，可以通过以下方式监控：

```bash
# 检查容器状态
docker-compose ps

# 检查健康状态
curl http://localhost:3001/api/auth/status
```

### 日志管理

```bash
# 查看应用日志
docker-compose logs claude-code-ui

# 实时跟踪日志
docker-compose logs -f claude-code-ui

# 查看 Nginx 日志
docker-compose logs nginx
```

### 备份数据

```bash
# 备份数据卷
docker run --rm -v claude_data:/data -v $(pwd):/backup alpine tar czf /backup/claude-backup-$(date +%Y%m%d).tar.gz -C /data .

# 恢复数据
docker run --rm -v claude_data:/data -v $(pwd):/backup alpine tar xzf /backup/claude-backup-YYYYMMDD.tar.gz -C /data
```

## 故障排除

### 常见问题

1. **端口占用**
   ```bash
   # 修改 .env 文件中的 PORT
   PORT=3002
   ```

2. **权限问题**
   ```bash
   # 确保 Docker 有足够权限
   sudo chown -R $USER:$USER ~/.claude ~/.cursor
   ```

3. **容器无法启动**
   ```bash
   # 查看详细日志
   docker-compose logs claude-code-ui
   
   # 重新构建镜像
   docker-compose build --no-cache
   ```

### 性能调优

1. **内存限制**
   ```yaml
   # 在 docker-compose.yml 中添加
   services:
     claude-code-ui:
       deploy:
         resources:
           limits:
             memory: 1G
           reservations:
             memory: 512M
   ```

2. **CPU 限制**
   ```yaml
   services:
     claude-code-ui:
       deploy:
         resources:
           limits:
             cpus: '1.0'
   ```

## 安全建议

1. **设置 API 密钥**
   ```bash
   echo "API_KEY=$(openssl rand -hex 32)" >> .env
   ```

2. **网络隔离**
   ```bash
   # 使用自定义网络
   docker network create claude-network
   ```

3. **定期更新**
   ```bash
   # 更新镜像
   docker-compose pull
   docker-compose up -d
   ```

## 高级配置

### 自定义构建

```dockerfile
# 创建自定义 Dockerfile
FROM claudecodeui:latest
# 添加你的自定义配置
COPY custom-config.json /app/config/
```

### 多环境部署

```bash
# 开发环境
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# 测试环境
docker-compose -f docker-compose.yml -f docker-compose.test.yml up

# 生产环境
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
```

## 联系支持

如果遇到问题，请：
1. 检查日志：`docker-compose logs`
2. 查看健康状态：`docker-compose ps`
3. 重启服务：`docker-compose restart`

更多信息请参考项目文档。