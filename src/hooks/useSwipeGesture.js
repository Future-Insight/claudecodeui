import { useRef, useEffect } from 'react';

/**
 * 自定义Hook用于检测滑动手势
 * @param {Object} options - 配置选项
 * @param {Function} options.onSwipeLeft - 左滑回调
 * @param {Function} options.onSwipeRight - 右滑回调
 * @param {number} options.minDistance - 最小滑动距离，默认50px
 * @param {number} options.maxTime - 最大滑动时间，默认300ms
 * @param {number} options.edgeThreshold - 边缘触发区域，默认50px (从左边缘开始)
 * @returns {Object} - 返回ref对象用于绑定到元素
 */
export const useSwipeGesture = ({
  onSwipeLeft,
  onSwipeRight,
  minDistance = 50,
  maxTime = 300,
  edgeThreshold = 50
} = {}) => {
  const touchStartRef = useRef(null);
  const touchTimeRef = useRef(null);
  const elementRef = useRef(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const handleTouchStart = (e) => {
      const touch = e.touches[0];
      const startX = touch.clientX;
      const startY = touch.clientY;
      
      // 只在从左边缘开始的触摸中记录起始点
      if (startX <= edgeThreshold) {
        touchStartRef.current = { x: startX, y: startY };
        touchTimeRef.current = Date.now();
      } else {
        touchStartRef.current = null;
        touchTimeRef.current = null;
      }
    };

    const handleTouchMove = (e) => {
      if (!touchStartRef.current) return;
      
      // 防止页面滚动 (只有在有效滑动开始时)
      e.preventDefault();
    };

    const handleTouchEnd = (e) => {
      if (!touchStartRef.current || !touchTimeRef.current) return;

      const touch = e.changedTouches[0];
      const endX = touch.clientX;
      const endY = touch.clientY;
      const startTime = touchTimeRef.current;
      const endTime = Date.now();

      const deltaX = endX - touchStartRef.current.x;
      const deltaY = endY - touchStartRef.current.y;
      const deltaTime = endTime - startTime;

      // 重置触摸状态
      touchStartRef.current = null;
      touchTimeRef.current = null;

      // 检查是否满足滑动条件
      if (deltaTime <= maxTime && Math.abs(deltaX) >= minDistance) {
        // 确保水平滑动距离大于垂直滑动距离（防止垂直滚动误触发）
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          if (deltaX > 0 && onSwipeRight) {
            onSwipeRight();
          } else if (deltaX < 0 && onSwipeLeft) {
            onSwipeLeft();
          }
        }
      }
    };

    // 使用passive: false允许preventDefault
    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onSwipeLeft, onSwipeRight, minDistance, maxTime, edgeThreshold]);

  return elementRef;
};