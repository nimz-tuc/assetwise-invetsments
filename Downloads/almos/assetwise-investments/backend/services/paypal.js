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

function client() {

  return new paypal.core.PayPalHttpClient(
    environment()
  );

}

async function createOrder(amount, reference) {

  const request =
    new paypal.orders.OrdersCreateRequest();

  request.prefer(
    'return=representation'
  );

  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: reference,
        amount: {
          currency_code: 'USD',
          value: Number(amount).toFixed(2)
        }
      }
    ]
  });

  const response =
    await client().execute(request);

  return response.result;

}

async function captureOrder(orderID) {

  const request =
    new paypal.orders.OrdersCaptureRequest(
      orderID
    );

  request.requestBody({});

  const response =
    await client().execute(request);

  return response.result;

}

module.exports = {
  createOrder,
  captureOrder
};