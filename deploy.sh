#!/bin/bash

# 停止旧的tmux会话（如果存在）
tmux kill-session -t claudeui-build-server 2>/dev/null || true

# 设置生产环境
export NODE_ENV=production

# 加载生产环境配置
export $(grep -v '^#' .env.production | xargs)

# 构建项目
npm run build

# 设置目录权限
chmod -R 775 dist/

# 启动新的tmux会话
tmux new-session -d -s claudeui-build-server "cd \$(pwd) && export NODE_ENV=production && export \$(grep -v '^#' .env.production | xargs) && npm run server"

echo "部署完成！新的生产服务器已在tmux会话中启动"
echo "后端端口: $PORT, 前端端口: $VITE_PORT"
echo "使用 'tmux attach -t claudeui-build-server' 可以查看服务器状态"
