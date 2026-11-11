require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

module.exports = {
  BRAND: 'AssetWise Investments',
  PORT: num(process.env.PORT, 5000),
  IS_PROD: process.env.NODE_ENV === 'production',
  CURRENCY: (process.env.CURRENCY || 'USD').toUpperCase(),
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1h',
  MIN_DEPOSIT: num(process.env.MIN_DEPOSIT, 500),
  MAX_DEPOSIT: num(process.env.MAX_DEPOSIT, 50000),
  MIN_WITHDRAWAL: num(process.env.MIN_WITHDRAWAL, 100),
  MAX_AMOUNT: 10000000,
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || '',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://127.0.0.1:5500,http://localhost:5500').split(',').map(s => s.trim()).filter(Boolean),
  TRUST_PROXY: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
  // Paystack (online card payments). Secret key goes ONLY in .env, never in chat or code.
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',
  PAYSTACK_BASE_URL: (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co').replace(/\/$/, ''),
  PUBLIC_URL_SET: !!process.env.PUBLIC_URL,
  PUBLIC_URL: (process.env.PUBLIC_URL || `http://localhost:${num(process.env.PORT, 5000)}`).replace(/\/$/, ''),
  // Where customers send money. Shown on the Deposit screen. Leave blank until you have them.
  PAY: {
    usdt_trc20: process.env.USDT_TRC20_ADDRESS || '',
    usdt_erc20: process.env.USDT_ERC20_ADDRESS || '',
  },
};
