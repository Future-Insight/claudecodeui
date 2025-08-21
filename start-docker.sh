#!/bin/bash

# Claude Code UI Docker 启动脚本
# 用于简化Docker部署流程

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 输出函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查Docker和Docker Compose
check_docker() {
    log_info "检查Docker环境..."
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker未安装，请先安装Docker"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose未安装，请先安装Docker Compose"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker守护进程未运行，请启动Docker"
        exit 1
    fi
    
    log_success "Docker环境检查通过"
}

# 创建必要目录
create_directories() {
    log_info "创建必要的目录..."
    
    # 从环境变量或默认路径创建目录
    WORKSPACE_DIR=${WORKSPACE_DIR:-"$HOME/workspace"}
    CLAUDE_CONFIG_DIR=${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}
    CLAUDE_JSON=${CLAUDE_JSON:-"$HOME/.claude.json"}
    
    # 创建工作区目录
    if [ ! -d "$WORKSPACE_DIR" ]; then
        mkdir -p "$WORKSPACE_DIR"
        log_success "创建工作区目录: $WORKSPACE_DIR"
    else
        log_info "工作区目录已存在: $WORKSPACE_DIR"
    fi
    
    # 创建Claude配置目录
    if [ ! -d "$CLAUDE_CONFIG_DIR" ]; then
        mkdir -p "$CLAUDE_CONFIG_DIR"
        log_success "创建Claude配置目录: $CLAUDE_CONFIG_DIR"
    else
        log_info "Claude配置目录已存在: $CLAUDE_CONFIG_DIR"
    fi
    
    # 检查Claude配置文件
    if [ ! -f "$CLAUDE_JSON" ]; then
        log_info "Claude配置文件不存在，将在首次使用时创建: $CLAUDE_JSON"
    else
        log_info "Claude配置文件已存在: $CLAUDE_JSON"
    fi
}

# 检查环境文件
check_env_file() {
    log_info "检查环境配置文件..."
    
    if [ ! -f ".env" ]; then
        if [ -f ".env.docker" ]; then
            cp .env.docker .env
            log_success "已从 .env.docker 复制环境配置文件"
        else
            log_warning "未找到环境配置文件，将使用默认配置"
        fi
    else
        log_info "环境配置文件已存在"
    fi
}

# 显示配置信息
show_config() {
    log_info "当前配置信息:"
    echo "----------------------------------------"
    echo "工作区目录: ${WORKSPACE_DIR:-$HOME/workspace}"
    echo "Claude配置: ${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
    echo "Claude配置文件: ${CLAUDE_JSON:-$HOME/.claude.json}"
    echo "Git配置: ${GIT_CONFIG:-$HOME/.gitconfig}"
    echo "应用端口: ${PORT:-3001}"
    echo "----------------------------------------"
}

# 构建镜像
build_image() {
    log_info "构建Docker镜像..."
    docker-compose build
    log_success "镜像构建完成"
}

# 启动服务
start_services() {
    local mode=$1
    
    case $mode in
        "dev")
            log_info "启动开发模式..."
            docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
            ;;
        "prod")
            log_info "启动生产模式..."
            docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
            ;;
        "nginx")
            log_info "启动完整部署(包含Nginx)..."
            docker-compose --profile nginx up -d
            ;;
        *)
            log_info "启动标准模式..."
            docker-compose up -d
            ;;
    esac
}

# 检查服务状态
check_services() {
    log_info "检查服务状态..."
    sleep 5
    
    if docker-compose ps | grep -q "Up"; then
        log_success "服务启动成功!"
        docker-compose ps
        
        # 显示访问地址
        PORT=${PORT:-3001}
        echo ""
        log_info "访问地址:"
        echo "  - 应用主页: http://localhost:$PORT"
        
        # 如果启用了nginx
        if docker-compose ps nginx &> /dev/null; then
            echo "  - Nginx代理: http://localhost"
        fi
        
        echo ""
        log_info "查看日志: docker-compose logs -f"
        log_info "停止服务: docker-compose down"
    else
        log_error "服务启动失败，请检查日志: docker-compose logs"
        exit 1
    fi
}

# 显示帮助信息
show_help() {
    echo "Claude Code UI Docker 启动脚本"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --help, -h        显示帮助信息"
    echo "  --dev             启动开发模式"
    echo "  --prod            启动生产模式"
    echo "  --nginx           启动完整部署(包含Nginx)"
    echo "  --build           重新构建镜像"
    echo "  --stop            停止所有服务"
    echo "  --restart         重启所有服务"
    echo "  --logs            查看服务日志"
    echo "  --status          查看服务状态"
    echo ""
    echo "环境变量:"
    echo "  WORKSPACE_DIR     代码工作区目录 (默认: ~/workspace)"
    echo "  CLAUDE_CONFIG_DIR Claude配置目录 (默认: ~/.claude)"
    echo "  CLAUDE_JSON       Claude配置文件 (默认: ~/.claude.json)"
    echo "  PORT              应用端口 (默认: 3001)"
    echo ""
    echo "示例:"
    echo "  $0                启动标准模式"
    echo "  $0 --nginx        启动完整部署"
    echo "  $0 --dev          启动开发模式"
    echo "  $0 --build        重新构建并启动"
}

# 主函数
main() {
    local mode="standard"
    local build_flag=false
    
    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help|-h)
                show_help
                exit 0
                ;;
            --dev)
                mode="dev"
                shift
                ;;
            --prod)
                mode="prod"
                shift
                ;;
            --nginx)
                mode="nginx"
                shift
                ;;
            --build)
                build_flag=true
                shift
                ;;
            --stop)
                log_info "停止所有服务..."
                docker-compose down
                exit 0
                ;;
            --restart)
                log_info "重启所有服务..."
                docker-compose restart
                exit 0
                ;;
            --logs)
                docker-compose logs -f
                exit 0
                ;;
            --status)
                docker-compose ps
                exit 0
                ;;
            *)
                log_error "未知选项: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    echo "🐳 Claude Code UI Docker 部署工具"
    echo "=================================="
    
    # 执行检查和准备
    check_docker
    create_directories
    check_env_file
    show_config
    
    # 构建镜像（如果需要）
    if [ "$build_flag" = true ]; then
        build_image
    fi
    
    # 启动服务
    start_services "$mode"
    
    # 检查服务状态
    check_services
    
    echo ""
    log_success "部署完成! 🎉"
}

# 运行主函数
main "$@"