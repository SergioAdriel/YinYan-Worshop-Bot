/** Servidor local sin dependencias. Solo escucha en esta computadora. */
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,extname,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudentApi} from './student-api.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=resolve(project,process.argv.includes('--dist')?'dist':'web');
const port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT debe ser un puerto entre 1 y 65535.');
const origin=`http://127.0.0.1:${port}`;
const studentApi=createStudentApi({project,origin});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.pdf':'application/pdf','.ipynb':'application/x-ipynb+json'};
const aliases=new Map([
  ['/metrics.json',resolve(project,'reports/metrics.json')],
  ['/downloads/reporte-tecnico.pdf',resolve(project,'docs/reporte-tecnico.pdf')],
  ['/downloads/experimentacion.ipynb',resolve(project,'notebooks/experimentacion.ipynb')],
]);
function openBrowser(){
  if(!process.argv.includes('--open'))return;
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',origin]:[origin];
  const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
  const child=spawn(command,args,{windowsHide:true,stdio:'ignore'});
  child.on('error',()=>console.log(`Abre ${origin} en tu navegador.`));child.unref();
}
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,origin).pathname);
    if(await studentApi.handle(req,res,pathname))return;
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    if(pathname==='/health'||pathname==='/local-info.json'){
      const info={app:'yinyan-workshop',mode:'local',api_version:2,offline:true};
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(info));return;
    }
    let file=aliases.get(pathname);
    if(!file){
      file=resolve(root,`.${pathname}`);
      if(!file.startsWith(root+sep)&&file!==root){res.writeHead(403);res.end();return;}
    }
    if((await stat(file)).isDirectory())file=resolve(file,'index.html');
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':content.byteLength,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:content);
  }catch{res.writeHead(404,{'Content-Type':'text/plain;charset=utf-8'});res.end('Archivo no encontrado en esta copia local.');}
});
server.listen(port,'127.0.0.1',()=>{
  console.log(`\nYinYan Workshop - MODO LOCAL\n${origin}\nEl chatbot funciona sin internet. Mantén esta ventana abierta.\nCtrl+C para detener.\n`);openBrowser();
});
server.on('close',()=>studentApi.close());
process.on('exit',()=>studentApi.close());
server.on('error',async error=>{
  if(error.code==='EADDRINUSE'){
    try{const response=await fetch(`${origin}/health`,{signal:AbortSignal.timeout(1500)});const info=await response.json();if(info.app==='yinyan-workshop'){console.log(`YinYan Workshop ya está abierto en ${origin}`);openBrowser();return;}}catch{/* Otro programa usa el puerto. */}
    console.error(`El puerto ${port} está ocupado por otro programa. Cierra ese programa o usa PORT con otro número.`);
  }else console.error(`No se pudo iniciar: ${error.message}`);
  process.exitCode=1;
});
