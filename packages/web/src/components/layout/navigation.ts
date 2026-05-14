import { ClipboardCheck, type LucideIcon } from 'lucide-react';

export interface NavigationItem {
  to: string;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
  end?: boolean;
  requireRole?: 'viewer' | 'operator' | 'admin' | 'owner';
}

export const navigationItems: NavigationItem[] = [
  {
    to: '/',
    label: '提案 Review',
    title: '提案 Review',
    description: '审阅 Haro 自动生成的改动提案，批准、驳回或要求按方向修改。',
    icon: ClipboardCheck,
    end: true,
  },
];

export const fallbackPageMeta = {
  title: '提案 Review',
  description: 'Haro Web 只保留 sidecar 提案审阅工作台。',
};
