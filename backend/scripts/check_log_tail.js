const fs = require('fs');

function checkTail(filePath, sizeToRead) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - sizeToRead);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buffer, 0, buffer.length, start);
  fs.closeSync(fd);

  const lines = buffer.toString('utf8').split('\n');
  console.log(`Total lines in buffer: ${lines.length}`);
  // check where attendance or scan or errors or yola appear
  const keywords = ['attendance', 'presensi', 'scan', 'gate', '135807607', 'yola', 'diniyar', 'VII-B', 'vii-b'];
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const match = keywords.some(k => l.toLowerCase().includes(k.toLowerCase()));
    if (match) {
      count++;
      if (count <= 100) {
        console.log(`[L${i}] ${l.slice(0, 180)}`);
      }
    }
  }
  console.log(`Total matching lines: ${count}`);
}

checkTail('C:\\Users\\user\\.pm2\\logs\\smart-school-backend-out.log', 20 * 1024 * 1024);
