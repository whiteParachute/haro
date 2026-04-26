import {
  Bot,
  Home,
  MessageSquare,
  RadioTower,
  Settings,
  ServerCog,
  SquareActivity,
  Workflow,
  GitBranch,
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
    to: '/dispatch',
    label: 'Dispatch',
    title: 'Dispatch',
    description: 'Team workflow 编排调试与 checkpoint 只读观测。',
    icon: GitBranch,
  },
  {
    to: '/dispatch',
    label: 'Dispatch',
    title: 'Dispatch',
    description: 'Team workflow 编排调试与 checkpoint 只读观测。',
    icon: GitBranch,
  },
  {
    to: '/sessions',
    label: 'Sessions',
    title: 'Sessions',
    description: '分页浏览 Agent sessions 与事件历史。',
    icon: Workflow,
  },
  {
    to: '/dispatch',
    label: 'Dispatch',
    title: 'Dispatch / Orchestration Debugger',
    description: '查看 workflow 拓扑、checkpoint timeline 与 stalled branch。',
    icon: Workflow,
  },
  {
    to: '/status',
    label: 'Status',
    title: 'Status',
    description: '系统健康、doctor 报告与 channel 只读摘要。',
    icon: SquareActivity,
  },
  {
    to: '/channels',
    label: 'Channels',
    title: 'Channels',
    description: 'Channel 启停、删除、Setup 与 Doctor。',
    icon: RadioTower,
  },
  {
    to: '/gateway',
    label: 'Gateway',
    title: 'Gateway',
    description: 'Gateway 状态、Start/Stop、Doctor 与日志。',
    icon: ServerCog,
  },
  {
    to: '/agents',
    label: 'Agents',
    title: 'Agents',
    description: 'Agent YAML 创建、编辑、校验与删除。',
    icon: Bot,
  },
  {
    to: '/settings',
    label: 'Settings',
    title: 'Settings',
    description: '项目级配置查看、校验与保存。',
    icon: Settings,
  },
];

export const fallbackPageMeta = {
  title: 'Dashboard',
  description: '当前页面尚未配置标题映射。',
};
