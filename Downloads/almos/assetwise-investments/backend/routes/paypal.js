const crypto = require('crypto');
const express = require('express');
const { authenticate } = require('../lib/auth');
const { tx } = require('../lib/db');
const L = require('../services/ledger');
const paypal = require('../services/paypal');

const router = express.Router();

router.use(authenticate);

router.post('/deposits/paypal/create-order', async (req, res) => {

  const amount = Number(req.body.amount);

  if (!amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid amount'
    });
  }

  const reference =
    'AWPP' +
    crypto.randomBytes(8)
      .toString('hex')
      .toUpperCase();

  const deposit = await tx(client =>
    L.insertTx(client, {
      user_id: req.user.id,
      type: 'deposit',
      amount,
      status: 'pending',
      method: 'paypal',
      reference,
      note: 'Awaiting PayPal payment'
    })
  );

  const order = await paypal.createOrder(
    amount,
    reference
  );

  res.json({
    success: true,
    orderID: order.id,
    transactionId: deposit.id
  });

});

router.post('/deposits/paypal/capture-order', async (req, res) => {

  const { orderID, transactionId } = req.body;

  const result =
    await paypal.captureOrder(orderID);

  if (result.status !== 'COMPLETED') {
    return res.status(400).json({
      success: false,
      message: 'Payment not completed'
    });
  }

  await tx(async client => {

    await L.confirmDeposit(
      client,
      transactionId,
      {
        providerRef: orderID
      }
    );

  });

  res.json({
    success: true,
    message: 'Wallet credited successfully'
  });

});

module.exports = router;