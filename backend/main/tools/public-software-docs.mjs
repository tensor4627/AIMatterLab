import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {lookup} from 'node:dns';
import {BlockList,isIP} from 'node:net';
import {releaseToolNameKey,releaseToolNames,releaseToolSourcePath} from '../../../contracts/tools/release-tool-sources.mjs';

const reserved=new BlockList();
for(const [prefix,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
 ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],
 ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])reserved.addSubnet(prefix,bits,'ipv4');
for(const [prefix,bits] of [['2001::',23],['2001:db8::',32],['2002::',16]])reserved.addSubnet(prefix,bits,'ipv6');
export function publicAddress(address){
 const type=isIP(address);
 return type===4?!reserved.check(address,'ipv4'):type===6&&/^[23]/.test(address)&&!reserved.check(address,'ipv6');
}
export function publicSoftwareUrl(value){
 const url=new URL(value);
 const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!host.includes('.')&&!isIP(host)||
    /(?:^|\.)(localhost|local|internal|test|invalid)\.?$/.test(host)||isIP(host)&&!publicAddress(host))throw Error('Select a public HTTPS software source');
 return url;
}

// Validate the actual addresses used by the socket, including after each redirect.
export async function openPublicSoftware(value,{signal=AbortSignal.timeout(20000),accept='*/*',redirects=4}={}){
 const url=publicSoftwareUrl(value);
 const response=await new Promise((resolve,reject)=>{
  const req=https.get(url,{signal,agent:false,headers:{Accept:accept,'User-Agent':'AIMatterLab-public-software'},
   lookup(host,options,callback){
    lookup(host,{all:true,verbatim:true},(error,addresses)=>{
     if(error)return callback(error);
     if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))return callback(Error('The software source resolved to a non-public address'));
     if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
    });
   }},resolve);
  req.on('error',reject);
 });
 if([301,302,303,307,308].includes(response.statusCode)&&response.headers.location){
  response.destroy();
  if(redirects<=0)throw Error('Too many software source redirects');
  return openPublicSoftware(new URL(response.headers.location,url),{signal,accept,redirects:redirects-1});
 }
 if(response.statusCode!==200){response.destroy();throw Error('Software source returned HTTP '+response.statusCode);}
 return {url:url.href,response};
}

async function readPublic(url,options){
 const {url:final,response}=await openPublicSoftware(url,options);
 const chunks=[];let bytes=0;
 for await(const chunk of response){
  bytes+=chunk.length;
  if(bytes>2*1024*1024){response.destroy();throw Error('This documentation page is too large');}
  chunks.push(chunk);
 }
 return {url:final,type:response.headers['content-type']||'',text:Buffer.concat(chunks).toString('utf8')};
}

const term={type:'string',minLength:1,maxLength:100};
const searchSources={type:'string',enum:['bundled','public'],default:'bundled',description:'Bundled reads the local release inventory. Public queries GitHub and PyPI.'};
const literatureQuery={type:'string',minLength:1,maxLength:240};
const literatureLimit={type:'integer',minimum:1,maximum:10,default:5};
const definition=(name,description,properties,required)=>({name,description,inputSchema:{type:'object',additionalProperties:false,properties,required},
 annotations:{readOnlyHint:true,openWorldHint:true}});
export const softwareDocDefinitions=[
 definition('search_software_docs','Use {} for the bundled AIMatterLab release inventory offline. The default bundled scope stays local for any name or version, including misses. Read its guidance_functions with read_scientific_skill. Set sources to public and supply a public software name to query GitHub and PyPI. Public checks can run in parallel with local reads when in scope. guide_url points upstream.',{software:term,version:term,sources:searchSources},[]),
 definition('read_software_docs','Fetch public HTTPS software documentation or readable publication pages. This check can run in parallel with local evidence collection when in scope. Stay local for explicit offline or internal-only requests. Check the returned text before describing a work\'s findings. Read bundled material by its exact read_scientific_skill document ID.',{url:{type:'string',maxLength:2048}},['url']),
 definition('search_scientific_literature','Search Crossref for public scientific literature and citations unless the user requests offline or internal-only research. Use public topic keywords, titles, or citation terms. Keep project files, private details and credentials out of the query. Returns bibliographic records with DOI links. Use read_software_docs for a separate read of a publicly accessible publication page or abstract.',{query:literatureQuery,limit:literatureLimit},['query'])
];

