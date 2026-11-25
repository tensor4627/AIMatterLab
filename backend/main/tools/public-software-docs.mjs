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
const definition=(name,description,properties,required)=>({name,description,inputSchema:{type:'object',additionalProperties:false,properties,required},
 annotations:{readOnlyHint:true,openWorldHint:true}});
export const softwareDocDefinitions=[
 definition('search_software_docs','With no arguments, list the bundled AIMatterLab tool source catalog offline. An exact software name returns its repository, reviewed commit, guide_url, integration_status and guidance_functions. The status describes the installed release. Read the guide with read_software_docs. Target configuration and test results come from that resource. Other names and unresolved versions can search public documentation. Send only a public product/package name and optional version.',{software:term,version:term},[]),
 definition('read_software_docs','Read a public HTTPS software manual. Use its source URL and version as references when configuring a tool.',{url:{type:'string',maxLength:2048}},['url'])
];

function catalogResult(tool,version){
 const source=new URL(tool.url.replace(/\.git$/,''));
 const guide=tool.guide.split('/').map(encodeURIComponent).join('/');
 const guideUrl=source.hostname==='github.com'
  ? 'https://raw.githubusercontent.com'+source.pathname+'/'+encodeURIComponent(tool.validated_commit)+'/'+guide
  : source.href+'/-/raw/'+encodeURIComponent(tool.validated_commit)+'/'+guide;
 return {...tool,source:source.href,guide_url:guideUrl,origin:'AIMatterLab tool source catalog',
  revision_scope:'The guide is pinned to the catalog commit. The integration status describes the shipped product. Check the selected target for its environment, installation and test receipts.',
  ...version?{requested_version_match:version===tool.validated_commit?'exact_commit':'unverified'}:{}};
}

function pinnedGithubDocument(url){
 if(url.hostname!=='raw.githubusercontent.com'||url.search)return null;
 const [,owner,repo,revision,...file]=url.pathname.split('/');
 if(!owner||!repo||!/^[0-9a-f]{40}$/i.test(revision)||!(/\.(?:md|rst|txt|json|ya?ml)$/i.test(file.at(-1))))return null;
 return new URL('https://api.github.com/repos/'+owner+'/'+repo+'/contents/'+file.join('/')+'?ref='+revision);
}

export async function softwareDocs(name,args,read=readPublic,catalog=releaseToolSourcePath){
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
 if(name!=='search_software_docs'||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!['software','version'].includes(key))||
    (args.software!==undefined&&(typeof args.software!=='string'||!args.software.length||args.software.length>100))||
    (args.version!==undefined&&(!args.software||!publicTerm(args.version))))throw Error('Provide a public software name and optional version');
 const summary={software:args.software??null,version:args.version||null};
 let rows=[];
 const catalogStatus={name:'AIMatterLab tool source catalog',status:'available'};
 try{rows=JSON.parse(await readFile(catalog,'utf8')).map(row=>catalogResult(row,args.version));}
 catch{catalogStatus.status='unavailable';}
 if(!args.software)return {...summary,results:rows,sources:[catalogStatus]};
 const key=releaseToolNameKey(args.software);
 const known=rows.find(row=>releaseToolNames(row).some(label=>releaseToolNameKey(label)===key));
 if(known&&(!args.version||known.requested_version_match==='exact_commit'))return {...summary,results:[known],sources:[catalogStatus]};
 if(!publicTerm(args.software)&&!known)throw Error('Provide a public software name and optional version');
 const gh=new URL('https://api.github.com/search/repositories');
 gh.searchParams.set('q',args.software+' in:name');gh.searchParams.set('per_page','5');
 const pypi='https://pypi.org/pypi/'+encodeURIComponent(args.software)+(args.version?'/'+encodeURIComponent(args.version):'')+'/json';
 const results=await Promise.allSettled([read(gh,{accept:'application/json'}).then(doc=>JSON.parse(doc.text).items.map(row=>({name:row.full_name,source:row.html_url,description:row.description}))),
  read(pypi,{accept:'application/json'}).then(doc=>{const {info}=JSON.parse(doc.text);return [{name:info.name,version:info.version,source:info.package_url,links:info.project_urls}];})]);
 const external=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 return {...summary,results:known?[known,...external]:external,
  sources:[...results.map((r,i)=>({name:i?'PyPI':'GitHub',status:r.status==='fulfilled'?'available':'unavailable',...r.status==='rejected'?{reason:r.reason.message}:{}})),catalogStatus]};
}
