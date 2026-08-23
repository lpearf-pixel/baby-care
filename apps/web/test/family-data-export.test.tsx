import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { BabyCareApiError, babyCareApi } from '../src/api-client.js';

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

const momSession = {
  ...dadSession,
  userId: '66666666-6666-4666-8666-666666666666',
  displayName: 'Mom',
  relationship: 'mom',
} as const;

const nannySession = { ...dadSession, displayName: 'Nanny', relationship: 'nanny', permissionLevel: 'caregiver' } as const;
const exportPrivateMarker = 'private-export-marker-4f0978';
const exportSerializedJson = JSON.stringify({ private: exportPrivateMarker, care: 'data' });

const emptyCareSummary = {
  asOf: '2026-08-13T08:00:00.000Z',
  lastFeeding: null,
  lastDiaper: null,
  rolling24h: {
    bottleTotalMl: 0,
    expressedBreastMilkMl: 0,
    formulaMl: 0,
    directBreastfeedingSessions: 0,
    directBreastfeedingMinutes: 0,
  },
  currentSleep: null,
} as const;

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
    getCareSummary: vi.fn(async () => emptyCareSummary),
    exportFamilyData: vi.fn(async () => ({
      blob: new Blob([exportSerializedJson], { type: 'application/json' }),
      filename: 'baby-care-export-20260817T120000Z.json',
    })),
    ...overrides,
  };
}

function renderWithApi(api: ReturnType<typeof fakeApi>) {
  render(<App {...({ api } as unknown as Record<string, never>)} />);
}

function expectExportPayloadAbsent(): void {
  expect(document.body.textContent).not.toContain(exportSerializedJson);
  expect(document.body.textContent).not.toContain(exportPrivateMarker);
}

