import {getDocument,PDFWorker,VerbosityLevel} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {ChatFileReadError,checkedText,collectText} from './chat-file-text';

const limitPages=256,maxReadMs=15000;

export async function readPdfText(bytes:Uint8Array){
 // Use the bundled worker directly. PDF.js otherwise tries a fake worker in
 // the renderer when a local module worker fails to load.
 let port:Worker;
 try{port=new Worker(workerUrl,{type:'module'});}catch{
  throw new ChatFileReadError('无法启动本地 PDF 读取程序。请导出为纯文本后添加。');
 }
 const worker=PDFWorker.create({port,verbosity:VerbosityLevel.ERRORS});
 const options={
  data:bytes,worker,verbosity:VerbosityLevel.ERRORS,
  disableRange:true,disableStream:true,disableAutoFetch:true,
  useWorkerFetch:false,useWasm:false,useSystemFonts:false,disableFontFace:true,
  isEvalSupported:false,stopAtErrors:true,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,
 };
 const task=getDocument(options);
 let deadline:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{
  deadline=setTimeout(()=>reject(new ChatFileReadError('PDF 读取超时。请拆分文档，或导出相关页面为文本。')),maxReadMs);
  port.addEventListener('error',event=>{event.preventDefault();reject(new ChatFileReadError('无法加载本地 PDF 读取程序。请导出为纯文本后添加。'));},{once:true});
 });
 try{
  const text=await Promise.race([extract(),timeout]);
  return checkedText(text,'PDF 没有可读取的文本层。扫描件可先做文字识别或导出为文本。');
 }catch(error){
  if(error instanceof ChatFileReadError)throw error;
  if(error instanceof Error&&error.name==='PasswordException')throw new ChatFileReadError('PDF 有密码保护。请先保存可读取的副本。');
  throw new ChatFileReadError('无法提取 PDF 文字。请选择可复制文字的 PDF，或导出相关页面为文本。');
 }finally{
  clearTimeout(deadline);
  // A malformed PDF can leave a worker request outstanding. Stop that worker
  // even when its library cleanup cannot obtain a response.
  void task.destroy().catch(()=>{});
  worker.destroy();
  port.terminate();
 }

 async function extract(){
  const pdf=await task.promise;
  if(pdf.numPages>limitPages)throw new ChatFileReadError('PDF 超过 256 页。请选择相关页面另存后添加。');
  const output=collectText();
  for(let number=1;number<=pdf.numPages;number++){
   const page=await pdf.getPage(number),reader=page.streamTextContent().getReader();
   let pageHasText=false;
   try{
    for(;;){
     const {value,done}=await reader.read();
     if(done)break;
     for(const item of value.items){
      if(!('str' in item))continue;
      if(!pageHasText&&item.str.trim()){output.append((number>1?'\n\n':'')+'[Page '+number+']\n');pageHasText=true;}
      if(pageHasText)output.append(item.str+(item.hasEOL?'\n':' '));
     }
    }
   }finally{
    void reader.cancel().catch(()=>{});
    reader.releaseLock();
    page.cleanup();
   }
  }
  return output.text();
 }
}
