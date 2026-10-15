const fs = require('fs');

function searchFromEnd(filePath, sizeToRead, terms) {
  if (!fs.existsSync(filePath)) {
    console.log('File not found:', filePath);
    return;
  }
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - sizeToRead);
  console.log(`Reading from ${filePath}: start ${start} of ${stat.size} bytes (${(sizeToRead / 1024 / 1024).toFixed(1)} MB)...`);

  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buffer, 0, buffer.length, start);
  fs.closeSync(fd);

  const text = buffer.toString('utf8');
  const lines = text.split('\n');
  console.log(`Read ${lines.length} lines.`);

  let matched = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    for (const term of terms) {
      if (l.toLowerCase().includes(term.toLowerCase())) {
        matched.push({ index: i, line: l.trim() });
        break;
      }
    }
  }

  console.log(`Matched lines: ${matched.length}`);
  for (const m of matched) {
    console.log(`[Line ${m.index}] ${m.line.slice(0, 200)}`);
  }
}

const terms = ['135807607', '074414a4e3a101d4', '3e5efc32', 'diniyar', 'yola'];
searchFromEnd('C:\\Users\\user\\.pm2\\logs\\smart-school-backend-out.log', 30 * 1024 * 1024, terms);
searchFromEnd('C:\\Users\\user\\.pm2\\logs\\smart-school-backend-error.log', 10 * 1024 * 1024, terms);
