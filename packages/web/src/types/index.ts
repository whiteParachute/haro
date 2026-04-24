export type Theme = 'light' | 'dark' | 'system';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}
