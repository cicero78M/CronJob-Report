import waClient, { waGatewayClient } from '../service/waService.js';

const DIRECTORATE_ROUTE = Object.freeze({
  primaryClient: waClient,
  reportClient: waClient,
  fallbackClients: [
    { client: waClient, label: 'WA' },
    { client: waGatewayClient, label: 'WA-GATEWAY' },
  ],
});

const OPERATOR_ROUTE = Object.freeze({
  primaryClient: waGatewayClient,
  reportClient: waGatewayClient,
  fallbackClients: [
    { client: waGatewayClient, label: 'WA-GATEWAY' },
    { client: waClient, label: 'WA' },
  ],
});

export function getDirectorateWaRoute() {
  return DIRECTORATE_ROUTE;
}

export function getOperatorWaRoute() {
  return OPERATOR_ROUTE;
}
