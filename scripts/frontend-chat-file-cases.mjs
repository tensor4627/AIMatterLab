import assert from 'node:assert/strict';
import {zipSync} from 'fflate';

// Byte-complete document fixtures, built locally without routes to a PDF/Office service.
function pdf(text){
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
 ];
 const content=text?`BT /F1 12 Tf 40 148 Td (${text}) Tj ET`:'0 0 65 33 re f';
 objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
 let file='%PDF-1.4\n';
 const offsets=[0];
 for(const [index,object] of objects.entries()){
  offsets.push(Buffer.byteLength(file));file+=`${index+1} 0 obj\n${object}\nendobj\n`;
 }
 const offset=Buffer.byteLength(file);
 file+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('');
 file+=`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
 return Buffer.from(file);
}
const archive=entries=>Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name,text])=>[name,Buffer.from(text)])))).toString('base64');
const word=text=>`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
const name=(name,mimeType,base64)=>({name,mimeType,base64});

export async function frontendChatFileCases({check}){
 await check('chat-file-experience-local-file-decoder',async page=>{
  const sheet='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const draw='http://schemas.openxmlformats.org/drawingml/2006/main';
  const files=[
   name('input.lammps','application/octet-stream',Buffer.from('# 温度\nvariable T equal 350\n').toString('base64')),
   name('run.log','text/plain',Buffer.concat([Buffer.from([255,254]),Buffer.from('步骤 120\n350 K','utf16le')]).toString('base64')),
   name('trace.csv','text/csv',Buffer.from('time,temperature\n0,350\n').toString('base64')),
   name('pixel.png','application/octet-stream','iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWM4ZhAJAAMPAVB8H27FAAAAAElFTkSuQmCC'),
   name('experiment.pdf','application/pdf',pdf('Measured temperature 350 K').toString('base64')),
   name('scan.pdf','application/pdf',pdf('').toString('base64')),
   name('report.docx','application/octet-stream',archive({'word/document.xml':word('实验温度 350 K')})),
   name('runs.xlsx','application/octet-stream',archive({
    'xl/sharedStrings.xml':`<sst xmlns="${sheet}"><si><t>Temperature</t></si></sst>`,
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="${sheet}"><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1"><v>350</v></c></row></sheetData></worksheet>`,
   })),
   name('review.pptx','application/octet-stream',archive({
    'ppt/slides/slide1.xml':`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${draw}"><a:p><a:r><a:t>350 K phase review</a:t></a:r></a:p></p:sld>`,
   })),
   name('binary.dat','application/octet-stream',Buffer.from([0,137,0,255,9,2,0,128]).toString('base64')),
   name('truncated.png','image/png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWM4ZhAJAAMPAVB8H27FAAAAAElFTkSuQmCC','base64').subarray(0,29).toString('base64')),
   name('fake.jpg','image/jpeg',Buffer.from('This does not have an image signature').toString('base64')),
   name('too-large.docx','application/octet-stream',archive({'word/document.xml':word('x'.repeat(4*1024*1024+1))})),
   name('doctype.docx','application/octet-stream',archive({'word/document.xml':'<!DOCTYPE document>'+word('blocked XML entity declaration')})),
  ];
  const receipts=await page.evaluate(async files=>{
   // Use the production script and worker restrictions for modules and workers
   // loaded during extraction. The regression harness itself is already running.
   const meta=document.createElement('meta');
   meta.httpEquiv='Content-Security-Policy';
   meta.content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'";
   document.head.append(meta);
   const {readChatFile}=await import('/frontend/features/conversations/read-chat-file.ts');
   const result={};
   for(const {name,mimeType,base64} of files){
    const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0)),file=new File([bytes],name,{type:mimeType});
    try{
     const value=await readChatFile(file);
     result[name]='text'in value?{text:value.text,mimeType:value.mimeType}:{bytes:value.bytes.length,mimeType:value.mimeType};
    }catch(error){result[name]={error:String(error.message)};}
   }
   return result;
  },files);
  assert.equal(receipts['input.lammps'].text,'# 温度\nvariable T equal 350\n');
  assert.equal(receipts['run.log'].text,'步骤 120\n350 K');
  assert.equal(receipts['trace.csv'].text,'time,temperature\n0,350\n');
  assert.equal(receipts['pixel.png'].mimeType,'image/png');assert(receipts['pixel.png'].bytes>24);
  assert.match(receipts['experiment.pdf'].text||JSON.stringify(receipts['experiment.pdf']),/Measured temperature 350 K/);
  assert.match(receipts['scan.pdf'].error,/没有可读取的文本层/);
  assert.match(receipts['report.docx'].text,/实验温度 350 K/);
  assert.match(receipts['runs.xlsx'].text,/Temperature\t\t350/);
  assert.match(receipts['review.pptx'].text,/350 K phase review/);
  assert.match(receipts['binary.dat'].error,/转换为 UTF-8 文本/);
  assert.match(receipts['truncated.png'].error,/无法解码/);
  assert.match(receipts['fake.jpg'].error,/需要是有效的/);
  assert.match(receipts['too-large.docx'].error,/解压后的内容太大/);
  assert.match(receipts['doctype.docx'].error,/XML 实体/);
 });
 await check('chat-file-experience-terminal-draft-adoption',async page=>{
  await page.evaluate(()=>{
   const fixture=window.__test,original=window.studio.invoke;
   const conversation={id:'codex:terminal-draft-owner',provider:'codex',threadId:'terminal-draft-owner',name:'Local terminal',projectId:null,taskId:null};
   const file={id:'8ccf769f-f724-4c1e-8f7d-64fbac28c344',name:'notes.txt',kind:'text',mimeType:'text/plain',size:18};
   let session={sessionId:'local-shell',name:'Local fixture',kind:'local',mode:'interactive',owner:'human',ownerEpoch:1,alive:true,status:'running',sequence:0};
   let opened=false;
   window.studio.invoke=async(method,data)=>{
    if(method==='agent.attachments.import'){fixture.upload=data;return [file];}
    if(method==='agent.attachments.preview'){
     if(data.threadId!==conversation.threadId||data.provider!==conversation.provider||data.id!==file.id)throw Error('Incorrect adopted file owner');
     return {file,text:fixture.upload.files[0].text};
    }
    if(method==='compute.sshService.status')return {status:'disconnected',workflowReady:false};
    if(method==='compute.resource.status')return {schemaVersion:1,selectionId:null,kind:null,status:'none'};
    if(method==='sharedTerminal.open'){opened=true;return session;}
    if(method==='sharedTerminal.list')return {sessions:opened?[session]:[]};
    if(method==='sharedTerminal.read')return {...session,output:'',cursor:0,dropped:false};
    if(method==='sharedTerminal.resize')return {accepted:true};
    if(method==='sharedTerminal.owner'){
     fixture.handoff=data;
     if(data.provider!==conversation.provider||data.attachmentDraftId!==fixture.upload?.draftId)throw Error('No matching blank draft for handoff');
     session={...session,owner:'agent',ownerEpoch:2};
     return {...session,conversation,adoptedDraftId:data.attachmentDraftId};
    }
    if(method==='conversation.remember'&&data.threadId===conversation.threadId)return conversation;
    if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return {thread:{id:conversation.threadId,turns:[]},model:'fixture-model'};
    return original(method,data);
   };
   return window.renderTest('App');
  });
  const composer=page.locator('.composer textarea');
  await composer.fill('Unsent terminal instructions');
  await page.getByTestId('chat-file-picker').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('Original draft\n')});
  await page.getByTestId('chat-file-chip').waitFor();
  const open=page.getByRole('button',{name:'本地终端',exact:true});
  if(!await open.isVisible())await page.getByTestId('toggle-bottom-panel').click();
  await open.click();
  await page.getByTestId('shared-terminal-handoff').click();
  await page.getByTestId('shared-terminal-handoff').filter({hasText:'我来操作'}).waitFor();
  await page.waitForFunction(()=>localStorage.getItem('studio.conversation')==='codex:terminal-draft-owner');
  assert.deepEqual(await page.evaluate(()=>window.__test.handoff),{
   sessionId:'local-shell',ownerEpoch:1,owner:'agent',provider:'codex',attachmentDraftId:await page.evaluate(()=>window.__test.upload.draftId),
  });
  assert.equal(await composer.inputValue(),'Unsent terminal instructions');
  await page.getByTestId('chat-file-chip').getByRole('button',{name:'notes.txt',exact:true}).click();
  await page.getByTestId('chat-file-preview').getByText('Original draft',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='agent.rpc'&&call.data.method==='turn/start').length),0);
 });
}
