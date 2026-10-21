const fs = require('fs');
const readline = require('readline');

async function searchLog() {
  const fileStream = fs.createReadStream('C:\\Users\\user\\.pm2\\logs\\smart-school-backend-out.log');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const matchingLines = [];
  for await (const line of rl) {
    if (line.includes('Prayer Scheduler') || line.includes('Pengingat Sholat') || line.includes('DHUHUR') || line.includes('Sidik') || line.includes('sidik')) {
      matchingLines.push(line);
      if (matchingLines.length > 50) {
        matchingLines.shift(); // keep last 50
      }
    }
  }

  console.log(`Found ${matchingLines.length} matching lines:`);
  matchingLines.forEach(l => console.log(l));
}

searchLog().catch(console.error);
