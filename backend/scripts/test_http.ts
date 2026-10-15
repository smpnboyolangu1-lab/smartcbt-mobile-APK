import jwt from 'jsonwebtoken';
import http from 'http';

const SECRET_KEY = process.env.JWT_SECRET || 'cbt_prod_secret_f9a83b27c64e10d592a8174fec01849a62bc38102d7e481b9201948271039841';
const token = jwt.sign(
  { id: 'fa582370-4a33-49f6-9be2-a344a948c91b', username: '3134124579', role: 'STUDENT', name: 'AZKA TEGAR RAHMAT' },
  SECRET_KEY,
  { expiresIn: '7d' }
);

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/student/attendance-detail?month=10&year=2026',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('HTTP STATUS:', res.statusCode);
    try {
      const parsed = JSON.parse(body);
      console.log('SUCCESS:', parsed.success);
      console.log('HISTORY LENGTH:', parsed.history?.length);
      console.log('FIRST ITEM:', JSON.stringify(parsed.history?.[0]));
    } catch(e) {
      console.log('BODY:', body);
    }
  });
});

req.on('error', err => console.error('REQ ERROR:', err.message));
req.end();
