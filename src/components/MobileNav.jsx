import { MessageSquare, Folder, Terminal, GitBranch } from 'lucide-react';

function MobileNav({ activeTab, setActiveTab, isInputFocused, selectedProject }) {
  // Detect dark mode
  const isDarkMode = document.documentElement.classList.contains('dark');
  const shellTabId = selectedProject ? `shell-${selectedProject.name}` : 'shell';
  const navItems = [
    {
      id: 'chat',
      icon: MessageSquare,
      onClick: () => setActiveTab('chat')
    },
    {
      id: shellTabId,
      displayId: 'shell', // For UI display purposes
      icon: Terminal,
      onClick: () => setActiveTab(shellTabId)
    },
    {
      id: 'files',
      icon: Folder,
      onClick: () => setActiveTab('files')
    },
    {
      id: 'git',
      icon: GitBranch,
      onClick: () => setActiveTab('git')
    },
    {
      id: 'preview',
      icon: ({ className }) => (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      ),
      onClick: () => setActiveTab('preview')
    }
  ];

  return (
    <>
      <style>
        {`
          .mobile-nav-container {
            background-color: ${isDarkMode ? '#1f2937' : '#ffffff'} !important;
          }
          .mobile-nav-container:hover {
            background-color: ${isDarkMode ? '#1f2937' : '#ffffff'} !important;
          }
        `}
      </style>
      <div 
        className={`mobile-nav-container fixed bottom-0 left-0 right-0 border-t border-gray-200 dark:border-gray-700 z-50 ios-bottom-safe transform transition-transform duration-300 ease-in-out shadow-lg ${
          isInputFocused ? 'translate-y-full' : 'translate-y-0'
        }`}
      >
      <div className="flex items-center justify-around py-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          
          return (
            <button
              key={item.id}
              onClick={item.onClick}
              onTouchStart={(e) => {
                e.preventDefault();
                item.onClick();
              }}
              className={`flex items-center justify-center p-2 rounded-lg min-h-[40px] min-w-[40px] relative touch-manipulation ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
              aria-label={item.displayId || item.id}
            >
              <Icon className="w-5 h-5" />
              {isActive && (
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-6 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
    </>
  );
}

export default MobileNav;