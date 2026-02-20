const fs = require('fs');
const path = 'src/api/v1/modules/owner/owner.controller.ts';
let content = fs.readFileSync(path, 'utf8');
const newContent = content.replace(/asIntId\(req\.user\.id\)/g, 'asIntId(req.user?.id || req.auth?.userId)');
fs.writeFileSync(path, newContent);
console.log('Replaced occurrences.');
