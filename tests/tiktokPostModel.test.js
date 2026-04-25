import { jest } from '@jest/globals';

const mockQuery = jest.fn();

jest.unstable_mockModule('../src/repository/db.js', () => ({
  query: mockQuery,
}));

let getPostsTodayByClient;
let getVideoIdsTodayByClient;
let getPostsInAttendanceWindowByClient;
let countPostsByClient;

beforeAll(async () => {
  ({ getPostsTodayByClient, getVideoIdsTodayByClient, getPostsInAttendanceWindowByClient, countPostsByClient } = await import(
    '../src/model/tiktokPostModel.js'
  ));
});

beforeEach(() => {
  mockQuery.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

test('getPostsTodayByClient applies daily recap window (00:01 WIB until now) and orders results', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2024-07-01T17:00:00.000Z'));
  mockQuery
    .mockResolvedValueOnce({ rows: [{ client_type: 'instansi' }] })
    .mockResolvedValueOnce({ rows: [] });

  await getPostsTodayByClient('Client 1');

  expect(mockQuery).toHaveBeenNthCalledWith(
    2,
    expect.stringMatching(/AT TIME ZONE 'UTC'\)\s*AT TIME ZONE 'Asia\/Jakarta'\)\s+BETWEEN \$2::timestamp AND \$3::timestamp/i),
    ['client 1', '2024-07-02 00:01:00', '2024-07-02 00:00:00']
  );
  expect(mockQuery.mock.calls[1][0]).toMatch(/ORDER BY\s+created_at\s+ASC,\s+video_id\s+ASC/i);
});

test('getPostsTodayByClient applies role query for direktorat and falls back to client_id when role result is empty', async () => {
  const referenceDate = new Date('2024-06-30T17:00:00.000Z');

  mockQuery
    .mockResolvedValueOnce({ rows: [{ client_type: 'direktorat' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ video_id: 'vid-fallback' }] });

  const rows = await getPostsTodayByClient('Ditlantas', referenceDate);

  expect(mockQuery).toHaveBeenCalledTimes(3);
  expect(mockQuery.mock.calls[1][0]).toContain('JOIN tiktok_post_roles pr ON pr.video_id = p.video_id');
  expect(mockQuery.mock.calls[1][1]).toEqual(['ditlantas', '2024-07-01 00:01:00', '2024-07-01 00:00:00']);
  expect(mockQuery.mock.calls[2][0]).toContain('WHERE LOWER(TRIM(client_id)) = $1');
  expect(rows).toEqual([{ video_id: 'vid-fallback' }]);
});

test('getPostsTodayByClient uses execution time as daily window upper bound', async () => {
  const referenceDate = new Date('2024-06-30T20:05:20.000Z'); // 2024-07-01 03:05:20 WIB
  mockQuery
    .mockResolvedValueOnce({ rows: [{ client_type: 'instansi' }] })
    .mockResolvedValueOnce({ rows: [] });

  await getPostsTodayByClient('Client 5', referenceDate);

  expect(mockQuery.mock.calls[1][1]).toEqual([
    'client 5',
    '2024-07-01 00:01:00',
    '2024-07-01 03:05:20',
  ]);
});

test('getVideoIdsTodayByClient applies Jakarta date filter for reference date', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const referenceDate = new Date('2024-05-10T18:30:00.000Z');

  await getVideoIdsTodayByClient('Client 3', referenceDate);

  expect(mockQuery.mock.calls[0][0]).toMatch(/BETWEEN \$2::timestamptz AND \$3::timestamptz/i);
  expect(mockQuery.mock.calls[0][1][0]).toBe('client 3');
});

test('getPostsInAttendanceWindowByClient keeps attendance window filtering for operational attendance', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await getPostsInAttendanceWindowByClient('Client 9', new Date('2024-05-10T18:30:00.000Z'));

  expect(mockQuery.mock.calls[0][0]).toMatch(/BETWEEN \$2::timestamptz AND \$3::timestamptz/i);
  expect(mockQuery.mock.calls[0][1][0]).toBe('client 9');
});

test('countPostsByClient filters by client_id when no scope supplied', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ jumlah_post: '4' }] });

  const result = await countPostsByClient('C1', 'harian', undefined, undefined, undefined, {});

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain('COUNT(DISTINCT p.video_id)');
  expect(sql).toContain('LOWER(TRIM(p.client_id)) = LOWER($1)');
  expect(result).toBe(4);
});

test('countPostsByClient applies role join for directorate scope', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ jumlah_post: '2' }] });

  await countPostsByClient('DITA', 'harian', undefined, undefined, undefined, {
    role: 'dita',
    scope: 'direktorat',
  });

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain('LEFT JOIN tiktok_post_roles pr ON pr.video_id = p.video_id');
  expect(sql).toContain('LOWER(TRIM(p.client_id)) = LOWER($1)');
  expect(sql).toContain('OR LOWER(TRIM(pr.role_name)) = LOWER($1)');
});

test('countPostsByClient filters by regional_id when provided', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ jumlah_post: '3' }] });

  await countPostsByClient('C1', 'harian', undefined, undefined, undefined, {
    regionalId: 'jatim',
  });

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain('JOIN clients c ON c.client_id = p.client_id');
  expect(sql).toContain('UPPER(c.regional_id) = $2');
});

test('countPostsByClient keeps role join strategy for role-scope queries', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ jumlah_post: '0' }] });

  const result = await countPostsByClient('DITA', 'harian', undefined, undefined, undefined, {
    role: 'dita',
    scope: 'direktorat',
  });

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain('LEFT JOIN tiktok_post_roles pr ON pr.video_id = p.video_id');
  expect(result).toBe(0);
});

test('getVideoIdsTodayByClient treats late-night UTC as same Jakarta day', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const nearMidnightUtc = new Date('2024-02-29T17:30:00.000Z');

  await getVideoIdsTodayByClient('Client 4', nearMidnightUtc);

  const [, start, end] = mockQuery.mock.calls[0][1];
  expect(start).toMatch(/T10:00:00\.000Z$/);
  expect(end).toMatch(/T09:59:59\.000Z$/);
});

test('getPostsTodayByClient keeps calendar-day contract: H-1 17:01 WIB excluded from recap H', async () => {
  const referenceDate = new Date('2024-05-11T05:00:00.000Z'); // 12:00 WIB
  const expectedDate = toJakartaDateInput(referenceDate);

  mockQuery
    .mockResolvedValueOnce({ rows: [{ client_type: 'instansi' }] })
    .mockResolvedValueOnce({ rows: [] });

  await getPostsTodayByClient('Client 7', referenceDate);

  const sql = mockQuery.mock.calls[1][0];
  const params = mockQuery.mock.calls[1][1];
  expect(sql).toContain("AT TIME ZONE 'Asia/Jakarta'");
  expect(params[1]).toBe(expectedDate);
});

test('getPostsTodayByClient includes H 00:01 WIB in recap H via Jakarta date key', async () => {
  const referenceDate = new Date('2024-05-11T00:01:00+07:00');
  const expectedDate = '2024-05-11';

  mockQuery
    .mockResolvedValueOnce({ rows: [{ client_type: 'instansi' }] })
    .mockResolvedValueOnce({ rows: [] });

  await getPostsTodayByClient('Client 8', referenceDate);

  const params = mockQuery.mock.calls[1][1];
  expect(params[1]).toBe(expectedDate);
});
