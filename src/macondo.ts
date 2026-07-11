import type { MacondoOrderResponse } from "./types.js";

export async function getMacondoOrder(macondoOrderId: number): Promise<MacondoOrderResponse> {
  const baseUrl = process.env.MACONDO_API_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MACONDO_SERVICE_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("Macondo API configuration is missing");
  }

  const response = await fetch(
    `${baseUrl}/api/service/amazon-otp-proxy/orders/${encodeURIComponent(macondoOrderId)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (response.status === 401) {
    throw new Error("Macondo authentication failed");
  }

  if (response.status === 404) {
    throw new Error(`Macondo order ${macondoOrderId} was not found`);
  }

  if (!response.ok) {
    throw new Error(`Macondo API failed with HTTP ${response.status}`);
  }

  return (await response.json()) as MacondoOrderResponse;
}
