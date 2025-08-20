# Claude Code UI - 项目独立Shell功能实现文档

## 概述

实现了每个项目拥有独立Shell实例的功能，解决了不同项目共享Shell导致的连接状态丢失问题。

## 实现的功能

### 1. 项目独立Shell实例
- 每个项目都有自己独立的Shell组件实例
- 不同项目的Shell连接状态完全独立
- 切换项目时保持各自的Shell连接状态

### 2. 项目特定的标签页
- Shell标签页使用项目特定的ID格式：`shell-${projectName}`
- 每个项目记住自己的活跃标签页状态
- 支持桌面端和移动端

### 3. 持久化连接状态
- Shell实例在后台持续运行，不会被销毁
- 通过显示/隐藏机制切换，而非创建/销毁
- 已连接的Shell在项目切换后仍保持连接

## 关键技术实现

### App.jsx 改动
```javascript
// 项目特定的标签页状态管理
const [projectTabs, setProjectTabs] = useState({}); // project.name -> activeTab
const activeTab = selectedProject ? (projectTabs[selectedProject.name] || 'chat') : 'chat';

const setActiveTab = (tabName) => {
  if (selectedProject) {
    setProjectTabs(prev => ({
      ...prev,
      [selectedProject.name]: tabName
    }));
  }
};
```

### MainContent.jsx 改动
```javascript
// 为所有项目同时渲染Shell组件
{projects && projects.map((project) => (
  <div 
    key={`shell-container-${project.name}`}
    className={`h-full overflow-hidden ${activeTab === `shell-${project.name}` ? 'block' : 'hidden'}`}
  >
    <Shell 
      key={`shell-${project.name}`} // 确保每个项目有独立的Shell实例
      selectedProject={project} 
      selectedSession={selectedProject && selectedProject.name === project.name ? selectedSession : null}
      isActive={activeTab === `shell-${project.name}`}
    />
  </div>
))}
```

### MobileNav.jsx 改动
```javascript
// 支持项目特定的Shell标签
const shellTabId = selectedProject ? `shell-${selectedProject.name}` : 'shell';
const navItems = [
  // ...
  {
    id: shellTabId,
    displayId: 'shell',
    icon: Terminal,
    onClick: () => setActiveTab(shellTabId)
  },
  // ...
];
```

## 架构优势

### 1. 状态隔离
- 每个项目的Shell状态完全独立
- 避免了项目间的状态污染
- 连接状态不会相互影响

### 2. 用户体验
- 切换项目时保持Shell连接状态
- 无需重新连接已建立的Shell会话
- 支持多项目并行开发工作流

### 3. 性能优化
- Shell实例只创建一次，避免重复初始化
- 使用CSS显示/隐藏，避免DOM重建
- React key确保组件实例正确管理

## 使用场景

### 典型工作流
1. **项目A**: 开启Shell连接，进行开发工作
2. **切换到项目B**: 开启新的Shell连接
3. **切换回项目A**: Shell连接状态保持，无需重新连接
4. **并行开发**: 两个项目的Shell可以同时运行不同的任务

### 支持的操作
- 每个项目独立的shell会话管理
- 独立的连接/断开状态
- 独立的终端历史和状态
- 项目特定的工作目录和环境

## 技术细节

### React Key策略
- 使用`key={shell-${project.name}}`确保组件实例唯一性
- 避免React重用组件导致的状态混乱

### 条件渲染
- 所有Shell实例同时存在于DOM中
- 通过CSS `block/hidden` 控制显示
- 避免组件销毁导致的状态丢失

### 会话管理
- Shell组件内部使用`project-${selectedProject.name}`作为session key
- 确保不同项目的shell会话数据完全隔离

## 兼容性

- ✅ 桌面端完全支持
- ✅ 移动端完全支持  
- ✅ 与现有聊天功能完全兼容
- ✅ 与项目切换功能完全兼容

## 总结

此实现成功解决了多项目开发中Shell状态管理的核心问题，提供了真正的项目级Shell隔离，大幅提升了多项目并行开发的用户体验。通过巧妙的组件实例管理和状态隔离，实现了既高性能又用户友好的Shell功能。