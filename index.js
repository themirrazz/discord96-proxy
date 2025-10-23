const http = require('http');
const https = require('https');
const fs = require('fs');

const server = http.createServer((req, res) => {
    const uuu = new URL(`https://discord.com${req.url}`)
    if(uuu.pathname === '/embed') {
        res.writeHead(200, {
            'content-type': 'text/html',
            'access-control-allow-origin': 'https://windows96.net/',
            'x-frame-options': 'ALLOW-FROM https://windows96.net/'
        });
        res.write(fs.readFileSync('embed.html'));
        res.end();
        return;
    };
    if(uuu.pathname === '/app.js') {
        res.writeHead(200, {
            'content-type': 'text/javascript',
            'access-control-allow-origin': 'https://windows96.net/',
            'x-frame-options': 'ALLOW-FROM https://windows96.net/'
        });
        res.write(fs.readFileSync('app.js'));
        res.end();
        return;
    };
    req.headers['host'] = 'discord.com';
    req.headers['origin'] = 'https://discord.com/';
    const ask = https.request(
        `https://discord.com/${req.url}`,
        {
            headers: req.headers,
            method: req.method
        },
        ans => {
            ans.headers['access-control-allow-origin'] = 'https://windows96.net/';
            ans.headers['access-control-allow-headers'] = '*';
            ans.headers['access-control-allow-methods'] = '*';
            ans.headers['access-control-expose-headers'] = '*';
            res.writeHead(ans.statusCode, ans.headers);
            ans.on('data', chunk => res.write(chunk));
            ans.on('end', _ => res.end());
        }
    );
    req.on('data', chunk => ask.write(chunk));
    req.on('end', _ => ask.end());
});

server.listen(3000);
