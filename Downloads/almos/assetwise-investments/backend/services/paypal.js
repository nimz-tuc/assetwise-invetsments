const paypal = require('@paypal/checkout-server-sdk');
const cfg = require('../lib/config');

function environment() {
  return cfg.PAYPAL_ENV === 'live'
    ? new paypal.core.LiveEnvironment(
        cfg.PAYPAL_CLIENT_ID,
        cfg.PAYPAL_CLIENT_SECRET
      )
    : new paypal.core.SandboxEnvironment(
        cfg.PAYPAL_CLIENT_ID,
        cfg.PAYPAL_CLIENT_SECRET
      );
}

const client = () => new paypal.core.PayPalHttpClient(environment());

async function createOrder(amount, reference) {
  const req = new paypal.orders.OrdersCreateRequest();

  req.prefer('return=representation');

  req.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: reference,
      amount: {
        currency_code: 'USD',
        value: Number(amount).toFixed(2)
      }
    }]
  });

  const response = await client().execute(req);
  return response.result;
}

async function captureOrder(orderId) {
  const req = new paypal.orders.OrdersCaptureRequest(orderId);
  req.requestBody({});

  const response = await client().execute(req);
  return response.result;
}

module.exports = {
  createOrder,
  captureOrder
};