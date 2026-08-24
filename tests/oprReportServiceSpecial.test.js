import { beforeEach, jest, test } from '@jest/globals';

const mockQuery = jest.fn();
const mockGetSpecialReports = jest.fn();
const mockGetSpecialShortcodes = jest.fn();

jest.unstable_mockModule('../src/repository/db.js', () => ({ query: mockQuery }));
jest.unstable_mockModule('../src/model/linkReportKhususModel.js', () => ({
  getReportsTodayByClient: mockGetSpecialReports,
}));
jest.unstable_mockModule('../src/model/instaPostKhususModel.js', () => ({
  getShortcodesTodayByClient: mockGetSpecialShortcodes,
}));

const { generateDailySpecialAmplificationReport } = await import(
  '../src/service/oprReportService.js'
);

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSpecialReports.mockReset();
  mockGetSpecialShortcodes.mockReset();
});

test('laporan khusus hanya mengambil model khusus dan memiliki judul terpisah', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ user_id: 'operator-1' }] })
    .mockResolvedValueOnce({ rows: [{ nama: 'POLRES TEST' }] });
  mockGetSpecialReports.mockResolvedValue([
    {
      user_id: 'operator-1',
      instagram_link: 'https://instagram.com/p/report-1',
      facebook_link: 'https://facebook.com/report-1',
      twitter_link: 'https://x.com/report-1',
      tiktok_link: null,
      youtube_link: null,
    },
  ]);
  mockGetSpecialShortcodes.mockResolvedValue(['SPECIAL1']);

  const message = await generateDailySpecialAmplificationReport('POLRES_TEST');

  expect(mockGetSpecialReports).toHaveBeenCalledWith('POLRES_TEST', 'operator');
  expect(mockGetSpecialShortcodes).toHaveBeenCalledWith('POLRES_TEST');
  expect(message).toContain('*LAPORAN AMPLIFIKASI KHUSUS*');
  expect(message).toContain('https://www.instagram.com/p/SPECIAL1');
  expect(message).not.toContain('LAPORAN AMPLIFIKASI REGULER');
});

test('tidak mengirim laporan khusus ketika tidak ada bukti khusus', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'operator-1' }] });
  mockGetSpecialReports.mockResolvedValue([]);

  await expect(generateDailySpecialAmplificationReport('POLRES_TEST')).resolves.toBeNull();
  expect(mockGetSpecialShortcodes).not.toHaveBeenCalled();
});
