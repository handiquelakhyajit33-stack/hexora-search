// ============================================================
// PAYPAL PAYMENT INTEGRATION
// ============================================================

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_MODE =
  (process.env.PAYPAL_MODE || "sandbox").toLowerCase();

const PAYPAL_BASE_URL =
  PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

function paypalConfigured() {
  return Boolean(
    PAYPAL_CLIENT_ID &&
    PAYPAL_CLIENT_SECRET
  );
}

async function getPayPalAccessToken() {
  if (!paypalConfigured()) {
    throw new Error("PayPal is not configured");
  }

  const credentials = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error_description ||
      data?.error ||
      "PayPal authentication failed"
    );
  }

  return data.access_token;
}

async function paypalRequest(
  path,
  {
    method = "GET",
    body = null,
    requestId = null,
  } = {}
) {
  const accessToken =
    await getPayPalAccessToken();

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  if (requestId) {
    headers["PayPal-Request-Id"] =
      requestId;
  }

  const response = await fetch(
    `${PAYPAL_BASE_URL}${path}`,
    {
      method,
      headers,
      body: body
        ? JSON.stringify(body)
        : undefined,
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.details?.[0]?.description ||
      data?.error_description ||
      `PayPal request failed: ${response.status}`;

    const error = new Error(message);
    error.status = response.status;
    error.paypal = data;
    throw error;
  }

  return data;
}

async function createPayPalOrder({
  amount,
  currency = "USD",
  description = "HEXORA Ads balance",
}) {
  const numericAmount =
    Number(amount);

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0
  ) {
    throw new Error(
      "Invalid PayPal payment amount"
    );
  }

  const safeCurrency =
    String(currency)
      .trim()
      .toUpperCase();

  if (!/^[A-Z]{3}$/.test(safeCurrency)) {
    throw new Error(
      "Invalid PayPal currency"
    );
  }

  return paypalRequest(
    "/v2/checkout/orders",
    {
      method: "POST",
      requestId:
        `hexora-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`,
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            description:
              String(description)
                .slice(0, 127),

            amount: {
              currency_code:
                safeCurrency,
              value:
                numericAmount.toFixed(2),
            },
          },
        ],
        application_context: {
          brand_name: "HEXORA",
          user_action: "PAY_NOW",
          shipping_preference:
            "NO_SHIPPING",
        },
      },
    }
  );
}

async function capturePayPalOrder(
  orderId
) {
  if (!orderId) {
    throw new Error(
      "PayPal order ID is required"
    );
  }

  return paypalRequest(
    `/v2/checkout/orders/${encodeURIComponent(
      orderId
    )}/capture`,
    {
      method: "POST",
      requestId:
        `hexora-capture-${orderId}`,
      body: {},
    }
  );
}