function metadataText(value,maxLength){
 return typeof value==='string'?value.replace(/[\s\u0000-\u001f\u007f]+/g,' ').trim().slice(0,maxLength):'';
}

function literatureRecord(item){
 const doi=typeof item?.DOI==='string'?item.DOI.trim():'';
 const title=metadataText(Array.isArray(item?.title)?item.title[0]:null,512);
 if(!title||doi.length>512||!doi.isWellFormed()||!/^10\.\d+(?:\.\d+)*\/[^\s\u0000-\u001f\u007f]+$/i.test(doi))return null;
 const slash=doi.indexOf('/');
 const authorList=Array.isArray(item.author)?item.author:[];
 const authors=authorList.slice(0,8).map(author=>metadataText(author?.name,120)||
  [metadataText(author?.given,80),metadataText(author?.family,80)].filter(Boolean).join(' ')).filter(Boolean);
 const year=item.published?.['date-parts']?.[0]?.[0];
 return {title,doi,url:'https://doi.org/'+doi.slice(0,slash+1)+encodeURIComponent(doi.slice(slash+1)),authors,
  ...(authorList.length>8?{authors_truncated:true}:{}),year:Number.isInteger(year)&&year>0?year:null,
  publication:metadataText(Array.isArray(item['container-title'])?item['container-title'][0]:null,240)||null,type:metadataText(item.type,80)||null};
}

async function searchScientificLiterature(args,read){
 const {query:queryText,limit=literatureLimit.default}=args??{};
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!['query','limit'].includes(key))||
  typeof queryText!=='string'||!queryText.trim()||queryText.length>literatureQuery.maxLength||/[\u0000-\u001f\u007f]/.test(queryText)||
  !Number.isInteger(limit)||limit<literatureLimit.minimum||limit>literatureLimit.maximum)throw Error('Provide a short public literature query and a limit from 1 to 10');
 const query=queryText.trim(),url=new URL('https://api.crossref.org/works');
 url.searchParams.set('query.bibliographic',query);
 url.searchParams.set('rows',String(limit));
 url.searchParams.set('select','DOI,title,author,container-title,published,type');
 const receipt={source:'Crossref',source_url:url.href,scope:'bibliographic_metadata',query,limit};
 try{
  const doc=await read(url,{accept:'application/json',redirects:0});
  const response=JSON.parse(doc.text);
  if(response?.status!=='ok'||response['message-type']!=='work-list'||!Array.isArray(response.message?.items))throw Error('Invalid Crossref works response');
  return {...receipt,status:'passed',results:response.message.items.slice(0,limit).map(literatureRecord).filter(Boolean)};
 }catch{
  return {...receipt,status:'failed',code:'crossref_unavailable',reason:'Crossref did not return a usable works response.',results:[]};
 }
}

function catalogResult(tool,version){
 const source=new URL(tool.url.replace(/\.git$/,''));
 const guide=tool.guide.split('/').map(encodeURIComponent).join('/');
 const guideUrl=source.hostname==='github.com'
  ? 'https://raw.githubusercontent.com'+source.pathname+'/'+encodeURIComponent(tool.validated_commit)+'/'+guide
  : source.href+'/-/raw/'+encodeURIComponent(tool.validated_commit)+'/'+guide;
 return {...tool,source:source.href,guide_url:guideUrl,origin:'AIMatterLab tool source catalog',
  revision_scope:'The catalog records the reviewed upstream commit and shipped integration status. guide_url points upstream at that commit. Use guidance_functions for bundled references. Check the selected target for its environment, installation and test receipts.',
  ...version?{requested_version_match:version===tool.validated_commit?'exact_commit':'unverified'}:{}};
}

function pinnedGithubDocument(url){
 if(url.hostname!=='raw.githubusercontent.com'||url.search)return null;
 const [,owner,repo,revision,...file]=url.pathname.split('/');
 if(!owner||!repo||!/^[0-9a-f]{40}$/i.test(revision)||!(/\.(?:md|rst|txt|json|ya?ml)$/i.test(file.at(-1))))return null;
 return new URL('https://api.github.com/repos/'+owner+'/'+repo+'/contents/'+file.join('/')+'?ref='+revision);
}

