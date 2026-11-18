import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const MAX_BYTES = 16384;
const NAME = /^[a-z][a-z0-9-]{0,63}$/;
export const COMPUTE_ALIASES_SKILL = 'compute-resource-aliases';
const digest = value => createHash('sha256').update(value).digest('hex');
const descriptions = {
 project_skill_catalog: 'List skills and return the absolute directory of the selected library. Use scope=user for the local workspace skill library across chats. Use scope=current for this project or private chat, including its project AGENTS.md.',
 read_project_skill: 'Read a local SKILL.md by name and return its absolute path. Use the same scope as the catalog entry.',
 write_project_skill: 'Save a local SKILL.md and return its absolute path. Explicitly set scope=user for the local workspace skill library. Use scope=current for a project- or chat-specific skill. Pass the previous SHA-256 in expected_sha256, or null to create.',
};

// Deliberately accept simple, single-line YAML fields only. Never inspect body text
// for metadata or silently interpret aliases, duplicate keys or multiline scalars.
function metadata(body, name) {
 if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BYTES) {
  throw Error('SKILL.md exceeds the text limit');
 }
 const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)?.[1];
 if (header === undefined) throw Error('SKILL.md requires opening frontmatter');
 const fields = {};
 for (const line of header.split(/\r?\n/)) {
  if (!line.trim() || line.trimStart().startsWith('#')) continue;
  const match = /^(name|description):[ \t]*(.+?)[ \t]*$/.exec(line);
  if (!match || Object.hasOwn(fields, match[1])) throw Error('Invalid skill frontmatter');
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!value.trim() || /^[>|*&!{[]/.test(value)) throw Error('Use simple skill metadata');
  fields[match[1]] = value;
 }
 if (fields.name !== name || !fields.description) throw Error('Skill frontmatter name must match the target and include description');
 return fields;
}

function assertDirectory(directory) {
 const stat = fs.lstatSync(directory);
 if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Unsafe skill workspace directory');
}

function ensureDirectory(directory) {
 const absolute = path.resolve(directory);
 const base = path.parse(absolute).root;
 let cursor = base;
 for (const part of path.relative(base, absolute).split(path.sep).filter(Boolean)) {
  cursor = path.join(cursor, part);
  if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, {mode: 0o700});
  assertDirectory(cursor);
 }
}

