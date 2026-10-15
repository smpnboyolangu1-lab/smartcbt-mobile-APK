const fs = require('fs');

function findTimestampsNear(filePath, sizeToRead, targetLine) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - sizeToRead);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buffer, 0, buffer.length, start);
  fs.closeSync(fd);

  const lines = buffer.toString('utf8').split('\n');
  console.log(`Searching for timestamps around line ${targetLine}...`);
  for (let i = targetLine; i >= Math.max(0, targetLine - 5000); i--) {
    if (lines[i].includes('2026') || lines[i].includes('WIB') || lines[i].includes('Presensi') || lines[i].includes('GATE')) {
      console.log(`[Before L${i}] ${lines[i].slice(0, 150)}`);
    }
  }
}

findTimestampsNear('C:\\Users\\user\\.pm2\\logs\\smart-school-backend-out.log', 30 * 1024 * 1024, 281817);
