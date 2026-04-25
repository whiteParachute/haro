import {
  Home,
  MessageSquare,
  Settings,
  SquareActivity,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavigationItem {
  to: string;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
  end?: boolean;
}

export const navigationItems: NavigationItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    title: 'Dashboard',
    description: 'Haro Web 控制台基础框架。',
    icon: Home,
    end: true,
  },
  {
    to: '/chat',
    label: 'Chat',
    title: 'Chat',
    description: '与 Agent 对话并实时查看事件流。',
    icon: MessageSquare,
  },
  {
    to: '/sessions',
    label: 'Sessions',
    title: 'Sessions',
    description: '分页浏览 Agent sessions 与事件历史。',
    icon: Workflow,
  },
  {
    to: '/status',
    label: 'Status',
    title: 'Status',
    description: '系统状态与指标面板占位。',
    icon: SquareActivity,
  },
  {
    to: '/settings',
    label: 'Settings',
    title: 'Settings',
    description: '配置管理页面占位。',
    icon: Settings,
  },
];

export const fallbackPageMeta = {
  title: 'Dashboard',
  description: '当前页面尚未配置标题映射。',
};
