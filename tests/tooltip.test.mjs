import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/Tooltip.tsx',import.meta.url),'utf8');
function fixture({width=1000,height=800,top=300,left=980,popupWidth=300,popupHeight=100,asChild=false}={}){
 let index=0,tree,clock=0,next=0;const hooks=[],timers=new Map(),listeners=new Map();
 let nullRef=0;const rect={left,top,bottom:top+20},popupRect={width:Math.min(popupWidth,width-16),height:Math.min(popupHeight,height-16)},window={innerWidth:width,innerHeight:height,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const react={isValidElement:value=>!!value?.type,cloneElement:(child,props,...children)=>({...child,props:{...child.props,...props,children}}),useId:()=> 'explanation-id',useRef:value=>{const i=index++;if(hooks[i])return hooks[i];const bounds=value===null?(nullRef++===0?rect:popupRect):null;return hooks[i]={current:value===null?{getBoundingClientRect:()=>bounds}:value};},useState:value=>{const i=index++;if(!(i in hooks))hooks[i]=value;return [hooks[i],v=>{hooks[i]=v;}];},useEffect:(fn,deps)=>{const i=index++,old=hooks[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();hooks[i]={deps,cleanup:fn()};}}};
 react.useLayoutEffect=react.useEffect;
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports','setTimeout','clearTimeout','window','document','Node',compiled)(name=>name==='react'?react:name==='react-dom'?{createPortal:node=>node}:{jsx,jsxs:jsx},module,module.exports,(fn,ms)=>{const id=++next;timers.set(id,{fn,at:clock+ms});return id;},id=>timers.delete(id),window,{body:{}},class Node {});
 function render(){index=0;tree=module.exports.default({content:'Saved inputs do not imply scientific validation.',children:asChild?{type:'summary',props:{children:'Inputs',onClick:()=> 'native-summary-handler'}}:'Inputs',asChild});return tree;}
 function advance(ms){clock+=ms;for(const [id,t] of timers)if(t.at<=clock){timers.delete(id);t.fn();}return render();}
 function unmount(){for(const hook of hooks)hook?.cleanup?.();}
 render();return {render,advance,unmount,timers,listeners};
}
function popup(node){return node.props.children[1];}
test('explanation delay, focus, Escape capture isolation and timer cleanup',()=>{
 const h=fixture();let n=h.render();assert.equal(n.props.tabIndex,0);n.props.onFocus();assert.equal(h.advance(399).props['aria-describedby'],undefined);
 n=h.advance(1);assert.equal(popup(n).props.role,'tooltip');assert.equal(popup(n).props.id,n.props['aria-describedby']);
 let prevented=0,stopped=0;h.listeners.get('keydown')({key:'Escape',preventDefault:()=>prevented++,stopPropagation:()=>stopped++});
 assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(popup(h.render()),false);assert(!h.listeners.has('keydown'),'closed explanation cannot capture parent Escape');
 n=h.render();n.props.onBlur();n.props.onFocus();h.unmount();assert.equal(h.timers.size,0);
});
for(const [label,options] of [['top',{top:2}],['bottom',{top:770}],['small viewport',{top:10,width:140,height:90,popupWidth:300,popupHeight:200}]])test('measured popup fits '+label,()=>{
 const h=fixture(options);h.render().props.onMouseEnter();h.advance(400);const tip=popup(h.render()),p=tip.props.style,w=options.width||1000,height=options.height||800;
 assert(p.left>=8);assert(p.top>=8);assert(p.left+Math.min(300,w-16)<=w-8);assert(p.top+Math.min(options.popupHeight||100,height-16)<=height-8);
 if(label==='top')assert(p.top>=29,'near-top anchor flips below');
 if(label==='bottom')assert(p.top<770,'bottom anchor uses above');
 assert.equal(p.maxHeight,'calc(100vh - 16px)');assert.equal(p.overflowY,'auto');h.unmount();
});
test('pointer crosses gap into popup without closing, then leaves and closes',()=>{
 const h=fixture();h.render().props.onMouseEnter();let n=h.advance(400);n.props.onMouseLeave();n=h.advance(100);assert(popup(n));popup(n).props.onMouseEnter();n=h.advance(200);assert(popup(n));popup(n).props.onMouseLeave();assert(popup(h.advance(179)));assert.equal(popup(h.advance(1)),false);h.unmount();
});
test('focus keeps popup on pointer leave; blur, scroll and unmount clean up',()=>{
 const h=fixture();h.render().props.onFocus();let n=h.advance(400);n.props.onMouseLeave();assert(popup(h.advance(200)));h.listeners.get('scroll')({target:null});assert.equal(popup(h.render()),false);
 n=h.render();n.props.onBlur();n.props.onMouseEnter();n=h.advance(400);n.props.onMouseLeave();h.unmount();assert.equal(h.timers.size,0);assert(!h.listeners.has('keydown'));
});

test('interactive summary is the actual trigger with no nested or duplicate focus stop',()=>{
 const h=fixture({asChild:true});let n=h.render();assert.equal(n.type,'summary');assert.equal(n.props.tabIndex,undefined);assert.equal(n.props.onClick(),'native-summary-handler');
 n.props.onFocus();h.advance(400);n=h.render();assert.equal(n.type,'summary');assert.equal(n.props['aria-describedby'],popup(n).props.id);assert.equal(n.props.children[0],'Inputs');h.unmount();
});
