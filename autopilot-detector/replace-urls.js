const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

function processFiles(dir, isExtension) {
  walkDir(dir, (filePath) => {
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
    
    let text = fs.readFileSync(filePath, 'utf8');
    let originalText = text;
    
    const apiEnvStr = isExtension ? 'import.meta.env.VITE_API_URL' : 'process.env.NEXT_PUBLIC_API_URL';
    const wsEnvStr = isExtension ? 'import.meta.env.VITE_WS_URL' : 'process.env.NEXT_PUBLIC_WS_URL';
    
    // Replace "http://localhost:3001" or `http://localhost:3001`
    text = text.replace(/["'`]http:\/\/localhost:3001["'`]/g, '(${' + apiEnvStr + '} || "http://localhost:3001")');
    text = text.replace(/["'`]ws:\/\/localhost:3001["'`]/g, '(${' + wsEnvStr + '} || "ws://localhost:3001")');
    
    // For urls that are interpolated like: `http://localhost:3001/auth/login`
    // Wait, the Next.js fetch calls were: fetch("http://localhost:3001/auth/login")
    // If I replaced it with (`${process.env.NEXT_PUBLIC_API_URL} || "http://localhost:3001"`)/auth/login, it would be a syntax error.
    // Instead: fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/auth/login`)

    // Let's do this:
    // /"http:\/\/localhost:3001([^"]*)"/g
    text = text.replace(/"http:\/\/localhost:3001([^"]*)"/g, '`${' + apiEnvStr + ' || "http://localhost:3001"}$1`');
    text = text.replace(/'http:\/\/localhost:3001([^']*)'/g, '`${' + apiEnvStr + ' || "http://localhost:3001"}$1`');
    text = text.replace(/`http:\/\/localhost:3001([^`]*)`/g, '`${' + apiEnvStr + ' || "http://localhost:3001"}$1`');

    text = text.replace(/"ws:\/\/localhost:3001([^"]*)"/g, '`${' + wsEnvStr + ' || "ws://localhost:3001"}$1`');
    text = text.replace(/'ws:\/\/localhost:3001([^']*)'/g, '`${' + wsEnvStr + ' || "ws://localhost:3001"}$1`');
    text = text.replace(/`ws:\/\/localhost:3001([^`]*)`/g, '`${' + wsEnvStr + ' || "ws://localhost:3001"}$1`');

    if (text !== originalText) {
      fs.writeFileSync(filePath, text);
      console.log(`Updated ${filePath}`);
    }
  });
}

// Reset the files just in case
require('child_process').execSync('git checkout apps/web/ apps/extension/');

processFiles(path.join(__dirname, 'apps', 'web', 'app'), false);
processFiles(path.join(__dirname, 'apps', 'web', 'components'), false);
processFiles(path.join(__dirname, 'apps', 'web', 'contexts'), false);
processFiles(path.join(__dirname, 'apps', 'extension', 'src'), true);
console.log('Done replacing hardcoded URLs.');
