import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockGetPostsTodayByClient = jest.fn();
const mockGetPostsByClientOnJakartaDate = jest.fn();
const mockGetCommentsByVideoId = jest.fn();
const mockGetUsersByDirektorat = jest.fn();
const mockGetClientsByRole = jest.fn();
const mockSendDebug = jest.fn();

jest.unstable_mockModule('../src/db/index.js', () => ({ query: mockQuery }));
jest.unstable_mockModule('../src/model/tiktokPostModel.js', () => ({
  getPostsTodayByClient: mockGetPostsTodayByClient,
  getPostsByClientOnJakartaDate: mockGetPostsByClientOnJakartaDate,
  getPostsInAttendanceWindowByClient: jest.fn(),
  findPostByVideoId: jest.fn(),
  deletePostByVideoId: jest.fn(),
}));
jest.unstable_mockModule('../src/model/tiktokCommentModel.js', () => ({
  getCommentsByVideoId: mockGetCommentsByVideoId,
  deleteCommentsByVideoId: jest.fn(),
}));
jest.unstable_mockModule('../src/model/userModel.js', () => ({
  getClientsByRole: mockGetClientsByRole,
  getUsersByDirektorat: mockGetUsersByDirektorat,
  getUsersByClient: jest.fn(),
}));
jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendDebug: mockSendDebug,
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('builds analytical narrative with key metrics', async () => {
  mockGetPostsByClientOnJakartaDate.mockResolvedValue([
    { video_id: 'v1', caption: 'Caption A unggulan' },
    { video_id: 'v2', caption: 'Caption B evaluasi' },
  ]);
  mockGetCommentsByVideoId
    .mockResolvedValueOnce({ comments: [{ username: 'dita1' }, { username: 'polresa1' }] })
    .mockResolvedValueOnce({ comments: [{ username: 'dita1' }] });
  mockGetClientsByRole.mockResolvedValue(['polres_a', 'polres_b']);
  mockGetUsersByDirektorat.mockResolvedValue([
    { user_id: '1', client_id: 'DITBINMAS', tiktok: 'dita1', insta: '@dita', status: true },
    { user_id: '2', client_id: 'POLRES_A', tiktok: 'polresa1', insta: '@polresa', status: true },
    { user_id: '3', client_id: 'POLRES_A', tiktok: '', insta: '@backup', status: true },
    { user_id: '4', client_id: 'POLRES_B', tiktok: 'polresb1', insta: '@polresb', status: true },
  ]);
  mockQuery.mockImplementation(async (_sql, params) => {
    const cid = (params[0] || '').toString().toUpperCase();
    const mapping = {
      DITBINMAS: { nama: 'Direktorat Binmas', client_tiktok: '@ditbinmas', client_type: 'direktorat' },
      POLRES_A: { nama: 'POLRES A', client_tiktok: '@polresa', client_type: 'org' },
      POLRES_B: { nama: 'POLRES B', client_tiktok: '@polresb', client_type: 'org' },
    };
    return { rows: [mapping[cid] || mapping.POLRES_A] };
  });

  let lapharTiktokDitbinmas;
  await jest.isolateModulesAsync(async () => {
    ({ lapharTiktokDitbinmas } = await import('../src/handler/fetchabsensi/tiktok/absensiKomentarTiktok.js'));
  });

  const result = await lapharTiktokDitbinmas();

  expect(result.narrative).toMatch(/Urutan pelaksanaan tugas berdasarkan jumlah komentar/);
  expect(result.narrative).toMatch(/LAPORAN HARIAN MEDIA SOSIAL/);
  expect(result.narrative).toMatch(/Platform: TikTok/);
  expect(result.narrative).toMatch(/Aktivitas: Likes dan Komentar/);
  expect(result.narrative).toMatch(/Indikator Peringkat: Jumlah Likes dan Komentar/);
  expect(result.narrative).not.toMatch(/Top 5|Bottom 5/);
  expect(result.narrative).toMatch(/POLRES A/);
  expect(result.text).toMatch(/Distribusi komentar per konten:/);
  expect(result.text).toMatch(/1\. https:\/\/www\.tiktok\.com\/\@ditbinmas\/video\/v1 — 2 akun/);
  expect(result.narrative).toMatch(/DIREKTORAT BINMAS/);
});

test('returns empty-day message without top-bottom highlights when no tiktok content today', async () => {
  mockGetPostsByClientOnJakartaDate.mockResolvedValue([]);
  mockQuery.mockResolvedValue({
    rows: [{ nama: 'Direktorat Binmas', client_tiktok: '@ditbinmas', client_type: 'direktorat' }],
  });

  let lapharTiktokDitbinmas;
  await jest.isolateModulesAsync(async () => {
    ({ lapharTiktokDitbinmas } = await import('../src/handler/fetchabsensi/tiktok/absensiKomentarTiktok.js'));
  });

  const result = await lapharTiktokDitbinmas();

  expect(result.text).toBe('Tidak ada konten TikTok untuk DIREKTORAT BINMAS hari ini.');
  expect(result.narrative).toBeUndefined();
});

test('classifies missing username based on tiktok field, not insta field', async () => {
  mockGetPostsByClientOnJakartaDate.mockResolvedValue([{ video_id: 'v1', caption: 'Konten tes' }]);
  mockGetCommentsByVideoId.mockResolvedValue({ comments: [{ username: 'aktifTiktok' }] });
  mockGetClientsByRole.mockResolvedValue([]);
  mockGetUsersByDirektorat.mockResolvedValue([
    {
      user_id: '1',
      client_id: 'DITBINMAS',
      title: 'BRIPKA',
      nama: 'User Insta Ada',
      tiktok: '',
      insta: '@insta_ada',
      status: true,
    },
    {
      user_id: '2',
      client_id: 'DITBINMAS',
      title: 'BRIPKA',
      nama: 'User Tiktok Ada',
      tiktok: 'aktifTiktok',
      insta: '',
      status: true,
    },
  ]);
  mockQuery.mockResolvedValue({
    rows: [{ nama: 'DITBINMAS', client_tiktok: '@ditbinmas', client_type: 'direktorat' }],
  });

  let lapharTiktokDitbinmas;
  await jest.isolateModulesAsync(async () => {
    ({ lapharTiktokDitbinmas } = await import('../src/handler/fetchabsensi/tiktok/absensiKomentarTiktok.js'));
  });

  const result = await lapharTiktokDitbinmas();

  expect(result.text).toMatch(/\*DITBINMAS\* : 2 \/ 1 \/ 0 \/ 1 \/ 1 \/ 1/);
  expect(result.text).toMatch(/Belum Input Username TikTok : 1/);
  expect(result.text).toContain('User Insta Ada, TikTok Kosong');
  expect(result.text).not.toContain('User Tiktok Ada, TikTok Kosong');
});

afterAll(() => {
  jest.resetModules();
});
