import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const root = process.cwd();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;let file=pathname==='/'?'index.html':pathname.slice(1);file=normalize(file).replace(/^(\.\.(\/|\\|$))+/, '');let p=join(root,file);if(!(await stat(p)).isFile())p=join(root,'index.html');const data=await readFile(p);res.writeHead(200,{'Content-Type':types[extname(p)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data)}catch{res.writeHead(404);res.end('Not found')}});
const port=Number(process.env.PORT)||3002;server.listen(port,()=>console.log(`EasySplit running at http://localhost:${port}`));
