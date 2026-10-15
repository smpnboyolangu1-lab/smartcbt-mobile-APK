const cur = new Date();
const y = cur.getFullYear();
const m = String(cur.getMonth() + 1).padStart(2, '0');
const d = String(cur.getDate()).padStart(2, '0');
const targetDateStr = `${y}-${m}-${d}`;
const startOfDay = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 0, 0, 0, 0);
const endOfDay = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 23, 59, 59, 999);

console.log("Current date:", cur.toString());
console.log("targetDateStr:", targetDateStr);
console.log("startOfDay:", startOfDay.toISOString(), startOfDay.toString());
console.log("endOfDay:", endOfDay.toISOString(), endOfDay.toString());

const andharaScan = new Date("2026-10-08T23:58:00.000Z");
console.log("andharaScan:", andharaScan.toISOString(), andharaScan.toString());
console.log("is andharaScan >= startOfDay?", andharaScan >= startOfDay);
console.log("is andharaScan <= endOfDay?", andharaScan <= endOfDay);
