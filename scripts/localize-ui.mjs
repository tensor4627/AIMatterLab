import ts from 'typescript';import fs from 'node:fs';
for(const file of ['src/App.tsx','src/Agent.tsx','src/RunDetail.tsx','src/Dialogs.tsx','src/widgets.tsx']){
 let source=fs.readFileSync(file,'utf8');const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[];
 const chinese=value=>/[\u3400-\u9fff]/.test(value);
 function containsJsx(node){let found=false;function visit(n){if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)||ts.isJsxFragment(n))found=true;ts.forEachChild(n,visit);}visit(node);return found;}
 function visit(node){
  if(ts.isJsxText(node)&&chinese(node.text)){const value=node.text.trim();edits.push([node.pos,node.end,'{tr('+JSON.stringify(value)+')}']);}
  else if(ts.isJsxAttribute(node)&&node.initializer&&ts.isStringLiteral(node.initializer)&&chinese(node.initializer.text)&&['title','placeholder','aria-label','alt'].includes(node.name.text)){
   edits.push([node.initializer.getStart(tree),node.initializer.end,'{tr('+JSON.stringify(node.initializer.text)+')}']);
  }else if(ts.isJsxExpression(node)&&node.expression&&node.parent&&!ts.isJsxAttribute(node.parent)){
   const e=node.expression,text=e.getText(tree);
   if(!containsJsx(e)&&!/^t[r]?\(/.test(text)&&(chinese(text)||['label','title','body','t'].includes(text))){
    edits.push([e.getStart(tree),e.end,'tr('+text+')']);return;
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(tree);for(const [start,end,value] of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+value+source.slice(end);
 if(!source.includes("import {tr}"))source="import {tr} from './i18n';\n"+source;fs.writeFileSync(file,source);console.log(file,edits.length);
}
