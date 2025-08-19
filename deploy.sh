#!/bin/bash

# 停止旧的tmux会话（如果存在）
tmux kill-session -t claudeui-build-server 2>/dev/null || true

# 构建项目
npm run build

# 设置目录权限
sudo chown -R test:test dist/
sudo chmod -R 775 dist/

# 启动新的tmux会话
tmux new-session -d -s claudeui-build-server "cd /home/test/claudecodeui && npm run server"

echo "部署完成！新的开发服务器已在tmux会话中启动"
echo "使用 'tmux attach -t claudeui-build-server' 可以查看开发服务器状态"
