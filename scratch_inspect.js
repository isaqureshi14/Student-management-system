const fs = require('fs');

const files = ['2student_page.html', '3parent_page.html', '4teacher_page.html', '5owner_page.html'];

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    console.log(`\n=== Theme load in ${file} ===`);
    lines.forEach((line, idx) => {
        if (line.includes("localStorage.getItem('theme')") || line.includes("localStorage.getItem(\"theme\")") || line.includes("toggleDarkMode")) {
            // print 10 lines around
            const start = Math.max(0, idx - 5);
            const end = Math.min(lines.length - 1, idx + 10);
            for (let i = start; i <= end; i++) {
                console.log(`${i+1}: ${lines[i].trim()}`);
            }
        }
    });
});
