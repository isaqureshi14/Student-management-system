const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\Lenovo\\Desktop\\$PRO v3\\3parent_page.html', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
    if (line.includes('syncStateToUI')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
