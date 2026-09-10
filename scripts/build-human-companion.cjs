'use strict';
const fs=require('node:fs'),path=require('node:path');
fs.copyFileSync(path.resolve(__dirname,'../public/human-room-reader.js'),path.resolve(__dirname,'../extensions/huddle-read-only/human-room-reader.js'));
console.log('Read-only companion built. Load extensions/huddle-read-only as an unpacked browser extension.');
