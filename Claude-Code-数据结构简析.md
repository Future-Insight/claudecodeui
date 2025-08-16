# Claude Code UI 数据结构简析

## 核心数据来源

是的，Claude Code UI 主要通过读取 `~/.claude/projects/` 目录下的内容来获取所有数据。

## 目录结构

```
~/.claude/projects/
├── {项目名称编码}/              # 每个项目一个目录
│   ├── session1.jsonl         # 会话1的聊天记录
│   ├── session2.jsonl         # 会话2的聊天记录
│   └── ...
└── project-config.json        # 项目配置文件
```

**项目名称编码规则：** 将项目路径中的 `/` 替换为 `-`
- 例如：`/home/test/claudecodeui` → `-home-test-claudecodeui`

## 数据类型详解

### 1. JSONL 会话文件 (*.jsonl)
每个 `.jsonl` 文件代表一个 Claude 对话会话，包含：

#### 消息条目结构：
```json
{
  "parentUuid": "父消息ID",
  "sessionId": "会话ID", 
  "cwd": "/项目工作目录",
  "version": "Claude版本",
  "gitBranch": "Git分支",
  "type": "消息类型",
  "message": {
    "role": "user|assistant", 
    "content": "消息内容"
  },
  "uuid": "消息唯一ID",
  "timestamp": "时间戳",
  "isMeta": false
}
```

#### 消息类型：
- **user** - 用户消息
- **assistant** - Claude 回复
- **summary** - 会话摘要
- **command** - 命令执行记录

### 2. 项目配置文件 (project-config.json)
位置：`~/.claude/project-config.json`

```json
{
  "项目名称编码": {
    "displayName": "自定义显示名",
    "manuallyAdded": true,
    "originalPath": "/真实项目路径"
  }
}
```

## 数据获取流程

1. **扫描目录** - 读取 `~/.claude/projects/` 下所有子目录
2. **解析会话** - 逐行解析每个 `.jsonl` 文件
3. **提取项目路径** - 从 `cwd` 字段获取真实项目目录
4. **构建会话列表** - 按时间排序，生成会话摘要
5. **应用配置** - 合并自定义项目名称等配置

## 主要数据内容

### 项目数据：
- 项目名称和路径
- 会话列表
- 最后活动时间
- Git 分支信息

### 会话数据：
- 会话ID和摘要
- 消息数量
- 创建时间
- 工作目录

### 消息数据：
- 用户输入
- Claude 回复
- 工具调用记录
- 文件操作历史
- 命令执行结果

### 元数据：
- Claude 版本信息
- Git 状态
- 时间戳
- 消息关系链

## 实时监控

使用 **Chokidar** 监控 `~/.claude/projects/` 目录：
- 文件变化 → 重新解析数据
- 新会话创建 → 实时更新界面
- 防抖处理 → 避免频繁刷新

## 简化总结

**Claude Code UI 就是一个 JSONL 文件的可视化界面：**
1. 读取 `~/.claude/projects/` 下的所有 `.jsonl` 文件
2. 解析其中的对话记录
3. 提供 Web 界面来浏览、搜索、管理这些会话
4. 支持恢复历史会话继续对话

**核心价值：** 将 Claude CLI 的文本数据转换为友好的图形界面。