function containsDirectory(parent, child) {
 const relative = path.relative(parent, child);
 return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

const PROJECT_GUIDE = '# 项目提示词\n\n根据本项目的任务选择下方引用的技能。个人技能来自[用户技能库](../user/)，项目技能位于本目录。可在这里添加项目约定和技能链接。\n';

export class ProjectSkills {
 constructor({root, current, bundledRoot, previousRoots=[]}) {
  this.root = path.resolve(root);
  this.bundledRoot = bundledRoot && path.resolve(bundledRoot);
  this.previousRoots = new Set(previousRoots);
  this.current = current;
 }

 overlapsBundle(directory) {
  return !!this.bundledRoot && (containsDirectory(this.bundledRoot,directory) || containsDirectory(directory,this.bundledRoot));
 }

 ownsDirectory(directory) {
  for (const root of [this.root,...this.previousRoots]) {
   const first = path.relative(root,directory).split(path.sep)[0];
   if (/^(?:user|[a-f0-9]{64})$/i.test(first)) return true;
  }
  return false;
 }

 get personalDirectory() {
  return this.overlapsBundle(this.root) ? undefined : path.join(this.root,'user');
 }

 tools() {
  return Object.entries(descriptions).map(([name, description]) => {
   const write = name === 'write_project_skill';
   const catalog = name === 'project_skill_catalog';
   return {
    name, description,
    annotations: {readOnlyHint: !write, openWorldHint: false},
    inputSchema: {
     type: 'object',
     properties: {
      scope: {type: 'string', enum: ['current', 'user']},
      ...(catalog ? {} : {name: {type: 'string', pattern: NAME.source}}),
      ...(write ? {
       body: {type: 'string', maxLength: MAX_BYTES},
       expected_sha256: {oneOf: [{type: 'string'}, {type: 'null'}]},
      } : {}),
     },
     required: catalog ? [] : write ? ['name', 'body', 'expected_sha256'] : ['name'],
     additionalProperties: false,
    },
   };
  });
 }

 owns(name) { return Object.hasOwn(descriptions, name); }

 owner(scope) {
  const actual = this.current();
  if (scope?.checkCurrent?.() !== true || !actual?.threadId ||
      scope.provider !== actual.provider || scope.threadId !== actual.threadId || scope.projectId !== actual.projectId) {
   throw Error('Selected skill workspace changed');
  }
  return {kind: actual.projectId ? 'project' : 'conversation', id: actual.projectId || actual.provider + ':' + actual.threadId};
 }

 directory(scope, library = 'current') {
  const selected = this.owner(scope);
  if (this.overlapsBundle(this.root)) throw Error('Choose a skill cache separate from the built-in skill directory in Settings');
  if (!['current','user'].includes(library)) throw Error('Unknown skill library');
  const owner = library === 'user' ? {kind:'user'} : selected;
  const target = library === 'user' ? this.personalDirectory : path.join(this.root, digest(owner.kind + ':' + owner.id));
  ensureDirectory(target);
  return {target, owner};
 }

 read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw Error('Unsafe skill file');
  const body = fs.readFileSync(file, 'utf8');
  return {body, sha256: digest(body)};
 }

 projectGuide(target, projectId) {
  const file = path.join(target, 'AGENTS.md');
  if (!fs.existsSync(file)) {
   const initial=/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)?PROJECT_GUIDE.replace('# 项目提示词','# 项目提示词 · '+projectId):PROJECT_GUIDE;
   try { fs.writeFileSync(file, initial, {flag:'wx',mode:0o600}); }
   catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return {document:'AGENTS.md',relativePath:path.basename(target)+'/AGENTS.md',...this.read(file)};
 }

 referenceSkill(target, projectId, name, library, checkCurrent) {
  const guide = this.projectGuide(target,projectId);
  const link = (library === 'user' ? '../user/' : './') + name + '/SKILL.md';
  if (guide.body.includes(']('+link+')')) return;
  const line = '\n- [' + name + '](' + link + ')\n';
  if (Buffer.byteLength(guide.body + line) > MAX_BYTES) throw Error('Project AGENTS.md exceeds the text limit');
  const file = path.join(target,'AGENTS.md');
  const fd = fs.openSync(file,fs.constants.O_APPEND | fs.constants.O_WRONLY);
  try {
   const opened=fs.fstatSync(fd),current=fs.lstatSync(file);
   if (!opened.isFile() || current.isSymbolicLink() || opened.ino!==current.ino || opened.nlink!==1 || opened.size+Buffer.byteLength(line)>MAX_BYTES) throw Error('Project AGENTS.md changed');
   checkCurrent();
   fs.writeFileSync(fd,line);
  } finally { fs.closeSync(fd); }
 }

 catalog(target) {
  const skills = [];
  for (const name of fs.readdirSync(target).filter(name => NAME.test(name))) {
   const directory = path.join(target, name);
   assertDirectory(directory);
   let entry;
   try { entry = this.read(path.join(directory, 'SKILL.md')); }
   catch (error) {
    // A process interrupted before publication may leave a legacy empty directory.
    if (error.code === 'ENOENT') continue;
    throw error;
   }
   const fields = metadata(entry.body, name);
   skills.push({name, description: fields.description.slice(0, 240), sha256: entry.sha256});
  }
  return skills;
 }

 write(target, directory, file, args, checkCurrent) {
  metadata(args.body, args.name);
  const previous = fs.existsSync(file) ? this.read(file).sha256 : null;
  if (args.expected_sha256 !== previous) throw Error('Skill revision changed; read before saving');
  if (previous === null && this.catalog(target).length >= 64) throw Error('Project skill limit reached');
  checkCurrent();
  if (fs.existsSync(directory)) {
   const temporary = path.join(directory, '.' + randomUUID() + '.tmp');
   try {
    fs.writeFileSync(temporary, args.body, {flag: 'wx', mode: 0o600});
    checkCurrent();
    const actual = fs.existsSync(file) ? this.read(file).sha256 : null;
    if (actual !== previous) throw Error('Skill revision changed; read before saving');
    fs.renameSync(temporary, file);
   } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
   }
   return;
  }
  // Publish a complete new directory in one rename; failed writes leave no catalog entry.
  const staging = path.join(target, '.' + randomUUID() + '.tmp');
  fs.mkdirSync(staging);
  try {
   fs.writeFileSync(path.join(staging, 'SKILL.md'), args.body, {flag: 'wx', mode: 0o600});
   fs.renameSync(staging, directory);
  } finally {
   if (fs.existsSync(staging)) fs.rmSync(staging, {recursive: true});
  }
 }

 // Main-only owner of the confirmed aliases document. A background conversation
 // supplies its authenticated scope rather than borrowing the selected page.
 confirmedComputeAliases({checkCurrent, body, expectedSha256}) {
  const check = () => { if (checkCurrent?.() !== true) throw Error('Selected skill workspace changed'); };
  check();
  const target=path.join(this.root,'user'), name=COMPUTE_ALIASES_SKILL;
  const directory=path.join(target,name), file=path.join(directory,'SKILL.md');
  if (body === undefined && !fs.existsSync(target)) return null;
  ensureDirectory(target);
  if (fs.existsSync(directory)) assertDirectory(directory);
  if (body !== undefined) this.write(target,directory,file,{name,body,expected_sha256:expectedSha256},check);
  const result=fs.existsSync(file)?this.read(file):null;
  if (result) metadata(result.body,name);
  check();
  return result;
 }

 prepareRoot(directory) {
  const next = path.resolve(directory);
  if (!path.relative(this.root, next)) return this.root;
  if (this.overlapsBundle(next)) throw Error('Choose a skill cache separate from the built-in skill directory in Settings');
  if (containsDirectory(this.root, next) || containsDirectory(next, this.root)) throw Error('Choose independent skill cache directories');
  ensureDirectory(next);
  const probe = path.join(next, '.write-' + randomUUID());
  fs.writeFileSync(probe, '', {flag:'wx', mode:0o600});
  fs.unlinkSync(probe);
  if (!fs.existsSync(this.root)) return next;
  ensureDirectory(this.root);
  const copies = [], guides = [];
  for (const key of fs.readdirSync(this.root).filter(key => key === 'user' || /^[a-f0-9]{64}$/.test(key))) {
   const from = path.join(this.root, key);
   const to = path.join(next, key);
   assertDirectory(from);
   ensureDirectory(to);
   const existing = new Map(this.catalog(to).map(skill => [skill.name, skill.sha256]));
   const source = this.catalog(from);
   const guideFile=path.join(from,'AGENTS.md');
   if (key !== 'user' && fs.existsSync(guideFile)) {
    const guide=this.read(guideFile), destination=path.join(to,'AGENTS.md');
    if (!fs.existsSync(destination)) guides.push({guideFile,destination,sha256:guide.sha256});
    else if (this.read(destination).sha256 !== guide.sha256) throw Error('Conflicting project AGENTS.md in the chosen cache');
   }
   if (new Set([...existing.keys(), ...source.map(skill=>skill.name)]).size > 64) throw Error('Skill cache library limit reached');
   for (const {name, sha256} of source) {
    if (!existing.has(name)) {
     copies.push({from:path.join(from, name, 'SKILL.md'), to, name, sha256});
    } else if (existing.get(name) !== sha256) {
     throw Error('Conflicting SKILL.md in the chosen cache: ' + name);
    }
   }
  }
  for (const {from, to, name, sha256} of copies) {
   const entry = this.read(from);
   if (entry.sha256 !== sha256) throw Error('Skill changed while copying the local cache');
   const folder = path.join(to, name);
   if (fs.existsSync(folder)) assertDirectory(folder);
   this.write(to, folder, path.join(folder,'SKILL.md'), {name, body:entry.body, expected_sha256:null}, ()=>{});
  }
  for(const {guideFile,destination,sha256} of guides){
   const guide=this.read(guideFile);
   if(guide.sha256!==sha256)throw Error('Project AGENTS.md changed while copying');
   try{fs.writeFileSync(destination,guide.body,{flag:'wx',mode:0o600});}
   catch(error){if(error.code!=='EEXIST'||this.read(destination).sha256!==sha256)throw error;}
  }
  return next;
 }

 call(tool, args, scope) {
  const keys = tool === 'project_skill_catalog' ? ['scope'] : tool === 'read_project_skill' ? ['scope','name'] : ['scope','name', 'body', 'expected_sha256'];
  if (!this.owns(tool) || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key))) {
   throw Error('Invalid project skill arguments');
  }
  const {target, owner} = this.directory(scope,args.scope);
  if (tool === 'project_skill_catalog') {
   const skills = this.catalog(target);
   const instructions = owner.kind==='project'?this.projectGuide(target,owner.id):undefined;
   this.owner(scope);
   return {scope: owner.kind, directory: target, skills,...instructions&&{instructions}};
  }
  if (typeof args.name !== 'string' || !NAME.test(args.name)) throw Error('Invalid skill name');
  const directory = path.join(target, args.name);
  if (fs.existsSync(directory)) assertDirectory(directory);
  const file = path.join(directory, 'SKILL.md');
  let instructionsWarning;
  if (tool === 'write_project_skill') {
   if (owner.kind === 'user' && args.name === COMPUTE_ALIASES_SKILL) throw Error('Compute aliases require the human resource choice');
   this.write(target, directory, file, args,()=>this.owner(scope));
   if(scope.projectId){
    try{
     const {target:project,owner:projectOwner}=this.directory(scope);
     this.referenceSkill(project,projectOwner.id,args.name,args.scope,()=>this.owner(scope));
    }catch(error){this.owner(scope);instructionsWarning='Skill saved. Check the project AGENTS.md link: '+error.message;}
   }
  }
  const result = this.read(file);
  metadata(result.body, args.name);
  this.owner(scope);
  return {name: args.name, document: 'SKILL.md', scope: owner.kind, path: file, ...result,...instructionsWarning&&{instructionsWarning}};
 }
}
