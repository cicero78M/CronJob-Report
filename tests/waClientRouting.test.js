import { jest } from '@jest/globals';

const waDirectorate = { clientId: 'wa-direktorat' };
const waOperator = { clientId: 'wa-operator' };

beforeEach(() => {
  jest.resetModules();
});

async function loadRouting() {
  jest.unstable_mockModule('../src/service/waService.js', () => ({
    default: waDirectorate,
    waGatewayClient: waOperator,
  }));
  return import('../src/cron/waClientRouting.js');
}

test('directorate route uses WA Direktorat first and WA Operator only as backup', async () => {
  const { getDirectorateWaRoute } = await loadRouting();
  const route = getDirectorateWaRoute();

  expect(route.primaryClient).toBe(waDirectorate);
  expect(route.reportClient).toBe(waDirectorate);
  expect(route.fallbackClients).toEqual([
    { client: waDirectorate, label: 'WA-DIREKTORAT' },
    { client: waOperator, label: 'WA-OPERATOR' },
  ]);
});

test('operator route remains operator-first for operator-specific jobs', async () => {
  const { getOperatorWaRoute } = await loadRouting();
  const route = getOperatorWaRoute();

  expect(route.primaryClient).toBe(waOperator);
  expect(route.fallbackClients).toEqual([
    { client: waOperator, label: 'WA-OPERATOR' },
    { client: waDirectorate, label: 'WA-DIREKTORAT' },
  ]);
});
