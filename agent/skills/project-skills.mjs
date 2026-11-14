import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const MAX_BYTES = 16384;
const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const descriptions = {
 project_skill_catalog: 'Discover saved user-authored skills in this selected project (or this chat when no project is selected). Read relevant entries each turn; instructions never grant permissions.',
 read_project_skill: 'Read a saved SKILL.md from the selected project micro workspace. No host paths accepted.',
 write_project_skill: 'Save a user-requested SKILL.md in the selected project micro workspace. Persisted and discovered immediately; no execution or permission changes. expected_sha256 must match catalog/read, or null for a new skill.',
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

export class ProjectSkills {
 constructor({root, current}) {
  this.root = path.resolve(root);
  this.current = current;
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
     properties: catalog ? {} : {
      name: {type: 'string', pattern: NAME.source},
      ...(write ? {body: {type: 'string', maxLength: MAX_BYTES}, expected_sha256: {type: ['string', 'null']}} : {}),
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

 directory(scope) {
  const owner = this.owner(scope);
  const target = path.join(this.root, digest(owner.kind + ':' + owner.id));
  // Check every ancestor, including the application-owned root. Never follow junctions.
  const parts = path.resolve(target).split(path.sep);
  let cursor = parts.shift() + path.sep;
  for (const part of parts) {
   cursor = path.join(cursor, part);
   if (fs.existsSync(cursor)) assertDirectory(cursor);
   else fs.mkdirSync(cursor);
  }
  return {target, owner};
 }

 read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw Error('Unsafe skill file');
  const body = fs.readFileSync(file, 'utf8');
  return {body, sha256: digest(body)};
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

 write(target, directory, file, args, scope) {
  metadata(args.body, args.name);
  const previous = fs.existsSync(file) ? this.read(file).sha256 : null;
  if (args.expected_sha256 !== previous) throw Error('Skill revision changed; read before saving');
  this.owner(scope);
  if (fs.existsSync(directory)) {
   const temporary = path.join(directory, '.' + randomUUID() + '.tmp');
   try {
    fs.writeFileSync(temporary, args.body, {flag: 'wx', mode: 0o600});
    fs.renameSync(temporary, file);
   } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
   }
   return;
  }
  if (this.catalog(target).length >= 64) throw Error('Project skill limit reached');
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

 call(tool, args, scope) {
  const keys = tool === 'project_skill_catalog' ? [] : tool === 'read_project_skill' ? ['name'] : ['name', 'body', 'expected_sha256'];
  if (!this.owns(tool) || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key))) {
   throw Error('Invalid project skill arguments');
  }
  const {target, owner} = this.directory(scope);
  if (tool === 'project_skill_catalog') {
   const skills = this.catalog(target);
   this.owner(scope);
   return {scope: owner.kind, skills};
  }
  if (typeof args.name !== 'string' || !NAME.test(args.name)) throw Error('Invalid skill name');
  const directory = path.join(target, args.name);
  if (fs.existsSync(directory)) assertDirectory(directory);
  const file = path.join(directory, 'SKILL.md');
  if (tool === 'write_project_skill') this.write(target, directory, file, args, scope);
  const result = this.read(file);
  metadata(result.body, args.name);
  this.owner(scope);
  return {name: args.name, document: 'SKILL.md', scope: owner.kind, ...result};
 }
}
