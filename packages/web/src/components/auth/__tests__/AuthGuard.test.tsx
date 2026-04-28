import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthGuard, resolveAuthGuardDecision } from '../AuthGuard';
import { canAccessRole } from '@/router/roles';
import type { AuthStatus } from '@/stores/auth';
import type { WebUserRole } from '@/types';

describe('FEAT-028 AuthGuard', () => {
  it('covers four statuses without allowing protected content before authentication', () => {
    const matrix: Array<[AuthStatus, ReturnType<typeof resolveAuthGuardDecision>]> = [
      ['initial', 'loading'],
      ['needs-bootstrap', 'bootstrap'],
      ['logged-out', 'login'],
      ['authenticated', 'allow'],
    ];
    for (const [status, decision] of matrix) {
      expect(resolveAuthGuardDecision({ status, role: 'viewer' })).toBe(decision);
    }
    expect(renderToString(<MemoryRouter><AuthGuard><span>protected-child</span></AuthGuard></MemoryRouter>)).toContain('加载中');
  });

  it('checks 4 roles against role hierarchy and returns forbidden when insufficient', () => {
    const roles: WebUserRole[] = ['viewer', 'operator', 'admin', 'owner'];
    for (const role of roles) {
      for (const required of roles) {
        expect(canAccessRole(role, required)).toBe(roles.indexOf(role) >= roles.indexOf(required));
        expect(resolveAuthGuardDecision({ status: 'authenticated', role, requireRole: required })).toBe(
          roles.indexOf(role) >= roles.indexOf(required) ? 'allow' : 'forbidden',
        );
      }
    }
  });
});
