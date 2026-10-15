const fs = require('fs');
const readline = require('readline');

async function searchLog(filePath, terms) {
  if (!fs.existsSync(filePath)) {
    console.log('File not found:', filePath);
    return;
  }
  console.log(`Searching in ${filePath}...`);
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  let matches = [];

  for await (const line of rl) {
    lineCount++;
    for (const term of terms) {
      if (line.includes(term)) {
        matches.push({ lineNum: lineCount, term, line: line.slice(0, 300) });
        break;
      }
    }
  }

  console.log(`Finished ${filePath}, total lines: ${lineCount}, matches found: ${matches.length}`);
  // print last 30 matches
  for (const m of matches.slice(-30)) {
    console.log(`[L${m.lineNum}] ${m.line}`);
  }
}

async function main() {
  const terms = ['135807607', '074414a4e3a101d4', '3e5efc32-c620-41f2', 'YOLA', 'DINIYAR'];
  await searchLog('C:\\Users\\user\\.pm2\\logs\\smart-school-backend-out.log', terms);
  await searchLog('C:\\Users\\user\\.pm2\\logs\\smart-school-backend-error.log', terms);
}

main().catch(console.error);