function jsonResponse(
  contentDisposition: string | null,
  contentType = 'application/json; charset=utf-8',
  body = '{"private":"care data"}',
) {
  const headers = new Headers({ 'content-type': contentType });
  if (contentDisposition !== null) headers.set('content-disposition', contentDisposition);
  return new Response(body, { status: 200, headers });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('family data export download surface', () => {
  it('shows a Dad the private-data warning and download action without rendering export JSON', async () => {
    renderWithApi(fakeApi());

    expect(await screen.findByRole('heading', { name: '导出家庭数据' })).toBeInTheDocument();
    expect(screen.getByText('导出文件包含家庭和宝宝的私密护理资料。仅在受信任的设备上下载和保存。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载家庭数据' })).toBeEnabled();
    expectExportPayloadAbsent();
  });

  it('shows the same private export action to a Mom family admin', async () => {
    renderWithApi(fakeApi({ getSession: vi.fn(async () => momSession) }));

    expect(await screen.findByRole('heading', { name: '导出家庭数据' })).toBeInTheDocument();
    expect(screen.getByText('导出文件包含家庭和宝宝的私密护理资料。仅在受信任的设备上下载和保存。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载家庭数据' })).toBeEnabled();
    expectExportPayloadAbsent();
  });

  it('keeps the download action out of the Nanny DOM', async () => {
    renderWithApi(fakeApi({ getSession: vi.fn(async () => nannySession) }));

    expect(await screen.findByRole('heading', { name: '家庭信息' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '导出家庭数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载家庭数据' })).not.toBeInTheDocument();
  });

  it('disables a pending download and makes one request under a double click', async () => {
    const exportFamilyData = vi.fn(() => new Promise<{ blob: Blob; filename: string }>(() => undefined));
    renderWithApi(fakeApi({ exportFamilyData }));

    const download = await screen.findByRole('button', { name: '下载家庭数据' });
    fireEvent.click(download);
    fireEvent.click(download);

    expect(exportFamilyData).toHaveBeenCalledTimes(1);
    expect(download).toBeDisabled();
    expect(screen.getByText('正在准备下载…')).toBeInTheDocument();

  });

  it('downloads the generic filename, clicks an object URL, and revokes it without rendering export JSON', async () => {
    const createObjectURL = vi.fn(() => 'blob:family-export');
    const revokeObjectURL = vi.fn();
    const remove = vi.spyOn(HTMLAnchorElement.prototype, 'remove');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('baby-care-export-20260817T120000Z.json');
      expect(this.href).toBe('blob:family-export');
      expect(this.isConnected).toBe(true);
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    renderWithApi(fakeApi());

    fireEvent.click(await screen.findByRole('button', { name: '下载家庭数据' }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    expectExportPayloadAbsent();

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:family-export'));
  });

  it('allows a failed export to retry successfully without previewing private JSON', async () => {
    const exportFamilyData = vi
      .fn()
      .mockRejectedValueOnce(new BabyCareApiError('forbidden', exportPrivateMarker))
      .mockResolvedValueOnce({
        blob: new Blob([exportSerializedJson], { type: 'application/json' }),
        filename: 'baby-care-export-20260817T120000Z.json',
      });
    const createObjectURL = vi.fn(() => 'blob:family-export-retry');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderWithApi(fakeApi({ exportFamilyData }));

    const download = await screen.findByRole('button', { name: '下载家庭数据' });
    fireEvent.click(download);

    expect(await screen.findByText('下载失败，请稍后重试')).toBeInTheDocument();
    expect(download).toBeEnabled();
    expectExportPayloadAbsent();

    fireEvent.click(download);

    expect(await screen.findByText('下载已开始，请在浏览器下载中查看')).toBeInTheDocument();
    expect(exportFamilyData).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expectExportPayloadAbsent();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:family-export-retry'));
  });

  it('keeps the warning visible, enables retry, and redacts API error details', async () => {
    const exportFamilyData = vi.fn(async () => {
      throw new BabyCareApiError('forbidden', 'sensitive response details');
    });
    renderWithApi(fakeApi({ exportFamilyData }));

    fireEvent.click(await screen.findByRole('button', { name: '下载家庭数据' }));

    expect(await screen.findByText('下载失败，请稍后重试')).toBeInTheDocument();
    expect(screen.getByText('导出文件包含家庭和宝宝的私密护理资料。仅在受信任的设备上下载和保存。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载家庭数据' })).toBeEnabled();
    expect(screen.queryByText('sensitive response details')).not.toBeInTheDocument();
  });

  it('revokes a created object URL when the browser download click fails', async () => {
    const createObjectURL = vi.fn(() => 'blob:family-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('sensitive response details');
    });
    renderWithApi(fakeApi());

    fireEvent.click(await screen.findByRole('button', { name: '下载家庭数据' }));

    expect(await screen.findByText('下载失败，请稍后重试')).toBeInTheDocument();

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:family-export'));
  });
});

describe('BabyCareApi.exportFamilyData', () => {
  it('uses the dedicated credentialed binary request path for a JSON attachment', async () => {
    const fetchMock = vi.fn(async () => jsonResponse('attachment; filename="baby-care-export-20260817T120000Z.json"'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await babyCareApi.exportFamilyData();

    expect(fetchMock).toHaveBeenCalledWith('/api/family/export', { method: 'POST', credentials: 'include' });
    expect(result.filename).toBe('baby-care-export-20260817T120000Z.json');
    expect(result.blob.type).toMatch(/^application\/json/);
  });

  it('rejects a successful response that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('attachment; filename="baby-care-export-20260817T120000Z.json"', 'text/html')));

    await expect(babyCareApi.exportFamilyData()).rejects.toMatchObject({
      code: 'export_failed',
      message: '下载失败，请稍后重试',
    } satisfies Partial<BabyCareApiError>);
  });

  it.each([
    ['missing', null],
    ['malformed', 'attachment; filename="baby-care-export-20260817T120000Z.json"; filename*=UTF-8\'\'private.json'],
    ['private-looking', 'attachment; filename="xiangxiang-care-data.json"'],
  ])('replaces a %s response filename with a local generic UTC filename', async (_label, contentDisposition) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'));
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(contentDisposition)));

    const result = await babyCareApi.exportFamilyData();

    expect(result.filename).toBe('baby-care-export-20260817T120000Z.json');
  });
});
