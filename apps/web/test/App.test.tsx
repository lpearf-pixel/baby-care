import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';

const dadSession = {
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Dad',
  relationship: 'dad',
  permissionLevel: 'family_admin',
  familyId: '22222222-2222-4222-8222-222222222222',
  familyName: 'Xiangxiang Family',
  babyId: '33333333-3333-4333-8333-333333333333',
  babyDisplayName: 'xiangxiang',
} as const;

const nannySession = { ...dadSession, displayName: 'Nanny', relationship: 'nanny', permissionLevel: 'caregiver' } as const;

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    getSetupStatus: vi.fn(async () => ({ required: false })),
    setupFamily: vi.fn(async () => ({ status: 'created' })),
    login: vi.fn(async () => dadSession),
    logout: vi.fn(async () => undefined),
    getSession: vi.fn(async () => dadSession),
    getFamily: vi.fn(async () => ({ id: dadSession.familyId, name: 'Xiangxiang Family', timezone: 'Asia/Shanghai', status: 'active' })),
    updateFamily: vi.fn(),
    getBaby: vi.fn(async () => ({ id: dadSession.babyId, displayName: 'xiangxiang', birthDate: null, status: 'active' })),
    updateBaby: vi.fn(),
    listMembers: vi.fn(async () => [
      { membershipId: '44444444-4444-4444-8444-444444444444', displayName: 'Dad', relationship: 'dad', permissionLevel: 'family_admin', status: 'active' },
      { membershipId: '55555555-5555-4555-8555-555555555555', displayName: 'Mom', relationship: 'mom', permissionLevel: 'family_admin', status: 'active' },
    ]),
    createNanny: vi.fn(),
    setNannyStatus: vi.fn(),
    resetNannyPassword: vi.fn(),
    ...overrides,
  };
}

function renderWithApi(api: ReturnType<typeof fakeApi>) {
  render(<App {...({ api } as unknown as Record<string, never>)} />);
}

afterEach(() => cleanup());

describe('M1 Baby Care family workspace', () => {
  it('shows first-run setup with xiangxiang default and a non-persistent secret field', async () => {
    const api = fakeApi({
      getSetupStatus: vi.fn(async () => ({ required: true })),
      getSession: vi.fn(async () => { throw new Error('must not load session before setup'); }),
    });
    renderWithApi(api);

    expect(await screen.findByRole('heading', { name: '初始化家庭' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('xiangxiang')).toBeInTheDocument();
    const setupToken = screen.getByLabelText('Setup Token');
    expect(setupToken).toHaveAttribute('type', 'password');
    expect(setupToken).not.toHaveAttribute('autocomplete', 'on');
  });

  it('shows login when setup is complete but no session exists and keeps auth errors generic', async () => {
    const api = fakeApi({
      getSession: vi.fn(async () => { throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' }); }),
      login: vi.fn(async () => { throw Object.assign(new Error('bad'), { code: 'invalid_credentials' }); }),
    });
    renderWithApi(api);

    expect(await screen.findByRole('heading', { name: '登录 Baby Care' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('登录名'), { target: { value: 'dad' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('登录名或密码不正确')).toBeInTheDocument();
    expect(screen.queryByText(/dad.*不存在|用户不存在|密码错误/i)).not.toBeInTheDocument();
  });

  it('shows family-admin controls for Dad without inventing care state', async () => {
    const api = fakeApi();
    renderWithApi(api);

    expect((await screen.findAllByText('Dad')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: '家庭管理' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('xiangxiang')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加月嫂' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存宝宝资料' })).toBeInTheDocument();
    expect(screen.queryByText(/上次喂奶|正在睡眠|尿布|奶量/)).not.toBeInTheDocument();
  });

  it('shows Nanny a read-only family view and never renders admin actions', async () => {
    const api = fakeApi({ getSession: vi.fn(async () => nannySession) });
    renderWithApi(api);

    expect((await screen.findAllByText('Nanny')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: '家庭信息' })).toBeInTheDocument();
    await waitFor(() => expect(api.listMembers).toHaveBeenCalled());
    expect(screen.getAllByText('Mom').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '添加月嫂' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存宝宝资料' })).not.toBeInTheDocument();
  });
});