export async function softwareDocs(name,args,read=readPublic,catalog=releaseToolSourcePath){
 if(name==='search_scientific_literature')return searchScientificLiterature(args,read);
 if(name==='read_software_docs'){
  if(!args||Object.keys(args).length!==1||typeof args.url!=='string'||args.url.length>2048)throw Error('Provide the public documentation URL');
  const url=publicSoftwareUrl(args.url);
  const contents=pinnedGithubDocument(url);
  let doc;
  if(contents){
   try{doc=await read(contents,{accept:'application/vnd.github.raw+json'});}
   catch{ /* The raw host also serves this exact commit if the API is unavailable. */ }
  }
  const fromContents=Boolean(doc);
  doc??=await read(url,{accept:'text/html,text/plain,text/markdown'});
  const githubText=fromContents&&/^application\/vnd\.github\.raw\+json(?:;|$)/i.test(doc.type);
  if(doc.text.includes('\0')||(!githubText&&!/^(text\/|application\/xhtml\+xml)/i.test(doc.type)))throw Error('A readable documentation page is required');
  const text=/html/.test(doc.type)?doc.text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]{1,4096}>/g,' ').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim():doc.text;
  return {source:fromContents?url.href:doc.url,...fromContents?{retrieved_from:doc.url}:{},text:text.slice(0,18000),truncated:text.length>18000};
 }
 const publicTerm=value=>typeof value==='string'&&/^[\p{L}\p{N}][\p{L}\p{N} ._+-]{0,99}$/u.test(value);
 const {software,version,sources:sourceScope=searchSources.default}=args??{};
 if(name!=='search_software_docs'||!args||typeof args!=='object'||Array.isArray(args)||
    Object.keys(args).some(key=>!['software','version','sources'].includes(key))||
    !searchSources.enum.includes(sourceScope)||
    (software!==undefined&&(typeof software!=='string'||!software.trim()||software.length>term.maxLength||/[\u0000-\u001f\u007f]/.test(software)))||
    (version!==undefined&&(!software||!publicTerm(version)))||
    (sourceScope==='public'&&!publicTerm(software)))throw Error('Provide a public software name and optional version. Choose bundled or public sources; public requires a name.');

 const summary={software:software??null,version:version??null,source_scope:sourceScope};
 if(sourceScope==='bundled'){
  let rows;
  try{rows=JSON.parse(await readFile(catalog,'utf8')).map(row=>catalogResult(row,version));}
  catch{
   return {...summary,status:'failed',match:'catalog_unavailable',results:[],
    sources:[{name:'AIMatterLab tool source catalog',status:'unavailable'}]};
  }
  const catalogSources=[{name:'AIMatterLab tool source catalog',status:'available'}];
  if(!software)return {...summary,status:'passed',match:'inventory',results:rows,sources:catalogSources};
  const key=releaseToolNameKey(software);
  const known=rows.find(row=>releaseToolNames(row).some(label=>releaseToolNameKey(label)===key));
  const match=known?(known.requested_version_match||'listed'):'not_listed';
  return {...summary,status:'passed',match,results:known?[known]:[],sources:catalogSources};
 }

 const gh=new URL('https://api.github.com/search/repositories');
 gh.searchParams.set('q',software+' in:name');gh.searchParams.set('per_page','5');
 const pypi='https://pypi.org/pypi/'+encodeURIComponent(software)+(version?'/'+encodeURIComponent(version):'')+'/json';
 const lookups=await Promise.allSettled([
  read(gh,{accept:'application/json'}).then(doc=>JSON.parse(doc.text).items.map(row=>({
   name:row.full_name,source:row.html_url,description:row.description,...version&&{requested_version_match:'unverified'}}))),
  read(pypi,{accept:'application/json'}).then(doc=>{
   const {info}=JSON.parse(doc.text);
   return [{name:info.name,version:info.version,source:info.package_url,links:info.project_urls,
    ...version&&{requested_version_match:version===info.version?'exact_version':'unverified'}}];
  }),
 ]);
 const results=lookups.flatMap(row=>row.status==='fulfilled'?row.value:[]);
 return {...summary,status:lookups.some(row=>row.status==='fulfilled')?'passed':'failed',results,
  sources:lookups.map((row,i)=>({name:i?'PyPI':'GitHub',status:row.status==='fulfilled'?'available':'unavailable',
   ...row.status==='rejected'&&{reason:row.reason?.message||'Software index unavailable'}}))};
}
