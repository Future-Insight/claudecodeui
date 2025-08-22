import React from 'react';
import { Badge } from './ui/badge';
import { CheckCircle2, Clock, Circle } from 'lucide-react';

const TodoList = ({ todos, isResult = false }) => {
  if (!todos || !Array.isArray(todos)) {
    return null;
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-3 h-3 text-green-500 dark:text-green-400" />;
      case 'in_progress':
        return <Clock className="w-3 h-3 text-blue-500 dark:text-blue-400" />;
      case 'pending':
      default:
        return <Circle className="w-3 h-3 text-gray-400 dark:text-gray-500" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 border-green-200 dark:border-green-800';
      case 'in_progress':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800';
      case 'pending':
      default:
        return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
      case 'medium':
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
      case 'low':
      default:
        return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700';
    }
  };

  return (
    <div className="space-y-1">
      {isResult && (
        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Todo List ({todos.length} {todos.length === 1 ? 'item' : 'items'})
        </div>
      )}
      
      {todos.map((todo, index) => (
        <div
          key={todo.id || index}
          className="flex items-center gap-2 px-2 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-xs hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
        >
          <div className="flex-shrink-0">
            {getStatusIcon(todo.status)}
          </div>
          
          <div className="flex-1 min-w-0">
            <p className={`truncate ${todo.status === 'completed' ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
              {todo.content}
            </p>
          </div>
          
          <div className="flex gap-1 flex-shrink-0">
            {todo.priority && (
              <Badge
                variant="outline"
                className={`text-[9px] px-1 py-0 ${getPriorityColor(todo.priority)}`}
              >
                {todo.priority}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[9px] px-1 py-0 ${getStatusColor(todo.status)}`}
            >
              {todo.status.replace('_', ' ')}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TodoList;