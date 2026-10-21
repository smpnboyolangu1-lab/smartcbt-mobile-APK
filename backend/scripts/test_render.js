const http = require('http');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'cbt_prod_secret_f9a83b27c64e10d592a8174fec01849a62bc38102d7e481b9201948271039841';
const token = jwt.sign({ id: 'admin-1', username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/admin/remote-devices',
    method: 'GET',
    headers: {
        'Cookie': `admin_token=${token}; token=${token}`,
        'Authorization': `Bearer ${token}`
    }
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('HTTP Status:', res.statusCode);
        const galleryIdx = data.indexOf('id="galleryContainer"');
        if (galleryIdx !== -1) {
            const chunk = data.substring(galleryIdx, galleryIdx + 1200);
            console.log('--- galleryContainer HTML preview ---');
            console.log(chunk);
        } else {
            console.log('galleryContainer not found in HTML! Response length:', data.length);
        }
    });
});

req.on('error', (e) => console.error('Request error:', e));
req.end();
