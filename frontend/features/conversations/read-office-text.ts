import {Unzip,UnzipInflate} from 'fflate';
import {ChatFileReadError,checkedText,collectText,decodeUnicode} from './chat-file-text';

type OfficeFormat='docx'|'xlsx'|'pptx';
const usefulParts:Record<OfficeFormat,RegExp>={
 docx:/^word\/(document|footnotes|endnotes|header\d+|footer\d+)\.xml$/,
 xlsx:/^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/,
 pptx:/^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml)$/,
};
const entryLimit=4*1024*1024,xmlLimit=12*1024*1024,entryCountLimit=2048;
const byNumber=new Intl.Collator('en',{numeric:true}).compare;
const malformed=()=>new ChatFileReadError('无法读取此 Office 文档。请打开后重新保存为 DOCX、XLSX、PPTX 或导出为文字。');
const tooLarge=()=>new ChatFileReadError('文档解压后的内容太大。请复制相关段落、表格或幻灯片到较小的文件。');

function localXml(bytes:Uint8Array){
 const xml=decodeUnicode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new ChatFileReadError('文档包含外部或自定义 XML 实体。请另存为普通文档后重试。');
 const document=new DOMParser().parseFromString(xml,'application/xml');
 if(document.querySelector('parsererror'))throw malformed();
 return document;
}

function readParts(bytes:Uint8Array,format:OfficeFormat){
 const contents=new Map<string,Uint8Array>(),parts=new Set<string>();
 let inflated=0,entries=0;
 const zip=new Unzip(file=>{
  if(++entries>entryCountLimit)throw tooLarge();
  if(!usefulParts[format].test(file.name))return;
  if(parts.has(file.name))throw malformed();
  if(file.originalSize&&file.originalSize>entryLimit)throw tooLarge();
  parts.add(file.name);
  const chunks:Uint8Array[]=[];
  let length=0;
  file.ondata=(error,chunk,done)=>{
   if(error)throw error instanceof ChatFileReadError?error:malformed();
   length+=chunk.length;inflated+=chunk.length;
   if(length>entryLimit||inflated>xmlLimit)throw tooLarge();
   chunks.push(chunk);
   if(!done)return;
   const bytes=new Uint8Array(length);let offset=0;
   for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   contents.set(file.name,bytes);
  };
  file.start();
 });
 zip.register(UnzipInflate);
 // Small compressed chunks also bound any one deflate callback's allocation.
 for(let offset=0;offset<bytes.length;offset+=1024)zip.push(bytes.subarray(offset,offset+1024),offset+1024>=bytes.length);
 if(!contents.size||contents.size!==parts.size)throw malformed();
 return new Map([...contents].map(([name,contents])=>[name,localXml(contents)]));
}

const elements=(node:Document|Element|undefined,name:string)=>node?[...node.getElementsByTagNameNS('*',name)]:[];
const textOf=(element:Element|undefined)=>element?.textContent||'';
const textRuns=(part:Element)=>elements(part,'t').map(textOf).join('');
type TextCollector=ReturnType<typeof collectText>;

function wordText(parts:Map<string,XMLDocument>,output:TextCollector){
 if(!parts.has('word/document.xml'))throw malformed();
 const filenames=['word/document.xml',...[...parts.keys()].filter(name=>name!=='word/document.xml').sort(byNumber)];
 for(const name of filenames)for(const paragraph of elements(parts.get(name),'p')){
  for(const part of paragraph.getElementsByTagNameNS('*','*')){
   if(part.localName==='t'&&part.namespaceURI===paragraph.namespaceURI)output.append(textOf(part));
   if(part.localName==='tab')output.append('\t');
   if(part.localName==='br'||part.localName==='cr')output.append('\n');
  }
  output.append('\n');
 }
}

function relationships(parts:Map<string,XMLDocument>,path:string,prefix:string){
 const values=new Map<string,string>();
 for(const entry of elements(parts.get(path),'Relationship')){
  const id=entry.getAttribute('Id'),target=entry.getAttribute('Target');
  if(!id||!target||entry.getAttribute('TargetMode')==='External')continue;
  const resolved=target.startsWith('/')?target.slice(1):prefix+target;
  if(parts.has(resolved))values.set(id,resolved);
 }
 return values;
}
function relationshipId(element:Element){return [...element.attributes].find(attribute=>attribute.localName==='id'&&attribute.prefix)?.value||'';}
function spreadsheetColumn(reference:string|null,next:number){
 const letters=reference?.match(/^([A-Z]{1,3})[1-9]\d*$/)?.[1];
 if(!letters)return next;
 let column=0;
 for(const letter of letters)column=column*26+letter.charCodeAt(0)-64;
 return column>=next&&column<=16384?column:next;
}

function sheetText(parts:Map<string,XMLDocument>,output:TextCollector){
 const shared=elements(parts.get('xl/sharedStrings.xml'),'si').map(textRuns);
 const links=relationships(parts,'xl/_rels/workbook.xml.rels','xl/');
 const named=elements(parts.get('xl/workbook.xml'),'sheet').flatMap(sheet=>{
  const path=links.get(relationshipId(sheet));return path?[{path,label:sheet.getAttribute('name')||path}]:[];
 });
 const selected=named.length?named:[...parts.keys()].filter(path=>path.startsWith('xl/worksheets/')).sort(byNumber).map(path=>({path,label:path.split('/').at(-1)!.replace('.xml','')}));
 for(const {path,label} of selected){
  const rows=elements(parts.get(path),'row');
  let hasContent=false;
  for(const row of rows){
   const cells=elements(row,'c').map(cell=>{
    const type=cell.getAttribute('t'),value=textOf(elements(cell,'v')[0]),formula=textOf(elements(cell,'f')[0]);
    const text=type==='s'?shared[Number(value)]||'':type==='inlineStr'?textRuns(cell):value||(formula?'='+formula:'');
    return {reference:cell.getAttribute('r'),text};
   });
   if(!cells.some(cell=>cell.text.trim()))continue;
   if(!hasContent){output.append('['+label+']\n');hasContent=true;}
   let previous=0;
   for(const cell of cells){
    const column=spreadsheetColumn(cell.reference,previous+1);
    const blanks=column-previous-(previous?0:1);
    if(blanks)output.append('\t'.repeat(blanks));
    output.append(cell.text);
    previous=column;
   }
   output.append('\n');
  }
 }
}

function slideText(parts:Map<string,XMLDocument>,output:TextCollector){
 const links=relationships(parts,'ppt/_rels/presentation.xml.rels','ppt/');
 const order=elements(parts.get('ppt/presentation.xml'),'sldId').flatMap(slide=>links.get(relationshipId(slide))||[]);
 const selected=order.length?order:[...parts.keys()].filter(path=>path.startsWith('ppt/slides/')).sort(byNumber);
 for(const [index,path] of selected.entries()){
  const paragraphs=elements(parts.get(path),'p').map(textRuns).filter(text=>text.trim());
  if(!paragraphs.length)continue;
  output.append('[Slide '+(index+1)+']\n');
  for(const paragraph of paragraphs)output.append(paragraph+'\n');
 }
}

export async function readOfficeText(bytes:Uint8Array,format:OfficeFormat){
 try{
  const parts=readParts(bytes,format),output=collectText();
  if(format==='docx')wordText(parts,output);
  if(format==='xlsx')sheetText(parts,output);
  if(format==='pptx')slideText(parts,output);
  return checkedText(output.text(),'此文档没有可读取的文字。请导出文本或选择含文字的文件。');
 }catch(error){if(error instanceof ChatFileReadError)throw error;throw malformed();}
}
