const fs = require('fs');

function inspectLinesAround(filePath, sizeToRead, targetLine) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - sizeToRead);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buffer, 0, buffer.length, start);
  fs.closeSync(fd);

  const lines = buffer.toString('utf8').split('\n');
  const startIdx = Math.max(0, targetLine - 30);
  const endIdx = Math.min(lines.length - 1, targetLine + 30);

  console.log(`Printing lines ${startIdx} to ${endIdx}:`);
  for (let i = startIdx; i <= endIdx; i++) {
    console.log(`[${i}] ${lines[i]}`);
  }
}

inspectLinesAround('C:\\Users\\user\\.pm2\\logs\\smart-school-backend-out.log', 30 * 1024 * 1024, 281817);
