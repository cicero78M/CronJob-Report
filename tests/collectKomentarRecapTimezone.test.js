import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockGetUsersByDirektorat = jest.fn();
const mockGetClientsByRole = jest.fn();
const mockGetUsersByClient = jest.fn();
const mockGetPostsByClientOnJakartaDate = jest.fn();
const mockGetPostsInAttendanceWindowByClient = jest.fn();
const mockGetCommentsByVideoId = jest.fn();
const mockSendDebug = jest.fn();

jest.unstable_mockModule('../src/db/index.js', () => ({ query: mockQuery }));
jest.unstable_mockModule('../src/model/userModel.js', () => ({
  getUsersByDirektorat: mockGetUsersByDirektorat,
  getClientsByRole: mockGetClientsByRole,
  getUsersByClient: mockGetUsersByClient,
}));
jest.unstable_mockModule('../src/model/tiktokPostModel.js', () => ({
  getPostsByClientOnJakartaDate: mockGetPostsByClientOnJakartaDate,
  getPostsInAttendanceWindowByClient: mockGetPostsInAttendanceWindowByClient,
  findPostByVideoId: jest.fn(),
  deletePostByVideoId: jest.fn(),
}));
jest.unstable_mockModule('../src/model/tiktokCommentModel.js', () => ({
  getCommentsByVideoId: mockGetCommentsByVideoId,
  deleteCommentsByVideoId: jest.fn(),
}));
jest.unstable_mockModule('../src/utils/constants.js', () => ({ hariIndo: [] }));
jest.unstable_mockModule('../src/utils/utilsHelper.js', () => ({
  groupByDivision: () => ({}),
  sortDivisionKeys: () => [],
  formatNama: () => '',
  groupUsersByDivisionStatus: () => ({}),
}));
jest.unstable_mockModule('../src/utils/sqlPriority.js', () => ({
  getNamaPriorityIndex: () => 0,
}));
jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendDebug: mockSendDebug,
}));

let collectKomentarRecap;

beforeEach(() => {
  jest.clearAllMocks();
});

test('collectKomentarRecap forwards referenceDate to Jakarta calendar-day post query', async () => {
  const originalTZ = process.env.TZ;
  process.env.TZ = 'UTC';
  mockQuery.mockResolvedValueOnce({
    rows: [{ nama: 'POLRES A', client_tiktok: '@polresa', client_type: 'org' }],
  });
  mockGetUsersByDirektorat.mockResolvedValue([]);
  mockGetClientsByRole.mockResolvedValue([]);
  mockGetUsersByClient.mockResolvedValue([]);
  mockGetPostsByClientOnJakartaDate.mockResolvedValue([{ video_id: 'VID-1' }]);
  mockGetCommentsByVideoId.mockResolvedValue({ comments: [] });

  try {
    await jest.isolateModulesAsync(async () => {
      ({ collectKomentarRecap } = await import(
        '../src/handler/fetchabsensi/tiktok/absensiKomentarTiktok.js'
      ));
    });

    const referenceDate = new Date('2024-01-01T18:00:00.000Z');
    await collectKomentarRecap('polres_a', { selfOnly: true, referenceDate });

    expect(mockGetPostsByClientOnJakartaDate).toHaveBeenCalledWith(
      'polres_a',
      referenceDate
    );
    expect(mockGetPostsInAttendanceWindowByClient).not.toHaveBeenCalled();
  } finally {
    process.env.TZ = originalTZ;
  }
});

test('collectKomentarRecap can explicitly use attendance window query when requested', async () => {
  mockQuery.mockResolvedValueOnce({
    rows: [{ nama: 'POLRES A', client_tiktok: '@polresa', client_type: 'org' }],
  });
  mockGetUsersByDirektorat.mockResolvedValue([]);
  mockGetClientsByRole.mockResolvedValue([]);
  mockGetUsersByClient.mockResolvedValue([]);
  mockGetPostsInAttendanceWindowByClient.mockResolvedValue([{ video_id: 'VID-2' }]);
  mockGetCommentsByVideoId.mockResolvedValue({ comments: [] });

  await jest.isolateModulesAsync(async () => {
    ({ collectKomentarRecap } = await import(
      '../src/handler/fetchabsensi/tiktok/absensiKomentarTiktok.js'
    ));
  });

  const referenceDate = new Date('2024-01-01T18:00:00.000Z');

  await collectKomentarRecap('polres_a', {
    selfOnly: true,
    referenceDate,
    useAttendanceWindow: true,
  });

  expect(mockGetPostsInAttendanceWindowByClient).toHaveBeenCalledWith(
    'polres_a',
    referenceDate
  );
  expect(mockGetPostsByClientOnJakartaDate).not.toHaveBeenCalled();
});
