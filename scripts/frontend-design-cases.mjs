import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendDesignCases({check,out}) {
  await check('design-default-typography-recommendation-is-previewed',async page=>{
    await page.setViewportSize({width:1024,height:768});
    await page.evaluate(()=>window.renderTest('App'));
    const settings=page.getByRole('button',{name:'设置',exact:true}).filter({visible:true});
    await settings.click();
    const dialog=page.getByRole('dialog');
    const minimum=dialog.getByTestId('minimum-font');
    assert.equal(await minimum.inputValue(),'13');
    const preview=dialog.getByTestId('typography-preview');
    const [previewBox,footerBox]=await Promise.all([preview.boundingBox(),dialog.locator('.settings-footer').boundingBox()]);
    assert(previewBox&&footerBox&&previewBox.y+previewBox.height<=footerBox.y,'preview is above the settings actions');
    const sizes=()=>preview.evaluate(node=>['caption','meta','body','title'].map(level=>
      Number.parseFloat(getComputedStyle(node.querySelector('.settings-type-'+level)).fontSize)));
    const defaults=await sizes();
    assert(defaults.every((size,index)=>index===0||size>defaults[index-1]));
    assert.equal(defaults[2],18);
    await minimum.fill('17');
    await minimum.press('Tab');
    const crowded=await sizes();
    assert.deepEqual(crowded.slice(0,2),[17,17]);
    await dialog.getByRole('button',{name:'保存设置',exact:true}).click();
    await dialog.getByText('设置已保存',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__test.settings.minimumFontSize),17);
    await dialog.getByTestId('recommended-minimum-font').click();
    assert.deepEqual(await sizes(),defaults);
    assert.equal(await page.evaluate(()=>window.__test.settings.minimumFontSize),17);
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await settings.click();
    assert.equal(await minimum.inputValue(),'17');
    await page.screenshot({path:path.join(out,'typography-saved-setting.png')});
  });

  await check('design-workspace-shortcuts-focus-and-compact-panes',async page=>{
    await page.setViewportSize({width:1366,height:768});
    await page.evaluate(()=>window.renderTest('App'));
    const sidebar=page.locator('nav.sidebar');
    const focusShell=()=>page.locator('.window-buttons button').first().focus();
    const dialog=page.getByRole('dialog');
    await focusShell();
    await page.keyboard.press('Control+/');
    await dialog.getByTestId('workspace-shortcuts').waitFor();
    assert.match(await dialog.innerText(),/Ctrl\+K[\s\S]*Ctrl\+N[\s\S]*Ctrl\+B[\s\S]*Ctrl\+J[\s\S]*Ctrl\+,[\s\S]*Ctrl\+\//);
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    await focusShell();
    await page.keyboard.press('Control+,');
    await dialog.getByTestId('minimum-font').waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    await focusShell();
    await page.keyboard.press('Control+b');
    await sidebar.waitFor({state:'hidden'});
    await page.keyboard.press('Control+b');
    await sidebar.waitFor();
    const bottom=page.getByTestId('toggle-bottom-panel');
    const before=await bottom.getAttribute('aria-expanded');
    await page.keyboard.press('Control+j');
    assert.notEqual(await bottom.getAttribute('aria-expanded'),before);
    const composer=page.locator('.composer textarea');
    await composer.fill('Keep this shortcut test draft');
    await composer.press('Control+n');
    await composer.press('Control+b');
    await composer.press('Control+j');
    await composer.press('Control+,');
    assert.equal(await dialog.count(),0);
    assert.equal(await sidebar.isVisible(),true);
    assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='conversation.select'&&call.data?.new).length),0);
    await composer.press('Control+k');
    const search=dialog.getByRole('textbox',{name:'搜索页面、引擎或任务…'});
    await search.fill('ctrl+n');
    await dialog.getByRole('button',{name:'新对话',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert.equal(await composer.evaluate(element=>element===document.activeElement),true);
    await page.setViewportSize({width:1024,height:768});
    const work=page.getByTestId('show-workspace'),chat=page.getByTestId('show-agent');
    await work.press('Enter');
    await composer.waitFor({state:'hidden'});
    await chat.press('Enter');
    assert.equal(await composer.inputValue(),'Keep this shortcut test draft');
    await page.getByTestId('show-split-panels').press('Enter');
    await page.locator('.main-column').waitFor();
    await page.getByTestId('navigate-tools').filter({visible:true}).press('Enter');
    await page.getByRole('heading',{name:'工具',exact:true}).waitFor();
    await page.waitForFunction(()=>document.activeElement?.matches('.workspace-content h1'));
    const scroll=page.locator('.workspace-content');
    await scroll.evaluate(node=>{node.scrollTop=120;});
    await page.waitForFunction(()=>document.querySelector('.workspace-content').scrollTop>0);
    const previous=await scroll.evaluate(node=>node.scrollTop);
    await page.getByTestId('navigate-runs').filter({visible:true}).press('Enter');
    await page.getByTestId('tools-directory').waitFor({state:'detached'});
    await page.getByTestId('navigate-tools').filter({visible:true}).press('Enter');
    await page.waitForFunction(top=>document.querySelector('.workspace-content').scrollTop===top,previous);
    await focusShell();
    await page.keyboard.press('Control+n');
    await page.waitForFunction(()=>window.__test.calls.filter(call=>call.method==='conversation.select'&&call.data?.new).length===1);
  });

  await check('design-editor-shortcuts-and-confirmation-preserve-the-draft',async page=>{
    await page.evaluate(()=>{
      const invoke=window.studio.invoke;
      window.studio.invoke=(method,data)=>method==='file.open'
        ?Promise.resolve({id:'fixture-source',name:'fixture.py',path:'/fixture/source.py',content:'# original'})
        :invoke(method,data);
      return window.renderTest('App');
    });
    const panel=page.getByTestId('toggle-bottom-panel');
    if(await panel.getAttribute('aria-expanded')==='false')await panel.click();
    await page.getByRole('button',{name:'打开源码',exact:true}).click();
    const editor=page.locator('.monaco-editor textarea.inputarea');
    await editor.waitFor({timeout:30000});
    await editor.press('End');
    await page.keyboard.type(' changed');
    await page.locator('.editor-path').getByText('未保存',{exact:true}).waitFor();
    await editor.press('Control+n');
    await editor.press('Control+j');
    assert.equal(await panel.getAttribute('aria-expanded'),'true');
    assert.equal(await page.evaluate(()=>window.__test.calls.some(call=>call.method==='conversation.select'&&call.data?.new)),false);
    await editor.press('Control+k');
    await page.getByRole('dialog',{name:'搜索与命令'}).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    const tools=page.getByTestId('navigate-tools').filter({visible:true});
    await tools.click();
    const confirm=page.getByRole('dialog',{name:'离开编辑器'});
    await confirm.getByTestId('confirm-editor-replace').waitFor();
    assert.equal(await confirm.getByRole('button',{name:'取消',exact:true}).evaluate(node=>node===document.activeElement),true);
    await page.screenshot({path:path.join(out,'editor-confirmation.png')});
    await page.keyboard.press('Escape');
    await confirm.waitFor({state:'hidden'});
    assert.match(await page.locator('.monaco-editor .view-lines').innerText(),/original\s+changed/);
    await tools.click();
    await confirm.getByTestId('confirm-editor-replace').press('Enter');
    await page.getByRole('heading',{name:'工具',exact:true}).waitFor();
  });

  await check('design-layout-switches-visible-panes',async page=>{
    await page.setViewportSize({width:1366,height:768});
    await page.evaluate(()=>window.renderTest('App'));
    const shell=page.locator('.workspace-shell');
    const agent=shell.locator('.workspace-panels>.agent-panel');
    const workspace=shell.locator('.workspace-panels>.main-column');
    const draft=agent.locator('.composer textarea');
    const menu=shell.locator('.workspace-layout-menu>summary');
    async function choose(mode){
      await menu.click();
      await page.getByTestId('priority-'+mode).click();
    }
    async function expectSplit(chatFirst){
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.workspace-panels>.main-column,.workspace-panels>.agent-panel')).filter(pane=>pane.getClientRects().length).length===2);
      const a=await agent.boundingBox(),w=await workspace.boundingBox();
      assert(a&&w);
      assert.equal(a.x<w.x,chatFirst);
      assert.equal(a.width>w.width,chatFirst);
    }
    await draft.fill('Unsent layout regression draft');
    await choose('chat');await expectSplit(true);
    await shell.locator('nav:visible').getByTestId('navigate-runs').click();
    await expectSplit(false);
    await choose('chat');await expectSplit(true);
    await shell.locator('.agent-panel-toggle').click();
    assert.equal(await agent.isVisible(),false);
    await choose('chat');await expectSplit(true);
    await page.setViewportSize({width:640,height:720});
    await choose('workflow');await workspace.waitFor();assert.equal(await agent.isVisible(),false);
    await choose('chat');await agent.waitFor();assert.equal(await workspace.isVisible(),false);
    assert.equal(await draft.inputValue(),'Unsent layout regression draft');
    await page.setViewportSize({width:1366,height:768});await expectSplit(true);
    await choose('workflow');await expectSplit(false);
    await shell.locator('nav:visible').getByTestId('navigate-home').click();
    await expectSplit(true);
    assert.equal(await draft.inputValue(),'Unsent layout regression draft');
    const settings=await page.evaluate(()=>window.__test.settings);
    assert.equal(settings.agentLayout,'center');assert.equal(settings.overviewAgentLayout,'right');
  });
  for (const [width,theme,language] of [[1366,'dark','zh-CN'],[1024,'light','en']]) {
    await check('design-settings-help-'+theme,async page=>{
      await page.setViewportSize({width,height:768});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate(({theme,language})=>{
        Object.assign(window.__test.settings,{theme,language,minimumFontSize:18});
        return window.renderTest('App');
      },{theme,language});
      const settings=page.getByRole('button',{name:language==='en'?'Settings':'设置',exact:true}).first();
      await settings.click();
      const dialog=page.getByRole('dialog');
      const input=dialog.getByTestId('minimum-font');
      const help=dialog.locator('.settings-field').filter({has:page.getByTestId('minimum-font')}).getByRole('button',{name:/帮助|Help/});
      const popup=page.getByRole('tooltip').filter({hasText:/各自的字号设置|their own font settings/});
      await help.hover();
      await popup.waitFor();
      const explanation=await popup.innerText();
      assert(explanation.length>8);
      assert.equal(await help.getAttribute('aria-describedby'),await popup.getAttribute('id'));
      const rect=await popup.boundingBox();
      assert(rect && rect.x>=0 && rect.x+rect.width<=width && rect.y>=0 && rect.y+rect.height<=768);
      const aboveNotifications=await popup.evaluate(tip=>{
        const notification=document.createElement('div');
        const box=tip.getBoundingClientRect();
        Object.assign(notification.style,{position:'fixed',left:box.left+'px',top:box.top+'px',right:'auto',bottom:'auto',
          width:box.width+'px',height:box.height+'px',transform:'none'});
        document.body.append(notification);
        try{
          return ['toast notice-surface','codex-version-notice'].every(classes=>{
            notification.className=classes;
            return document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)===tip;
          });
        }finally{notification.remove();}
      });
      assert.equal(aboveNotifications,true,'help remains readable when a later notification overlaps');
      await page.screenshot({path:path.join(out,'settings-help-'+theme+'.png')});
      await page.keyboard.press('Escape');
      await popup.waitFor({state:'hidden'});
      assert(await dialog.isVisible());
      assert(!(await dialog.innerText()).includes(explanation));
      await page.mouse.move(1,1);
      await input.focus();
      await page.keyboard.press('Shift+Tab');
      assert(await help.evaluate(node=>document.activeElement===node));
      await popup.waitFor();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
      await popup.waitFor();
      assert.equal(await popup.innerText(),explanation);
      const transforms=await dialog.evaluate(node=>node.getAnimations().flatMap(animation=>
        animation.effect?.getKeyframes().map(frame=>frame.transform).filter(Boolean)??[]));
      assert.deepEqual(transforms,[],'reduced motion has no position or scale animation');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'hidden'});
      await page.emulateMedia({reducedMotion:'no-preference'});
      await settings.click();
      const motion=await dialog.evaluate(node=>{
        const style=getComputedStyle(node);
        return {name:style.animationName,seconds:parseFloat(style.animationDuration)};
      });
      assert.notEqual(motion.name,'none');
      assert(motion.seconds>0 && motion.seconds<0.5);
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'hidden'});
    });
  }
}
