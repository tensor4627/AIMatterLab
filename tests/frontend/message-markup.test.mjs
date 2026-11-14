import test from 'node:test';import assert from 'node:assert/strict';
import {messageMarkup,inlineMarkup} from "../../frontend/features/conversations/message-markup.mjs";

const text=nodes=>nodes.map(n=>n.type==='strong'?text(n.children):n.text).join('');
test('scientific numbers and original text stay separate from presentation',()=>{const raw='已改为 **12** 步；温度 **300 K**，文件 `run.py`。';const original=raw;const tokens=inlineMarkup(raw);assert.equal(text(tokens),'已改为 12 步；温度 300 K，文件 run.py。');assert.equal(tokens.filter(n=>n.type==='strong').length,2);assert.deepEqual(tokens.find(n=>n.type==='code'),{type:'code',text:'run.py'});assert.equal(raw,original);});
test('closed code spans are literal even with nested markup and HTML-looking text',()=>{const raw='Use ``a ` b **c** <img>`` safely';assert.deepEqual(inlineMarkup(raw).find(n=>n.type==='code'),{type:'code',text:'a ` b **c** <img>'});});
test('unclosed bold and inline code remain literal during streaming',()=>{for(const raw of ['waiting **12','waiting __12','waiting `run.py','waiting ``run.py `'])assert.equal(text(inlineMarkup(raw)),raw);});
test('streaming closure changes presentation without losing suffix text',()=>{assert.equal(text(inlineMarkup('value **12')),'value **12');assert.equal(text(inlineMarkup('value **12** ready')),'value 12 ready');assert.equal(text(inlineMarkup('value `run')),'value `run');assert.equal(text(inlineMarkup('value `run.py` ready')),'value run.py ready');});
test('paragraph boundaries and user line breaks are retained',()=>{assert.deepEqual(messageMarkup('first\nline\n\nsecond'),[{type:'paragraph',text:'first\nline'},{type:'paragraph',text:'second'}]);});
test('basic ordered and unordered lists keep sequence and starting number',()=>{assert.deepEqual(messageMarkup('- file\n- review\n\n3. inspect\n4. execute'),[{type:'ul',start:1,items:['file','review']},{type:'ol',start:3,items:['inspect','execute']}]);});
test('fenced scripts are inert exact strings without inline interpretation',()=>{const source='steps = 12\nprint("<script> & **literal**")\n';assert.deepEqual(messageMarkup('```python\n'+source+'```'),[{type:'code',text:source,closed:true}]);});
test('incomplete fenced code keeps opening marker and all received characters',()=>{const raw='```python\nsteps = 12\n';assert.deepEqual(messageMarkup(raw),[{type:'code',text:raw,closed:false}]);});
test('tilde fences and longer closing fences are recognized without HTML syntax',()=>{assert.deepEqual(messageMarkup('~~~\ntext\n~~~~'),[{type:'code',text:'text\n',closed:true}]);});
test('HTML, image, javascript and data URL payloads remain text leaves',()=>{const payload='<img src="https://example.invalid/pixel" onerror="evil()">\n<script>evil()</script>\n[x](javascript:evil())\n![x](data:text/html,evil)';const blocks=messageMarkup(payload);assert.equal(text(inlineMarkup(blocks[0].text)),payload);assert.equal(JSON.stringify(blocks).includes('href'),false);});
test('escape handling does not interpret paths or scientific backslashes',()=>{assert.equal(text(inlineMarkup(String.raw`C:\Users\Name\run.py and \**literal**`)),String.raw`C:\Users\Name\run.py and **literal**`);});
test('all streamed prefixes retain only a bounded inert node vocabulary',()=>{const raw='目标 **12** `run.py`\n\n- 审阅\n- 保存\n\n```python\nprint("<img>")\n```';for(let end=0;end<=raw.length;end++){const blocks=messageMarkup(raw.slice(0,end));for(const block of blocks){assert(['paragraph','code','ul','ol'].includes(block.type));if(block.type==='paragraph')for(const node of inlineMarkup(block.text))assert(['text','code','strong'].includes(node.type));}}});

test('ATX headings support six levels, Chinese strong and paragraph interruption',()=>{
 for(let level=1;level<=6;level++)assert.deepEqual(messageMarkup('#'.repeat(level)+' **队列事实** ###'),[{type:'heading',level,text:'**队列事实**'}]);
 assert.deepEqual(messageMarkup('说明\n## 队列事实\n正文').map(b=>b.type),['paragraph','heading','paragraph']);
 for(const raw of ['####### 七级','#无空格',String.raw`\# 转义`])assert.equal(messageMarkup(raw)[0].type,'paragraph');
 assert.equal(inlineMarkup('**中文加粗**')[0].type,'strong');
});
test('GFM tables preserve alignment, strong cells, escaped pipes and uneven rows',()=>{
 const block=messageMarkup(String.raw`| 队列 | **状态** | 数量 |
| :--- | :---: | ---: |
| 队\|列 | **可用** | 12 |
| 短行 |
| A | B | C | excess |`)[0];
 assert.equal(block.type,'table');assert.deepEqual(block.align,['left','center','right']);
 assert.equal(text(inlineMarkup(block.rows[0][0])),'队|列');assert.equal(inlineMarkup(block.rows[0][1])[0].type,'strong');
 assert.deepEqual(block.rows[1],['短行','','']);assert.deepEqual(block.rows[2],['A','B','C']);
 assert.equal(messageMarkup('A | B\n--- | invalid')[0].type,'paragraph');
 assert.equal(messageMarkup('A | B\n---')[0].type,'paragraph');
 assert.equal(messageMarkup('A | B\n--- | ---\nx | y')[0].type,'table');
});
test('streamed headings and tables stay inert, fenced table text stays code',()=>{
 const raw='## 队列事实\n\n| 队列 | 状态 |\n| :--- | ---: |\n| **学校** | <img onerror="evil()"> |';
 for(let end=0;end<=raw.length;end++)for(const b of messageMarkup(raw.slice(0,end)))assert(['heading','table','paragraph'].includes(b.type));
 assert.equal(messageMarkup('```text\n'+raw+'\n```')[0].type,'code');
 assert.equal(messageMarkup('| 队列 | 状态 |\n| :--')[0].type,'paragraph');
});
test('escaped pipes inside table code spans render without the GFM escape',()=>{
 const table=messageMarkup('| code | other |\n| --- | --- |\n| `a\\|b` | x |')[0];
 assert.deepEqual(inlineMarkup(table.rows[0][0]),[{type:'code',text:'a|b'}]);
});
